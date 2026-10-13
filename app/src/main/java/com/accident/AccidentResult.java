package com.accident;

import java.util.List;
import java.util.Map;

public class AccidentResult {
    public final GateResult gateResult;
    public final List<Track> tracks;
    public final Map<Integer, String> trackLabels;
    public final Map<Integer, String> trackReasons;
    public final boolean hasCollision;
    public final boolean hasRollover;

    public AccidentResult(GateResult gateResult, List<Track> tracks, 
                          Map<Integer, String> trackLabels, Map<Integer, String> trackReasons,
                          boolean hasCollision, boolean hasRollover) {
        this.gateResult = gateResult;
        this.tracks = tracks;
        this.trackLabels = trackLabels;
        this.trackReasons = trackReasons;
        this.hasCollision = hasCollision;
        this.hasRollover = hasRollover;
    }

    public static AccidentResult normal(GateResult gateResult, List<Track> tracks,
                                        Map<Integer, String> trackLabels, Map<Integer, String> trackReasons) {
        return new AccidentResult(gateResult, tracks, trackLabels, trackReasons, false, false);
    }

    public static AccidentResult collision(GateResult gateResult, List<Track> tracks,
                                           Map<Integer, String> trackLabels, Map<Integer, String> trackReasons) {
        return new AccidentResult(gateResult, tracks, trackLabels, trackReasons, true, false);
    }

    public static AccidentResult rollover(GateResult gateResult, List<Track> tracks,
                                          Map<Integer, String> trackLabels, Map<Integer, String> trackReasons) {
        return new AccidentResult(gateResult, tracks, trackLabels, trackReasons, false, true);
    }
}