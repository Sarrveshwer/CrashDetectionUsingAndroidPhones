"""Tests for ProfileState dataclass."""

import time
from trying.src.threshold.profile import ProfileState


def test_profile_defaults():
    """Profile should have sensible defaults."""
    p = ProfileState()
    assert p.is_frozen() is False
    assert p.calibrated is False
    assert p.threshold == 0.5


def test_freeze_timing():
    """Freeze should set freeze_until correctly."""
    p = ProfileState()
    p.trigger_freeze(3.0)
    
    # Should be frozen immediately
    assert p.is_frozen() is True
    
    # freeze_until should be ~3 seconds from now
    expected_until = time.time() * 1000 + 3000
    assert abs(p.freeze_until - expected_until) < 100  # 100ms tolerance
    
    # After waiting 4 seconds, should be unfrozen
    time.sleep(4.1)
    assert p.is_frozen() is False


def test_freeze_no_arg():
    """Freeze with default 3 seconds."""
    p = ProfileState()
    p.trigger_freeze()  # default
    assert p.is_frozen() is True
    # Check it's approximately 3 seconds
    expected = time.time() * 1000 + 3000
    assert abs(p.freeze_until - expected) < 200