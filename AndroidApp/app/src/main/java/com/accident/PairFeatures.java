package com.accident;

import java.util.ArrayDeque;

public class PairFeatures {
    public final int trackIdA;
    public final int trackIdB;
    public final ArrayDeque<IouPoint> iouHistory = new ArrayDeque<>(30);
    public final ArrayDeque<DistPoint> distHistory = new ArrayDeque<>(30);
    public final ArrayDeque<ClosingVelPoint> closingVelHistory = new ArrayDeque<>(30);
    public final ArrayDeque<DecelClosingVelPoint> decelClosingVelHistory = new ArrayDeque<>(30);
    public final ArrayDeque<ConflictPoint> conflictHistory = new ArrayDeque<>(30);
    public int lastUpdateFrame = -1;
    public int lastConflictFrame = -1000000000;
    public float lastConflictMinSep = Float.POSITIVE_INFINITY;
    public float recentCloseMax = 0.0f;
    public float pairScale = 1.0f;
    public float lastTtc = Float.POSITIVE_INFINITY;
    public float lastMinSep = Float.POSITIVE_INFINITY;
    public float lastClosingNorm = 0.0f;

    public PairFeatures(int trackIdA, int trackIdB) {
        this.trackIdA = trackIdA;
        this.trackIdB = trackIdB;
    }

    public static class IouPoint {
        public final int frame;
        public final float iou;
        public IouPoint(int frame, float iou) {
            this.frame = frame;
            this.iou = iou;
        }
    }

    public static class DistPoint {
        public final int frame;
        public final float dist;
        public DistPoint(int frame, float dist) {
            this.frame = frame;
            this.dist = dist;
        }
    }

    public static class ClosingVelPoint {
        public final int frame;
        public final float closingVel;
        public ClosingVelPoint(int frame, float closingVel) {
            this.frame = frame;
            this.closingVel = closingVel;
        }
    }

    public static class DecelClosingVelPoint {
        public final int frame;
        public final float closingVel;
        public DecelClosingVelPoint(int frame, float closingVel) {
            this.frame = frame;
            this.closingVel = closingVel;
        }
    }

    public static class ConflictPoint {
        public final int frame;
        public final boolean conflict;
        public final float minSep;
        public final float ttc;
        public ConflictPoint(int frame, boolean conflict, float minSep, float ttc) {
            this.frame = frame;
            this.conflict = conflict;
            this.minSep = minSep;
            this.ttc = ttc;
        }
    }
}