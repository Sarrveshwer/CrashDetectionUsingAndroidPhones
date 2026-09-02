"""Tests for day/night classifier."""

import numpy as np
import cv2
import pytest

from trying.src.threshold.day_night import DayNightClassifier


def test_init_default():
    """Default thresholds should set day > night."""
    cls = DayNightClassifier()
    assert cls.day_threshold > cls.night_threshold


def test_classify_day():
    """Bright frame should classify as day."""
    cls = DayNightClassifier(day_threshold=80, night_threshold=50, hysteresis=10)
    bright_frame = np.full((100, 100, 3), 200, dtype=np.uint8)  # bright BGR
    mode = cls.classify(bright_frame)
    assert mode == "day"


def test_classify_night():
    """Dark frame should classify as night."""
    cls = DayNightClassifier(day_threshold=80, night_threshold=50, hysteresis=10)
    dark_frame = np.full((100, 100, 3), 30, dtype=np.uint8)  # dark BGR
    mode = cls.classify(dark_frame)
    assert mode == "night"


def test_hysteresis_prevents_flicker():
    """Hysteresis should prevent rapid mode switching."""
    cls = DayNightClassifier(day_threshold=80, night_threshold=50, hysteresis=10)
    
    # Start in day mode
    cls.current_mode = "day"  # access internal state
    cls.initialized = True
    
    # Brightness just below night threshold - should NOT switch
    bright_frame = np.full((100, 100, 3), 55, dtype=np.uint8)  # 55 > 50 - 10 hysteresis = 40
    mode = cls.classify(bright_frame)
    assert mode == "day", f"Expected day, got {mode} with brightness 55 and hysteresis 10"
    
    # Brightness well below night threshold - should switch
    dark_frame = np.full((100, 100, 3), 35, dtype=np.uint8)  # 35 < 40
    mode = cls.classify(dark_frame)
    assert mode == "night", f"Expected night, got {mode} with brightness 35 and hysteresis 10"


def test_first_frame_initialization():
    """First frame should initialize mode based on brightness."""
    cls = DayNightClassifier(day_threshold=80, night_threshold=50, hysteresis=10)
    # Bright first frame
    bright_frame = np.full((100, 100, 3), 150, dtype=np.uint8)
    mode = cls.classify(bright_frame)
    assert mode == "day", f"First frame bright should be day, got {mode}"
    
    # Dark first frame initialization handled separately