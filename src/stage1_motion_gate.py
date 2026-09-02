import sys
import os
import gc

_NPROC = os.cpu_count() or 4
os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
os.environ.setdefault("OMP_NUM_THREADS", str(_NPROC))
os.environ.setdefault("OPENBLAS_NUM_THREADS", str(_NPROC))
os.environ.setdefault("MKL_NUM_THREADS", str(_NPROC))
os.environ.setdefault("NUMEXPR_NUM_THREADS", str(_NPROC))

from collections import deque
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Tuple, NamedTuple, Dict, List

import cv2
import torch
import numpy as np
import yaml
import json
import time
from ultralytics import YOLO

cv2.setNumThreads(_NPROC)
torch.set_num_threads(_NPROC)


@dataclass
class BaselineState:
    scores: List[float] = None
    median: float = 0.0
    mad: float = 0.0
    threshold: float = 0.5
    calibrated: bool = False
    last_updated: Optional[str] = None
    freeze_until: float = 0.0
    consecutive_above: int = 0
    trigger_frames: int = 7
    scores_seen: int = 0

    def __post_init__(self):
        if self.scores is None:
            self.scores = []

    def is_frozen(self) -> bool:
        return time.time() * 1000 < self.freeze_until

    def trigger_freeze(self, seconds: float = 3.0):
        self.freeze_until = time.time() * 1000 + seconds * 1000

    def update_baseline(self, window_size: int = 9000):
        if len(self.scores) < 50:
            return
        arr = np.array(self.scores[-window_size:])
        self.median = float(np.median(arr))
        self.mad = float(np.median(np.abs(arr - self.median)))
        if self.mad < 1e-6:
            self.mad = 1e-6
        self.last_updated = datetime.utcnow().isoformat() + "Z"

    def compute_threshold(self, k_mad: float = 3.5) -> float:
        return float(np.clip(self.median + k_mad * self.mad, 0.15, 0.95))

    def add_score(self, score: float):
        self.scores.append(score)
        self.scores_seen += 1
        if len(self.scores) > 9000:
            self.scores = self.scores[-9000:]

    def check_trigger(self, score: float, threshold: float, persist_frames: int = 7) -> bool:
        if score > threshold:
            self.consecutive_above += 1
        else:
            self.consecutive_above = 0
        return self.consecutive_above >= persist_frames


class DayNightClassifier:
    def __init__(self, day_threshold: int = 80, night_threshold: int = 50, hysteresis: int = 10,
                 mode_persist_frames: int = 60, forced_mode: str = None):
        self.day_threshold = day_threshold
        self.night_threshold = night_threshold
        self.hysteresis = hysteresis
        self.mode_persist_frames = mode_persist_frames
        self.current_mode: str = "unknown"
        self.initialized: bool = False
        self.mode_candidate: Optional[str] = None
        self.mode_candidate_frames: int = 0
        self.forced_mode = forced_mode

    def classify(self, frame: np.ndarray) -> str:
        if self.forced_mode is not None:
            self.current_mode = self.forced_mode
            self.initialized = True
            self.mode_candidate = None
            self.mode_candidate_frames = 0
            return self.forced_mode
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        brightness = float(np.mean(gray))
        if brightness > self.day_threshold:
            candidate = "day"
        elif brightness < self.night_threshold:
            candidate = "night"
        else:
            candidate = "twilight"

        if not self.initialized:
            self.current_mode = candidate
            self.initialized = True
            return self.current_mode

        if candidate != self.current_mode:
            if self.mode_candidate == candidate:
                self.mode_candidate_frames += 1
                if self.mode_candidate_frames >= self.mode_persist_frames:
                    self.current_mode = candidate
                    self.mode_candidate = None
                    self.mode_candidate_frames = 0
            else:
                self.mode_candidate = candidate
                self.mode_candidate_frames = 1
        else:
            self.mode_candidate = None
            self.mode_candidate_frames = 0
        return self.current_mode

    def get_brightness(self, frame: np.ndarray) -> float:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        return float(np.mean(gray))


class AutoThresholdManager:
    BASELINE_DIR = "trying/configs/baselines"

    def __init__(self, camera_id: str, day_thresh: int = 80, night_thresh: int = 50, hysteresis: int = 10):
        self.camera_id = camera_id
        self.classifier = DayNightClassifier(day_thresh, night_thresh, hysteresis)
        self.k_mad = 2.0
        self.persist_frames = 7
        self.window_size = 9000
        self.calibration_min_frames = 300
        os.makedirs(self.BASELINE_DIR, exist_ok=True)
        self.baselines = {m: BaselineState() for m in ("day", "twilight", "night")}
        self._load_baselines()
        self._last_save = 0.0
        self._save_cooldown = 5.0
        self._last_print = {m: 0.0 for m in ("day", "twilight", "night")}
        self._print_cooldown = 2.0

    def _baseline_path(self, mode: str) -> str:
        return os.path.join(self.BASELINE_DIR, f"{self.camera_id}_{mode}_baseline.json")

    def _load_baselines(self):
        for mode in ("day", "twilight", "night"):
            path = self._baseline_path(mode)
            if os.path.exists(path):
                try:
                    with open(path, "r") as f:
                        data = json.load(f)
                    if data.get("last_updated"):
                        last_str = data["last_updated"].replace("Z", "+00:00")
                        last = datetime.fromisoformat(last_str)
                        if last.tzinfo is not None:
                            last = last.replace(tzinfo=None)
                        if (datetime.utcnow() - last).total_seconds() < 86400:
                            b = self.baselines[mode]
                            b.scores = data.get("scores", [])
                            b.median = data.get("median", 0.0)
                            b.mad = data.get("mad", 0.0)
                            b.threshold = data.get("threshold", 0.5)
                            b.calibrated = data.get("calibrated", False)
                            b.last_updated = data.get("last_updated")
                            b.scores_seen = data.get("scores_seen", 0)
                            print(f"[Baseline] Loaded {mode} baseline for {self.camera_id}: median={b.median:.3f}, mad={b.mad:.3f}")
                            continue
                except Exception as e:
                    print(f"[Baseline] Failed to load {mode}: {e}")
            self.baselines[mode] = BaselineState()

    def _save_baseline(self, mode: str):
        path = self._baseline_path(mode)
        b = self.baselines[mode]
        data = {
            "camera_id": self.camera_id, "mode": mode, "scores": b.scores[-9000:],
            "scores_seen": b.scores_seen,
            "median": b.median, "mad": b.mad, "threshold": b.threshold,
            "calibrated": b.calibrated, "last_updated": datetime.utcnow().isoformat() + "Z",
            "trigger_frames": b.trigger_frames,
        }
        try:
            with open(path, "w") as f:
                json.dump(data, f)
        except Exception as e:
            print(f"[Baseline] Failed to save {mode}: {e}")

    def _maybe_save(self):
        now = time.time()
        if now - self._last_save > self._save_cooldown:
            for mode in ("day", "twilight", "night"):
                self._save_baseline(mode)
            self._last_save = now

    def classify_frame(self, frame: np.ndarray) -> str:
        return self.classifier.classify(frame)

    def get_brightness(self, frame: np.ndarray) -> float:
        return self.classifier.get_brightness(frame)

    def update(self, frame: np.ndarray, physics_score: float, alert_active: bool = False) -> Tuple[float, str, BaselineState]:
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
            print(f"[Baseline] {mode} calibrated: median={baseline.median:.3f}, mad={baseline.mad:.3f}, thr={baseline.threshold:.3f}")
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
        if baseline.check_trigger(physics_score, threshold, self.persist_frames):
            triggered = True
        else:
            triggered = False
        self._maybe_save()
        return threshold, mode, baseline


