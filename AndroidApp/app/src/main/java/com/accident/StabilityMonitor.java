package com.accident;

import java.util.*;

public class StabilityMonitor {
    private final int minFrames; private final float stableTol,driftTol; private final int stableWindow,confirmChecks,snapshotEvery;
    private final List<Snapshot> snapshots=new ArrayList<>(); private String lastMode=null; private int confirmStreak=0;
    public StabilityMonitor(int minFrames,float stableTol,float driftTol,int stableWindow,int confirmChecks,int snapshotEvery){this.minFrames=minFrames;this.stableTol=stableTol;this.driftTol=driftTol;this.stableWindow=stableWindow;this.confirmChecks=confirmChecks;this.snapshotEvery=snapshotEvery;}
    public boolean canExitNow(int frameIdx,String mode,BaselineState baseline){
        if(!Objects.equals(mode,lastMode)){lastMode=mode;snapshots.clear();confirmStreak=0;}
        if(snapshotEvery<=0||frameIdx%snapshotEvery!=0)return false;
        snapshots.add(new Snapshot(frameIdx,baseline.median,baseline.mad,baseline.threshold));while(snapshots.size()>2048)snapshots.remove(0);
        boolean stable=evaluate(frameIdx,baseline);
        if(stable)confirmStreak++;else confirmStreak=0;
        return confirmStreak>=Math.max(1,confirmChecks);
    }
    private boolean evaluate(int frame,BaselineState b){
        if(!b.calibrated||frame<minFrames||b.scores.size()<Math.min(minFrames,9000)||b.mad<1e-4||b.threshold<=0.150001f||b.threshold>=0.979999f||snapshots.size()<8)return false;
        List<Snapshot>w=new ArrayList<>();for(Snapshot s:snapshots)if(s.frame>=frame-stableWindow)w.add(s);if(w.size()<8)return false;
        float min=Float.POSITIVE_INFINITY,max=Float.NEGATIVE_INFINITY;for(Snapshot s:w){min=Math.min(min,s.threshold);max=Math.max(max,s.threshold);}if(max-min>stableTol)return false;
        Snapshot first=w.get(0),last=w.get(w.size()-1);return Math.abs(last.median-first.median)<=driftTol&&Math.abs(last.mad-first.mad)<=driftTol;
    }
    private static final class Snapshot{final int frame;final float median,mad,threshold;Snapshot(int f,float m,float d,float t){frame=f;median=m;mad=d;threshold=t;}}
}
