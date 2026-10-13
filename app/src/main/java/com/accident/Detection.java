package com.accident;

import android.graphics.Rect;

public class Detection {
    public final Rect bbox;
    public final float centerX;
    public final float centerY;
    public final String className;
    public final float confidence;

    public Detection(Rect bbox, float centerX, float centerY, String className, float confidence) {
        this.bbox = bbox;
        this.centerX = centerX;
        this.centerY = centerY;
        this.className = className;
        this.confidence = confidence;
    }

    public static Detection fromDict(int x1, int y1, int x2, int y2, String className, float confidence) {
        Rect rect = new Rect(x1, y1, x2, y2);
        float cx = (x1 + x2) * 0.5f;
        float cy = (y1 + y2) * 0.5f;
        return new Detection(rect, cx, cy, className, confidence);
    }
}