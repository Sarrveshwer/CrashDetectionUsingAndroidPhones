package com.accident;

import java.util.*;

/** Collision classifier matching gate.py: trajectory conflict + temporally linked impact + voting. */
public class RuleClassifier {
    private float minClosingVel, approachDist, conflictDistance;
    private final float maxTtc, minImpactScore;
    private int impactWindow;
    private final int voteK, voteM, cooldown, maxPairAge;
    private final Set<String> vehicleClasses;
    private final Map<Integer,Integer> lastAlert = new HashMap<>();
    private final Map<VoteKey,Deque<Boolean>> votes = new HashMap<>();
    private final Map<VoteKey,Integer> lastVoteFrame = new HashMap<>();
    private final Map<Integer,String> lastLabel = new HashMap<>();
    private final Map<Integer,String> lastReason = new HashMap<>();
    private Set<FeatureExtractor.PairKey> activePairs = new HashSet<>();

    public RuleClassifier(){
        this(0.025f,1.25f,0.85f,12.0f,5,0.30f,2,4,30,1,
                new HashSet<>(Arrays.asList("car","truck","bus","motorcycle","bicycle")));
    }
    public RuleClassifier(float minClosingVel,float approachDistance,float conflictDistance,float maxTtc,
                          int impactWindow,float minImpactScore,int voteK,int voteM,int cooldown,int maxPairAge,
                          Set<String> vehicleClasses){
        this.minClosingVel=minClosingVel;this.approachDist=approachDistance;this.conflictDistance=conflictDistance;
        this.maxTtc=maxTtc;this.impactWindow=impactWindow;this.minImpactScore=minImpactScore;this.voteK=voteK;this.voteM=voteM;
        this.cooldown=cooldown;this.maxPairAge=maxPairAge;this.vehicleClasses=new HashSet<>(vehicleClasses);
    }
    public String getLabel(int tid){return lastLabel.getOrDefault(tid,"normal");}
    public String getReason(int tid){return lastReason.getOrDefault(tid,"none");}
    /** Port of gate.py _apply_profile: "laneless", "laned", "signalized" or "auto"/null. */
    public void applyProfile(String profile){
        if(profile==null||"auto".equals(profile))return;
        switch(profile){
            case "laneless":   minClosingVel=0.030f;approachDist=1.35f;conflictDistance=0.95f;impactWindow=5;break;
            case "laned":      minClosingVel=0.035f;approachDist=1.15f;conflictDistance=0.75f;impactWindow=4;break;
            case "signalized": minClosingVel=0.040f;approachDist=1.10f;conflictDistance=0.75f;impactWindow=6;break;
            default: break;
        }
    }
    public void expire(int frame){
        List<VoteKey> stale=new ArrayList<>();for(VoteKey k:votes.keySet()){int last=lastVoteFrame.getOrDefault(k,Integer.MIN_VALUE/4);if(frame-last>Math.max(10,voteM*maxPairAge+3))stale.add(k);}for(VoteKey k:stale){votes.remove(k);lastVoteFrame.remove(k);}
    }
    private Verdict pairCollision(Map<String,Object> pf){
        if(pf==null)return new Verdict(false,"no_pair");
        if(intv(pf,"pair_age",99)>maxPairAge)return new Verdict(false,"stale_pair");
        if(!boolv(pf,"fresh_a")||!boolv(pf,"fresh_b"))return new Verdict(false,"not_fresh");
        String a=strv(pf,"motion_state_a","UNKNOWN"),b=strv(pf,"motion_state_b","UNKNOWN");
        Set<String> stationary=new HashSet<>(Arrays.asList("STATIONARY","PARKED","STOPPED"));
        if(stationary.contains(a)&&stationary.contains(b))return new Verdict(false,"both_stationary");
        if("UNKNOWN".equals(a)||"UNKNOWN".equals(b))return new Verdict(false,"unknown_state");
        float closing=floatv(pf,"max_closing_vel_recent",0), minSep=floatv(pf,"conflict_min_sep",Float.POSITIVE_INFINITY),ttc=floatv(pf,"ttc",Float.POSITIVE_INFINITY);int conflictAge=intv(pf,"conflict_age",999);
        if(closing<minClosingVel)return new Verdict(false,"weak_closing");
        if(conflictAge>impactWindow)return new Verdict(false,"no_recent_conflict");
        if(minSep>conflictDistance)return new Verdict(false,"paths_not_close");
        if(Float.isFinite(ttc)&&ttc>maxTtc&&conflictAge<=1)return new Verdict(false,"ttc_too_long");
        boolean movingA="MOVING".equals(a),movingB="MOVING".equals(b);
        boolean impactA=intv(pf,"impact_age_a",999)<=impactWindow&&floatv(pf,"impact_score_a",0)>=minImpactScore;
        boolean impactB=intv(pf,"impact_age_b",999)<=impactWindow&&floatv(pf,"impact_score_b",0)>=minImpactScore;
        boolean headingA=floatv(pf,"heading_change_a",0)>=0.55f&&intv(pf,"impact_age_a",999)<=impactWindow;
        boolean headingB=floatv(pf,"heading_change_b",0)>=0.55f&&intv(pf,"impact_age_b",999)<=impactWindow;
        boolean impact=impactA||impactB||(headingA&&impactA)||(headingB&&impactB);
        if(!impact)return new Verdict(false,"no_impact_signature");
        if(movingA&&movingB)return new Verdict(true,"moving_moving_conflict_plus_impact");
        if((movingA&&stationary.contains(b))||(movingB&&stationary.contains(a)))return new Verdict(true,"moving_stationary_conflict_plus_moving_impact");
        return new Verdict(false,"unsupported_state_combo");
    }
    private boolean rollover(Map<String,Object> f){return "MOVING".equals(strv(f,"motion_state","UNKNOWN"))&&floatv(f,"ar_oscillation",0)>=0.6f&&intv(f,"ar_peaks_per_window",0)>=4&&floatv(f,"heading_p90",0)>=0.9f;}
    private void pushVote(VoteKey key,boolean value,int frame){if(lastVoteFrame.getOrDefault(key,Integer.MIN_VALUE)!=frame){Deque<Boolean> q=votes.computeIfAbsent(key,k->new ArrayDeque<>());q.addLast(value);while(q.size()>voteM)q.removeFirst();lastVoteFrame.put(key,frame);}}