@dataclass
class GateResult:
    triggered: bool
    threshold: float
    smoothed_score: float
    raw_score: float
    mode: str
    profile: object


class StabilityMonitor:
    """Decides whether the calibration baseline is genuinely converged.

    A conservative early-exit. An exit is granted only when ALL of these hold:
      * the active baseline is calibrated and has collected a full window of samples
        (guards against alert-freezes starving the score buffer),
      * the motion signal is real (MAD not floor-flat) and the threshold is NOT pinned
        at the clamp boundary (0.15 / 0.95) - a boundary value means the distribution
        is off-scale and calibration is meaningless,
      * the threshold did not move by more than stable_tol across a trailing window,
      * median/mad did not drift by more than drift_tol between window endpoints
        (catches monotonic creep and jumps),
      * the whole-run median/mad range (since the last mode change) is within drift_tol
        (catches in-sample regime changes, e.g. quiet clip that later gets busy),
      * the above holds for `confirm_checks` consecutive checkpoints (transient
        stability from clamping can't pass).
    The decision state is reset on any mode switch.
    """

    def __init__(self, min_frames: int = 9000, stable_tol: float = 0.008, drift_tol: float = 0.015,
                 stable_window: int = 3000, confirm_checks: int = 3, snapshot_every: int = 250):
        self.min_frames = min_frames
        self.stable_tol = stable_tol
        self.drift_tol = drift_tol
        self.stable_window = stable_window
        self.confirm_checks = confirm_checks
        self.snapshot_every = snapshot_every
        self.snapshots: List[Tuple[int, float, float, float]] = []
        self.confirm_streak: int = 0
        self._last_mode: Optional[str] = None

    def can_exit_now(self, frame_idx: int, mode: str, baseline: BaselineState) -> bool:
        if mode != self._last_mode:
            self._last_mode = mode
            self.snapshots = []
            self.confirm_streak = 0
        if frame_idx % self.snapshot_every != 0:
            return False
        self.snapshots.append((frame_idx, baseline.median, baseline.mad, baseline.threshold))
        if len(self.snapshots) > 2048:
            self.snapshots = self.snapshots[-2048:]
        if self._evaluate(frame_idx, baseline):
            self.confirm_streak += 1
            if self.confirm_streak >= self.confirm_checks:
                return True
        else:
            self.confirm_streak = 0
        return False

    def _evaluate(self, frame_idx: int, baseline: BaselineState) -> bool:
        if not baseline.calibrated:
            return False
        if frame_idx < self.min_frames:
            return False
        if len(baseline.scores) < min(self.min_frames, 9000):
            return False
        if baseline.mad < 1e-4:
            return False
        if baseline.threshold <= 0.15 + 1e-6 or baseline.threshold >= 0.95 - 1e-6:
            return False
        snaps = self.snapshots
        if len(snaps) < 8:
            return False
        win = [s for s in snaps if s[0] >= frame_idx - self.stable_window]
        if len(win) < 8:
            return False
        thrs = [s[3] for s in win]
        meds = [s[1] for s in win]
        mads = [s[2] for s in win]
        if (max(thrs) - min(thrs)) > self.stable_tol:
            return False
        if abs(win[-1][1] - win[0][1]) > self.drift_tol:
            return False
        if abs(win[-1][2] - win[0][2]) > self.drift_tol:
            return False
        all_med = [s[1] for s in snaps]
        all_mad = [s[2] for s in snaps]
        if (max(all_med) - min(all_med)) > self.drift_tol:
            return False
        if (max(all_mad) - min(all_mad)) > self.drift_tol:
            return False
        return True


class MotionGate:
    def __init__(self, camera_id: str = "cam_001", physics_window: int = 5, frame_skip: int = 1,
                 suppress_alerts: bool = False):
        self.frame_skip = frame_skip
        self.frame_count: int = 0
        self.threshold_mgr = AutoThresholdManager(camera_id)
        self.prev_gray: Optional[np.ndarray] = None
        self.physics_history: deque = deque(maxlen=physics_window)
        self._last_alert_frame: Optional[int] = None
        self.alert_cooldown_active: bool = False
        self.suppress_alerts = suppress_alerts
        self.camera_id = camera_id

    def _compute_physics_score(self, frame: np.ndarray) -> float:
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        if self.prev_gray is None:
            self.prev_gray = gray.copy()
            return 0.0
        diff = cv2.absdiff(self.prev_gray, gray)
        _, diff_thresh = cv2.threshold(diff, 25, 255, cv2.THRESH_BINARY)
        diff_pct = np.sum(diff_thresh > 0) / (frame.shape[1] * frame.shape[0])
        score = min(diff_pct * 10.0, 1.0)
        self.prev_gray = gray.copy()
        return score

    def check(self, frame: np.ndarray) -> GateResult:
        self.frame_count += 1
        physics_score = self._compute_physics_score(frame)
        alert_active = self._is_in_cooldown() and not self.suppress_alerts
        threshold, mode, profile = self.threshold_mgr.update(frame, physics_score, alert_active=alert_active)
        self.threshold_mgr._current_mode = mode
        if self.frame_count % max(1, self.frame_skip) == 0:
            self.physics_history.append(physics_score)
        smoothed_score = np.mean(self.physics_history) if self.physics_history else physics_score
        triggered = profile.consecutive_above >= self.threshold_mgr.persist_frames
        if triggered and not self.alert_cooldown_active:
            self._trigger_alert(physics_score, threshold, mode)
        elif not triggered and self.alert_cooldown_active:
            if self._last_alert_frame is not None:
                frames_since = self.frame_count - self._last_alert_frame
                if frames_since >= 90:
                    self.alert_cooldown_active = False
                    self._last_alert_frame = None
        return GateResult(triggered, threshold, smoothed_score, physics_score, mode, profile)

    def _trigger_alert(self, physics_score: float, threshold: float, mode: str) -> None:
        self._last_alert_frame = self.frame_count
        self.alert_cooldown_active = True

    def _is_in_cooldown(self) -> bool:
        if not self.alert_cooldown_active:
            return False
        if self._last_alert_frame is not None:
            frames_since = self.frame_count - self._last_alert_frame
            if frames_since >= 90:
                self.alert_cooldown_active = False
                self._last_alert_frame = None
                return False
        return True


