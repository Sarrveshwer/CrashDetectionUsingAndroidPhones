package com.accident;

import android.content.Context;
import android.util.Log;
import org.opencv.core.Core;
import org.opencv.core.Mat;
import org.opencv.imgproc.Imgproc;
import java.util.ArrayDeque;

/** Stage-1 motion gate. V2 behavior is the default checkV2 path. */
public class MotionGate {
    private final int frameSkip;
    private int frameCount = 0;
    private final AutoThresholdManager thresholdMgr;
    private Mat prevGray;
    private final ArrayDeque<Float> physicsHistory;
    private final int physicsWindow;
    private Integer lastAlertFrame = null;
    private boolean alertCooldownActive = false;
    private final boolean suppressAlerts;
    private final float physicsAlpha;
    private final int persistFrames;
    private final int persistWindow;

    public MotionGate(String cameraId, int physicsWindow, int frameSkip, boolean suppressAlerts,
                      String calibrationMode, Context context) {
        this(cameraId, physicsWindow, frameSkip, suppressAlerts, calibrationMode, context, 7, 12, 0.4f);
    }

    public MotionGate(String cameraId, int physicsWindow, int frameSkip, boolean suppressAlerts,
                      String calibrationMode, Context context,
                      int persistFrames, int persistWindow, float physicsAlpha) {
        this.frameSkip = Math.max(1, frameSkip);
        this.thresholdMgr = new AutoThresholdManager(context, cameraId, 80, 50, 10, calibrationMode);
        this.physicsWindow = Math.max(1, physicsWindow);
        this.physicsHistory = new ArrayDeque<>(this.physicsWindow);
        this.suppressAlerts = suppressAlerts;
        this.persistFrames = Math.max(1, persistFrames);
        this.persistWindow = Math.max(this.persistFrames, persistWindow);
        this.physicsAlpha = Math.max(0.01f, Math.min(1.0f, physicsAlpha));
        this.thresholdMgr.persistFrames = this.persistFrames;
        this.thresholdMgr.persistWindow = this.persistWindow;
    }

    private float computePhysicsScore(Mat frame) {
        if (frame == null || frame.empty()) {
            return 0.0f;
        }
        Mat currentGray = new Mat();
        if (frame.channels() == 1) frame.copyTo(currentGray);
        else Imgproc.cvtColor(frame, currentGray, Imgproc.COLOR_BGR2GRAY);

        if (prevGray == null || prevGray.empty()) {
            prevGray = currentGray.clone();
            currentGray.release();
            return 0.0f;
        }

        Mat currentResized = new Mat();
        Mat difference = new Mat();
        Mat thresholded = new Mat();
        try {
            if (currentGray.size().equals(prevGray.size())) {
                currentGray.copyTo(currentResized);
            } else {
                Imgproc.resize(currentGray, currentResized, prevGray.size());
            }

            Core.absdiff(prevGray, currentResized, difference);
            Imgproc.threshold(difference, thresholded, 25.0, 255.0, Imgproc.THRESH_BINARY);
            double changed = Core.countNonZero(thresholded);
            float score = (float) Math.min(changed / (double) (prevGray.rows() * prevGray.cols()) * 10.0, 1.0);

            prevGray.release();
            prevGray = currentResized.clone();
            return score;
        } finally {
            currentGray.release();
            currentResized.release();
            difference.release();
            thresholded.release();
        }
    }

    public GateResult check(Mat frame) { return checkV2(frame); }

    public GateResult checkV2(Mat frame) {
        frameCount++;
        float raw = computePhysicsScore(frame);
        if (triggerEma == null) triggerEma = raw;
        else triggerEma = physicsAlpha * raw + (1.0f - physicsAlpha) * triggerEma;
        boolean alertActive = isInCooldown() && !suppressAlerts;
        AutoThresholdManager.ThresholdResult result = thresholdMgr.update(
                frame, raw, alertActive, alertCooldownActive, triggerEma);
        if (frameCount % frameSkip == 0) {
            physicsHistory.addLast(raw);
            while (physicsHistory.size() > physicsWindow) physicsHistory.removeFirst();
        }
        boolean persistent = result.baseline.calibrated && result.baseline.consecutiveAbove >= persistFrames;
        float margin = Math.max(0.05f, result.threshold * 0.10f);
        boolean rawSpike = result.baseline.calibrated && raw >= result.threshold + margin;
        boolean triggered = persistent || rawSpike;
        if (triggered && !alertCooldownActive) triggerAlert(raw, result.threshold, result.mode);
        else if (!triggered && alertCooldownActive && lastAlertFrame != null && frameCount - lastAlertFrame >= 90) {
            alertCooldownActive = false; lastAlertFrame = null;
        }
        result.baseline.triggerFrames = persistFrames;
        result.baseline.v2PersistentTrigger = persistent;
        result.baseline.v2RawSpikeTrigger = rawSpike;
        result.baseline.v2RawSpikeMargin = margin;
        result.baseline.v2TriggerScore = triggerEma;
        return new GateResult(triggered, result.threshold, triggerEma, raw, result.mode, result.baseline);
    }

    private Float triggerEma = null;
    private void triggerAlert(float score, float threshold, String mode) {
        lastAlertFrame = frameCount; alertCooldownActive = true;
        Log.d("MotionGate", String.format("ALERT frame=%d score=%.3f thr=%.3f mode=%s", frameCount, score, threshold, mode));
    }
    private boolean isInCooldown() {
        if (!alertCooldownActive) return false;
        if (lastAlertFrame != null && frameCount - lastAlertFrame >= 90) {
            alertCooldownActive = false; lastAlertFrame = null; return false;
        }
        return true;
    }
    public void release() { if (prevGray != null) { prevGray.release(); prevGray = null; } }
    public int getFrameCount() { return frameCount; }
    public AutoThresholdManager getThresholdManager() { return thresholdMgr; }
    public boolean isAlertCooldownActive() { return alertCooldownActive; }
}
