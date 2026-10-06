# ASSUMPTIONS, EDGE CASES & KNOWN ISSUES
# 3-Stage Crash Detection System - Comprehensive Analysis

---

## 1. STAGE 1: MOTION GATE ASSUMPTIONS

### 1.1 Physics Gate (Frame Differencing)
- **Assumption**: Sudden pixel changes = potential incident
  - *Reality*: Shadows, lighting changes, weather (rain/snow), camera auto-exposure, headlight glare cause false triggers
  - *EMAS approach*: Uses loop detectors (occupancy/speed) + video verification, not pure pixel differencing
  - *Risk*: High false positive rate in dynamic lighting

- **Assumption**: 300-frame calibration captures "normal" traffic
  - *Reality*: 
    - Rush hour vs midnight have vastly different baselines
    - 300 frames = 10 seconds at 30fps - may catch an incident during calibration
    - No day/night separation during calibration (calibrates on first 300 frames regardless of mode)
  - *EMAS approach*: Calibrated per-site, per-lane, per-time-of-day using months of loop data

- **Assumption**: Single threshold per day/night mode works
  - *Reality*: 
    - Camera angle affects pixel motion magnitude (near vs far objects)
    - Weather changes baseline significantly
    - Seasonal changes (sun position, foliage)
  - *EMAS approach*: Per-site, per-lane calibration with regular recalibration

### 1.2 Auto-Threshold Issues (CURRENT PROBLEM)
- **Problem**: EMA adaptation too slow/fast
  - alpha=0.001 means ~1000 frames (33 sec) to adapt - too slow for lighting changes
  - No separate adaptation for day vs night transition
  - Freeze logic only triggers on alerts, not on lighting changes

- **Problem**: No per-camera calibration persistence
  - YAML saves threshold but recalibrates on every restart
  - No "calibrated" flag to skip 300-frame startup

- **Problem**: Day/night classification is naive
  - Single brightness threshold ignores camera auto-gain/exposure
  - No hysteresis during twilight transitions
  - IR night vision cameras have different characteristics

---

## 2. STAGE 2: FEATURE EXTRACTION ASSUMPTIONS

### 2.1 Tracking (Centroid Matching)
- **Assumption**: Simple centroid distance < 80px works for tracking
  - *Reality*: 
    - Fails at intersections, merges, occlusions
    - No appearance features (color, shape) for re-identification
    - ID switches on occlusion cause fragmentation spikes (false collision signal)
  - *EMAS approach*: Loop detectors track per-lane; cameras only verify

- **Assumption**: 30-frame window (1 sec) sufficient
  - *Reality*: 
    - High-speed highways need longer window (3-5 sec)
    - Low-speed urban needs shorter
    - Rollover may take 2-3 seconds to manifest

### 2.2 Optical Flow (Farneback)
- **Assumption**: Dense optical flow on ROI works for flow spike
  - *Reality*:
    - Farneback is CPU-intensive (~15ms/frame on ROI)
    - Camera vibration = global motion = false flow
    - Parallax from camera height = false flow for distant objects
    - No ego-motion compensation (static camera assumed)
  - *EMAS approach*: Loop detectors provide ground-truth speed/occupancy

- **Assumption**: Flow spike = current/EMA > threshold
  - *Reality*:
    - Parallax from camera angle causes natural flow gradients
    - Large vehicles (trucks) have different flow patterns
    - Rain/wiper artifacts create noise

### 2.3 Feature Assumptions
- **Heading change**: Assumes smooth trajectories, sudden change = collision
  - *Reality*: Lane changes, obstacle avoidance, turning = false positives
- **Aspect ratio oscillation**: Assumes rollover = AR oscillation
  - *Reality*: Perspective changes (vehicle turning toward/away from camera) = AR change
  - No 3D box estimation from 2D bbox
- **Fragmentation**: Assumes ID switches = incident
  - *Reality*: Tracker failures, occlusion, detection dropout = false fragmentation

---

## 3. STAGE 3: CLASSIFIER ASSUMPTIONS

### 3.1 Rule-Based Classifier
- **Assumption**: Fixed thresholds work across all cameras/scenarios
  - *Reality*: Thresholds tuned on one video fail on others
  - *EMAS approach*: Algorithm fusion (multiple algorithms + weighted voting)

- **Assumption**: Binary collision/rollover/normal sufficient
  - *Reality*: 
    - Near-miss, sudden braking, debris, pedestrian, animal
    - Multi-vehicle pileup vs 2-vehicle collision
    - Severity estimation needed for dispatch priority

