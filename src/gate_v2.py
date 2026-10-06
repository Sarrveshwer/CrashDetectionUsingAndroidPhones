#!/usr/bin/env python3
"""
Extended motion gate (v2): smoothed trigger + tolerant X-of-Y persistence.

Fixes two trigger problems in stage1_motion_gate.py:

  1. SMOOTHING - the gate state was driven by the raw per-frame diff, which is
     scalloped (1.0 after a scene/abrupt change, ~0 on similar encoder frames),
     so "7 *consecutive* above-threshold frames" rarely accumulated even during
     sustained noise motion. The trigger score is now an EMA of the raw score
     (physics_alpha; 1.0 = no smoothing).

  2. TOLERANT PERSISTENCE - "7 consecutive" is replaced by "N frames above the
     threshold within the last M frames" (sliding window). A 1.0->0.05->1.0
     pattern now stays TRIGGERED while a true single-frame spike does not.

Calibration is unchanged: the baseline distribution still receives the RAW
score, so already-calibrated baselines remain valid (no re-calibration
needed). It reuses stage1_motion_gate's run loop, panels and CLI.

Usage: same CLI as stage1_motion_gate.py, plus:
  --persist-frames N   trigger when N frames within the window are above threshold (default 7)
  --persist-window M   sliding-window length for the above-count           (default 12)
  --physics-alpha A    EMA weight (0,1]; 1 = raw score, no smoothing       (default 0.4)

Run from the project root as usual, e.g.:
  python trying/src/stage1_motion_gate_v2.py "Input videos/calibrate_h264.mp4" \
      --mode day --calibrate-only --fresh
"""

import os
import sys
import time
from collections import deque

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stage1_motion_gate as sg

# Make the baseline dir absolute (independent of CWD) so this script works from
# anywhere, and keep all baselines shared with the stage-1 pipeline.
_BASELINE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                             "configs", "baselines")
os.makedirs(_BASELINE_DIR, exist_ok=True)
sg.AutoThresholdManager.BASELINE_DIR = _BASELINE_DIR


