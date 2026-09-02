#!/usr/bin/env python3
"""End-to-end webcam demo of the Stage-1 motion gate (shared Regime-A engine).

Keys:
    q - quit
    c - recalibrate (reset all baselines, re-collect calibration frames)
    s - save baselines to disk immediately

The engine self-calibrates: each lighting mode (day / twilight / night) needs
300 scores before it is armed. Baselines persist as JSON and survive restarts.
"""

import sys
import time
from pathlib import Path

import cv2

sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.stage1_motion_gate import MotionGate
from src.utils.config_loader import init_config, CAMERA_CONFIG_DIR


def _reset_baselines(gate):
    for b in gate.threshold_mgr.baselines.values():
        b.scores = []
        b.median = 0.0
        b.mad = 0.0
        b.threshold = 0.5
        b.calibrated = False
        b.consecutive_above = 0
        b.freeze_until = 0.0


def _recalibrate(gate, cap, cal_frames=300):
    print("[INFO] Resetting baselines and recalibrating ...")
    _reset_baselines(gate)
    got = 0
    while got < cal_frames:
        ret, frame = cap.read()
        if not ret:
            print("\n[WARN] source ended during recalibration")
            break
        gate.check(frame)
        got += 1
        if got % 30 == 0:
            print(f"\r  {got}/{cal_frames} frames", end="")
    print()
    for mode, b in gate.threshold_mgr.baselines.items():
        state = "armed" if b.calibrated else f"warm-up ({len(b.scores)} samples)"
        print(f"  {mode:>8}: median={b.median:.3f} mad={b.mad:.3f} "
              f"thr={b.threshold:.3f} [{state}]")
    for mode in ("day", "twilight", "night"):
        gate.threshold_mgr._save_baseline(mode)
    print("[INFO] Baselines saved.")


def main():
    print("=" * 60)
    print("E2E DEMO: Stage-1 Motion Gate (Regime A)")
    print("=" * 60)

    camera_id = "demo_cam"
    config = init_config(camera_id=camera_id)
    print(f"[INFO] Config file: {Path(CAMERA_CONFIG_DIR) / f'camera_{camera_id}.yaml'}")

    gate = MotionGate(camera_id=camera_id, physics_window=5, frame_skip=1)

    cap = cv2.VideoCapture(0, cv2.CAP_V4L2)
    if not cap.isOpened():
        cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("ERROR: Cannot open webcam")
        return

    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"[INFO] Webcam: {width}x{height}")
    print("Controls: q=quit  c=recalibrate  s=save baselines\n")

    fps_start = time.time()
    frame_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            print("Video ended")
            break
        frame_count += 1

        result = gate.check(frame)

        info_y = 30
        cv2.putText(frame, f"Mode: {result.mode.upper()}",
                    (20, info_y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        info_y += 25
        cv2.putText(frame, f"Thr: {result.threshold:.3f}",
                    (20, info_y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 0), 2)
        info_y += 25
        cv2.putText(frame, f"Raw: {result.raw_score:.3f}  Smoothed: {result.smoothed_score:.3f}",
                    (20, info_y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        info_y += 25
        color = (0, 0, 255) if result.triggered else (0, 255, 0)
        label = "TRIGGERED!" if result.triggered else "NORMAL"
        cv2.putText(frame, label, (20, info_y), cv2.FONT_HERSHEY_SIMPLEX, 0.8, color, 3)

        profile = gate.threshold_mgr.baselines.get(result.mode)
        if profile is not None:
            overlay = frame.copy()
            cv2.rectangle(overlay, (0, height - 110), (330, height - 30), (0, 0, 0), -1)
            cv2.addWeighted(overlay, 0.35, frame, 0.65, 0, frame)
            lines = [
                f"Camera: {camera_id}   samples: {len(profile.scores)}",
                f"Calibrated: {profile.calibrated}",
                f"Median: {profile.median:.4f}   MAD: {profile.mad:.4f}",
            ]
            for i, line in enumerate(lines):
                cv2.putText(frame, line, (10, height - 88 + 22 * i),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

        fps = frame_count / (time.time() - fps_start + 1e-6)
        cv2.putText(frame, f"FPS: {fps:.1f}", (20, 150),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        cv2.imshow("Stage-1 Motion Gate (Regime A)", frame)

        key = cv2.waitKey(1) & 0xFF
        if key == ord('q'):
            break
        elif key == ord('c'):
            _recalibrate(gate, cap)
        elif key == ord('s'):
            for mode in ("day", "twilight", "night"):
                gate.threshold_mgr._save_baseline(mode)
            print("[INFO] Config/baselines saved.")

    cap.release()
    cv2.destroyAllWindows()
    print("\n[DONE] Exiting.")


if __name__ == "__main__":
    main()