- **Assumption**: 30-frame cooldown prevents duplicate alerts
  - *Reality*: Long incidents (pileup) need sustained alerts, not suppression

### 3.2 Missing Classifier Features
- No velocity/speed estimation (pixels/frame ≠ km/h without calibration)
- No lane information (which lane is incident in?)
- No vehicle type differentiation (motorcycle vs truck = different dynamics)
- No weather/lighting condition awareness
- No pre-incident traffic state (congested vs free-flow)

---

## 4. EMAS SYSTEM ARCHITECTURE (SINGAPORE) - KEY INSIGHTS

### 4.1 Detection Layer (Dual-Station Approach)
```
EMAS Detection Logic:
├── Loop Detectors (Primary)
│   ├── Occupancy per lane per 1-min interval
│   ├── Speed per lane per 1-min interval
│   ├── Flow per lane per 1-min interval
│   └── Dual-Station Comparison (upstream vs downstream)
│       ├── CODE Algorithm: Occupancy + Speed comparison
│       ├── Flow-based CODE: Adds pre-incident flow condition
│       └── Dual-Variable (DV): Speed + Occupancy thresholds
│
└── Video Cameras (Verification Only)
    ├── PTZ cameras at 500m intervals
    ├── Operator verification before dispatch
    └── NO automated video detection in production
```

### 4.2 Key EMAS Principles (from Mak & Fan papers)
1. **Pre-incident baseline critical**: Algorithms use "normal" traffic 5-min before incident
2. **Dual-station > Single-station**: Upstream/downstream comparison cancels daily variations
3. **Algorithm fusion > Single algorithm**: CODE + DV + Flow-CODE fused with weighted voting
4. **Calibration per site**: CTE algorithms recalibrated for Melbourne freeways
5. **Human-in-loop mandatory**: Operators verify every detection before dispatch
6. **False alarm target**: < 1% (achieved 0.2-1.0% with fusion)

### 4.3 EMAS vs Our Approach - Critical Gaps
| Aspect | EMAS | Our System |
|--------|------|------------|
| Primary sensor | Loop detectors (ground truth) | Video only (noisy) |
| Detection logic | Multi-algorithm fusion | Single rule-based |
| Calibration | Months of loop data per site | 300 frames (10 sec) |
| Verification | Human operator | None (auto) |
| False alarm target | < 1% | Unknown (likely > 20%) |
| Environment handling | Per-site calibration | Single threshold |
| Traffic state awareness | Pre-incident 5-min baseline | None |

---

## 5. EDGE CASES NOT HANDLED

### 5.1 Environmental
- [ ] Rain/fog/snow (reduces visibility, changes flow)
- [ ] Night with headlight glare / IR reflections
- [ ] Camera vibration (wind, heavy vehicles)
- [ ] Seasonal sun position changes (shadows)
- [ ] Wet road reflections

### 5.2 Traffic Scenarios
- [ ] Congested traffic (low speed, high occupancy = false incident)
- [ ] Free-flow high speed (high pixel motion = false incident)
- [ ] Lane changes / merging / weaving
- [ ] Sudden braking (no collision)
- [ ] Motorcycle lane splitting
- [ ] Emergency vehicles
- [ ] Construction zones (lane shifts)
- [ ] Tunnels (lighting transitions)

### 5.3 Incident Types
- [ ] Multi-vehicle pileup (sustained, not single spike)
- [ ] Rollover (slow, may not trigger motion gate)
- [ ] Pedestrian/cyclist incident
- [ ] Animal on road
- [ ] Debris/fallen cargo
- [ ] Vehicle fire (smoke obscures)
- [ ] Secondary incidents (rubbernecking)

### 5.4 Camera/Setup
- [ ] PTZ cameras (moving FOV)
- [ ] Multiple cameras overlapping
- [ ] Different resolutions/frame rates
- [ ] Compression artifacts (H.264/265)
- [ ] Network latency/jitter (RTSP)
- [ ] Camera tampering/blocking

### 5.5 System
- [ ] Long-running memory leaks (calibration buffers)
- [ ] Clock drift between cameras
- [ ] Power loss / restart recovery
- [ ] Config corruption
- [ ] Concurrent video streams

---

## 6. THRESHOLD MODIFIER SPECIFIC ISSUES

