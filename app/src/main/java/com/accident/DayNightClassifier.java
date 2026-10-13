package com.accident;

import org.opencv.core.Mat;
import org.opencv.core.Core;
import org.opencv.imgproc.Imgproc;

/** Camera brightness classifier matching gate.py. */
public class DayNightClassifier {
    private final int dayThreshold;
    private final int nightThreshold;
    private final int hysteresis; // retained for API parity
    private final int modePersistFrames;
    private String currentMode = "unknown";
    private boolean initialized = false;
    private String modeCandidate = null;
    private int modeCandidateFrames = 0;
    private String forcedMode = null;

    public DayNightClassifier(int dayThreshold, int nightThreshold, int hysteresis,
                              int modePersistFrames, String forcedMode) {
        this.dayThreshold = dayThreshold;
        this.nightThreshold = nightThreshold;
        this.hysteresis = hysteresis;
        this.modePersistFrames = modePersistFrames;
        this.forcedMode = forcedMode;
    }

    public DayNightClassifier(int dayThreshold, int nightThreshold, int hysteresis,
                              int modePersistFrames) {
        this(dayThreshold, nightThreshold, hysteresis, modePersistFrames, null);
    }

    public String classify(Mat frame) {
        if (forcedMode != null) {
            currentMode = forcedMode;
            initialized = true;
            modeCandidate = null;
            modeCandidateFrames = 0;
            return forcedMode;
        }
        float brightness = getBrightness(frame);
        String candidate = brightness > dayThreshold ? "day" :
                (brightness < nightThreshold ? "night" : "twilight");
        if (!initialized) {
            currentMode = candidate;
            initialized = true;
            return currentMode;
        }
        if (!candidate.equals(currentMode)) {
            if (candidate.equals(modeCandidate)) {
                modeCandidateFrames++;
                if (modeCandidateFrames >= modePersistFrames) {
                    currentMode = candidate;
                    modeCandidate = null;
                    modeCandidateFrames = 0;
                }
            } else {
                modeCandidate = candidate;
                modeCandidateFrames = 1;
            }
        } else {
            modeCandidate = null;
            modeCandidateFrames = 0;
        }
        return currentMode;
    }

    public float getBrightness(Mat frame) {
        Mat gray = new Mat();
        if (frame.channels() == 1) {
            frame.copyTo(gray);
        } else {
            Imgproc.cvtColor(frame, gray, Imgproc.COLOR_BGR2GRAY);
        }
        ScalarMean mean = scalarMean(gray);
        gray.release();
        return mean.value;
    }

    private static ScalarMean scalarMean(Mat gray) {
        return new ScalarMean(Core.mean(gray).val[0]);
    }

    private static final class ScalarMean {
        final float value;
        ScalarMean(double value) { this.value = (float) value; }
    }

    public void setForcedMode(String mode) { this.forcedMode = mode; }
    public String getCurrentMode() { return currentMode; }
    public boolean isInitialized() { return initialized; }
}
