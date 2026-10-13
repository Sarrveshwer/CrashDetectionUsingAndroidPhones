package com.accident;

import android.content.Context;
import android.util.Log;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.opencv.core.Mat;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;

/** Android persistence and threshold manager corresponding to gate.py. */
public class AutoThresholdManager {
    private static final String TAG = "AutoThresholdManager";
    private final String cameraId;
    private final DayNightClassifier classifier;
    private final float kMad = 2.0f;
    public int persistFrames = 7;
    public int persistWindow = 12;
    private final int windowSize = 9000;
    /** gate.py run_realtime sets calibration_min_frames = min(min_frames, 3000) = 3000 by default. */
    public int calibrationTargetFrames = 3000;
    private final String calibrationMode;
    private final File baselineDir;
    private final Map<String, BaselineState> baselines = new HashMap<>();
    private long lastSave = 0L;
    private final Map<String, Long> lastPrint = new HashMap<>();
    private String currentMode = "day";

    public AutoThresholdManager(Context context, String cameraId, int dayThresh, int nightThresh,
                                int hysteresis, String calibrationMode) {
        this.cameraId = cameraId;
        this.classifier = new DayNightClassifier(dayThresh, nightThresh, hysteresis, 60);
        this.calibrationMode = ("adaptive".equals(calibrationMode) || "frozen".equals(calibrationMode))
                ? calibrationMode : "frozen";
        baselineDir = new File(context.getFilesDir(), "baselines");
        if (!baselineDir.exists()) baselineDir.mkdirs();
        for (String mode : modes()) {
            baselines.put(mode, new BaselineState(this.calibrationMode));
            lastPrint.put(mode, 0L);
        }
        loadBaselines();
    }

    private static List<String> modes() { return Arrays.asList("day", "twilight", "night"); }
    private File baselinePath(String mode) { return new File(baselineDir, cameraId + "_" + mode + "_baseline.json"); }

    private void loadBaselines() {
        for (String mode : modes()) {
            File path = baselinePath(mode);
            if (!path.exists()) continue;
            try {
                String jsonText = read(path);
                JSONObject data = new JSONObject(jsonText);
                String lastUpdated = data.optString("last_updated", null);
                if (!validAge(lastUpdated)) { baselines.put(mode, new BaselineState(calibrationMode)); continue; }
                BaselineState b = new BaselineState(data.optString("calibration_mode", calibrationMode));
                JSONArray scores = data.optJSONArray("scores");
                if (scores != null) for (int i = 0; i < scores.length(); i++) b.scores.add((float)scores.optDouble(i, 0.0));
                b.median = (float)data.optDouble("median", 0.0);
                b.mad = (float)data.optDouble("mad", 0.0);
                b.threshold = (float)data.optDouble("threshold", 0.5);
                b.calibrated = data.optBoolean("calibrated", false);
                b.lastUpdated = lastUpdated;
                b.scoresSeen = data.optInt("scores_seen", b.scores.size());
                b.calibrationRejected = data.optInt("calibration_rejected", 0);
                b.triggerFrames = data.optInt("trigger_frames", 7);
                baselines.put(mode, b);
                Log.d(TAG, String.format(Locale.US, "Loaded %s: median=%.3f mad=%.3f thr=%.3f calibrated=%s",
                        mode, b.median, b.mad, b.threshold, b.calibrated));
            } catch (Exception e) {
                Log.e(TAG, "Failed to load " + mode, e);
                baselines.put(mode, new BaselineState(calibrationMode));
            }
        }
    }