### 6.1 Current Implementation Problems
```python
# Current alpha=0.001 means:
# - Time constant: 1/0.001 = 1000 frames = 33 seconds at 30fps
# - Too slow for: cloud cover, shadows, auto-exposure
# - Too fast for: gradual seasonal changes

# Current freeze: 3 seconds (90 frames)
# - Too short for: multi-vehicle incidents
# - Doesn't freeze on: lighting changes, camera adjustments
```

### 6.2 Required Improvements
1. **Per-mode adaptation rates**: 
   - Day: alpha=0.01 (faster, more variation)
   - Night: alpha=0.001 (slower, more stable)
   - Twilight: alpha=0.005 (transition)

2. **Pre-incident baseline tracking**:
   - Maintain 5-min rolling median (EMAS approach)
   - Compare current vs baseline, not absolute threshold

3. **Multi-algorithm fusion**:
   - Motion gate + Flow spike + Fragmentation + Heading change
   - Weighted voting instead of AND logic

4. **Calibration persistence**:
   - Save "calibrated: true" with timestamp
   - Skip 300-frame startup if < 24h old
   - Force recalibration on significant scene change

5. **Per-camera config**:
   - Camera-specific: alpha, k_mad, freeze_seconds
   - Camera-specific: day/night brightness thresholds
   - Camera-specific: ROI mask (ignore sky/trees)

---

## 7. PRIORITY FIXES BEFORE CODING

### P0 - Blockers (Must Fix)
1. **Threshold modifier validation**: Test on 10+ videos with ground truth
2. **Calibration persistence**: Skip 300-frame startup if valid config exists
3. **Day/night transition**: Handle twilight without flicker
4. **Calibration contamination**: Detect incidents during calibration, discard those frames

### P1 - High Impact
1. **Algorithm fusion**: Replace AND logic with weighted scoring
2. **Pre-incident baseline**: 5-min rolling median per track
2. **Ego-motion compensation**: Subtract global camera motion from flow
3. **Better tracking**: ByteTrack/BoT-SORT instead of centroid

### P2 - Medium Impact
1. **Per-camera config files**: Separate YAML per camera
2. **Weather/lighting detection**: Auto-detect rain, fog, night
3. **Severity estimation**: Output confidence + estimated severity
4. **Multi-camera fusion**: Cross-reference overlapping cameras

---

## 8. TESTING REQUIREMENTS

### 8.1 Minimum Test Suite
- [ ] 10+ accident videos (various types)
- [ ] 10+ normal traffic videos (various conditions)
- [ ] 5+ edge case videos (rain, night, tunnel, congestion)
- [ ] Ground truth labels per frame per track
- [ ] Metrics: Precision, Recall, F1, False Alarm Rate, Detection Latency

### 8.2 EMAS Benchmarks to Match
- Detection Rate: > 90%
- False Alarm Rate: < 1% (per hour per camera)
- Detection Latency: < 60 seconds
- Localization Accuracy: Lane-level

---

## 9. DOCUMENTATION NEEDED

- [ ] Per-camera config schema (YAML)
- [ ] Threshold tuning guide
- [ ] Calibration procedure
- [ ] Incident labeling guidelines
- [ ] System monitoring/alerting
- [ ] Rollback procedure for bad configs

---

## 10. ARCHITECTURE DECISIONS TO MAKE

1. **Single-file vs modular**: Current single-file works for MVP, split for production
2. **Tracking**: Keep centroid (fast) vs upgrade to ByteTrack (accurate)
3. **Optical flow**: Farneback (dense) vs RAFT (accurate) vs None (loop-only)
4. **Classifier**: Rule-based (interpretable) vs ML (accurate) vs Hybrid
5. **Deployment**: Single camera vs multi-camera fusion
6. **Verification**: Auto-only vs Human-in-loop (EMAS requires human)

---

## RECOMMENDATION: BEFORE NEXT CODE CHANGE

1. **Create test harness** with 20+ labeled videos
2. **Measure current performance** (Precision/Recall/Latency)
3. **Implement EMAS-inspired dual-algorithm approach**:
   - Algorithm A: Motion gate + Flow spike (fast, sensitive)
   - Algorithm B: Pre-incident baseline + Heading change (specific)
   - Fuse: Weighted OR with confidence scores
4. **Add calibration persistence** with versioning
5. **Add per-camera config** with validation

---

*Last Updated: 2026-08-26*
*Based on: EMAS documentation, Mak & Fan papers (2002-2007), LTA documentation*