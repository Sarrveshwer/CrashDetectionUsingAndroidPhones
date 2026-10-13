package com.accident;

import android.graphics.Rect;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;

public class Track {
    public final int trackId;
    public Rect bbox;
    public float centerX;
    public float centerY;
    public final String className;
    public float conf;
    public final List<HistoryPoint> history = new ArrayList<>();
    public float velocityX = 0.0f;
    public float velocityY = 0.0f;
    public float prevVelocityX = 0.0f;
    public float prevVelocityY = 0.0f;
    public float speed = 0.0f;
    public float prevSpeed = 0.0f;
    public final List<AspectRatioPoint> aspectRatios = new ArrayList<>();
    public final List<FlowSample> flowSamples = new ArrayList<>();
    public float currentFlowDisp = 0.0f;
    public final ArrayDeque<Boolean> hitsMisses = new ArrayDeque<>(30);
    public int missStreak = 0;
    public final ArrayDeque<DecelEvent> decelEvents = new ArrayDeque<>(30);
    public String motionState = "UNKNOWN";
    public int motionStateFrames = 0;
    public boolean everMoved = false;
    public float speedEma = 0.0f;
    public final float speedEmaAlpha = 0.25f;
    public Integer stationaryStartFrame = null;
    public int lastObservedFrame = 0;
    public int lastPredictionFrame = 0;
    public boolean isPredicted = false;
    public float bottomCenterX = 0.0f;
    public float bottomCenterY = 0.0f;
    public float lastObservedPositionX = 0.0f;
    public float lastObservedPositionY = 0.0f;
    public float currentPositionX = 0.0f;
    public float currentPositionY = 0.0f;
    public float lastObservedScale = 1.0f;
    public float lastHeadingChange = 0.0f;
    public int lastHeadingChangeFrame = -1000000000;
    public float lastImpactScore = 0.0f;
    public int lastImpactFrame = -1000000000;

    public Track(int trackId, Rect bbox, float centerX, float centerY, String className, float conf) {
        this.trackId = trackId;
        this.bbox = bbox;
        this.centerX = centerX;
        this.centerY = centerY;
        this.className = className;
        this.conf = conf;
    }

    public int getFragmentation() {
        int count = 0;
        for (Boolean hit : hitsMisses) {
            if (!hit) count++;
        }
        return count;
    }

    public void updateMotionState(int frameIdx, float minMovingSpeed, int minStationaryFrames, 
                                   int parkedFrames, int stoppedMinFrames) {
        speedEma = speedEmaAlpha * speed + (1.0f - speedEmaAlpha) * speedEma;
        float moveOn = minMovingSpeed;
        float moveOff = minMovingSpeed * 0.45f;
        
        switch (motionState) {
            case "UNKNOWN":
                if (speedEma >= moveOn) {
                    motionState = "MOVING";
                    everMoved = true;
                    motionStateFrames = 1;
                } else {
                    motionState = "STATIONARY";
                    stationaryStartFrame = frameIdx;
                    motionStateFrames = 1;
                }
                break;
            case "MOVING":
                if (speedEma <= moveOff) {
                    motionState = "STOPPED";
                    motionStateFrames = 1;
                } else {
                    motionStateFrames++;
                    everMoved = true;
                }
                break;
            case "STOPPED":
                if (speedEma >= moveOn * 0.8f) {
                    motionState = "MOVING";
                    motionStateFrames = 1;
                    everMoved = true;
                } else {
                    motionStateFrames++;
                    if (motionStateFrames >= stoppedMinFrames) {
                        motionState = "STATIONARY";
                        stationaryStartFrame = frameIdx;
                        motionStateFrames = 1;
                    }
                }
                break;
            case "STATIONARY":
                if (speedEma >= moveOn * 0.8f) {
                    motionState = "MOVING";
                    motionStateFrames = 1;
                    everMoved = true;
                } else {
                    motionStateFrames++;
                    if (!everMoved && stationaryStartFrame != null && 
                        frameIdx - stationaryStartFrame >= parkedFrames) {
                        motionState = "PARKED";
                    }
                }
                break;
            case "PARKED":
                if (speedEma >= moveOn * 0.8f) {
                    motionState = "MOVING";
                    motionStateFrames = 1;
                    everMoved = true;
                }
                break;
        }
    }

    public static class HistoryPoint {
        public final int frame;
        public final float x;
        public final float y;
        public HistoryPoint(int frame, float x, float y) {
            this.frame = frame;
            this.x = x;
            this.y = y;
        }
    }

    public static class AspectRatioPoint {
        public final int frame;
        public final float ratio;
        public AspectRatioPoint(int frame, float ratio) {
            this.frame = frame;
            this.ratio = ratio;
        }
    }

    public static class FlowSample {
        public final int frame;
        public final float disp;
        public FlowSample(int frame, float disp) {
            this.frame = frame;
            this.disp = disp;
        }
    }

    public static class DecelEvent {
        public final int frame;
        public final float prevSpeed;
        public final float currSpeed;
        public DecelEvent(int frame, float prevSpeed, float currSpeed) {
            this.frame = frame;
            this.prevSpeed = prevSpeed;
            this.currSpeed = currSpeed;
        }
    }
}