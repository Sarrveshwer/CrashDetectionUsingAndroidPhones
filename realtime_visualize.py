#!/usr/bin/env python3
"""
Real-time viewer for the shared crash-detection pipeline
(src/stage1_motion_gate.py - single Regime-A engine, unified 300-px panel).

Controls: SPACE=pause, Q/ESC=quit, S=step frame (while paused).
Usage:    python realtime_visualize.py /path/to/video.mp4
"""

import sys
import time
import os
from collections import deque
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

# Add src/ to path FIRST so that `import stage1_motion_gate` (bare) works for v2
src_path = str(Path(__file__).resolve().parent / "src")
sys.path.insert(0, src_path)

# Now import base classes from stage1_motion_gate
from stage1_motion_gate import (
    FeatureExtractor,
    RuleClassifier,
    draw_panel,
)

# Import SmoothedMotionGate from v2 module (which also does `import stage1_motion_gate`)
import stage1_motion_gate_v2 as sg_v2
SmoothedMotionGate = sg_v2.SmoothedMotionGate


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    video_path = sys.argv[1]

    print("Loading YOLO...")
    model = YOLO("yolo26n.pt")
    # Print available class names at startup for filter configuration
    print(f"YOLO class names: {model.names}")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"ERROR: Cannot open {video_path}")
        return

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"Video: {width}x{height} @ {fps:.1f} FPS ({total} frames)")
    print("Controls: SPACE=pause, Q=quit, S=step frame (paused)")
    print("          F=toggle class filter (default: vehicles + person)")

    # Use the FIXED gate (EMA smoothing + X-of-Y persistence) from v2
    gate = SmoothedMotionGate(camera_id="cam_001", physics_window=5)
    extractor = FeatureExtractor(window_size=30)
    classifier = RuleClassifier()

    # Optional detection class filter — default to vehicle + person relevant classes
    # Using exact strings from model.names at runtime
    default_allowed = {"car", "truck", "bus", "motorcycle", "bicycle", "person"}
    available = set(model.names.values()) if isinstance(model.names, dict) else set(model.names)
    allowed_classes = default_allowed & available
    print(f"Allowed detection classes: {sorted(allowed_classes)}")
    use_class_filter = True

    window_name = "Crash Detection"
    cv2.namedWindow(window_name, cv2.WINDOW_NORMAL)

    paused = False
    frame_idx = 0

    # For real-time pacing: target frame interval (seconds)
    target_interval = 1.0 / fps if fps > 0 else 1.0 / 30.0

    # For alert clip buffering (requirement #8) — rolling buffer of raw frames
    alert_buffer_seconds = 5
    alert_buffer = deque(maxlen=int(alert_buffer_seconds * fps) + 10)
    alert_writer = None
    alert_recording = False
    alert_recording_frames_remaining = 0
    post_alert_buffer_frames = int(2 * fps)  # 2 seconds after alert

    while True:
        loop_start = time.perf_counter()

        if not paused:
            ret, frame = cap.read()
            if not ret:
                print("Video ended")
                break
            frame_idx += 1

            # Store raw frame in alert buffer (before any annotations)
            alert_buffer.append(frame.copy())

        gate_result = gate.check(frame)

        # YOLO detection (run every frame for viewer responsiveness)
        results = model(frame, conf=0.25, verbose=False)
        detections = []
        if results and results[0].boxes is not None:
            for box in results[0].boxes:
                cls_id = int(box.cls[0])
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                cls_name = model.names[cls_id] if cls_id < len(model.names) else f"cls_{cls_id}"
                if use_class_filter and cls_name not in allowed_classes:
                    continue
                detections.append({
                    "bbox": (x1, y1, x2, y2),
                    "center": ((x1 + x2) // 2, (y1 + y2) // 2),
                    "class": cls_name,
                    "conf": float(box.conf[0]),
                })

        # Stage 2/3 run continuously (not gated by trigger)
        tracks = extractor.update(detections, frame, frame_idx=frame_idx)
        pair_features = extractor.all_pair_features()

        display = frame.copy()
        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            cv2.rectangle(display, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(display, f"{det['class']} {det['conf']:.2f}", (x1, y1 - 5),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)

        for tid, track in tracks.items():
            x1, y1, x2, y2 = track.bbox
            cx, cy = track.center
            cv2.rectangle(display, (x1, y1), (x2, y2), (255, 0, 255), 3)
            if len(track.history) > 1:
                pts = np.array([(x, y) for (_f, x, y) in track.history[-30:]], dtype=np.int32)
                cv2.polylines(display, [pts], False, (255, 255, 0), 2)

            f = extractor.get_features(tid)
            if f:
                cl = classifier.predict(f, frame_idx, pair_features)
                color = {"collision": (0, 0, 255), "rollover": (0, 165, 255)}.get(cl, (0, 255, 0))
                cv2.putText(display, f"ID:{tid} {cl.upper()}", (x1, y1 - 10),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)

        # --- 1. Persistent status readout (on the display frame, before panel) ---
        # GateResult: triggered, threshold, smoothed_score, raw_score, mode, profile
        # profile (V2BaselineState) has: consecutive_above (repurposed as X-of-Y count),
        # persist_frames, persist_window
        profile = gate_result.profile
        if profile is not None:
            persist_current = getattr(profile, 'consecutive_above', 0)
            persist_needed = gate.threshold_mgr.persist_frames
            persist_window = gate.threshold_mgr.persist_window
        else:
            persist_current = 0
            persist_needed = gate.threshold_mgr.persist_frames
            persist_window = gate.threshold_mgr.persist_window

        mode_str = gate_result.mode.upper()
        status_lines = [
            f"MODE: {mode_str}",
            f"RAW: {gate_result.raw_score:.3f}  SMOOTHED: {gate_result.smoothed_score:.3f}  THR: {gate_result.threshold:.3f}",
            f"PERSIST: {persist_current}/{persist_needed}  (window={persist_window})",
            f"GATE: {'TRIGGERED' if gate_result.triggered else 'NORMAL'}",
        ]
        y0 = 20
        for i, line in enumerate(status_lines):
            color = (0, 255, 255) if i < 3 else ((0, 0, 255) if gate_result.triggered else (0, 220, 0))
            cv2.putText(display, line, (10, y0 + i * 22),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.55, color, 2)

        # --- 2. Obvious alert-state visual change ---
        if gate_result.triggered:
            # Thick red border around full display canvas
            h, w = display.shape[:2]
            cv2.rectangle(display, (0, 0), (w - 1, h - 1), (0, 0, 255), 6)
            # Also a semi-transparent red overlay banner at top
            overlay = display.copy()
            cv2.rectangle(overlay, (0, 0), (w, 50), (0, 0, 200), -1)
            cv2.addWeighted(overlay, 0.3, display, 0.7, 0, display)
            cv2.putText(display, "!!! MOTION GATE TRIGGERED !!!", (w // 2 - 180, 35),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (255, 255, 255), 2)

        # --- 3. Per-track classification vote/debounce visibility ---
        # Classifier stores votes in _votes dict with keys ("track", tid) or ("pair", (a,b))
        # Add a read-only accessor method to expose current vote state without mutation
        # (We'll add it as a monkey-patch here since we can't modify stage1_motion_gate.py
        # per constraints — but actually we CAN add a minimal accessor if needed)
        # Let's expose it via a helper that reads the internal structure:
        def get_vote_info(classifier_obj, key):
            """Return (vote_count, window_size, label) for a vote key, or None."""
            q = classifier_obj._votes.get(key)
            if q is None:
                return None
            return (sum(q), len(q), classifier_obj._last_label.get(key[1]) if key[0] == "track" else None)

        for tid, track in tracks.items():
            # Track vote info
            vinfo = get_vote_info(classifier, ("track", tid))
            if vinfo and vinfo[0] > 0:
                vote_count, window_sz, _ = vinfo
                x1, y1, x2, y2 = track.bbox
                cv2.putText(display, f"rollover vote {vote_count}/{window_sz}", (x1, y2 + 18),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 165, 255), 1)

            # Pair vote info for pairs involving this track
            for pk, pf in pair_features.items():
                if tid not in pk:
                    continue
                vinfo = get_vote_info(classifier, ("pair", pk))
                if vinfo and vinfo[0] > 0:
                    vote_count, window_sz, _ = vinfo
                    other_tid = pk[1] if pk[0] == tid else pk[0]
                    if other_tid in tracks:
                        other = tracks[other_tid]
                        # --- 4. Pairwise interaction visualization ---
                        # Draw line between centers if pair is near/above corroboration threshold
                        # Use same logic as classifier._pair_collision to decide when to draw
                        iou = pf["iou_now"]
                        iou_trend = pf["iou_trend"]
                        closing_vel = pf["closing_velocity"]
                        decel_close_vel = pf["decel_closing_velocity"]
                        dist = pf["dist_now"]

                        # Corroboration thresholds from classifier
                        iou_contact = classifier.iou_contact
                        iou_rise = classifier.iou_approach_rise
                        min_close = classifier.min_closing_vel
                        decel_close = classifier.decel_close_vel
                        appr_dist = classifier.approach_dist

                        contact = iou >= iou_contact
                        approaching = iou_trend >= iou_rise
                        closing = closing_vel >= min_close and dist <= appr_dist
                        matched_decel = decel_close_vel >= decel_close
                        corroborating = contact or approaching or (closing and matched_decel)

                        if corroborating or vote_count > 0:
                            # Draw connecting line with label
                            c1 = track.center
                            c2 = other.center
                            cv2.line(display, (int(c1[0]), int(c1[1])), (int(c2[0]), int(c2[1])),
                                     (0, 255, 255), 2)
                            mid_x = int((c1[0] + c2[0]) / 2)
                            mid_y = int((c1[1] + c2[1]) / 2)
                            label = f"IoU={iou:.2f} dIoU={iou_trend:+.3f} vclose={closing_vel:.1f}"
                            cv2.putText(display, label, (mid_x - 80, mid_y),
                                        cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 255), 1)
                            if vote_count > 0:
                                cv2.putText(display, f"collision vote {vote_count}/{window_sz}",
                                            (mid_x - 60, mid_y + 16),
                                            cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 255), 1)

        # --- 5. Panel with dynamic height from draw_panel return ---
        canvas = draw_panel(display, gate_result, tracks, extractor, classifier, frame_idx, pair_features)
        # Size window from actual canvas shape (avoids hardcoded 300/350 mismatch)
        cv2.resizeWindow(window_name, canvas.shape[1], canvas.shape[0])

        # --- 8. Alert clip buffering ---
        any_alert = gate_result.triggered or any(
            classifier.predict(extractor.get_features(tid), frame_idx, pair_features) != "normal"
            for tid in tracks if extractor.get_features(tid)
        )
        if any_alert and not alert_recording:
            # Start recording
            alert_recording = True
            alert_recording_frames_remaining = post_alert_buffer_frames
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            ts = time.strftime("%Y%m%d_%H%M%S")
            alert_path = f"alert_{ts}.mp4"
            alert_writer = cv2.VideoWriter(alert_path, fourcc, fps, (width, height))
            print(f"[ALERT] Started recording to {alert_path}")
            # Write buffered pre-alert frames
            for buf_frame in alert_buffer:
                alert_writer.write(buf_frame)

        if alert_recording and alert_writer is not None:
            alert_writer.write(display)
            alert_recording_frames_remaining -= 1
            if alert_recording_frames_remaining <= 0:
                alert_writer.release()
                alert_writer = None
                alert_recording = False
                print(f"[ALERT] Finished recording")

        cv2.imshow(window_name, canvas)

        # --- 6. Playback pacing ---
        elapsed = time.perf_counter() - loop_start
        sleep_time = target_interval - elapsed
        wait_ms = 1 if paused else max(1, int(sleep_time * 1000))
        key = cv2.waitKey(wait_ms) & 0xFF
        if key in (ord('q'), 27):
            break
        elif key == ord(' '):
            paused = not paused
        elif key == ord('s') and paused:
            ret, frame = cap.read()
            if ret:
                frame_idx += 1
        elif key == ord('f'):
            use_class_filter = not use_class_filter
            print(f"Class filter: {'ON' if use_class_filter else 'OFF'}")

    cap.release()
    if alert_writer is not None:
        alert_writer.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()