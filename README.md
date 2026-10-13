# Crash Detection Using Android Phones

A system that uses an Android phone's camera to detect car crashes, sends the info to a backend server, and shows real-time alerts on a web dashboard. It's like having a smart accident sensor that immediately alerts emergency services.

---

## How It Works (The Journey of a Crash Detection)

Think of this as a assembly line with 3 main stages. Here's what happens step by step:

### Stage 1: The Phone's Eye (Motion Detection)
The Android phone grabs video frames from its camera at 30 frames per second. Each frame gets converted to grayscale (removing color info, keeping brightness). The system then compares each new frame to the previous one, counting how many pixels have changed significantly.

**The physics score** is calculated like this:
1. Take the absolute difference between two consecutive frames
2. Count pixels where the difference exceeds 25 (a meaningful change)
3. Multiply that pixel ratio by 10 → this is your physics score

**EMA smoothing** (Exponential Moving Average): To avoid jumpy scores, the system applies a weighted average with α=0.4. This gives recent frames slightly more weight while smoothing out noise.

**Adaptive baselines**: The system learns what "normal" looks like for different lighting conditions:
- **Day**: bright frames (>80% brightness)
- **Twilight**: medium brightness 
- **Night**: dark frames (<50% brightness)

It needs 60 frames in a mode before switching, and has a 10-unit hysteresis band. After 9,000 frames (about 5 minutes), baselines are solidified. You can also "freeze" calibration so it doesn't learn during active events.

### Stage 2: Following the Vehicles (Tracking)
The system identifies vehicles in each frame using YOLO detection. It tracks them using a Hungarian-algorithm-inspired method that assigns new detections to existing tracks based on bottom-center position distance.

**Track states evolve like this:**
- **UNKNOWN** → **MOVING** → **STATIONARY** → **PARKED**