    public String predict(Map<String,Object> features,int frameIdx,Map<FeatureExtractor.PairKey,Map<String,Object>> pairFeatures){
        if(features==null||!vehicleClasses.contains(strv(features,"class","")))return "normal";
        int tid=intv(features,"track_id",-1);expire(frameIdx);
        if(!boolv(features,"observation_fresh"))return lastLabel.getOrDefault(tid,"normal");
        Integer la=lastAlert.get(tid);if(la!=null&&frameIdx-la<cooldown)return lastLabel.getOrDefault(tid,"normal");
        Map<FeatureExtractor.PairKey,Boolean> verdicts=new LinkedHashMap<>();List<String> reasons=new ArrayList<>();
        if(pairFeatures!=null)for(Map.Entry<FeatureExtractor.PairKey,Map<String,Object>> e:pairFeatures.entrySet()){
            FeatureExtractor.PairKey pk=e.getKey();if(pk.a!=tid&&pk.b!=tid)continue;
            Verdict v=pairCollision(e.getValue());pushVote(new VoteKey("pair",pk),v.collision,frameIdx);Deque<Boolean> q=votes.get(new VoteKey("pair",pk));
            verdicts.put(pk,countTrue(q)>=voteK);reasons.add("P"+pk.a+"-"+pk.b+":"+v.reason);
        }
        boolean collision=false;for(Boolean b:verdicts.values())if(b){collision=true;break;}
        VoteKey trackKey=new VoteKey("track",tid);pushVote(trackKey,rollover(features),frameIdx);boolean roll=countTrue(votes.get(trackKey))>=voteK;
        String label=collision?"collision":(roll?"rollover":"normal");lastLabel.put(tid,label);lastReason.put(tid,reasons.isEmpty()?"none":joinLast(reasons,3));
        activePairs=new HashSet<>();for(Map.Entry<FeatureExtractor.PairKey,Boolean> e:verdicts.entrySet())if(e.getValue())activePairs.add(e.getKey());
        if(!"normal".equals(label))lastAlert.put(tid,frameIdx);return label;
    }

    private static int countTrue(Deque<Boolean> q){int n=0;if(q!=null)for(Boolean b:q)if(Boolean.TRUE.equals(b))n++;return n;}
    private static String joinLast(List<String> r,int n){int start=Math.max(0,r.size()-n);StringBuilder s=new StringBuilder();for(int i=start;i<r.size();i++){if(s.length()>0)s.append("; ");s.append(r.get(i));}return s.toString();}
    private static String strv(Map<String,Object>m,String k,String d){Object v=m.get(k);return v instanceof String?(String)v:d;}
    private static boolean boolv(Map<String,Object>m,String k){Object v=m.get(k);return Boolean.TRUE.equals(v);}
    private static int intv(Map<String,Object>m,String k,int d){Object v=m.get(k);return v instanceof Number?((Number)v).intValue():d;}
    private static float floatv(Map<String,Object>m,String k,float d){Object v=m.get(k);return v instanceof Number?((Number)v).floatValue():d;}

    public static final class Verdict{final boolean collision;final String reason;Verdict(boolean c,String r){collision=c;reason=r;}}
    private static final class VoteKey{final String type;final Object id;VoteKey(String t,Object i){type=t;id=i;}@Override public boolean equals(Object o){if(!(o instanceof VoteKey))return false;VoteKey k=(VoteKey)o;return type.equals(k.type)&&id.equals(k.id);}@Override public int hashCode(){return 31*type.hashCode()+id.hashCode();}}
}
