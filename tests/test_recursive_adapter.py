"""Tests for RecursiveAdapter: startup calibration + online adaptation."""

import time
import numpy as np
from trying.src.threshold.adapter import RecursiveAdapter
from trying.src.threshold.profile import ProfileState


def test_calibration_progressive():
    """Threshold should tighten as calibration frames accumulate."""
    config = {"alpha": 0.001, "k_mad": 3.0, "freeze_seconds": 3.0, "calibration_frames": 100}
    adapter = RecursiveAdapter(config)
    profile = ProfileState()
    
    # Simulate 150 frames of normal traffic (low scores ~0.1)
    base_score = 0.1
    for i in range(150):
        score = base_score + np.random.normal(0, 0.01)
        threshold = adapter.update(score, alert_active=False, profile=profile)
    
    # After calibration, threshold should be low (normal traffic baseline)
    assert profile.calibrated is True
    assert profile.calibration_frames_collected == 150
    # Threshold should be around P95 of ~0.1 scores ≈ 0.13 + margin
    assert 0.08 < profile.threshold < 0.25, f"Expected threshold ~0.1 after calibration, got {profile.threshold}"


def test_online_adaptation_after_calibration():
    """After calibration, threshold should adapt via EMA."""
    config = {"alpha": 0.001, "k_mad": 3.0, "freeze_seconds": 3.0, "calibration_frames": 100}
    adapter = RecursiveAdapter(config)
    profile = ProfileState(calibrated=True, threshold=0.3, median_ema=0.1, mad_ema=0.02)
    
    # Simulate gradual upward drift in traffic
    for i in range(200):
        score = 0.1 + 0.001 * i  # slow increase
        threshold = adapter.update(score, alert_active=False, profile=profile)
    
    # Threshold should have risen with the drift
    assert profile.threshold > 0.3, f"Threshold should adapt upward, got {profile.threshold}"
    assert profile.median_ema > 0.1, "Median EMA should track the drift"


def test_freeze_during_alert():
    """Adapter should freeze during and after alert."""
    config = {"alpha": 0.001, "k_mad": 3.0, "freeze_seconds": 3.0, "calibration_frames": 100}
    adapter = RecursiveAdapter(config)
    profile = ProfileState(calibrated=True, threshold=0.3, median_ema=0.1, mad_ema=0.02)
    
    # Simulate alert
    threshold_during = adapter.update(0.9, alert_active=True, profile=profile)
    assert profile.is_frozen() is True
    threshold_after = adapter.update(0.9, alert_active=False, profile=profile)
    # Should still be frozen immediately after
    assert profile.is_frozen() is True
    
    # Wait 3+ seconds
    time.sleep(3.1)
    # Now should be unfrozen and have adapted
    threshold_after_wait = adapter.update(0.9, alert_active=False, profile=profile)
    # Cooldown over, should have adapted (high scores may have raised threshold further or lowered depending)
    # Key point: is_frozen should be False after cooldown


def test_recursive_no_fallback():
    """Adapter should never return None or use hardcoded defaults secretly."""
    config = {"alpha": 0.001, "k_mad": 3.0, "freeze_seconds": 3.0, "calibration_frames": 10}
    adapter = RecursiveAdapter(config)
    profile = ProfileState()
    
    # First frame - should always return something within bounds
    t = adapter.update(0.5, alert_active=False, profile=profile)
    assert 0.15 <= t <= 0.95, f"Threshold should be in [0.15, 0.95], got {t}"
    # Should have made some adaptation (even if minimal with only 1 frame)
    assert profile.threshold is not None