    private static String read(File f) throws IOException {
        try (FileInputStream in = new FileInputStream(f); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192]; int n;
            while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private static boolean validAge(String iso) {
        if (iso == null || iso.isEmpty()) return false;
        try {
            String normalized = iso;
            int dot = normalized.indexOf('.');
            if (dot >= 0) {
                int z = normalized.indexOf('Z', dot);
                if (z > dot) {
                    String frac = normalized.substring(dot + 1, z);
                    if (frac.length() > 3) frac = frac.substring(0, 3);
                    while (frac.length() < 3) frac += "0";
                    normalized = normalized.substring(0, dot + 1) + frac + normalized.substring(z);
                }
            }
            SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
            sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date d = sdf.parse(normalized);
            return d != null && System.currentTimeMillis() - d.getTime() < 86400000L;
        } catch (Exception ignored) { return false; }
    }

    private void saveBaseline(String mode) {
        BaselineState b = baselines.get(mode); if (b == null) return;
        try {
            JSONObject data = new JSONObject();
            data.put("camera_id", cameraId); data.put("mode", mode);
            JSONArray scores = new JSONArray();
            int start = Math.max(0, b.scores.size() - windowSize);
            for (int i = start; i < b.scores.size(); i++) scores.put(b.scores.get(i));
            data.put("scores", scores); data.put("scores_seen", b.scoresSeen);
            data.put("median", b.median); data.put("mad", b.mad); data.put("threshold", b.threshold);
            data.put("calibrated", b.calibrated); data.put("calibration_mode", b.calibrationMode);
            data.put("calibration_rejected", b.calibrationRejected); data.put("last_updated", utcNow());
            data.put("trigger_frames", b.triggerFrames);
            try (FileOutputStream out = new FileOutputStream(baselinePath(mode))) {
                out.write(data.toString().getBytes(StandardCharsets.UTF_8));
            }
        } catch (Exception e) { Log.e(TAG, "Failed to save " + mode, e); }
    }

    private void maybeSave() {
        long now = System.currentTimeMillis();
        if (now - lastSave > 5000L) { for (String mode : modes()) saveBaseline(mode); lastSave = now; }
    }

    public ThresholdResult update(Mat frame, float physicsScore, boolean alertActive,
                                  boolean collisionActive, Float triggerScore) {
        float trigger = triggerScore == null ? physicsScore : triggerScore;
        String mode = classifier.classify(frame);
        currentMode = mode;
        BaselineState baseline = baselines.get(mode);
        if (alertActive || collisionActive || baseline.isFrozen()) {
            if (alertActive || collisionActive) baseline.triggerFreeze(3.0f);
            // gate.py keeps the X-of-Y persistence history running while frozen.
            if (baseline.calibrated) baseline.checkTriggerXY(trigger, baseline.threshold, persistFrames, persistWindow);
            return new ThresholdResult(baseline.threshold, mode, baseline);
        }
        boolean shouldCollect = !baseline.calibrated || "adaptive".equals(baseline.calibrationMode);
        if (shouldCollect) baseline.addScore(physicsScore, windowSize);
        if (!baseline.calibrated && baseline.scores.size() >= calibrationTargetFrames) {
            baseline.updateBaseline(windowSize);
            baseline.threshold = baseline.computeThreshold(kMad);
            baseline.calibrated = true;
            baseline.calibrationMode = calibrationMode;
            Log.d(TAG, String.format(Locale.US, "%s calibrated: median=%.4f mad=%.4f thr=%.4f samples=%d",
                    mode, baseline.median, baseline.mad, baseline.threshold, baseline.scores.size()));
        } else if (baseline.calibrated && "adaptive".equals(baseline.calibrationMode) && baseline.scoresSeen % 5 == 0) {
            float old = baseline.threshold;
            baseline.updateBaseline(windowSize); baseline.threshold = baseline.computeThreshold(kMad);
            if (Math.abs(old - baseline.threshold) > 1e-6f) {
                long now = System.currentTimeMillis(); long last = lastPrint.get(mode);
                if (now - last >= 2000L) { lastPrint.put(mode, now); Log.d(TAG, "Adapted " + mode + " threshold " + old + " -> " + baseline.threshold); }
            }
        }
        if (baseline.calibrated) baseline.checkTriggerXY(trigger, baseline.threshold, persistFrames, persistWindow);
        maybeSave();
        return new ThresholdResult(baseline.threshold, mode, baseline);
    }

    public String getCurrentMode() { return currentMode; }
    public Map<String, BaselineState> getBaselines() { return Collections.unmodifiableMap(baselines); }
    public BaselineState getBaseline(String mode) { return baselines.get(mode); }
    public DayNightClassifier getClassifier() { return classifier; }

    public static class ThresholdResult {
        public final float threshold; public final String mode; public final BaselineState baseline;
        public ThresholdResult(float threshold, String mode, BaselineState baseline) { this.threshold=threshold; this.mode=mode; this.baseline=baseline; }
    }
    private static String utcNow() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC")); return sdf.format(new Date());
    }
}
