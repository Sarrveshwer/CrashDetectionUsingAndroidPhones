package com.accident;

import android.graphics.Rect;
import org.opencv.core.Core;
import org.opencv.core.CvType;
import org.opencv.core.Mat;
import org.opencv.core.MatOfByte;
import org.opencv.core.MatOfFloat;
import org.opencv.core.MatOfPoint;
import org.opencv.core.MatOfByte;
import org.opencv.core.MatOfFloat;
import org.opencv.core.MatOfPoint;
import org.opencv.core.MatOfPoint2f;
import org.opencv.core.Point;
import org.opencv.imgproc.Imgproc;
import org.opencv.video.Video;

import java.util.*;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * Tracking, motion features and pair trajectory evidence corresponding to gate.py.
 * Null detections mean YOLO was skipped. An empty list means YOLO ran and found nothing.
 */
public class FeatureExtractor {

    /**
     * Port of gate.py _load_homography for JSON files. Accepts {"homography": X} or a bare X,
     * where X is 9 numbers (row-major) or 3 rows of 3. (.npy files are not supported on Android.)
     * Returns null if the file does not exist; throws on malformed content.
     */
    public static Mat loadHomographyFromJson(java.io.File file) throws java.io.IOException, JSONException {
        if (file == null || !file.exists()) return null;
        String jsonText = readFile(file);
        Object parsed = new JSONTokener(jsonText).nextValue();
        JSONArray arr;
        if (parsed instanceof JSONArray) arr = (JSONArray) parsed;
        else if (parsed instanceof JSONObject) arr = ((JSONObject) parsed).getJSONArray("homography");
        else throw new JSONException("Homography JSON must be an array or an object with a 'homography' key");
        double[] v = new double[9];
        if (arr.length() == 9) {
            for (int i = 0; i < 9; i++) v[i] = arr.getDouble(i);
        } else if (arr.length() == 3) {
            for (int r = 0; r < 3; r++) {
                JSONArray row = arr.getJSONArray(r);
                if (row.length() != 3) throw new JSONException("Homography must be 3x3");
                for (int c = 0; c < 3; c++) v[r * 3 + c] = row.getDouble(c);
            }
        } else {
            throw new JSONException("Homography must be 3x3");
        }
        Mat h = new Mat(3, 3, CvType.CV_64F);
        h.put(0, 0, v);
        return h;
    }