def _bbox_iou(box_a: Tuple[int, int, int, int], box_b: Tuple[int, int, int, int]) -> float:
    """Intersection-over-union of two (x1, y1, x2, y2) boxes; 0 when disjoint."""
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    iw = min(ax2, bx2) - max(ax1, bx1)
    ih = min(ay2, by2) - max(ay1, by1)
    if iw <= 0 or ih <= 0:
        return 0.0
    inter = iw * ih
    area_a = max(1, (ax2 - ax1) * (ay2 - ay1))
    area_b = max(1, (bx2 - bx1) * (by2 - by1))
    return inter / max(1.0, area_a + area_b - inter)


@dataclass
class Track:
    """A single tracked object's windowed history.

    Every per-sample history list stores a leading (frame_idx, ...) so features
    can be normalized by the *actual* frame gap between samples (#5) instead of
    assuming each sample is the previous video frame (decouples from `--stride`).
    `hits_misses` is a rolling deque used to compute windowed fragmentation (#2).
    """
    track_id: int
    bbox: Tuple[int, int, int, int]
    center: Tuple[float, float]
    class_name: str
    conf: float
    history: List[Tuple[int, float, float]] = None      # (frame_idx, x, y)
    velocity: Tuple[float, float] = (0.0, 0.0)          # px / frame (frame-normalized)
    prev_velocity: Tuple[float, float] = (0.0, 0.0)
    speed: float = 0.0                                   # |velocity|, px / frame
    prev_speed: float = 0.0
    aspect_ratios: List[Tuple[int, float]] = None       # (frame_idx, w/h)
    flow_samples: List[Tuple[int, float]] = None        # (frame_idx, angle dispersion)
    current_flow_disp: float = 0.0
    hits_misses: deque = None                            # windowed True(hit)/False(miss) roll
    miss_streak: int = 0
    decel_events: deque = None                           # (frame_idx, prev_speed, speed)

    def __post_init__(self):
        if self.history is None: self.history = []
        if self.aspect_ratios is None: self.aspect_ratios = []
        if self.flow_samples is None: self.flow_samples = []
        if self.hits_misses is None:
            self.hits_misses = deque(maxlen=30)   # window set by FeatureExtractor
        if self.decel_events is None:
            self.decel_events = deque(maxlen=30)

    @property
    def fragmentation(self) -> int:
        """# of missed-detection frames in the last N evaluated frames ONLY.

        Windowed replacement for the old unbounded lifetime counter (#2): misses
        older than the window permanently fall out as hits/misses are pushed, so
        a long-lived track with a few ordinary dropouts no longer reads as 4+.
        """
        return self.hits_misses.count(False)


@dataclass
class PairFeatures:
    """Windowed pairwise kinematics for one (tid_a, tid_b), a < b.

    IoU, center distance, relative closing velocity, and closing-velocity at the
    moment either member shows a sudden deceleration - all keyed by the sorted
    pair and windowed to the same `window_size` as single-track features (#1).
    """
    key: Tuple[int, int]
    iou_history: deque = None                 # (frame_idx, IoU)
    dist_history: deque = None                # (frame_idx, center dist px)
    closing_vel_history: deque = None         # (frame_idx, px/frame, + means closing)
    decel_closing_vel_history: deque = None   # (frame_idx, px/frame) at sudden decel

    def __post_init__(self):
        if self.iou_history is None: self.iou_history = deque(maxlen=30)
        if self.dist_history is None: self.dist_history = deque(maxlen=30)
        if self.closing_vel_history is None: self.closing_vel_history = deque(maxlen=30)
        if self.decel_closing_vel_history is None: self.decel_closing_vel_history = deque(maxlen=30)


