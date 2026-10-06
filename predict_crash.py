#!/usr/bin/env python3
"""
Batch crash detection over a video file using the SHARED pipeline
(src/stage1_motion_gate.py - Regime A: windowed median/MAD thresholds,
7-consecutive-frame persistence trigger, JSON baseline persistence).

NOTE: the motion gate arms only after `calibration_min_frames` (300) scores
have been collected for the active lighting mode; earlier frames cannot
trigger. Pre-calibrated cameras load their baseline JSON automatically.

Usage:
    python predict_crash.py /path/to/video.mp4 [model.pt] [--camera-id ID]

Output:
    <video>_alerts.json
"""

import sys
import json
import argparse
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.stage1_motion_gate import MotionGate, FeatureExtractor, RuleClassifier


def _to_jsonable(obj):
    if isinstance(obj, (np.integer, np.floating)):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, dict):
        return {k: _to_jsonable(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_to_jsonable(v) for v in obj]
    return obj


def run_detection(video_path: str, model_path: str = "yolo26n.pt",
                  camera_id: str = "cam_001"):
    print(f"Loading YOLO from {model_path}...")
    model = YOLO(model_path)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"ERROR: Cannot open {video_path}")
        return []

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"Video: {width}x{height} @ {fps:.1f} FPS ({total} frames)")

    gate = MotionGate(camera_id=camera_id, physics_window=5)
    extractor = FeatureExtractor(window_size=30)
    classifier = RuleClassifier()

    alerts = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame_idx += 1

        gate_result = gate.check(frame)

        results = model(frame, conf=0.25, verbose=False)
        detections = []
        if results and results[0].boxes is not None:
            for box in results[0].boxes:
                cls_id = int(box.cls[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                detections.append({
                    "bbox": (x1, y1, x2, y2),
                    "center": ((x1 + x2) // 2, (y1 + y2) // 2),
                    "class": model.names[cls_id] if cls_id < len(model.names) else f"cls_{cls_id}",
                    "conf": float(box.conf[0]),
                })

        tracks = extractor.update(detections, frame, frame_idx=frame_idx)
        pair_features = extractor.all_pair_features()

        for tid, track in tracks.items():
            features = extractor.get_features(tid)
            if not features:
                continue
            label = classifier.predict(features, frame_idx, pair_features)
            if label != "normal":
                alerts.append({
                    "frame": frame_idx,
                    "time": frame_idx / fps,
                    "track_id": tid,
                    "class": track.class_name,
                    "label": label,
                    "features": features,
                    "bbox": track.bbox,
                })
                f = features
                print(f"[ALERT] Frame {frame_idx} ({frame_idx/fps:.1f}s): {label.upper()} "
                      f"- Track {tid} ({track.class_name}) "
                      f"H={f['max_heading_change']:.2f} FS={f['flow_spike']:.2f} "
                      f"AR={f['ar_oscillation']:.2f} frag={f['fragmentation']}")

        if frame_idx % 100 == 0:
            state = "TRIGGERED" if gate_result.triggered else "NORMAL"
            print(f"  {frame_idx}/{total} | gate={state} "
                  f"thr={gate_result.threshold:.3f} mode={gate_result.mode}")

    cap.release()

    print("\n=== DETECTION SUMMARY ===")
    print(f"Total frames: {frame_idx}")
    print(f"Total alerts: {len(alerts)}")

    out_path = str(Path(video_path).with_name(Path(video_path).stem + "_alerts.json"))
    with open(out_path, "w") as f:
        json.dump(_to_jsonable(alerts), f, indent=2)
    print(f"Results saved to: {out_path}")

    return alerts


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Batch crash detection (shared Regime-A pipeline)")
    parser.add_argument("video")
    parser.add_argument("model", nargs="?", default="yolo26n.pt")
    parser.add_argument("--camera-id", default="cam_001")
    args = parser.parse_args()
    run_detection(args.video, args.model, args.camera_id)
