package com.accident;

import android.content.Context;
import org.opencv.core.Mat;
import java.util.*;

/**
 * Android-native orchestration layer. Feed it the same camera Mat used by YOLO and
 * pass null detections on skipped YOLO frames, or an empty list when YOLO ran and found nothing.
 */
public class AccidentEngine {
    private final MotionGate motionGate;
    private final FeatureExtractor featureExtractor;
    private final RuleClassifier ruleClassifier;
    private final StabilityMonitor stabilityMonitor;
    private int frameIdx = 0;
    private boolean calibrated = false;

    public AccidentEngine(String cameraId, Context context, String calibrationMode) {
        motionGate = new MotionGate(cameraId, 5, 1, false, calibrationMode, context, 7, 12, 0.4f);
        featureExtractor = new FeatureExtractor(30,15,1.75f,0.45f,0.05f,30,24,5,21,2);
        ruleClassifier = new RuleClassifier();
        stabilityMonitor = new StabilityMonitor(9000,0.008f,0.015f,3000,3,250);
    }

    public AccidentResult process(Mat frame, List<Detection> detections, int frameIndex) {
        if (frame == null || frame.empty()) throw new IllegalArgumentException("frame must be non-null and non-empty");
        frameIdx = frameIndex > 0 ? frameIndex : frameIdx + 1;
        GateResult gateResult = motionGate.checkV2(frame);
        Map<Integer,Track> tracks = featureExtractor.update(detections,frame,frameIdx);
        Map<FeatureExtractor.PairKey,Map<String,Object>> pairFeatures = featureExtractor.allPairFeatures();
        Map<Integer,String> labels=new HashMap<>(), reasons=new HashMap<>();
        boolean collision=false,rollover=false;
        for(Integer tid:featureExtractor.getCurrentFreshIds()){
            Map<String,Object> f=featureExtractor.getFeatures(tid);
            if(f==null)continue;
            String label=ruleClassifier.predict(f,frameIdx,pairFeatures);
            labels.put(tid,label);reasons.put(tid,ruleClassifier.getReason(tid));
            if("collision".equals(label))collision=true;if("rollover".equals(label))rollover=true;
        }
        // Cache labels for predicted tracks without re-evaluating event logic.
        for(Track t:tracks.values()) if(!labels.containsKey(t.trackId)){labels.put(t.trackId,ruleClassifier.getLabel(t.trackId));reasons.put(t.trackId,ruleClassifier.getReason(t.trackId));}
        BaselineState baseline=motionGate.getThresholdManager().getBaseline(gateResult.mode);
        if(baseline!=null&&stabilityMonitor.canExitNow(frameIdx,gateResult.mode,baseline))calibrated=true;
        return new AccidentResult(gateResult,new ArrayList<>(tracks.values()),labels,reasons,collision,rollover);
    }

    public void setHomography(Mat h){featureExtractor.setHomography(h);}
    public void setProfile(String profile){ruleClassifier.applyProfile(profile);}
    /** True once the current day/twilight/night baseline has finished its initial calibration. */
    public boolean isBaselineReady(){BaselineState b=motionGate.getThresholdManager().getBaseline(motionGate.getThresholdManager().getCurrentMode());return b!=null&&b.calibrated;}
    public void release(){motionGate.release();featureExtractor.release();}
    public MotionGate getMotionGate(){return motionGate;}
    public FeatureExtractor getFeatureExtractor(){return featureExtractor;}
    public RuleClassifier getRuleClassifier(){return ruleClassifier;}
    public boolean isCalibrated(){return calibrated;}
}