class FeatureExtractor:
    """Tracks objects and derives windowed per-track + per-pair features.

    Behavior changes vs. the original (see RuleClassifier docstring for the
    classifier side and the requirement mapping):

    * #1 - adds pairwise IoU / closing-velocity / decel-closing-velocity
          tracking keyed by sorted (tid_a, tid_b), exposed via
          get_pair_features() and all_pair_features().
    * #2 - `fragmentation` is now a windowed miss count (rolling hit/miss
          deque), never a monotonic lifetime counter.
    * #3 - heading-change statistic is the 90th-percentile per-frame heading
          rate (robust to a single ID-swap outlier), plus the full windowed
          list so the classifier can apply a mini-persistence check.
    * #5 - every history/AR/flow/disp sample stores its (frame_idx, ...);
          velocities, heading rates and closing velocities are normalized by
          actual elapsed frames so feature semantics no longer depend on the
          `--stride` cadence at runtime.
    """

    def __init__(self, window_size=30, max_miss_frames=30, match_distance=80.0,
                 decel_speed_drop=0.5, decel_min_speed=2.0, pair_window=None,
                 flow_points_per_track=40, flow_min_distance=5,
                 lk_win_size=21, lk_max_level=2):
        self.window = window_size
        self.pair_window = pair_window or window_size
        self.max_miss_frames = max_miss_frames      # keep a lost track this many frames
        self.match_distance = match_distance        # centroid matching radius (px)
        self.decel_speed_drop = decel_speed_drop    # sudden decel = speed falls to < (1-drop)*prev
        self.decel_min_speed = decel_min_speed      # speed must exceed this to count a decel
        # Sparse ROI-flow controls. Points are SAMPLED, never dense: per-track
        # work is capped at flow_points_per_track (req #1) so total points stay
        # proportional to tracks x points, NOT image resolution (req #3).
        self.flow_points_per_track = flow_points_per_track
        self.flow_min_distance = flow_min_distance
        self.lk_win_size = lk_win_size
        self.lk_max_level = lk_max_level
        self.tracks: Dict[int, Track] = {}
        self.pairs: Dict[Tuple[int, int], PairFeatures] = {}
        self.next_id = 0
        self.prev_gray = None
        self._prev_pyr = None          # cached LK pyramid matching prev_gray (built once/frame)
        self.frame_idx = 0
        self._calls = 0

    def update(self, detections: List[dict], frame: np.ndarray, frame_idx: int = None) -> Dict[int, Track]:
        # Allow callers either to pass the real frame counter (frame-normalized
        # features, #5) or to omit it (internal monotonic counter fallback).
        if frame_idx is not None:
            self.frame_idx = frame_idx
        else:
            self._calls += 1
            self.frame_idx = self._calls

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        # Sparse ROI flow — REPLACES the dense whole-frame Farneback that was
        # ~93% of pipeline wall time. Instead of computing dense flow on the
        # entire image (1280x720=921K pixels), we run Lucas-Kanade on a capped
        # set of points sampled inside each tracked bbox. OpenCV's
        # calcOpticalFlowPyrLK internally builds a pyramid per call when images
        # are passed; we DO NOT pre-build pyramids because the Python bindings
        # don't support passing them explicitly. The total point count stays
        # proportional to (tracks × flow_points_per_track) not image resolution.
        # If no tracks exist this frame we skip LK entirely (req #4).
        old_prev_gray = self.prev_gray
        self.prev_gray = gray.copy()
        matched_ids = set()
        spawned = {}

        def _trim(lst: list, n: int) -> list:
            return lst if len(lst) <= n else lst[-n:]

        for det in detections:
            cx, cy = det["center"]
            best_id, best_dist = None, self.match_distance
            for tid, track in self.tracks.items():
                if tid in matched_ids: continue
                tx, ty = track.center
                dist = np.hypot(cx - tx, cy - ty)
                if dist < best_dist:
                    best_dist, best_id = dist, tid
            if best_id is not None:
                track = self.tracks[best_id]
                last_f = track.history[-1][0] if track.history else None
                dt = max(1, self.frame_idx - last_f) if last_f is not None else 1
                vx = (cx - track.center[0]) / dt
                vy = (cy - track.center[1]) / dt
                track.prev_velocity = track.velocity
                track.velocity = (vx, vy)
                track.prev_speed = track.speed
                track.speed = float(np.hypot(vx, vy))
                track.center = (cx, cy)
                track.bbox = det["bbox"]
                track.miss_streak = 0
                track.history.append((self.frame_idx, cx, cy))
                track.history = _trim(track.history, self.window)
                track.hits_misses.append(True)
                if track.prev_speed > self.decel_min_speed and \
                        track.speed <= track.prev_speed * (1.0 - self.decel_speed_drop):
                    track.decel_events.append((self.frame_idx, track.prev_speed, track.speed))
                ar = (det["bbox"][2] - det["bbox"][0]) / max(1, det["bbox"][3] - det["bbox"][1])
                track.aspect_ratios.append((self.frame_idx, ar))
                track.aspect_ratios = _trim(track.aspect_ratios, self.window)
                # Sparse LK flow inside THIS track's bbox only (fallback: if the bbox
                # yields no trackable corners or nothing tracks, keep the
                # previous current_flow_disp and record no new flow sample —
                # never crash, never silently zero the dispersion).
                if old_prev_gray is not None:
                    disp = self._sparse_flow_for_bbox(old_prev_gray, gray, det["bbox"],
                                                      self.flow_points_per_track)
                    if disp is not None:
                        track.current_flow_disp = disp
                        track.flow_samples.append((self.frame_idx, disp))
                        track.flow_samples = _trim(track.flow_samples, self.window)
                matched_ids.add(best_id)
            else:
                tid = self.next_id
                self.next_id += 1
                ar = (det["bbox"][2] - det["bbox"][0]) / max(1, det["bbox"][3] - det["bbox"][1])
                track = Track(tid, det["bbox"], (cx, cy), det["class"], det["conf"],
                              history=[(self.frame_idx, cx, cy)], aspect_ratios=[(self.frame_idx, ar)])
                track.hits_misses = deque(maxlen=self.window)
                track.hits_misses.append(True)
                track.decel_events = deque(maxlen=self.window)
                spawned[tid] = track

        survivors = {}
        for tid in spawned:
            survivors[tid] = spawned[tid]
        for tid, track in self.tracks.items():
            if tid in matched_ids:
                survivors[tid] = track
            else:
                track.miss_streak += 1
                track.hits_misses.append(False)   # windowed: old misses fall out (#2)
                if track.miss_streak <= self.max_miss_frames:
                    survivors[tid] = track
        self.tracks = survivors

        # --- pairwise kinematics, computed only for objects seen THIS frame ---
        hit_ids = sorted(matched_ids)
        for i in range(len(hit_ids)):
            a = hit_ids[i]
            for b in hit_ids[i + 1:]:
                ta, tb = self.tracks[a], self.tracks[b]
                key = (a, b)
                iou = _bbox_iou(ta.bbox, tb.bbox)
                dist = float(np.hypot(ta.center[0] - tb.center[0],
                                      ta.center[1] - tb.center[1]))
                pf = self.pairs.get(key)
                if pf is None:
                    pf = PairFeatures(key=key,
                                      iou_history=deque(maxlen=self.pair_window),
                                      dist_history=deque(maxlen=self.pair_window),
                                      closing_vel_history=deque(maxlen=self.pair_window),
                                      decel_closing_vel_history=deque(maxlen=self.pair_window))
                    self.pairs[key] = pf
                prev = pf.dist_history[-1] if len(pf.dist_history) >= 1 else None
                if prev is not None:
                    closing = (prev[1] - dist) / max(1, self.frame_idx - prev[0])   # + = closing
                else:
                    closing = 0.0
                pf.iou_history.append((self.frame_idx, iou))
                pf.dist_history.append((self.frame_idx, dist))
                pf.closing_vel_history.append((self.frame_idx, closing))
                # Record the closing velocity at the moment of a sudden
                # deceleration on EITHER member (requirement #1 third bullet).
                if (ta.decel_events and ta.decel_events[-1][0] == self.frame_idx) or \
                   (tb.decel_events and tb.decel_events[-1][0] == self.frame_idx):
                    pf.decel_closing_vel_history.append((self.frame_idx, closing))

        # Drop pairs whose member tracks no longer exist.
        alive = set(self.tracks)
        for key in [k for k in self.pairs if k[0] not in alive or k[1] not in alive]:
            self.pairs.pop(key, None)

        return self.tracks

    def _sparse_flow_for_bbox(self, prev_img: np.ndarray, next_img: np.ndarray,
                               bbox: Tuple[int, int, int, int],
                               max_points: int) -> Optional[float]:
        """
        Compute angular dispersion of sparse Lucas-Kanade flow vectors inside a
        single bbox. Returns None if zero trackable corners are found or all
        status==0 — caller should fall back to previous `current_flow_disp`.

        This replaces the dense `np.std(arctan2(vy, vx))` over the whole bbox
        region. The sparse statistic will have a different numeric range
        (typically smaller variance since we're only sampling the strongest
        corners), so the `flow_spike` threshold in `RuleClassifier` WILL NEED
        RE-VALIDATION. Do not assume the old 2.0/3.5 etc. thresholds transfer
        directly; re-calibrate on labeled sparse-flow data.
        """
        x1, y1, x2, y2 = bbox
        # Clamp to valid image region
        x1 = max(0, x1); y1 = max(0, y1)
        x2 = min(prev_img.shape[1], x2)
        y2 = min(prev_img.shape[0], y2)
        if x2 - x1 < 8 or y2 - y1 < 8:   # too small for reliable corners
            return None

        # Crop-based corner detection: extract ROI, find corners there, then
        # offset coordinates back to full-frame space. ~17x faster than
        # full-frame mask + goodFeaturesToTrack because the ROI is tiny.
        roi = prev_img[y1:y2, x1:x2]
        pts = cv2.goodFeaturesToTrack(roi, maxCorners=max_points,
                                       qualityLevel=0.01, minDistance=self.flow_min_distance,
                                       mask=None)
        if pts is None or len(pts) == 0:
            return None
        # Offset points from ROI coordinates to full-frame coordinates
        pts[:, 0, 0] += x1
        pts[:, 0, 1] += y1
        pts = pts.astype(np.float32)

        # Lucas-Kanade directly on images (Python bindings don't expose pre-built
        # pyramid reuse). Internally builds pyramids per call, but total points
        # are capped at tracks × flow_points_per_track, not image resolution.
        nxt, status, _err = cv2.calcOpticalFlowPyrLK(
            prev_img, next_img, pts, None,
            winSize=(self.lk_win_size, self.lk_win_size),
            maxLevel=self.lk_max_level,
            criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 10, 0.03))
        if nxt is None:
            return None
        good = status.ravel() == 1
        if not np.any(good):
            return None
        # LK returns (N, 1, 2) — flatten to (N, 2) for arithmetic
        pts = pts[good].reshape(-1, 2)
        nxt = nxt[good].reshape(-1, 2)

        # Flow vectors in pixel coordinates
        flow_vecs = nxt - pts
        # Angular dispersion — circular std-dev equivalent for the sparse set
        angles = np.arctan2(flow_vecs[:, 1], flow_vecs[:, 0])
        return float(np.std(angles))

    def get_features(self, track_id: int) -> Optional[dict]:
        """Windowed single-track features.

        max_heading_change is kept under its old name for backward-compatible
        downstream readers, but its value is now the robust 90th-percentile
        per-frame heading rate (with the raw list available for the classifier's
        mini-persistence check)."""
        track = self.tracks.get(track_id)
        if not track or len(track.history) < 10: return None

        # Frame-normalized heading-change RATES (#3, #5).
        steps = []
        for i in range(1, len(track.history)):
            f0, x0, y0 = track.history[i - 1]
            f1, x1, y1 = track.history[i]
            dt = max(1, abs(f1 - f0))
            dx, dy = x1 - x0, y1 - y0
            if dx or dy:
                steps.append((float(np.arctan2(dy, dx)), dt))
        hc = []
        for i in range(1, len(steps)):
            ha, _ = steps[i - 1]
            hb, dtb = steps[i]
            raw = hb - ha
            hc.append(abs(float(np.arctan2(np.sin(raw), np.cos(raw)))) / max(1, dtb))
        heading_p90 = float(np.percentile(hc, 90)) if len(hc) >= 3 else 0.0

        ars = [v for (_f, v) in track.aspect_ratios[-self.window:]]
        ar_osc = float(np.std(ars)) if len(ars) >= 3 else 0.0
        arp = sum(1 for i in range(2, len(ars) - 2)
                  if ars[i] > ars[i - 1] and ars[i] > ars[i + 1]) if len(ars) > 5 else 0

        disp_vals = [v for (_f, v) in track.flow_samples[-self.window:]]
        if len(disp_vals) >= 5:
            med = float(np.median(disp_vals))
            fs = track.current_flow_disp / max(1e-6, med)
        else:
            fs = 1.0

        return {"track_id": track_id, "class": track.class_name,
                "heading_p90": heading_p90,
                "heading_changes": hc,
                "max_heading_change": heading_p90,
                "flow_spike": fs,
                "ar_oscillation": ar_osc,
                "ar_peaks_per_window": arp,
                "fragmentation": track.fragmentation,
                "speed": track.speed,
                "decel_count": len(track.decel_events),
                "history_len": len(track.history)}

    def get_pair_features(self, tid_a: int, tid_b: int) -> Optional[dict]:
        """Pairwise interaction features for one sorted (tid_a, tid_b)."""
        key = (tid_a, tid_b) if tid_a < tid_b else (tid_b, tid_a)
        pf = self.pairs.get(key)
        if not pf or len(pf.iou_history) < 2:
            return None
        deltas = []
        for i in range(1, len(pf.iou_history)):
            f_prev, v_prev = pf.iou_history[i - 1]
            f_cur, v_cur = pf.iou_history[i]
            deltas.append((v_cur - v_prev) / max(1, f_cur - f_prev))
        decel_cvs = [v for (_f, v) in pf.decel_closing_vel_history]
        return {"pair": key,
                "iou_now": pf.iou_history[-1][1],
                "iou_trend": float(np.median(deltas)) if deltas else 0.0,
                "closing_velocity": pf.closing_vel_history[-1][1],
                "decel_closing_velocity": float(max(decel_cvs)) if decel_cvs else 0.0,
                "dist_now": pf.dist_history[-1][1],
                "frames": len(pf.iou_history)}

    def all_pair_features(self) -> Dict[Tuple[int, int], dict]:
        """All live pairwise feature dicts, keyed by sorted (tid_a, tid_b)."""
        out = {}
        for key in list(self.pairs):
            if key[0] in self.tracks and key[1] in self.tracks:
                f = self.get_pair_features(key[0], key[1])
                if f:
                    out[key] = f
        return out


