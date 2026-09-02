#!/usr/bin/env python3
"""
Real-time Video Runner - Simulates real-time processing of any video file.
Runs the 3-stage crash detection pipeline at the video's native FPS.
"""

import sys
import cv2
import time
from pathlib import Path

# Add trying/src to path
sys.path.insert(0, str(Path(__file__).parent / "src"))

from stage1_motion_gate import (
    MotionGate, FeatureExtractor, RuleClassifier,
    draw_panel, run_realtime
)


class VideoRunner:
    """Real-time video runner with playback controls."""
    
    def __init__(self, video_path: str, mode: str = "auto", output_path: str = None):
        self.video_path = video_path
        self.mode = mode
        if output_path:
            self.output_path = output_path
        else:
            p = Path(video_path)
            self.output_path = str(p.parent / f"{p.stem}_annotated{p.suffix}")
        
        # Initialize components
        from stage1_motion_gate import MotionGate, FeatureExtractor, RuleClassifier, YOLO
        self.model = YOLO("yolo26n.pt")
        self.gate = MotionGate(camera_id="cam_001", physics_window=5)
        self.extractor = FeatureExtractor(window_size=30)
        self.classifier = RuleClassifier()
        
        # Video capture
        self.cap = cv2.VideoCapture(video_path)
        if not self.cap.isOpened():
            raise ValueError(f"Cannot open video: {video_path}")
        
        self.width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        self.fps = self.cap.get(cv2.CAP_PROP_FPS) or 30
        self.total_frames = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.duration = self.total_frames / self.fps
        
        # Output writer
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        self.writer = cv2.VideoWriter(
            self.output_path, 
            cv2.VideoWriter_fourcc(*'mp4v'), 
            self.fps, 
            (self.width, self.height + 300)
        )
        
        # Playback state
        self.paused = False
        self.frame_idx = 0
        self.start_time = None
        self.real_start_time = None
        
        print(f"\n{'='*60}")
        print(f"VIDEO RUNNER - Real-time Simulation")
        print(f"{'='*60}")
        print(f"Video: {Path(video_path).name}")
        print(f"Resolution: {self.width}x{self.height}")
        print(f"FPS: {self.fps:.1f} | Frames: {self.total_frames} | Duration: {self.duration:.1f}s")
        print(f"Mode: auto (day/night auto-detect)")
        print(f"Output: {self.output_path}")
        print(f"\nControls:")
        print(f"  SPACE  - Pause/Resume")
        print(f"  RIGHT  - Step frame (when paused)")
        print(f"  LEFT   - Step back frame (when paused)")
        print(f"  R      - Restart from beginning")
        print(f"  S      - Save current frame")
        print(f"  Q/ESC  - Quit")
        print(f"{'='*60}\n")
    
    def process_frame(self, frame):
        """Run full 3-stage pipeline on a single frame."""
        # Stage 1: Motion gate
        gate_result = self.gate.check(frame)
        
        # YOLO detection
        results = self.model(frame, conf=0.25, verbose=False)
        detections = []
        if results and results[0].boxes is not None:
            for box in results[0].boxes:
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
                conf = float(box.conf[0])
                cls_id = int(box.cls[0])
                cls_name = self.model.names[cls_id] if cls_id < len(self.model.names) else f"cls_{cls_id}"
                detections.append({
                    "bbox": (x1, y1, x2, y2),
                    "center": (cx, cy),
                    "class": cls_name,
                    "conf": conf
                })
        
        # Stage 2 & 3 run continuously, independent of Stage 1's trigger state
        # (requirement #6) - a motion pre-filter must not starve track history.
        tracks = self.extractor.update(detections, frame, frame_idx=self.frame_idx)
        
        return gate_result, detections, tracks
    
    def draw_annotations(self, frame, gate_result, detections, tracks):
        """Draw all annotations on frame."""
        # YOLO boxes
        for det in detections:
            x1, y1, x2, y2 = det["bbox"]
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(frame, f"{det['class']} {det['conf']:.2f}", 
                       (x1, y1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 255, 0), 1)
        
        # Tracked objects with classification
        for tid, track in tracks.items():
            x1, y1, x2, y2 = track.bbox
            cx, cy = track.center
            cv2.rectangle(frame, (x1, y1), (x2, y2), (255, 0, 255), 3)
            cv2.circle(frame, (cx, cy), 5, (255, 0, 255), -1)
            if len(track.history) > 1:
                pts = np.array([(x, y) for (_f, x, y) in track.history[-30:]], dtype=np.int32)
                cv2.polylines(frame, [pts], False, (255, 255, 0), 2)
            
            pf_all = self.extractor.all_pair_features()
            f = self.extractor.get_features(tid)
            if f:
                cl = self.classifier.predict(f, self.frame_idx, pf_all)
                lc = (0, 255, 0) if cl == "normal" else (0, 0, 255) if cl == "collision" else (0, 165, 255)
                cv2.putText(frame, f"ID:{tid} {cl.upper()}", (x1, y1 - 10),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, lc, 2)
                cv2.putText(frame, f"H:{f['max_heading_change']:.2f} FS:{f['flow_spike']:.2f} AR:{f['ar_oscillation']:.2f}",
                           (x1, y2 + 18), cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 255), 1)
        
        return frame
    
    def run(self):
        """Main playback loop with real-time simulation."""
        from stage1_motion_gate import draw_panel
        import numpy as np
        
        self.gate = MotionGate(camera_id="cam_001", physics_window=5)
        self.extractor = FeatureExtractor(window_size=30)
        from stage1_motion_gate import RuleClassifier
        self.classifier = RuleClassifier()
        
        # Initialize YOLO
        from ultralytics import YOLO
        self.model = YOLO("yolo26n.pt")
        
        cv2.namedWindow("Video Runner - Real-time Crash Detection", cv2.WINDOW_NORMAL)
        cv2.resizeWindow("Video Runner - Real-time Crash Detection", self.width, self.height + 300)
        
        frame_time = 1.0 / self.fps
        self.start_time = time.time()
        self.real_start_time = time.time()
        
        print("Starting playback... Press SPACE to pause, Q to quit\n")
        
        while True:
            loop_start = time.time()
            
            if not self.paused:
                ret, frame = self.cap.read()
                if not ret:
                    print("\nEnd of video reached.")
                    break
                self.frame_idx += 1
            
            # Process frame
            gate_result, detections, tracks = self.process_frame(frame)
            
            # Draw annotations on original frame
            annotated_frame = self.draw_annotations(frame.copy(), gate_result, [], tracks)
            
            # Build panel
            from stage1_motion_gate import draw_panel
            canvas = draw_panel(frame, gate_result, {}, self.extractor, 
                               self.classifier, self.frame_idx)
            
            # Write output
            self.writer.write(canvas)
            
            # Display
            cv2.imshow("Video Runner - Real-time Crash Detection", canvas)
            
            # Real-time pacing
            elapsed = time.time() - loop_start
            sleep_time = frame_time - elapsed
            if sleep_time > 0 and not self.paused:
                time.sleep(sleep_time)
            
            # Handle keys
            key = cv2.waitKey(1 if not self.paused else 0) & 0xFF
            
            if key == ord('q') or key == 27:  # Q or ESC
                break
            elif key == ord(' '):  # SPACE - pause/resume
                self.paused = not self.paused
                print(f"\r{'PAUSED' if self.paused else 'PLAYING '}", end="", flush=True)
            elif key == 83 and self.paused:  # RIGHT arrow - step forward
                ret, frame = self.cap.read()
                if ret:
                    self.frame_idx += 1
            elif key == 81 and self.paused:  # LEFT arrow - step back
                if self.frame_idx > 1:
                    self.frame_idx -= 2
                    self.cap.set(cv2.CAP_PROP_POS_FRAMES, self.frame_idx)
            elif key == ord('r'):  # R - restart
                self.cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
                self.frame_idx = 0
                print("\nRestarted from beginning")
            elif key == ord('s'):  # S - save frame
                cv2.imwrite(f"frame_{self.frame_idx}_{int(time.time())}.jpg", canvas)
                print(f"\nSaved frame {self.frame_idx}")
        
        # Cleanup
        self.cap.release()
        self.writer.release()
        cv2.destroyAllWindows()
        
        elapsed = time.time() - self.real_start_time
        print(f"\n\nDone! Processed {self.frame_idx} frames in {elapsed:.1f}s")
        print(f"Output saved to: {self.output_path}")


def main():
    if len(sys.argv) < 2:
        print("Usage: python video_runner.py /path/to/video.mp4 [--mode day|night|twilight|auto]")
        print("Example: python video_runner.py 'Input videos/traffic.mp4' --mode day")
        sys.exit(1)
    
    video_path = sys.argv[1]
    mode = "auto"
    
    for i, arg in enumerate(sys.argv):
        if arg == "--mode" and i + 1 < len(sys.argv):
            mode = sys.argv[i + 1].lower()
            if mode not in ("day", "night", "twilight", "auto"):
                print(f"ERROR: Invalid mode '{mode}'. Use: day, night, twilight, auto")
                sys.exit(1)
    
    if not Path(sys.argv[1]).exists():
        print(f"ERROR: Video not found: {sys.argv[1]}")
        sys.exit(1)
    
    runner = VideoRunner(sys.argv[1], mode=mode)
    runner.run()


if __name__ == "__main__":
    main()