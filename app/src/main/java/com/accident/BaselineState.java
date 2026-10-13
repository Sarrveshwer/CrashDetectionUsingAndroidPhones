package com.accident;

import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.Deque;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

public class BaselineState {
    public List<Float> scores = new ArrayList<>();
    public float median = 0.0f;
    public float mad = 0.0f;
    public float threshold = 0.5f;
    public boolean calibrated = false;
    public String calibrationMode = "frozen";
    public String lastUpdated = null;
    public long freezeUntil = 0L;
    public int consecutiveAbove = 0;
    public int triggerFrames = 7;
    public int scoresSeen = 0;
    public int calibrationRejected = 0;

    // V2 Stage-1 X-of-Y persistence.
    public final Deque<Boolean> recentAbove = new ArrayDeque<>();
    public int aboveCount = 0;
    public boolean v2PersistentTrigger = false;
    public boolean v2RawSpikeTrigger = false;
    public float v2RawSpikeMargin = 0.0f;
    public float v2TriggerScore = 0.0f;

    public BaselineState() { this("frozen"); }

    public BaselineState(String calibrationMode) {
        this.calibrationMode = ("adaptive".equals(calibrationMode) || "frozen".equals(calibrationMode))
                ? calibrationMode : "frozen";
    }

    public boolean isFrozen() { return System.currentTimeMillis() < freezeUntil; }

    public void triggerFreeze(float seconds) {
        freezeUntil = System.currentTimeMillis() + (long) (seconds * 1000.0f);
    }

    public void updateBaseline(int windowSize) {
        if (scores.size() < 50) return;
        int start = Math.max(0, scores.size() - windowSize);
        float[] arr = new float[scores.size() - start];
        for (int i = start; i < scores.size(); i++) arr[i - start] = scores.get(i);
        median = median(arr);
        float[] abs = new float[arr.length];
        for (int i = 0; i < arr.length; i++) abs[i] = Math.abs(arr[i] - median);
        mad = Math.max(median(abs), 1e-6f);
        lastUpdated = utcNow();
    }

    public float computeThreshold(float kMad) {
        if (scores.isEmpty()) return 0.5f;
        int start = Math.max(0, scores.size() - 9000);
        float[] arr = new float[scores.size() - start];
        for (int i = start; i < scores.size(); i++) arr[i - start] = scores.get(i);
        float robust = median + kMad * mad;
        float percentile = percentile(arr, 99.0);
        return clamp(Math.max(robust, percentile), 0.15f, 0.95f);
    }

    public void addScore(float score, int maxSamples) {
        scores.add(clamp(score, 0.0f, 1.0f));
        scoresSeen++;
        if (scores.size() > maxSamples) {
            scores = new ArrayList<>(scores.subList(scores.size() - maxSamples, scores.size()));
        }
    }

    /** Base gate behavior: consecutive persistence. */
    public boolean checkTrigger(float score, float threshold, int persistFrames, int persistWindow) {
        if (score > threshold) consecutiveAbove++; else consecutiveAbove = 0;
        triggerFrames = persistFrames;
        return consecutiveAbove >= persistFrames;
    }

    /** V2 behavior: X positives within the last Y frames. */
    public boolean checkTriggerXY(float score, float threshold, int persistFrames, int persistWindow) {
        boolean above = score > threshold;
        recentAbove.addLast(above);
        if (above) aboveCount++;
        int maxWindow = Math.max(1, persistWindow);
        while (recentAbove.size() > maxWindow) {
            if (Boolean.TRUE.equals(recentAbove.removeFirst())) aboveCount--;
        }
        consecutiveAbove = aboveCount;
        triggerFrames = persistFrames;
        return aboveCount >= Math.max(1, persistFrames);
    }

    public void resetTriggerHistory() {
        recentAbove.clear();
        aboveCount = 0;
        consecutiveAbove = 0;
    }

    private static float median(float[] values) {
        if (values.length == 0) return 0.0f;
        float[] copy = values.clone();
        java.util.Arrays.sort(copy);
        int n = copy.length;
        return (n & 1) == 1 ? copy[n / 2] : (copy[n / 2 - 1] + copy[n / 2]) * 0.5f;
    }

    private static float percentile(float[] values, double p) {
        if (values.length == 0) return 0.0f;
        float[] copy = values.clone();
        java.util.Arrays.sort(copy);
        double rank = (p / 100.0) * (copy.length - 1);
        int lo = (int) Math.floor(rank), hi = (int) Math.ceil(rank);
        if (lo == hi) return copy[lo];
        double f = rank - lo;
        return (float) (copy[lo] + f * (copy[hi] - copy[lo]));
    }

    private static float clamp(float v, float lo, float hi) { return Math.max(lo, Math.min(hi, v)); }

    private static String utcNow() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date());
    }
}