class RuleClassifier:
    """Stage-3 collision / rollover classifier (redesigned).

    Behavior changes vs. the original, mapped to the requirements:

    #1  Collision now REQUIRES pairwise evidence - overlapping boxes (IoU >=
        iou_contact), IoU trending up past iou_approach_rise, or a relative
        closing velocity above min_closing_vel while near another track that
        shows a matching sudden deceleration (decel_closing_velocity >=
        decel_close_vel). A single-track heading/flow spike is NEVER sufficient
        for a collision; those signals only feed the rollover path, which is a
        separate single-vehicle rule (driving off-road / rollover).

    #3  Heading evidence uses the 90th-percentile per-frame heading rate and a
        mini-persistence check (heading_min_frames windowed frames must exceed
        heading_angle), instead of a single `max()` sample that one ID-swap can
        poison.

    #4  Multi-frame debounced voting: a track must satisfy rollover on K of the
        last M evaluated frames, and a track-pair must satisfy collision on K of
        M, before `predict()` returns anything but "normal". Votes are kept per
        (track,pair) key in `self._votes` - they sit IN FRONT of the existing
        `last_alert` cooldown dict, which is preserved unchanged in behavior.

    Threshold justifications (empirical basis where available):
      iou_contact=0.55        - two boxes occupying >half their union == physical
                                overlap/contact in this camera geometry.
      iou_approach_rise=0.05  - per-frame IoU growth >= this sustained across the
                                window means objects are being drawn together.
                                UNVALIDATED - needs tuning against labeled data.
      min_closing_vel=3.0     - px/frame relative closure; 1080p 25fps this is
                                ~3 px/frame (~50px over a car-width). UNVALIDATED.
      decel_close_vel=3.0     - closing velocity recorded at a sudden decel.
                                UNVALIDATED.
      approach_dist=160.0     - center-distance window in which closing/decel
                                counts as interaction (about one car length at
                                1080p). UNVALIDATED.
      heading_angle=1.1       - rad/frame heading-rate above erratic; 1.1 rad over
                                one frame is a violent path change. UNVALIDATED.
      heading_min_frames=2    - mini-persistence: >=2 window frames must exceed
                                heading_angle (#3), mirrors Stage-1 persistence.
      flow_spike_ratio=2.0    - current/median flow dispersion doubling.
                                UNVALIDATED.
      ar_oscillation=0.6      - windowed std of aspect ratio; ~15% aspect wobble.
                                UNVALIDATED (matches old value as a starting pt).
      ar_peaks=4              - repeated AR oscillation peaks in the window.
                                UNVALIDATED (matches old value).
      vote_k=3, vote_m=5      - 3 of last 5 evaluated frames, mirrors the K/M
                                debounce recommended in #4 (60% duty cycle).
    """

    def __init__(self,
                 iou_contact=0.55,
                 iou_approach_rise=0.05,
                 min_closing_vel=3.0,
                 decel_close_vel=3.0,
                 approach_dist=160.0,
                 heading_angle=1.1,
                 heading_min_frames=2,
                 flow_spike_ratio=2.0,
                 ar_oscillation=0.6,
                 ar_peaks=4,
                 vote_k=3,
                 vote_m=5,
                 cooldown=30,
                 vehicle_classes=("car", "truck", "bus", "motorcycle", "bicycle")):
        self.iou_contact = iou_contact
        self.iou_approach_rise = iou_approach_rise
        self.min_closing_vel = min_closing_vel
        self.decel_close_vel = decel_close_vel
        self.approach_dist = approach_dist
        self.heading_angle = heading_angle
        self.heading_min_frames = heading_min_frames
        self.flow_spike_ratio = flow_spike_ratio
        self.ar_oscillation = ar_oscillation
        self.ar_peaks = ar_peaks
        self.vote_k = vote_k
        self.vote_m = vote_m
        self.vehicle_classes = vehicle_classes
        self.last_alert: Dict[int, int] = {}
        self.cooldown = cooldown
        self._votes: Dict[Tuple, deque] = {}      # key -> recent M verdicts (bool)
        self._last_vote_frame: Dict[Tuple, int] = {}
        self._last_label: Dict[int, str] = {}
        self.active_pairs: set = set()            # pair keys currently voted-collision

    def _heading_persistent(self, features: dict) -> bool:
        """90th-percentile heading rate bound + mini-persistence check (#3)."""
        if features.get("heading_p90", 0.0) < self.heading_angle:
            return False
        n_spike = sum(1 for h in features.get("heading_changes", []) if h >= self.heading_angle)
        return n_spike >= self.heading_min_frames

    def _pair_collision(self, pf: Optional[dict]) -> bool:
        """Raw (single-frame) collision evidence for one track pair.

        Strictly pairwise: geometric contact, rapid IoU approach, or closing-
        away-with-matching-decel. No single-track signal can fire this.
        """
        if not pf:
            return False
        contact = pf["iou_now"] >= self.iou_contact
        approaching = pf["iou_trend"] >= self.iou_approach_rise
        closing = pf["closing_velocity"] >= self.min_closing_vel and \
            pf["dist_now"] <= self.approach_dist
        matched_decel = pf["decel_closing_velocity"] >= self.decel_close_vel
        return bool(contact or approaching or (closing and matched_decel))

    def _rollover(self, features: dict) -> bool:
        """Single-vehicle path (rollover / run-off-road). Distinct from collision."""
        if features.get("ar_oscillation", 0.0) < self.ar_oscillation:
            return False
        if features.get("ar_peaks_per_window", 0) < self.ar_peaks:
            return False
        return self._heading_persistent(features)

    def _push_vote(self, key, value: bool, frame_idx: int):
        # A frame is evaluated several times within one frame's rendering (box
        # loop + draw_panel); dedupe votes by frame so K-of-M counts frames, not
        # call sites (#4).
        if self._last_vote_frame.get(key) != frame_idx:
            q = self._votes.setdefault(key, deque(maxlen=self.vote_m))
            q.append(value)
            self._last_vote_frame[key] = frame_idx

    def predict(self, features: dict, frame_idx: int,
                pair_features: Optional[Dict[Tuple[int, int], dict]] = None) -> str:
        if not features:
            return "normal"
        if features["class"] not in self.vehicle_classes:
            return "normal"
        tid = features["track_id"]
        if tid in self.last_alert and frame_idx - self.last_alert[tid] < self.cooldown:
            return self._last_label.get(tid, "normal")

        pair_features = pair_features or {}
        involved = [(pk, pf) for (pk, pf) in pair_features.items() if tid in pk]

        # --- collision votes, per PAIR key (#4) ---
        pair_verdicts = {}
        for pk, pf in involved:
            self._push_vote(("pair", pk), self._pair_collision(pf), frame_idx)
            q = self._votes[("pair", pk)]
            pair_verdicts[pk] = sum(q) >= self.vote_k
        collision = any(pair_verdicts.values())

        # --- rollover votes, per TRACK key (#4) ---
        self._push_vote(("track", tid), self._rollover(features), frame_idx)
        q = self._votes[("track", tid)]
        rollover = sum(q) >= self.vote_k

        label = "collision" if collision else ("rollover" if rollover else "normal")
        self._last_label[tid] = label
        self.active_pairs = {pk for pk, v in pair_verdicts.items() if v}
        if label != "normal":
            self.last_alert[tid] = frame_idx
        return label


