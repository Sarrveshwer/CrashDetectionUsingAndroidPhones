#!/usr/bin/env python3
"""
Offline calibration for the auto-threshold system (shared Regime-A engine).

Collects N frames of NORMAL traffic through the real motion-gate baseline
machinery and persists BOTH:
  1. the Regime-A JSON baseline  <- what the runtime actually loads
  2. a mirrored YAML profile     <- schema bookkeeping (TRUE MAD units)

Run once per lighting regime (--mode day|twilight|night) to arm each mode.

Usage:
    python scripts/calibrate_camera.py --camera-id cam_001 --video day.mp4
    python scripts/calibrate_camera.py --camera-id cam_001              # webcam
"""

import argparse
import sys
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from src.stage1_motion_gate import MotionGate
from src.utils.config_loader import init_config


def main():
    parser = argparse.ArgumentParser(
        description="Calibrate Stage-1 auto-threshold (Regime A)")
    parser.add_argument("--camera-id", required=True,
                        help="camera identifier, e.g. cam_001")
    parser.add_argument("--video", default=None,
                        type=lambda x: int(x) if x.isdigit() else x,
                        help="video file path (default: webcam 0)")
    parser.add_argument("--frames", type=int, default=300)
    parser.add_argument("--fps", type=int, default=30)
    parser.add_argument("--mode", choices=("day", "twilight", "night"),
                        default="day",
                        help="which lighting regime this footage represents")
    args = parser.parse_args()

    print("=== Auto-Threshold Calibration (Regime A) ===")
    print(f"Camera: {args.camera_id} | Mode: {args.mode} | Frames: {args.frames}")

    config = init_config(camera_id=args.camera_id)
    gate = MotionGate(camera_id=args.camera_id, physics_window=5, frame_skip=1)

    source = args.video if args.video is not None else 0
    cap = cv2.VideoCapture(source, cv2.CAP_V4L2)
    if not cap.isOpened():
        cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        print(f"ERROR: Cannot open source {source}")
        return 1

    print("WARNING: ensure ONLY normal traffic occurs during this window.")

    scores = []
    idx = 0
    while len(scores) < args.frames:
        ret, frame = cap.read()
        if not ret:
            print("\n[WARN] source ended before calibration finished")
            break
        scores.append(gate._compute_physics_score(frame))
        idx += 1
        if idx % 30 == 0:
            arr = np.array(scores)
            print(f"\rProgress: {len(scores)}/{args.frames} | "
                  f"min={arr.min():.3f} max={arr.max():.3f}", end="")
    cap.release()
    print()

    if len(scores) < args.frames * 0.8:
        print(f"[WARN] only {len(scores)}/{args.frames} frames collected - "
              f"threshold may be weak")

    # Finalize through the engine's own machinery so runtime behaviour and
    # persisted state are identical to in-stream calibration.
    baseline = gate.threshold_mgr.baselines[args.mode]
    baseline.scores = list(scores)
    baseline.update_baseline(gate.threshold_mgr.window_size)
    baseline.threshold = baseline.compute_threshold(gate.threshold_mgr.k_mad)
    baseline.calibrated = True
    gate.threshold_mgr._save_baseline(args.mode)

    arr = np.array(scores)
    p50 = float(np.median(arr))
    iqr = float(np.percentile(arr, 75) - np.percentile(arr, 25))

    print(f"\nCollected {len(scores)} scores")
    print(f"P50={p50:.4f}  IQR={iqr:.4f}")
    print(f"Regime-A baseline -> median={baseline.median:.4f} "
          f"MAD={baseline.mad:.4f} threshold={baseline.threshold:.4f} "
          f"(k={gate.threshold_mgr.k_mad})")
    print(f"JSON baseline saved: {gate.threshold_mgr._baseline_path(args.mode)}")

    # Mirror into the YAML schema. NOTE: mad_ema stores a TRUE MAD here.
    # (IQR/1.349 is sigma, NOT MAD; Gaussian MAD ~= IQR/2.)
    profile = getattr(config, f"{args.mode}_profile", None)
    if profile is not None:
        profile.update({
            "enabled": True,
            "median_ema": baseline.median,
            "mad_ema": baseline.mad,
            "threshold": baseline.threshold,
            "calibration_frames_collected": len(scores),
            "calibrated": True,
            "last_updated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "freeze_until": 0,
        })
        config.save()
        print(f"YAML mirrored: camera_{args.camera_id}.yaml [{args.mode}_profile]")
    else:
        print("Twilight has no YAML slot; JSON baseline remains authoritative.")

    print("\n=== Calibration Complete ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