class V2BaselineState(sg.BaselineState):
    """BaselineState whose persistence is a sliding-window "X of last Y" count."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.recent_above = deque()
        self.above_count = 0

    def check_trigger(self, score, threshold, persist_frames=7, persist_window=12):
        is_above = score > threshold
        self.recent_above.append(is_above)
        if is_above:
            self.above_count += 1
        while len(self.recent_above) > persist_window:
            old = self.recent_above.popleft()
            if old:
                self.above_count -= 1
        self.consecutive_above = self.above_count
        return self.above_count >= persist_frames


class TriggerAwareManager(sg.AutoThresholdManager):
    """AutoThresholdManager that also accepts a separate smoothed trigger score.

    The RAW physics score always feeds the baseline distribution (calibration
    unchanged); the smoothed trigger score only drives the persistence counter.
    """

    def __init__(self, camera_id, persist_frames=7, persist_window=12, **kwargs):
        super().__init__(camera_id, **kwargs)
        self.persist_frames = persist_frames
        self.persist_window = persist_window

    def update(self, frame, physics_score, alert_active=False, trigger_score=None):
        trigger = physics_score if trigger_score is None else trigger_score
        mode = self.classifier.classify(frame)
        baseline = self.baselines[mode]
        if alert_active:
            baseline.trigger_freeze(3.0)
            return baseline.threshold, mode, baseline
        if baseline.is_frozen():
            return baseline.threshold, mode, baseline
        baseline.add_score(physics_score)
        if not baseline.calibrated and len(baseline.scores) >= self.calibration_min_frames:
            baseline.update_baseline(self.window_size)
            baseline.threshold = baseline.compute_threshold(self.k_mad)
            baseline.calibrated = True
            print(f"[Baseline] {mode} calibrated: median={baseline.median:.3f}, "
                  f"mad={baseline.mad:.3f}, thr={baseline.threshold:.3f}")
        elif baseline.calibrated and baseline.scores_seen % 5 == 0:
            old_median = baseline.median
            old_thr = baseline.threshold
            baseline.update_baseline(self.window_size)
            baseline.threshold = baseline.compute_threshold(self.k_mad)
            now = time.time()
            if now - self._last_print[mode] >= self._print_cooldown and \
                    (abs(baseline.threshold - old_thr) > 1e-6 or abs(baseline.median - old_median) > 0.001):
                self._last_print[mode] = now
                print(f"[Baseline] {mode} @ score {baseline.scores_seen}: "
                      f"median={old_median:.3f}->{baseline.median:.3f}, "
                      f"mad={baseline.mad:.3f}, thr={old_thr:.3f}->{baseline.threshold:.3f}")
        threshold = baseline.threshold
        if baseline.check_trigger(trigger, threshold, self.persist_frames, self.persist_window):
            triggered = True
        else:
            triggered = False
        self._maybe_save()
        return threshold, mode, baseline


class SmoothedMotionGate(sg.MotionGate):
    """MotionGate with EMA-smoothed trigger score and X-of-Y persistence."""

    def __init__(self, camera_id="cam_001", physics_window=5, frame_skip=1, suppress_alerts=False,
                 persist_frames=7, persist_window=12, physics_alpha=0.4):
        super().__init__(camera_id, physics_window, frame_skip, suppress_alerts)
        cfg = getattr(sg, "_V2_CFG", {})
        persist_frames = cfg.get("persist_frames", persist_frames)
        persist_window = cfg.get("persist_window", persist_window)
        physics_alpha = cfg.get("physics_alpha", physics_alpha)
        self.threshold_mgr = TriggerAwareManager(
            camera_id, persist_frames=persist_frames, persist_window=persist_window)
        self.physics_alpha = physics_alpha
        self._trigger_ema = None

    def check(self, frame):
        self.frame_count += 1
        raw = self._compute_physics_score(frame)
        if self.physics_alpha is None or self.physics_alpha >= 1.0:
            trigger_score = raw
        else:
            prev = self._trigger_ema
            self._trigger_ema = raw if prev is None else self.physics_alpha * raw + (1.0 - self.physics_alpha) * prev
            trigger_score = self._trigger_ema
        alert_active = self._is_in_cooldown() and not self.suppress_alerts
        threshold, mode, profile = self.threshold_mgr.update(
            frame, raw, alert_active=alert_active, trigger_score=trigger_score)
        self.threshold_mgr._current_mode = mode
        if self.frame_count % max(1, self.frame_skip) == 0:
            self.physics_history.append(raw)
        smoothed_score = float(np.mean(self.physics_history)) if self.physics_history else trigger_score
        triggered = profile.consecutive_above >= self.threshold_mgr.persist_frames
        if triggered and not self.alert_cooldown_active:
            self._trigger_alert(raw, threshold, mode)
        elif not triggered and self.alert_cooldown_active:
            if self._last_alert_frame is not None:
                frames_since = self.frame_count - self._last_alert_frame
                if frames_since >= 90:
                    self.alert_cooldown_active = False
                    self._last_alert_frame = None
        return sg.GateResult(triggered, threshold, smoothed_score, raw, mode, profile)


# Patch stage1's module globals so its run loop uses the v2 classes.
# This is a fresh process, so the patch is local and safe.
sg.BaselineState = V2BaselineState
sg.MotionGate = SmoothedMotionGate
sg.AutoThresholdManager = TriggerAwareManager


def main():
    argv = sys.argv
    if len(argv) < 2:
        print(__doc__.splitlines()[0])
        print(__doc__)
        sys.exit(1)
    input_path = argv[1]
    output_path = argv[2] if len(argv) > 2 and not argv[2].startswith("--") else None
    mode = "auto"
    fresh = False
    stride = 3
    calibrate_only = False
    exit_stable = True
    min_frames = 9000
    stable_tol = 0.008
    drift_tol = 0.015
    persist_frames = 7
    persist_window = 12
    physics_alpha = 0.4

    def _val(i, cast):
        if i + 1 < len(argv):
            try:
                return cast(argv[i + 1])
            except ValueError:
                print(f"ERROR: bad value for {argv[i]}: {argv[i + 1]}")
                sys.exit(1)
        print(f"ERROR: {argv[i]} requires a value")
        sys.exit(1)

    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg == "--mode":
            mode = _val(i, str).lower()
            if mode not in ("day", "night", "twilight", "auto"):
                print(f"ERROR: invalid mode '{mode}'")
                sys.exit(1)
            i += 2
        elif arg == "--fresh":
            fresh = True
            i += 1
        elif arg == "--stride":
            stride = max(1, int(_val(i, int)))
            i += 2
        elif arg == "--calibrate-only":
            calibrate_only = True
            i += 1
        elif arg == "--no-exit-stable":
            exit_stable = False
            i += 1
        elif arg == "--min-frames":
            min_frames = max(300, int(_val(i, int)))
            i += 2
        elif arg == "--stable-tol":
            stable_tol = max(0.0, float(_val(i, float)))
            i += 2
        elif arg == "--drift-tol":
            drift_tol = max(0.0, float(_val(i, float)))
            i += 2
        elif arg == "--persist-frames":
            persist_frames = max(1, int(_val(i, int)))
            i += 2
        elif arg == "--persist-window":
            persist_window = max(persist_frames, int(_val(i, int)))
            i += 2
        elif arg == "--physics-alpha":
            physics_alpha = min(1.0, max(0.01, float(_val(i, float))))
            i += 2
        else:
            i += 1

    sg._V2_CFG = {
        "persist_frames": persist_frames,
        "persist_window": persist_window,
        "physics_alpha": physics_alpha,
    }
    print(f"[V2] trigger: EMA alpha={physics_alpha}, persist {persist_frames}/{persist_window}")
    sg.run_realtime(input_path, output_path, mode=mode, fresh=fresh, stride=stride,
                    calibrate_only=calibrate_only, exit_stable=exit_stable,
                    min_frames=min_frames, stable_tol=stable_tol, drift_tol=drift_tol)


if __name__ == "__main__":
    main()