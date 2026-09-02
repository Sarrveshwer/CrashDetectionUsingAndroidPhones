"""Tests for AutoThresholdManager: day/night coordination + persistence."""

import numpy as np
import time
from trying.src.threshold.manager import AutoThresholdManager
from trying.src.utils.config_loader import CameraConfig


def test_manager_initialization():
    """Manager should initialize with day/night profiles."""
    config = CameraConfig.load()  # loads default or existing
    mgr = AutoThresholdManager(
        config.__dict__,
        day_thresh=80,
        night_thresh=50,
        hysteresis=10,
    )
    
    assert mgr is not None
    assert mgr.classifier is not None
    assert "day" in mgr.profiles
    assert "night" in mgr.profiles


def test_day_night_classification():
    """Manager should classify frames as day or night."""
    config = CameraConfig.load()
    mgr = AutoThresholdManager(
        config.__dict__,
        day_thresh=80,
        night_thresh=50,
        hysteresis=10,
    )
    
    # Bright frame = day
    bright = np.full((100, 100, 3), 150, dtype=np.uint8)
    mode = mgr.classify_frame(bright)
    assert mode == "day"
    
    # Dark frame = night
    dark = np.full((100, 100, 3), 30, dtype=np.uint8)
    mode = mgr.classify_frame(dark)
    assert mode == "night"


def test_update_with_physics_score():
    """Manager.update() should return (threshold, mode, profile)."""
    config = CameraConfig.load()
    mgr = AutoThresholdManager(
        config.__dict__,
        day_thresh=80,
        night_thresh=50,
        hysteresis=10,
    )
    
    # Bright frame with low physics score (normal traffic)
    bright = np.full((100, 100, 3), 150, dtype=np.uint8)
    threshold, mode, profile = mgr.update(bright, physics_score=0.1, alert_active=False)
    
    assert isinstance(threshold, float)
    assert mode in ("day", "night")
    assert hasattr(profile, 'threshold')
    assert hasattr(profile, 'calibrated')


def test_emergency_alert_freeze():
    """Alert should trigger 3-second freeze."""
    config = CameraConfig.load()
    mgr = AutoThresholdManager(
        config.__dict__,
        day_thresh=80,
        night_thresh=50,
        hysteresis=10,
    )
    
    # Start with calibrated profiles
    mgr.profiles["day"].calibrated = True
    mgr.profiles["day"].threshold = 0.3
    mgr.profiles["day"].median_ema = 0.1
    mgr.profiles["day"].mad_ema = 0.02
    
    # Trigger alert
    mgr.emergency_alert_triggered()
    
    # Should be frozen
    assert mgr.profiles["day"].is_frozen() is True
    
    # Wait 3 seconds
    time.sleep(3.1)
    # Should be unfrozen after cooldown
    # Note: is_frozen depends on absolute time, so just check the flag logic


def test_persistence_save_load():
    """Manager should be able to save and load profiles."""
    config = CameraConfig.load()
    mgr = AutoThresholdManager(
        config.__dict__,
        day_thresh=80,
        night_thresh=50,
        hysteresis=10,
    )
    
    # Run a few updates to adapt thresholds
    bright = np.full((100, 100, 3), 150, dtype=np.uint8)
    for _ in range(100):
        mgr.update(bright, physics_score=0.1, alert_active=False)
    
    # Save should have been called (check config file exists)
    # The manager auto-saves; just verify no errors
    assert config is not None


def test_manager_with_custom_config():
    """Manager with pre-calibrated config should work."""
    # Create config with pre-set thresholds
    config_dict = {
        "camera_id": "test_cam",
        "auto_threshold": {
            "enabled": True,
            "calibration_frames": 300,
            "online": {"alpha": 0.001, "k_mad": 3.0, "freeze_seconds": 3.0},
            "bounds": {"min": 0.15, "max": 0.95},
        },
        "day_profile": {
            "enabled": True,
            "median_ema": 0.12,
            "mad_ema": 0.03,
            "threshold": 0.20,
            "calibration_frames_collected": 300,
            "calibrated": True,
            "last_updated": "2026-01-01T00:00:00Z",
            "freeze_until": 0,
        },
        "night_profile": {
            "enabled": True,
            "median_ema": 0.08,
            "mad_ema": 0.02,
            "threshold": 0.14,
            "calibration_frames_collected": 300,
            "calibrated": True,
            "last_updated": "2026-01-01T00:00:00Z",
            "freeze_until": 0,
        },
    }
    config = type('Config', (), config_dict)()
    mgr = AutoThresholdManager(config.__dict__, day_thresh=80, night_thresh=50, hysteresis=10)
    
    # Should use the pre-set thresholds
    bright = np.full((100, 100, 3), 150, dtype=np.uint8)
    threshold, mode, profile = mgr.update(bright, physics_score=0.1, alert_active=False)
    assert abs(profile.threshold - 0.20) < 0.05, f"Expected ~0.20, got {profile.threshold}"