def draw_panel(frame, gate_result, tracks, extractor, classifier, frame_idx,
               pair_features=None):
    h, w = frame.shape[:2]
    panel_h = 350
    canvas = np.zeros((h + panel_h, w, 3), dtype=np.uint8)
    canvas[:h, :w] = frame.copy()
    cv2.rectangle(canvas, (0, h), (w, h + panel_h), (18, 18, 18), -1)
    cv2.line(canvas, (0, h), (w, h), (80, 80, 80), 1)

    y = h + 22
    cv2.putText(canvas, "STAGE 1: MOTION GATE", (12, y), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 200, 200), 2)
    status = "TRIGGERED" if gate_result.triggered else "NORMAL"
    sc = (0, 0, 255) if gate_result.triggered else (0, 220, 0)
    cv2.putText(canvas, status, (w - 120, y), cv2.FONT_HERSHEY_SIMPLEX, 0.6, sc, 2)

    bar_x, bar_y, bar_w, bar_h = 12, h + 32, w - 24, 16
    cv2.rectangle(canvas, (bar_x, bar_y), (bar_x + bar_w, bar_y + bar_h), (40, 40, 40), -1)
    fill_w = int(bar_w * min(1.0, gate_result.raw_score))
    cv2.rectangle(canvas, (bar_x, bar_y), (bar_x + fill_w, bar_y + bar_h), sc, -1)
    thr_x = bar_x + int(bar_w * min(1.0, gate_result.threshold))
    cv2.line(canvas, (thr_x, bar_y - 2), (thr_x, bar_y + bar_h + 2), (255, 255, 255), 2)

    y_info = h + 58
    info1 = f"Raw: {gate_result.raw_score:.3f}  |  Smoothed: {gate_result.smoothed_score:.3f}  |  Thr: {gate_result.threshold:.3f}  |  Mode: {gate_result.mode.upper()}"
    cv2.putText(canvas, info1, (12, y_info), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (180, 180, 180), 1)

    y_track_title = h + 80
    cv2.putText(canvas, f"STAGE 2&3: TRACKED OBJECTS ({len(tracks)})", (12, y_track_title), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 200, 200), 1)
    cv2.line(canvas, (12, y_track_title + 6), (w - 12, y_track_title + 6), (60, 60, 60), 1)

    if not tracks:
        cv2.putText(canvas, "No objects tracked", (12, y_track_title + 30), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (100, 100, 100), 1)
        return canvas

    card_w = 220
    card_h = 120
    cols = max(1, (w - 24) // (card_w + 8))
    x_start = 12
    y_start = y_track_title + 16

    if pair_features is None:
        pair_features = extractor.all_pair_features()

    for idx, (tid, track) in enumerate(tracks.items()):
        features = extractor.get_features(tid)
        if not features: continue
        label = classifier.predict(features, frame_idx, pair_features)
        col = idx % cols
        row = idx // cols
        cx = x_start + col * (card_w + 8)
        cy = y_start + row * (card_h + 8)

        if cy + card_h > h + panel_h - 5: break

        if label == "collision": card_bg, border_c = (30, 20, 20), (0, 0, 200)
        elif label == "rollover": card_bg, border_c = (30, 25, 15), (0, 140, 200)
        else: card_bg, border_c = (25, 25, 30), (60, 60, 60)
        cv2.rectangle(canvas, (cx, cy), (cx + card_w, cy + card_h), card_bg, -1)
        cv2.rectangle(canvas, (cx, cy), (cx + card_w, cy + card_h), border_c, 1)

        cv2.putText(canvas, f"ID:{tid}  {track.class_name}", (cx + 6, cy + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 255), 1)
        lc = (0, 200, 0) if label == "normal" else (0, 0, 220) if label == "collision" else (0, 160, 220)
        cv2.putText(canvas, label.upper(), (cx + card_w - 60, cy + 16), cv2.FONT_HERSHEY_SIMPLEX, 0.38, lc, 1)

        tx, ty = cx + 6, cy + 34
        line_h = 14

        # Pair evidence involving this track (strongest by IoU), if any.
        my_pairs = [(pk, pf) for pk, pf in (pair_features or {}).items() if tid in pk]
        best_pair = max(my_pairs, key=lambda it: it[1]["iou_now"] + it[1]["iou_trend"], default=None)
        pair_line = ""
        if best_pair:
            pk, pf = best_pair
            other = pk[1] if pk[0] == tid else pk[0]
            pair_line = f"PX {other} IOU {pf['iou_now']:.2f} tr {pf['iou_trend']:+.3f} cv {pf['closing_velocity']:.1f}"

        cv2.putText(canvas, f"Hd90:     {features['max_heading_change']:.2f}  Spd: {features['speed']:.1f}",
                    (tx, ty), cv2.FONT_HERSHEY_SIMPLEX, 0.32, (200, 200, 100), 1)
        cv2.putText(canvas, f"Flow:     {features['flow_spike']:.2f}  Decel: {features['decel_count']}",
                    (tx, ty + line_h), cv2.FONT_HERSHEY_SIMPLEX, 0.32, (100, 200, 200), 1)
        cv2.putText(canvas, f"AR osc:   {features['ar_oscillation']:.3f}  peaks: {features['ar_peaks_per_window']}",
                    (tx, ty + line_h * 2), cv2.FONT_HERSHEY_SIMPLEX, 0.32, (200, 100, 200), 1)
        cv2.putText(canvas, f"Frag(w):  {features['fragmentation']}  Hist: {features['history_len']}",
                    (tx, ty + line_h * 3), cv2.FONT_HERSHEY_SIMPLEX, 0.32, (150, 150, 150), 1)
        cv2.putText(canvas, pair_line or "Pair:     -", (tx, ty + line_h * 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.32, (150, 220, 180), 1)

    y_footer = h + panel_h - 8
    cv2.putText(canvas, f"Frame: {frame_idx}", (12, y_footer), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (100, 100, 100), 1)

    return canvas


def run_realtime(input_path: str, output_path: str = None, mode: str = "auto", fresh: bool = False,
                 stride: int = 3, calibrate_only: bool = False, exit_stable: bool = True,
                 min_frames: int = 9000, stable_tol: float = 0.008, drift_tol: float = 0.015):
    print(f"[Cores] {_NPROC} CPU threads: cv2={cv2.getNumThreads()} torch={torch.get_num_threads()}")
    model = None
    if not calibrate_only:
        print(f"Loading YOLO...")
        model = YOLO("yolo26n.pt")
        model.to("cpu")
    cap = cv2.VideoCapture(input_path, cv2.CAP_V4L2)
    print(f"V4L2 opened: {cap.isOpened()}")
    if not cap.isOpened():
        print("Falling back to default backend...")
        cap = cv2.VideoCapture(input_path)
    print(f"Default opened: {cap.isOpened()}")
    if not cap.isOpened():
        print(f"ERROR: Cannot open {input_path}")
        return
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    output_path = output_path or input_path.replace(".mp4", "_annotated.mp4")
    writer = None
    if not calibrate_only:
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        writer = cv2.VideoWriter(output_path, fourcc, fps, (width, height + 350))
    gate = MotionGate(camera_id="cam_001", physics_window=5, suppress_alerts=calibrate_only)
    if fresh:
        for mode_name in ("day", "twilight", "night"):
            path = gate.threshold_mgr._baseline_path(mode_name)
            if os.path.exists(path):
                os.remove(path)
                print(f"[Fresh] Deleted old baseline: {path}")
        gate.threshold_mgr.baselines = {m: BaselineState() for m in ("day", "twilight", "night")}
        print("[Fresh] Starting calibration from scratch")
    if mode != "auto":
        gate.threshold_mgr.classifier.forced_mode = mode
        gate.threshold_mgr.classifier.initialized = True
        gate.threshold_mgr.classifier.current_mode = mode
        print(f"[Mode] Manual override: {mode.upper()} (locked - brightness classifier disabled)")
    monitor = StabilityMonitor(min_frames=min_frames, stable_tol=stable_tol, drift_tol=drift_tol) if exit_stable else None
    if exit_stable:
        print(f"[Exit] Stable-exit ON: min_frames={monitor.min_frames}, stable_tol={monitor.stable_tol}, "
              f"drift_tol={monitor.drift_tol}, window={monitor.stable_window}, confirm={monitor.confirm_checks}x")
    extractor = FeatureExtractor(window_size=30)
    classifier = RuleClassifier()
    print(f"Input: {width}x{height} @ {fps:.1f} FPS ({total} frames)")
    print(f"Motion scoring: EVERY frame (keeps baseline representative)")
    if calibrate_only:
        print(f"Mode: {mode.upper()} | CALIBRATE-ONLY (no YOLO / tracking / annotated video; alert-freeze disabled)")
    else:
        print(f"Mode: {mode.upper()} | heavy stage-2/3 (YOLO+flow) every {stride} frame(s)")
        print(f"Output: {output_path}")
    frame_idx = 0
    yolo_every = max(1, stride)
    last_detections = []
    tracks = {}
    gc_every = 250
    gate_result: Optional[GateResult] = None
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frame_idx += 1
        gate_result = gate.check(frame)
        if not calibrate_only:
            if frame_idx % yolo_every == 0:
                results = model(frame, conf=0.25, verbose=False, device="cpu")
                last_detections = []
                if results and results[0].boxes is not None:
                    for box in results[0].boxes:
                        x1, y1, x2, y2 = map(int, box.xyxy[0])
                        cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
                        conf = float(box.conf[0])
                        cls_id = int(box.cls[0])
                        cls_name = model.names[cls_id] if cls_id < len(model.names) else f"cls_{cls_id}"
                        last_detections.append({"bbox": (x1, y1, x2, y2), "center": (cx, cy), "class": cls_name, "conf": conf})
            tracks = extractor.update(last_detections, frame, frame_idx=frame_idx)
            pair_features = extractor.all_pair_features()
            for det in last_detections:
                x1, y1, x2, y2 = det["bbox"]
                color = (0, 255, 0)
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                cv2.putText(frame, f"{det['class']} {det['conf']:.2f}", (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
            for tid, track in tracks.items():
                x1, y1, x2, y2 = track.bbox
                cx, cy = track.center
                cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 0, 255), 3)
                cv2.circle(frame, (cx, cy), 5, (255, 0, 255), -1)
                f = extractor.get_features(tid)
                if f:
                    cl = classifier.predict(f, frame_idx, pair_features)
                    if cl in ("collision", "rollover"):
                        for baseline in gate.threshold_mgr.baselines.values():
                            baseline.trigger_freeze(3.0)
                    lc = (0, 255, 0) if cl == "normal" else (0, 0, 255) if cl == "collision" else (0, 165, 255)
                    cv2.putText(frame, f"ID:{tid} {cl.upper()}", (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, lc, 2)
                    cv2.putText(frame, f"H:{f['max_heading_change']:.2f} FS:{f['flow_spike']:.2f} AR:{f['ar_oscillation']:.2f}", (x1, y2 + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 255), 1)
            canvas = draw_panel(frame, gate_result, tracks, extractor, classifier, frame_idx, pair_features)
            writer.write(canvas)
        if monitor is not None and monitor.can_exit_now(frame_idx, gate_result.mode, gate_result.profile):
            print(f"[Calibrate] EXIT EARLY at frame {frame_idx}/{total} - stable-exit confirmed "
                  f"(checks={monitor.confirm_streak}): thr={gate_result.profile.threshold:.4f}, "
                  f"median={gate_result.profile.median:.4f}, mad={gate_result.profile.mad:.4f}")
            break
        if frame_idx % gc_every == 0:
            gc.collect()
        if frame_idx % 30 == 0:
            tracks_n = "N/A (calibrate-only)" if calibrate_only else len(tracks)
            print(f"  Frame {frame_idx}/{total}: Gate={'TRIGGERED' if gate_result.triggered else 'NORMAL'} "
                  f"Thr={gate_result.threshold:.3f} Tracks={tracks_n}")
    cap.release()
    if writer is not None:
        writer.release()
    if gate_result is None:
        print("No frames processed.")
        return
    for mode_name in ("day", "twilight", "night"):
        gate.threshold_mgr._save_baseline(mode_name)
    for mode_name in ("day", "twilight", "night"):
        b = gate.threshold_mgr.baselines[mode_name]
        if b.calibrated:
            print(f"[Calibrate] {mode_name.upper()} calibrated: median={b.median:.4f}, mad={b.mad:.4f}, "
                  f"thr={b.threshold:.4f}, scores_seen={b.scores_seen}")
        else:
            print(f"[Calibrate] {mode_name.upper()} uncalibrated: scores_seen={b.scores_seen} "
                  f"(need >={gate.threshold_mgr.calibration_min_frames})")
    if not calibrate_only:
        print(f"Output saved to: {output_path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python stage1_motion_gate.py /path/to/video.mp4 [output.mp4] "
              "[--mode day|night|twilight|auto] [--fresh] [--stride N] [--calibrate-only] "
              "[--no-exit-stable] [--min-frames N] [--stable-tol F] [--drift-tol F]")
        sys.exit(1)
    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 and not sys.argv[2].startswith("--") else None
    mode = "auto"
    fresh = False
    stride = 3
    calibrate_only = False
    exit_stable = True
    min_frames = 9000
    stable_tol = 0.008
    drift_tol = 0.015
    for i, arg in enumerate(sys.argv):
        if arg == "--mode" and i + 1 < len(sys.argv):
            mode = sys.argv[i + 1].lower()
            if mode not in ("day", "night", "twilight", "auto"):
                print(f"ERROR: Invalid mode '{mode}'. Use: day, night, twilight, auto")
                sys.exit(1)
        elif arg == "--fresh":
            fresh = True
        elif arg == "--stride" and i + 1 < len(sys.argv):
            stride = max(1, int(sys.argv[i + 1]))
        elif arg == "--calibrate-only":
            calibrate_only = True
        elif arg == "--no-exit-stable":
            exit_stable = False
        elif arg == "--min-frames" and i + 1 < len(sys.argv):
            min_frames = max(300, int(sys.argv[i + 1]))
        elif arg == "--stable-tol" and i + 1 < len(sys.argv):
            stable_tol = max(0.0, float(sys.argv[i + 1]))
        elif arg == "--drift-tol" and i + 1 < len(sys.argv):
            drift_tol = max(0.0, float(sys.argv[i + 1]))
    run_realtime(input_path, output_path, mode=mode, fresh=fresh, stride=stride,
                 calibrate_only=calibrate_only, exit_stable=exit_stable,
                 min_frames=min_frames, stable_tol=stable_tol, drift_tol=drift_tol)
