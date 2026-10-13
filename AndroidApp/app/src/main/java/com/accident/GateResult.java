package com.accident;

public class GateResult {
    public final boolean triggered;
    public final float threshold;
    public final float smoothedScore;
    public final float rawScore;
    public final String mode;
    public final BaselineState profile;

    public GateResult(boolean triggered, float threshold, float smoothedScore, float rawScore, String mode, BaselineState profile) {
        this.triggered = triggered;
        this.threshold = threshold;
        this.smoothedScore = smoothedScore;
        this.rawScore = rawScore;
        this.mode = mode;
        this.profile = profile;
    }
}