Key rules:
- A track becomes STATIONARY after speed drops below threshold
- PARKED means never moved + stationary for >150 frames
- When BOTH tracks have fresh observations, pair features get updated:
  - Normalized distance between vehicles
  - Closing velocity (how fast they're approaching)
  - TTC (Time-To-Collision): how many frames until impact at current speed
  - Minimum separation history
  - Optical flow turbulence: measures how "chaotic" the motion looks in each vehicle's region

### Stage 3: Crash Decision Logic
This is where the system decides "yes, this is actually a crash."

**Freshness check:** Both tracked vehicles must have observations from the current frame (max 1 frame old).

**Collision criteria met when:**
- Not both vehicles are stationary/parked
- Closing velocity ≥ 0.025 (normalized speed)
- Recent conflict: conflict marker ≤ 5 frames old AND minimum separation ≤ 0.85

**Impact signature** (must happen on at least one vehicle):
- **Decel event:** Speed drops ≥ 45% from initial speed ≥ 0.05
- **OR:** Heading change ≥ 0.55 radians (~31.5°) plus impact

**Voting system:** k-of-m (2 of 4) over recent frames per pair/track. This prevents single-frame glitches from triggering false alarms. After a collision verdict, there's a 30-frame cooldown per track.

**Rollover detection** (for moving vehicles only):
- AR oscillation ≥ 0.6 (aspect ratio changes)
- ≥ 4 peaks in the oscillation
- Heading P90 ≥ 0.9

---

## Data Flow: From Phone to Dashboard

```
Camera frames → YOLO detection → Motion Gate → Feature Extraction → 
Rule Classification → Accident Result → POST /api/incidents/report
```

### Backend Server (Node.js + Socket.io)
1. **Incident creation:** New incidents start as `PENDING_VERIFICATION`
2. **Socket.io emission:** Broadcasts new incidents + dashboard updates to all connected clients
3. **Heartbeat flow:** Android phones send periodic heartbeats → server updates device status → emits `device:online`, `device:offline`, or `device:update`
4. **Status machine:** Incidents/Units follow valid transitions only

**Incident Status Flow:**
```
PENDING_VERIFICATION → VERIFIED → DISPATCHED → RESPONDING → RESOLVED
       ↓
   FALSE_POSITIVE
```

**Incident model stores:**
- Camera ID, edge device ID, camera name, timestamp, location
- Snapshot image, confidence score, current status
- Dispatch/response/resolution timestamps
- Assigned emergency unit
- Verification info and video URL

**Emergency Units:**
- Unique unit ID + name + type (AMBULANCE/POLICE/FIRE)
- Status: AVAILABLE → DISPATCHED → RESPONDING → UNAVAILABLE
- Current location coordinates

**Dashboard stats show:**
- Total/online/offline camera/device counts
- Incident counts by status
- Today's incident count + recent alerts (last 10)
- System status badge (green/yellow/red)

### Web Client (React 18 + Vite)
- **State management:** Auth context + local component state
- **Real-time updates:** Socket.io client listening to server broadcasts
- **Styling:** Tailwind CSS + Lucide React icons
- **HTTP requests:** Axios for API calls

**Key pages:**
- **Dashboard:** Stats grid + recent alerts table + real-time socket listeners
- **Live Incidents:** Priority alert cards + verify/reject controls
- **Emergency Dispatch:** Active incident queue + dispatch panel + unit status
- **Edge Device Management:** Device cards with real-time status
- **Emergency Unit Management:** CRUD table for managing units

**Auth flow:**
1. Login → POST /api/auth/login → JWT stored in localStorage
2. AuthProvider restores session on page load
3. ProtectedRoute wraps all routes except /login
4. Demo credentials: `admin@emergency.gov` / `admin123`

---

## System Configuration

### Environment Variables (.env)
```
PORT=5001
JWT_SECRET=crash_detection_secret_key
MONGODB_URI=mongodb://localhost:27017/crash_detection
```

### Backend Setup
```bash
cd server
npm install          # Install dependencies
npm run dev          # Development with nodemon
npm start            # Production mode
```

### Frontend Setup
```bash
cd client
npm install          # Install dependencies
npm run dev          # Vite dev server (port 5173)
npm run build        # Production build
```

### Python Crash Engine
Process a video file through the detection pipeline:
```bash
python gate.py input_video.mp4 output_video.mp4 \
    --camera cam_001 \
    --mode auto \
    --stride 3 \
    --persist-frames 7 \
    --persist-window 12 \
    --physics-alpha 0.4 \
    --calibration-mode frozen \
    --homography path/to/H.npy
```

**Command options explained:**
- `input_video.mp4` → Video to process
- `output_video.mp4` → Processed video with detections highlighted
- `--camera cam_001` → Camera identifier for reports
- `--mode auto` → Automatic day/night/twilight adaptation
- `--stride 3` → Process every 3rd frame (performance boost)
- `--persist-frames 7` → 7 of last 12 frames must trigger
- `--persist-window 12` → Look at last 12 frames
- `--physics-alpha 0.4` → EMA smoothing factor
- `--calibration-mode frozen` → Don't update baselines during events
- `--homography H.npy` → Optional perspective transformation matrix

---

## API Endpoints

### Auth (`/api/auth`)
| Method | Path  | Who can access |
|--------|-------|----------------|
| POST   | /login  | Anyone (public) |
| POST   | /logout | Logged-in users |
| GET    | /me     | Logged-in users |

### Cameras (`/api/cameras`)
| Method | Path  | Who can access |
|--------|-------|----------------|
| GET    | /     | Logged-in users |
| GET    | /:id  | Logged-in users |
| POST   | /     | Admin users only |
| PUT    | /:id  | Admin users only |
| DELETE | /:id  | Admin users only |

### Edge Devices (`/api/devices`)
| Method | Path              | Who can access |
|--------|-------------------|----------------|
| POST   | /register         | Anyone (public) - new phone registers |
| POST   | /:deviceId/heartbeat | Anyone - phone sends heartbeat |
| GET    | /                 | Logged-in users |
| GET    | /:deviceId        | Logged-in users |

### Incidents (`/api/incidents`)
| Method | Path              | Who can access |
|--------|-------------------|----------------|
| GET    | /                 | Logged-in users |
| POST   | /report           | Anyone (public) - report a crash |
| POST   | /report-video     | Anyone (public) - report with video |
| PATCH  | /:id/verify       | Logged-in users |
| PATCH  | /:id/reject       | Logged-in users |
| POST   | /:id/dispatch     | Logged-in users |
| POST   | /:id/respond      | Logged-in users |
| POST   | /:id/resolve      | Logged-in users |

### Dashboard (`/api/dashboard`)
| Method | Path  | Who can access |
|--------|-------|----------------|
| GET    | /stats | Logged-in users |

### Units (`/api/units`)
| Method | Path  | Who can access |
|--------|-------|----------------|
| GET    | /     | Logged-in users |
| POST   | /     | Admin users only |
| PUT    | /:id  | Admin users only |
| DELETE | /:id  | Admin users only |

---

## Real-time Communication (Socket.io)

### Server → Client Events
- `incident:new` - Someone reported a new incident (pending verification)
- `incident:update` - Status changed (verified or rejected)
- `incident:dispatched` - Emergency unit assigned
- `incident:responding` - Unit is on the way
- `incident:resolved` - Incident closed/ resolved
- `dashboard:update` - Refresh stats numbers
- `device:registered` - New Android phone connected
- `device:online` / `device:offline` - Phone status changed
- `device:update` - Heartbeat received, phone status refreshed

### Client → Server Events
- `join:admin` - Client joins admin room for all broadcasts

---

## Detection Workflow (Step-by-Step)

### 1. Frame Capture & Preprocessing
Android camera captures video at 30fps. Each frame gets converted to grayscale and normalized for consistent motion detection.

### 2. Physics Score Calculation (Stage 1)
- Absolute difference between consecutive frames: `absdiff(prev_gray, curr_gray)`
- Count pixels where difference > 25
- Pixel ratio × 10 = physics score
- EMA smoothing: `score_ema = α × score + (1-α) × previous_ema` (α=0.4)

### 3. Adaptive Baseline Calibration
- Frames classified by brightness: day (>80), night (<50), twilight (in between)
- Hysteresis: 10 units, persist 60 frames before mode switch
- Baselines established after 9,000 frames (5 min of normal traffic)
- Stability monitor verifies: threshold variation < 0.008, median drift < 0.015, MAD drift < 0.015
- Can be "frozen" or "adaptive" mode
- Frozen mode prevents learning during active events

### 4. Trigger Detection
- **X-of-Y persistence:** 7 of the last 12 frames must exceed threshold
- v2 enhancement: Raw spike escape triggers on raw ≥ threshold + max(0.05, 10% threshold)
- Cooldown: 90 frames after trigger before new detection possible

### 5. Object Tracking (Stage 2)
- YOLO detections associated via bottom-center distance
- Max miss frames: 15 before track is removed
- Constant velocity prediction when no detection seen
- Track states: UNKNOWN → MOVING → STATIONARY → PARKED
- EMA speed with hysteresis for enter/exit moving state

### 6. Pair Feature Computation
For every pair of tracks with fresh observations:
- Normalized distance between vehicles
- Closing velocity (rate of distance decrease)
- TTC (time-to-collision at current closing velocity)
- Minimum separation history
- Optical flow turbulence measure on detection ROI

### 7. Collision Decision (Stage 3)
**Freshness check:** Both tracks must have current-frame observations (max_pair_age=1).

**Collision criteria:**
- Not both vehicles stationary/parked
- Closing velocity ≥ 0.025
- Recent conflict: age ≤ 5 frames, min_sep ≤ 0.85

**Impact signature (on at least one vehicle):**
- **Decel event:** Speed drop ≥ 45% from initial speed ≥ 0.05
- **OR:** Heading change ≥ 0.55 rad (~31.5°) + impact

**Voting system:** k-of-m (2 of 4) over recent frames per pair/track
- Prevents single-frame glitches from triggering alerts
- 30-frame cooldown per track after collision verdict

### 8. Incident Report
If collision detected:
1. Phone POSTs to `/api/incidents/report`
2. Backend creates incident: `PENDING_VERIFICATION`
3. Socket.io emits `incident:new` to all connected clients
4. Dashboard updates in real-time
5. Operator can verify/reject, dispatch units, track resolution

### 9. Heartbeat & Status Maintenance
- Android app sends periodic heartbeats to `/api/devices/:deviceId/heartbeat`
- Server updates `lastHeartbeat` timestamp
- If heartbeat missed > 5 minutes → device status → OFFLINE
- Socket events: `device:online`, `device:offline`, `device:update`
- Dashboard device cards update in real-time

---

## Project Structure

```
CrashDetectionUsingAndroidPhones/
├── document.txt          # Comprehensive system documentation (454 lines)
├── README.md            # This file - Project overview + workflow
├── .git/
├── .env                # Environment variables (local setup only)
├── build/              # Build artifacts
├── scripts/            # Utility scripts
├── app/                # Android app (accident/ directory)
├── client/             # React frontend (200+ files)
│   └── ... (UI components, pages, utilities)
├── server/             # Node.js backend
│   ├── config/         # MongoDB connection setup
│   ├── controllers/    # Route controllers (auth, incident, device, etc.)
│   ├── middleware/     # JWT auth middleware + error handlers
│   ├── models/         # MongoDB Mongoose schemas
│   ├── routes/         # API route definitions
│   ├── utils/          # Helper utilities & math functions
│   ├── server.js       # Entry point with Socket.io initialization
│   └── package.json
├── build/              # Python processing outputs
├── __pycache/          # Python bytecode cache
├── .gradle/            # Android build cache
├── gradle/             # Gradle wrapper scripts
├── settings.gradle
├── build.gradle
├── local.properties
└── .idea/              # IDE configuration (IntelliJ/VS Code)
```

---

## Key Design Decisions (Why We Do It This Way)

1. **Motion Gate (Stage 1):** Frame differencing over optical flow - more efficient on mobile CPUs, gives good enough speed info
2. **Adaptive baselines:** Day/night/twilight modes with hysteresis handle varying lighting throughout the day
3. **Frozen calibration:** Prevents normal traffic from raising threshold over time - protects against false alarms
4. **X-of-Y persistence:** 7 of 12 frames must trigger - reduces false positives from transient motion (tree branches, shadows, reflections)
5. **Bottom-center tracking:** More stable than bounding-box IoU for traffic cameras without homography calibration
6. **Pair features only on fresh-fresh pairs:** Avoids stale-versus-fresh artifacts that could cause false decisions
7. **Voting over time:** Single-frame glitches don't trigger false alerts - need consistent evidence
8. **Rollover detection separate from collision:** Distinguishes vehicle rollovers from side-impact crashes
9. **Heartbeat-based online status:** 5-minute timeout balances phone battery power vs. detection latency
10. **Public incident reporting:** Android app doesn't need authentication for crash reporting - critical for emergency situations where every second counts

---

## Testing Checklist

- [ ] Gate calibration: stable threshold after 9000 frames of normal traffic
- [ ] Day/night/twilight mode transitions with hysteresis
- [ ] Motion state machine: MOVING→STOPPED→STATIONARY→PARKED
- [ ] Pair conflict: approaching vehicles, crossing paths, rear-end scenarios
- [ ] Collision veto: both stationary, insufficient closing velocity, no impact signature
- [ ] Heartbeat timeout: device → OFFLINE after 5min without heartbeat
- [ ] Socket reconnection: client survives server restart without losing state
- [ ] Auth: JWT expiry handling, protected routes redirect correctly
- [ ] Dispatch flow: VERIFIED→DISPATCHED→RESPONDING→RESOLVED
- [ ] Unit availability: can't dispatch a unit that's UNAVAILABLE
- [ ] Calibration persistence: baselines saved/loaded across server restarts

---

## Extension Points (Future Enhancements)

1. **Android App Integration:** Implement YOLO + gate.py logic directly on device (currently Python-only processing)
2. **Homography Calibration:** UI for marking road plane points to enable true distance/velocity measurements
3. **Incident History:** Full pagination, export, search functionality
4. **Real Charts:** Using Recharts/Chart.js for better statistical visualizations
5. **Multi-camera Correlation:** Track vehicles across camera boundaries and intersections
6. **ML Model Updates:** YOLO version management, confidence threshold tuning
7. **Mobile PWA:** Offline-capable operator interface for field use
8. **Audit Logging:** Expand SystemLog usage for compliance and debugging
9. **Advanced Tracking:** Kalman filters for predictive positioning and smoother tracks
10. **Cloud Synchronization:** Multi-region incident data backup and disaster recovery

---