    private static String readFile(java.io.File file) throws java.io.IOException {
        try (java.io.BufferedReader reader = new java.io.BufferedReader(
                new java.io.InputStreamReader(new java.io.FileInputStream(file), java.nio.charset.StandardCharsets.UTF_8))) {
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line).append('\n');
            return sb.toString();
        }
    }
    private final int window;
    private final int pairWindow;
    private final int maxMissFrames;
    private final float matchDistance;
    private final float decelSpeedDrop;
    private final float decelMinSpeed;
    private final int flowPointsPerTrack;
    private final float flowMinDistance;
    private final int lkWinSize;
    private final int lkMaxLevel;
    private Mat homography;
    private Mat prevGray;
    private int frameIdx = 0;
    private int calls = 0;
    private final Map<Integer, Track> tracks = new LinkedHashMap<>();
    private final Map<PairKey, PairFeatures> pairs = new LinkedHashMap<>();
    private int nextId = 0;
    private final Set<Integer> currentFreshIds = new HashSet<>();

    public FeatureExtractor(int windowSize, int maxMissFrames, float matchDistance,
                            float decelSpeedDrop, float decelMinSpeed,
                            int flowPointsPerTrack, float flowMinDistance,
                            int lkWinSize, int lkMaxLevel) {
        this(windowSize, maxMissFrames, matchDistance, decelSpeedDrop, decelMinSpeed,
                windowSize, flowPointsPerTrack, flowMinDistance, lkWinSize, lkMaxLevel, null);
    }

    public FeatureExtractor(int windowSize, int maxMissFrames, float matchDistance,
                            float decelSpeedDrop, float decelMinSpeed, int pairWindow,
                            int flowPointsPerTrack, float flowMinDistance,
                            int lkWinSize, int lkMaxLevel) {
        this(windowSize, maxMissFrames, matchDistance, decelSpeedDrop, decelMinSpeed,
                pairWindow, flowPointsPerTrack, flowMinDistance, lkWinSize, lkMaxLevel, null);
    }

    public FeatureExtractor(int windowSize, int maxMissFrames, float matchDistance,
                            float decelSpeedDrop, float decelMinSpeed, int pairWindow,
                            int flowPointsPerTrack, float flowMinDistance,
                            int lkWinSize, int lkMaxLevel, Mat homography) {
        this.window = windowSize;
        this.pairWindow = pairWindow > 0 ? pairWindow : windowSize;
        this.maxMissFrames = maxMissFrames;
        this.matchDistance = matchDistance;
        this.decelSpeedDrop = decelSpeedDrop;
        this.decelMinSpeed = decelMinSpeed;
        this.flowPointsPerTrack = flowPointsPerTrack;
        this.flowMinDistance = flowMinDistance;
        this.lkWinSize = lkWinSize;
        this.lkMaxLevel = lkMaxLevel;
        this.homography = homography == null ? new Mat() : homography.clone();
    }

    public void setHomography(Mat h) {
        if (h == null || h.empty() || h.rows() != 3 || h.cols() != 3)
            throw new IllegalArgumentException("Homography must be 3x3");
        if (homography != null) homography.release();
        homography = h.clone();
    }

    public void setHomography(double[] h9) {
        if (h9 == null || h9.length != 9) throw new IllegalArgumentException("Homography must have 9 values (row-major 3x3)");
        Mat m = new Mat(3, 3, CvType.CV_64F); m.put(0, 0, h9);
        setHomography(m); m.release();
    }

    public void release() {
        if (prevGray != null) { prevGray.release(); prevGray = null; }
        if (homography != null) { homography.release(); homography = new Mat(); }
    }

    public boolean hasHomography() { return homography != null && !homography.empty(); }

    private static Point bottomCenter(Rect b) {
        return new Point(b.left + b.width() * 0.5, b.bottom);
    }

    private static float scale(Rect b) { return Math.max(b.width(), Math.max(b.height(), 1)); }

    private Point projectToGround(Point pt) {
        if (!hasHomography()) return null;
        MatOfPoint2f src = new MatOfPoint2f(pt);
        MatOfPoint2f dst = new MatOfPoint2f();
        Core.perspectiveTransform(src, dst, homography);
        Point[] points = dst.toArray();
        src.release(); dst.release();
        return points.length == 0 ? null : points[0];
    }

    private Point workingPosition(Point bottom) {
        Point ground = projectToGround(bottom);
        return ground != null ? ground : bottom;
    }

    private float associationCost(Track track, Detection det) {
        Point bottom = bottomCenter(det.bbox);
        float sc = Math.max(scale(track.bbox), Math.max(scale(det.bbox), 1.0f));
        if (track.lastObservedFrame > 0) {
            Point pred = new Point(track.currentPositionX, track.currentPositionY);
            Point detPos = workingPosition(bottom);
            float dist = (float)Math.hypot(detPos.x - pred.x, detPos.y - pred.y);
            if (hasHomography()) return dist;
            return dist / sc;
        }
        float dist = (float)Math.hypot(bottom.x - track.bottomCenterX, bottom.y - track.bottomCenterY);
        return dist / sc;
    }

    private Track newTrack(Detection det, int frame) {
        int id = nextId++;
        Rect bbox = new Rect(det.bbox);
        Point bottom = bottomCenter(bbox);
        Point pos = workingPosition(bottom);
        float ar = bbox.width() / (float)Math.max(1, bbox.height());
        Track tr = new Track(id, bbox, det.centerX, det.centerY, det.className, det.confidence);
        tr.hitsMisses.addLast(true);
        tr.history.add(new Track.HistoryPoint(frame, (float)bottom.x, (float)bottom.y));
        tr.aspectRatios.add(new Track.AspectRatioPoint(frame, ar));
        tr.bottomCenterX = (float)bottom.x; tr.bottomCenterY = (float)bottom.y;
        tr.lastObservedPositionX = (float)pos.x; tr.lastObservedPositionY = (float)pos.y;
        tr.currentPositionX = (float)pos.x; tr.currentPositionY = (float)pos.y;
        tr.lastObservedScale = scale(bbox);
        tr.lastObservedFrame = frame; tr.lastPredictionFrame = frame; tr.isPredicted = false;
        tr.motionState = "UNKNOWN"; tr.speed = 0.0f; tr.speedEma = 0.0f;
        tr.updateMotionState(frame, 0.02f, 12, 150, 10);
        return tr;
    }

    private void recordObservation(Track tr, Detection det, int frame) {
        Rect bbox = new Rect(det.bbox);
        Point bottom = bottomCenter(bbox);
        Point pos = workingPosition(bottom);
        if (tr.lastObservedFrame > 0) {
            int dt = Math.max(1, frame - tr.lastObservedFrame);
            float dx = (float)pos.x - tr.lastObservedPositionX;
            float dy = (float)pos.y - tr.lastObservedPositionY;
            float vx = dx / dt, vy = dy / dt;
            if (!hasHomography()) {
                float sc = Math.max(tr.lastObservedScale, Math.max(scale(bbox), 1.0f));
                vx /= sc; vy /= sc;
            }
            tr.prevVelocityX = tr.velocityX; tr.prevVelocityY = tr.velocityY; tr.prevSpeed = tr.speed;
            tr.velocityX = vx; tr.velocityY = vy; tr.speed = (float)Math.hypot(vx, vy);

            float prevSpeed = tr.prevSpeed;
            if (prevSpeed >= decelMinSpeed) {
                float drop = (prevSpeed - tr.speed) / Math.max(prevSpeed, 1e-6f);
                if (drop >= decelSpeedDrop) {
                    tr.decelEvents.addLast(new Track.DecelEvent(frame, prevSpeed, tr.speed));
                    while (tr.decelEvents.size() > 30) tr.decelEvents.removeFirst();
                    tr.lastImpactFrame = frame;
                    tr.lastImpactScore = Math.max(tr.lastImpactScore, drop);
                }
            }
            float prevHyp = (float)Math.hypot(tr.prevVelocityX, tr.prevVelocityY);
            if (prevHyp > decelMinSpeed && tr.speed > decelMinSpeed) {
                float a1 = (float)Math.atan2(tr.prevVelocityY, tr.prevVelocityX);
                float a2 = (float)Math.atan2(tr.velocityY, tr.velocityX);
                float turn = Math.abs((float)Math.atan2(Math.sin(a2-a1), Math.cos(a2-a1)));
                tr.lastHeadingChange = turn; tr.lastHeadingChangeFrame = frame;
                if (turn >= 0.7f && prevSpeed >= 0.05f)
                    tr.lastImpactScore = Math.max(tr.lastImpactScore, Math.min(1.0f, turn / (float)Math.PI));
            } else tr.lastHeadingChange = 0.0f;
        }
        tr.centerX = det.centerX; tr.centerY = det.centerY; tr.bbox = bbox; tr.conf = det.confidence;
        tr.currentPositionX = (float)pos.x; tr.currentPositionY = (float)pos.y;
        tr.lastObservedPositionX = (float)pos.x; tr.lastObservedPositionY = (float)pos.y;
        tr.lastObservedScale = scale(bbox); tr.lastObservedFrame = frame; tr.lastPredictionFrame = frame;
        tr.isPredicted = false; tr.missStreak = 0;
        tr.hitsMisses.addLast(true); while (tr.hitsMisses.size() > 30) tr.hitsMisses.removeFirst();
        tr.bottomCenterX = (float)bottom.x; tr.bottomCenterY = (float)bottom.y;
        tr.history.add(new Track.HistoryPoint(frame, (float)bottom.x, (float)bottom.y));
        while (tr.history.size() > window) tr.history.remove(0);
        float ar = bbox.width() / (float)Math.max(1, bbox.height());
        tr.aspectRatios.add(new Track.AspectRatioPoint(frame, ar)); while (tr.aspectRatios.size() > window) tr.aspectRatios.remove(0);
        tr.speedEma = tr.speedEmaAlpha * tr.speed + (1.0f - tr.speedEmaAlpha) * tr.speedEma;
        tr.updateMotionState(frame, 0.02f, 12, 150, 10);
    }

    private void predictTrack(Track tr, int frame) {
        if (tr.lastPredictionFrame >= frame || tr.lastObservedFrame <= 0) return;
        int dt = frame - tr.lastPredictionFrame; if (dt <= 0) return;
        tr.currentPositionX += tr.velocityX * dt; tr.currentPositionY += tr.velocityY * dt;
        if (!hasHomography()) {
            float dx = tr.velocityX * tr.lastObservedScale * dt;
            float dy = tr.velocityY * tr.lastObservedScale * dt;
            tr.bbox = new Rect((int)(tr.bbox.left + dx), (int)(tr.bbox.top + dy),
                    (int)(tr.bbox.right + dx), (int)(tr.bbox.bottom + dy)); // int() truncation, as gate.py
            tr.centerX = (tr.bbox.left + tr.bbox.right) * 0.5f;
            tr.centerY = (tr.bbox.top + tr.bbox.bottom) * 0.5f;
            Point bc = bottomCenter(tr.bbox); tr.bottomCenterX = (float)bc.x; tr.bottomCenterY = (float)bc.y;
        }
        tr.lastPredictionFrame = frame; tr.isPredicted = true; tr.hitsMisses.addLast(false); tr.missStreak++;
        while (tr.hitsMisses.size() > 30) tr.hitsMisses.removeFirst();
    }

    public Map<Integer, Track> update(List<Detection> detections, Mat frame, int frameIndex) {
        this.frameIdx = frameIndex > 0 ? frameIndex : calls + 1;
        this.calls = this.frameIdx;
        Mat gray = new Mat();
        if (frame.channels() == 1) frame.copyTo(gray); else Imgproc.cvtColor(frame, gray, Imgproc.COLOR_BGR2GRAY);
        Mat oldPrevGray = prevGray;
        prevGray = gray.clone();
        boolean freshDetection = detections != null;
        currentFreshIds.clear();
        Map<Integer, Track> spawned = new LinkedHashMap<>();

        if (freshDetection) {
            Set<Integer> matched = new HashSet<>();
            List<Candidate> candidates = new ArrayList<>();
            for (int di=0; di<detections.size(); di++) {
                Detection det = detections.get(di);
                for (Track tr : tracks.values()) {
                    if (matched.contains(tr.trackId) || tr.missStreak > maxMissFrames) continue;
                    if (!tr.className.equals(det.className)) continue;
                    float cost = associationCost(tr, det);
                    float allowed = hasHomography() ? Math.max(2.0f, matchDistance) : matchDistance;
                    if (cost <= allowed) candidates.add(new Candidate(cost, di, tr.trackId));
                }
            }
            candidates.sort(Comparator.comparingDouble(c -> c.cost));
            Set<Integer> usedDets = new HashSet<>();
            for (Candidate c : candidates) {
                if (usedDets.contains(c.detIdx) || matched.contains(c.trackId)) continue;
                usedDets.add(c.detIdx); matched.add(c.trackId);
                Track tr = tracks.get(c.trackId);
                recordObservation(tr, detections.get(c.detIdx), frameIdx);
                currentFreshIds.add(tr.trackId);
                if (oldPrevGray != null) {
                    Float disp = sparseFlowForBbox(oldPrevGray, gray, detections.get(c.detIdx).bbox, flowPointsPerTrack);
                    if (disp != null) {
                        tr.currentFlowDisp = disp; tr.flowSamples.add(new Track.FlowSample(frameIdx, disp));
                        while (tr.flowSamples.size() > window) tr.flowSamples.remove(0);
                    }
                }
            }
            for (int di=0; di<detections.size(); di++) if (!usedDets.contains(di)) {
                Track tr = newTrack(detections.get(di), frameIdx); spawned.put(tr.trackId, tr); currentFreshIds.add(tr.trackId);
            }
            Map<Integer, Track> survivors = new LinkedHashMap<>(spawned);
            for (Track tr : tracks.values()) {
                if (matched.contains(tr.trackId)) survivors.put(tr.trackId, tr);
                else { predictTrack(tr, frameIdx); if (tr.missStreak <= maxMissFrames) survivors.put(tr.trackId, tr); }
            }
            tracks.clear(); tracks.putAll(survivors);
        } else {
            for (Track tr : tracks.values()) predictTrack(tr, frameIdx);
            tracks.entrySet().removeIf(e -> e.getValue().missStreak > maxMissFrames);
        }

        if (freshDetection && currentFreshIds.size() >= 2) {
            List<Integer> ids = new ArrayList<>(currentFreshIds); Collections.sort(ids);
            for (int i=0; i<ids.size(); i++) for (int j=i+1; j<ids.size(); j++) updatePair(ids.get(i), ids.get(j), tracks.get(ids.get(i)), tracks.get(ids.get(j)));
        }
        Set<Integer> alive = tracks.keySet();
        pairs.keySet().removeIf(k -> !alive.contains(k.a) || !alive.contains(k.b));
        gray.release();
        if (oldPrevGray != null) oldPrevGray.release();
        return tracks;
    }

    private void updatePair(int a, int b, Track ta, Track tb) {
        PairKey key = new PairKey(a,b); PairFeatures pf = pairs.get(key);
        if (pf == null) { pf = new PairFeatures(a,b); pairs.put(key,pf); }
        Point pa = new Point(ta.currentPositionX, ta.currentPositionY), pb = new Point(tb.currentPositionX, tb.currentPositionY);
        Point va = new Point(ta.velocityX, ta.velocityY), vb = new Point(tb.velocityX, tb.velocityY);
        Point r = new Point(pb.x-pa.x,pb.y-pa.y), rv = new Point(vb.x-va.x,vb.y-va.y);
        float dist=(float)Math.hypot(r.x,r.y), sc=Math.max(1.0f,(ta.lastObservedScale+tb.lastObservedScale)*0.5f); pf.pairScale=sc;
        float distNorm=hasHomography()?dist:dist/sc;
        float closingAbs=dist>1e-6? (float)(-(r.x*rv.x+r.y*rv.y)/dist):0.0f;
        float closingNorm=hasHomography()?closingAbs:closingAbs/sc;
        float speed2=(float)(rv.x*rv.x+rv.y*rv.y);
        float tClosest=speed2>1e-9f?(float)Math.max(0.0,Math.min(20.0,-(r.x*rv.x+r.y*rv.y)/speed2)):Float.POSITIVE_INFINITY;
        Point minVec=Float.isFinite(tClosest)?new Point(r.x+rv.x*tClosest,r.y+rv.y*tClosest):r;
        float minSep=(float)Math.hypot(minVec.x,minVec.y), minSepNorm=hasHomography()?minSep:minSep/sc;
        float ttc=closingNorm>1e-6?distNorm/closingNorm:Float.POSITIVE_INFINITY;
        boolean conflict=closingNorm>=0.015f && tClosest<=12.0f && minSepNorm<=0.85f;
        pf.lastUpdateFrame=frameIdx;
        pf.iouHistory.addLast(new PairFeatures.IouPoint(frameIdx,iou(ta.bbox,tb.bbox)));
        pf.distHistory.addLast(new PairFeatures.DistPoint(frameIdx,distNorm));
        pf.closingVelHistory.addLast(new PairFeatures.ClosingVelPoint(frameIdx,closingNorm));
        pf.conflictHistory.addLast(new PairFeatures.ConflictPoint(frameIdx,conflict,minSepNorm,ttc));
        trim(pf.iouHistory); trim(pf.distHistory); trim(pf.closingVelHistory); trim(pf.conflictHistory);
        float recent=0.0f; for(PairFeatures.ClosingVelPoint v:pf.closingVelHistory) if(frameIdx-v.frame<=8) recent=Math.max(recent,v.closingVel); pf.recentCloseMax=recent;
        if(conflict){pf.lastConflictFrame=frameIdx;pf.lastConflictMinSep=minSepNorm;}
        pf.lastTtc=ttc; pf.lastMinSep=minSepNorm; pf.lastClosingNorm=closingNorm;
        if((!ta.decelEvents.isEmpty()&&ta.decelEvents.peekLast().frame==frameIdx)||(!tb.decelEvents.isEmpty()&&tb.decelEvents.peekLast().frame==frameIdx)){
            pf.decelClosingVelHistory.addLast(new PairFeatures.DecelClosingVelPoint(frameIdx,closingNorm)); trim(pf.decelClosingVelHistory);
        }
    }

    private <T> void trim(ArrayDeque<T> q){while(q.size()>pairWindow)q.removeFirst();}

    private static float iou(Rect a, Rect b){
        float ax1=a.left,ay1=a.top,ax2=a.right,ay2=a.bottom,bx1=b.left,by1=b.top,bx2=b.right,by2=b.bottom;
        float iw=Math.min(ax2,bx2)-Math.max(ax1,bx1),ih=Math.min(ay2,by2)-Math.max(ay1,by1); if(iw<=0||ih<=0)return 0;
        float inter=iw*ih, areaA=a.width()*a.height(), areaB=b.width()*b.height(); return inter/Math.max(1.0f,areaA+areaB-inter);
    }

    private Float sparseFlowForBbox(Mat prev, Mat next, Rect bbox, int maxPoints){
        int x1=Math.max(0,bbox.left),y1=Math.max(0,bbox.top),x2=Math.min(prev.cols(),bbox.right),y2=Math.min(prev.rows(),bbox.bottom);
        if(x2-x1<8||y2-y1<8)return null;
        Mat roi=prev.submat(y1,y2,x1,x2);
        MatOfPoint corners=new MatOfPoint();
        Imgproc.goodFeaturesToTrack(roi, corners, maxPoints, 0.01, flowMinDistance);
        roi.release();
        Point[] found=corners.toArray(); corners.release();
        if(found.length==0)return null;
        Point[] arr=new Point[found.length];
        for(int i=0;i<found.length;i++)arr[i]=new Point(found[i].x+x1,found[i].y+y1);
        MatOfPoint2f prevPts=new MatOfPoint2f(arr), nextPts=new MatOfPoint2f();
        MatOfByte status=new MatOfByte(); MatOfFloat err=new MatOfFloat();
        Video.calcOpticalFlowPyrLK(prev,next,prevPts,nextPts,status,err,new org.opencv.core.Size(lkWinSize,lkWinSize),lkMaxLevel,
                new org.opencv.core.TermCriteria(org.opencv.core.TermCriteria.COUNT|org.opencv.core.TermCriteria.EPS,10,0.03));
        Point[] np=nextPts.toArray(); byte[] st=status.toArray();
        prevPts.release();nextPts.release();status.release();err.release();
        List<Double> angles=new ArrayList<>();
        for(int i=0;i<Math.min(arr.length,np.length);i++) if(i<st.length&&st[i]==1){double dx=np[i].x-arr[i].x,dy=np[i].y-arr[i].y;angles.add(Math.atan2(dy,dx));}
        if(angles.size()<3)return null;
        double mean=0;for(double a:angles)mean+=a;mean/=angles.size();double var=0;for(double a:angles){double d=a-mean;var+=d*d;}return (float)Math.sqrt(var/angles.size());
    }

    public Map<String,Object> getFeatures(int id){
        Track tr=tracks.get(id); if(tr==null||tr.history.size()<2)return null;
        List<Float> headingChanges=new ArrayList<>(); List<HeadingStep> steps=new ArrayList<>();
        for(int i=1;i<tr.history.size();i++){Track.HistoryPoint p0=tr.history.get(i-1),p1=tr.history.get(i);int dt=Math.max(1,p1.frame-p0.frame);float dx=p1.x-p0.x,dy=p1.y-p0.y;if(dx!=0||dy!=0)steps.add(new HeadingStep((float)Math.atan2(dy,dx),dt));}
        for(int i=1;i<steps.size();i++){float da=steps.get(i).angle-steps.get(i-1).angle;headingChanges.add(Math.abs((float)Math.atan2(Math.sin(da),Math.cos(da)))/Math.max(1,steps.get(i).dt));}
        float headingP90=percentileList(headingChanges,90); List<Float> ars=new ArrayList<>();for(Track.AspectRatioPoint p:tr.aspectRatios)ars.add(p.ratio);
        float arOsc=ars.size()>=3?std(ars):0;int peaks=0;if(ars.size()>4)for(int i=1;i<ars.size()-1;i++)if(ars.get(i)>ars.get(i-1)&&ars.get(i)>ars.get(i+1))peaks++;
        List<Float> disp=new ArrayList<>();for(Track.FlowSample p:tr.flowSamples)disp.add(p.disp);float flowSpike=1.0f;if(disp.size()>=5)flowSpike=tr.currentFlowDisp/Math.max(medianList(disp),1e-6f);
        int stationaryDuration=0;if(tr.stationaryStartFrame!=null&&Arrays.asList("STATIONARY","PARKED","STOPPED").contains(tr.motionState))stationaryDuration=Math.max(0,frameIdx-tr.stationaryStartFrame);
        Map<String,Object> f=new HashMap<>();f.put("track_id",id);f.put("class",tr.className);f.put("heading_p90",headingP90);f.put("heading_changes",headingChanges);f.put("max_heading_change",headingP90);f.put("flow_spike",flowSpike);f.put("ar_oscillation",arOsc);f.put("ar_peaks_per_window",peaks);f.put("fragmentation",tr.getFragmentation());f.put("speed",tr.speed);f.put("speed_ema",tr.speedEma);f.put("motion_state",tr.motionState);f.put("ever_moved",tr.everMoved);f.put("stationary_duration",stationaryDuration);f.put("decel_count",tr.decelEvents.size());f.put("last_observed_frame",tr.lastObservedFrame);f.put("observation_age",Math.max(0,frameIdx-tr.lastObservedFrame));f.put("observation_fresh",tr.lastObservedFrame==frameIdx);f.put("is_predicted",tr.isPredicted);f.put("impact_score",frameIdx-tr.lastImpactFrame<=5?tr.lastImpactScore:0.0f);f.put("impact_frame_age",Math.max(0,frameIdx-tr.lastImpactFrame));f.put("heading_change_recent",frameIdx-tr.lastHeadingChangeFrame<=5?tr.lastHeadingChange:0.0f);f.put("history_len",tr.history.size());return f;
    }

    public Map<String,Object> getPairFeatures(int a,int b){PairKey key=new PairKey(a,b);PairFeatures pf=pairs.get(key);if(pf==null)return null;Track ta=tracks.get(key.a),tb=tracks.get(key.b);if(ta==null||tb==null)return null;int age=frameIdx-pf.lastUpdateFrame;
        Map<String,Object> f=new HashMap<>();f.put("pair",key);f.put("iou_now",pf.iouHistory.isEmpty()?0.0f:pf.iouHistory.peekLast().iou);f.put("iou_trend",0.0f);f.put("closing_velocity",pf.lastClosingNorm);float maxDecel=0;for(PairFeatures.DecelClosingVelPoint p:pf.decelClosingVelHistory)maxDecel=Math.max(maxDecel,p.closingVel);f.put("decel_closing_velocity",maxDecel);f.put("max_closing_vel_recent",pf.recentCloseMax);f.put("dist_now",pf.distHistory.isEmpty()?Float.POSITIVE_INFINITY:pf.distHistory.peekLast().dist);f.put("frames",pf.distHistory.size());f.put("last_update_frame",pf.lastUpdateFrame);f.put("pair_age",age);f.put("fresh_a",ta.lastObservedFrame==frameIdx);f.put("fresh_b",tb.lastObservedFrame==frameIdx);f.put("motion_state_a",ta.motionState);f.put("motion_state_b",tb.motionState);f.put("ever_moved_a",ta.everMoved);f.put("ever_moved_b",tb.everMoved);f.put("last_conflict_frame",pf.lastConflictFrame);f.put("conflict_age",Math.max(0,frameIdx-pf.lastConflictFrame));f.put("conflict_min_sep",pf.lastConflictMinSep);f.put("ttc",pf.lastTtc);f.put("min_sep",pf.lastMinSep);f.put("impact_age_a",Math.max(0,frameIdx-ta.lastImpactFrame));f.put("impact_age_b",Math.max(0,frameIdx-tb.lastImpactFrame));f.put("impact_score_a",frameIdx-ta.lastImpactFrame<=5?ta.lastImpactScore:0.0f);f.put("impact_score_b",frameIdx-tb.lastImpactFrame<=5?tb.lastImpactScore:0.0f);f.put("heading_change_a",frameIdx-ta.lastHeadingChangeFrame<=5?ta.lastHeadingChange:0.0f);f.put("heading_change_b",frameIdx-tb.lastHeadingChangeFrame<=5?tb.lastHeadingChange:0.0f);return f; }

    public Map<PairKey,Map<String,Object>> allPairFeatures(){Map<PairKey,Map<String,Object>> out=new LinkedHashMap<>();for(PairKey k:new ArrayList<>(pairs.keySet())){Map<String,Object> f=getPairFeatures(k.a,k.b);if(f!=null)out.put(k,f);}return out;}
    public Map<Integer,Track> getTracks(){return tracks;}
    public Set<Integer> getCurrentFreshIds(){return Collections.unmodifiableSet(currentFreshIds);}

    private static float medianList(List<Float> v){if(v.isEmpty())return 0;float[] a=new float[v.size()];for(int i=0;i<v.size();i++)a[i]=v.get(i);Arrays.sort(a);return (a.length&1)==1?a[a.length/2]:(a[a.length/2-1]+a[a.length/2])/2f;}
    private static float percentileList(List<Float> v,double p){if(v.isEmpty())return 0;float[] a=new float[v.size()];for(int i=0;i<v.size();i++)a[i]=v.get(i);Arrays.sort(a);double r=p/100.0*(a.length-1);int l=(int)Math.floor(r),h=(int)Math.ceil(r);return l==h?a[l]:(float)(a[l]+(r-l)*(a[h]-a[l]));}
    private static float std(List<Float> v){float m=0;for(float x:v)m+=x;m/=v.size();float s=0;for(float x:v){float d=x-m;s+=d*d;}return (float)Math.sqrt(s/v.size());}
    private static final class HeadingStep{final float angle;final int dt;HeadingStep(float a,int d){angle=a;dt=d;}}
    private static final class Candidate{final float cost;final int detIdx,trackId;Candidate(float c,int d,int t){cost=c;detIdx=d;trackId=t;}}

    public static final class PairKey {
        public final int a,b; public PairKey(int a,int b){this.a=Math.min(a,b);this.b=Math.max(a,b);}
        @Override public boolean equals(Object o){if(!(o instanceof PairKey))return false;PairKey k=(PairKey)o;return a==k.a&&b==k.b;}
        @Override public int hashCode(){return 31*a+b;}
        @Override public String toString(){return "("+a+","+b+")";}
    }
}
