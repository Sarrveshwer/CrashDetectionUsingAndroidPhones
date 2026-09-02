"""Configuration loading and saving for the auto-threshold system.

Provides CameraConfig dataclass, per-camera YAML config files,
and auto-threshold initialization/calibration state management.
"""

import os
from datetime import datetime
from dataclasses import dataclass, asdict
from typing import Optional, Dict, Any

import yaml

# Base directory for config files (trying module directory)
_BASE_DIR: str = os.path.dirname(os.path.abspath(__file__))
# Relative path within the trying module
_CONFIG_SUBDIR: str = "configs"

# Ensure config directory exists at module load time
os.makedirs(os.path.join(_BASE_DIR, _CONFIG_SUBDIR), exist_ok=True)


CAMERA_CONFIG_DIR = os.path.join(_BASE_DIR, _CONFIG_SUBDIR)


@dataclass
class DayNightThresholds:
    day_threshold: int = 80
    night_threshold: int = 50
    hysteresis: int = 10


@dataclass
class AutoThresholdConfig:
    enabled: bool = True
    calibration_frames: int = 300
    online: dict = None
    bounds: dict = None
    calibration_count: int = 0

    def __post_init__(self):
        if self.online is None:
            self.online = {
                "alpha": 0.001,
                "k_mad": 3.0,
                "freeze_seconds": 3,
            }
        if self.bounds is None:
            self.bounds = {"min": 0.15, "max": 0.95}


@dataclass
class CameraConfig:
    camera_id: str = "cam_001"
    created_at: str = ""
    auto_threshold: AutoThresholdConfig = None
    day_profile: dict = None
    night_profile: dict = None

    def __post_init__(self):
        if self.auto_threshold is None:
            self.auto_threshold = AutoThresholdConfig()
        if self.day_profile is None:
            self.day_profile = {
                "enabled": False,
                "median_ema": 0.0,
                "mad_ema": 0.0,
                "threshold": 0.5,
                "calibration_frames_collected": 0,
                "calibrated": False,
                "last_updated": None,
                "freeze_until": 0,
            }
        if self.night_profile is None:
            self.night_profile = {
                "enabled": False,
                "median_ema": 0.0,
                "mad_ema": 0.0,
                "threshold": 0.5,
                "calibration_frames_collected": 0,
                "calibrated": False,
                "last_updated": None,
                "freeze_until": 0,
            }

    def save(self, path: str = None):
        """Save config to YAML file."""
        if path is None:
            path = os.path.join(CAMERA_CONFIG_DIR, f"camera_{self.camera_id}.yaml")
        
        data = asdict(self)
        data["created_at"] = datetime.utcnow().isoformat() + "Z"
        
        with open(path, "w") as f:
            yaml.dump(data, f, default_flow_style=False, sort_keys=False)

    @classmethod
    def load(cls, path: str = None) -> "CameraConfig":
        """Load config from YAML file."""
        if path is None:
            # Try to find camera-specific config in the trying module directory
            base = CAMERA_CONFIG_DIR
            if os.path.exists(base):
                for f in os.listdir(base):
                    if f.endswith(".yaml") and f"camera_{cls.camera_id}" in f:
                        path = os.path.join(base, f)
                        break
                else:
                    path = os.path.join(CAMERA_CONFIG_DIR, "camera_config.yaml")
            else:
                path = os.path.join(CAMERA_CONFIG_DIR, "camera_config.yaml")
        
        if not os.path.exists(path):
            # Return default config
            return cls()
        
        with open(path, "r") as f:
            data = yaml.safe_load(f)
        
        config = cls(
            camera_id=data.get("camera_id", "cam_001"),
            created_at=data.get("created_at", ""),
        )
        
        # Restore nested configs
        if data.get("auto_threshold"):
            auto_data = data["auto_threshold"]
            config.auto_threshold = AutoThresholdConfig(
                enabled=auto_data.get("enabled", True),
                calibration_frames=auto_data.get("calibration_frames", 300),
                online=auto_data.get("online", None),
                bounds=auto_data.get("bounds", None),
                calibration_count=auto_data.get("calibration_count", 0),
            )
        
        # Restore profiles
        for profile_name in ["day_profile", "night_profile"]:
            if data.get(profile_name):
                profile_data = data[profile_name]
                profile_dict = {
                    "enabled": profile_data.get("enabled", False),
                    "median_ema": profile_data.get("median_ema", 0.0),
                    "mad_ema": profile_data.get("mad_ema", 0.0),
                    "threshold": profile_data.get("threshold", 0.5),
                    "calibration_frames_collected": profile_data.get(
                        "calibration_frames_collected", 0
                    ),
                    "calibrated": profile_data.get("calibrated", False),
                    "last_updated": profile_data.get("last_updated", None),
                    "freeze_until": profile_data.get("freeze_until", 0),
                }
                setattr(config, profile_name, profile_dict)
        
        return config


def init_config(camera_id: str = "cam_001") -> CameraConfig:
    """Initialize a new camera config, creating directory if needed.
    
    Creates/loads config at: trying/configs/camera_<camera_id>.yaml
    """
    config_path = os.path.join(CAMERA_CONFIG_DIR, f"camera_{camera_id}.yaml")
    
    if not os.path.exists(config_path):
        # Create template with placeholders
        config = CameraConfig(camera_id=camera_id)
        config.save(path=config_path)
        return config
    
    return CameraConfig.load(path=config_path)