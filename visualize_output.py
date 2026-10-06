#!/usr/bin/env python3
"""
Offline annotator: runs the SHARED pipeline (src/stage1_motion_gate.py) over
a video and writes an annotated MP4 (frames + diagnostics panel).
Thin wrapper around run_realtime - no local copies of the engine.

Usage:
    python visualize_output.py input.mp4 [output.mp4] [--mode day|night|twilight|auto]
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from src.stage1_motion_gate import run_realtime


def main():
    args = list(sys.argv[1:])
    mode = "auto"
    if "--mode" in args:
        i = args.index("--mode")
        mode = args[i + 1].lower()
        del args[i:i + 2]

    if not args:
        print(__doc__)
        sys.exit(1)

    input_path = args[0]
    if len(args) > 1:
        output_path = args[1]
    else:
        p = Path(input_path)
        output_path = str(p.with_name(p.stem + "_visualized.mp4"))

    run_realtime(input_path, output_path, mode=mode)


if __name__ == "__main__":
    main()
