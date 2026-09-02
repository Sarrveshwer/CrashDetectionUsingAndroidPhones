#!/usr/bin/env python3
"""
Per-stage profiler for the crash-detection pipeline.

Does NOT modify stage1_motion_gate.py — it imports it and reproduces the same
call sequence as run_realtime(), with a timer wrapped around each stage:
  read frame | motion gate | YOLO inference | tracker+flow update |
  pairwise features | classification loop | draw_panel | writer.write

Usage:
  python profile_pipeline.py /path/to/video.mp4 --stride 3 --frames 900

Notes:
  - Uses --calibrate-only semantics implicitly OFF (we want YOLO+tracking
    timed, since that's almost certainly where the phone budget will blow up).
  - Does not write an annotated output video by default (I/O to disk is its
    own cost and would muddy the CPU-bound numbers) - pass --write-video to
    include it if you want that cost measured too.
  - Stops after --frames frames (default 900 = 30s at 30fps) so you get a
    fast, representative read without processing an entire clip.
"""

import argparse
import os
import sys
import time
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import cv2
import numpy as np

import stage1_motion_gate as sg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--stride", type=int, default=3)
    ap.add_argument("--frames", type=int, default=900)
    ap.add_argument("--mode", default="auto")
    ap.add_argument("--write-video", action="store_true")
    ap.add_argument("--report-every", type=int, default=150)
    ap.add_argument("--skip-yolo", action="store_true",
                     help="Skip model load + inference entirely. Isolates motion-gate "
                          "+ optical-flow cost fast, without waiting on YOLO. Tracks/"
                          "classification will be near-empty (no detections feed them) "
                          "but tracker_and_flow_update still runs real Farneback flow "
                          "every frame, which is the number you actually want first.")
    args = ap.parse_args()

    model = None
    if not args.skip_yolo:
        print("Loading YOLO...")
        model = sg.YOLO("yolo26n.pt")
        model.to("cpu")
    else:
        print("--skip-yolo: motion gate + optical flow only, no detection/model load")

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        print(f"ERROR: cannot open {args.video}")
        sys.exit(1)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    print(f"Video: {width}x{height} @ {fps:.1f} FPS")

    gate = sg.MotionGate(camera_id="profile_cam", physics_window=5, suppress_alerts=True)
    if args.mode != "auto":
        gate.threshold_mgr.classifier.forced_mode = args.mode
        gate.threshold_mgr.classifier.initialized = True
        gate.threshold_mgr.classifier.current_mode = args.mode

    extractor = sg.FeatureExtractor(window_size=30)
    classifier = sg.RuleClassifier()

    writer = None
    if args.write_video:
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        writer = cv2.VideoWriter("profile_annotated.mp4", fourcc, fps, (width, height + 350))

    times = defaultdict(float)   # stage -> total seconds
    counts = defaultdict(int)    # stage -> number of times it ran (YOLO/panel don't run every frame)

    def timed(stage):
        """Context manager that accumulates wall time into times[stage]."""
        class _T:
            def __enter__(self):
                self.t0 = time.perf_counter()
                return self
            def __exit__(self, *exc):
                times[stage] += time.perf_counter() - self.t0
                counts[stage] += 1
        return _T()

    frame_idx = 0
    last_detections = []
    tracks = {}
    yolo_every = max(1, args.stride)
    wall_start = time.perf_counter()

    while frame_idx < args.frames:
        with timed("read_frame"):
            ret, frame = cap.read()
        if not ret:
            print("Video ended before --frames reached.")
            break
        frame_idx += 1

        with timed("motion_gate"):
            gate_result = gate.check(frame)

        if not args.skip_yolo and frame_idx % yolo_every == 0:
            with timed("yolo_inference"):
                results = model(frame, conf=0.25, verbose=False, device="cpu")
            last_detections = []
            if results and results[0].boxes is not None:
                for box in results[0].boxes:
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
                    conf = float(box.conf[0])
                    cls_id = int(box.cls[0])
                    cls_name = model.names[cls_id] if cls_id < len(model.names) else f"cls_{cls_id}"
                    last_detections.append({"bbox": (x1, y1, x2, y2), "center": (cx, cy),
                                             "class": cls_name, "conf": conf})

        # This is the call that matters most: extractor.update() runs dense
        # Farneback optical flow EVERY frame regardless of --stride (only YOLO
        # is gated by stride in run_realtime). If this line dominates the
        # breakdown, that confirms optical flow (not YOLO) is your bottleneck.
        with timed("tracker_and_flow_update"):
            tracks = extractor.update(last_detections, frame, frame_idx=frame_idx)

        with timed("pairwise_features"):
            pair_features = extractor.all_pair_features()

        with timed("classification_loop"):
            for tid, track in tracks.items():
                f = extractor.get_features(tid)
                if f:
                    classifier.predict(f, frame_idx, pair_features)

        if args.write_video:
            with timed("draw_panel"):
                canvas = sg.draw_panel(frame, gate_result, tracks, extractor, classifier,
                                        frame_idx, pair_features)
            with timed("writer_write"):
                writer.write(canvas)

        if frame_idx % args.report_every == 0:
            elapsed = time.perf_counter() - wall_start
            fps_actual = frame_idx / elapsed
            print(f"  [{frame_idx}/{args.frames}] {fps_actual:.2f} fps so far "
                  f"({elapsed:.1f}s elapsed)")

    cap.release()
    if writer is not None:
        writer.release()

    total_wall = time.perf_counter() - wall_start
    total_stage_time = sum(times.values())

    print("\n" + "=" * 64)
    print(f"PROFILE REPORT — {frame_idx} frames, stride={args.stride}")
    print("=" * 64)
    print(f"{'stage':<24}{'total s':>10}{'% of wall':>12}{'calls':>8}{'ms/call':>10}")
    print("-" * 64)
    for stage, t in sorted(times.items(), key=lambda kv: -kv[1]):
        pct = 100.0 * t / total_wall if total_wall > 0 else 0.0
        n = counts[stage]
        ms_per_call = 1000.0 * t / n if n else 0.0
        print(f"{stage:<24}{t:>10.2f}{pct:>11.1f}%{n:>8}{ms_per_call:>9.2f}ms")
    print("-" * 64)
    overall_fps = frame_idx / total_wall if total_wall > 0 else 0.0
    print(f"Wall time: {total_wall:.2f}s  |  Overall: {overall_fps:.2f} fps "
          f"(video source is {fps:.1f} fps -> "
          f"{'REAL-TIME OK' if overall_fps >= fps else 'SLOWER than real-time'})")
    print("=" * 64)
    print("\nInterpretation:")
    print(" - If 'tracker_and_flow_update' dominates: dense optical flow is your")
    print("   bottleneck, not YOLO. On a phone this gets categorically worse, and")
    print("   the fix is switching to sparse/ROI-only flow or dropping it.")
    print(" - If 'yolo_inference' dominates: model size/resolution is the lever;")
    print("   a TFLite/NNAPI export will matter most here.")
    print(" - 'ms/call' for yolo_inference matters more than its %, since it only")
    print("   runs 1-in-N frames (N=stride) — a slow per-call cost still stalls")
    print("   every Nth frame's presentation, which is what causes visible stutter.")


if __name__ == "__main__":
    main()