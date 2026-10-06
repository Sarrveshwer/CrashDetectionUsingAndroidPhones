#!/usr/bin/env python3
"""
k_mad validation harness (offline, no camera/model needed).

Loads every *_baseline.json produced by the Regime-A engine, recomputes
median / MAD from the stored score window, and sweeps candidate k values.

For each baseline file and each k it reports:

    threshold  = clip(median + k * MAD, 0.15, 0.95)
    exceedance = fraction of BASELINE scores above that threshold

Exceedance is a single-frame false-positive proxy; the live detector
additionally demands a 7-consecutive-frame streak, so realized FAR is far
lower - but comparing exceedance across k on identical data isolates the
effect of k itself.

Guideline: choose the smallest k whose WORST-FILE exceedance stays at or
below --target (default 0.01).

Usage:
    python scripts/validate_k_mad.py [--target 0.01]
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BASELINE_DIR = ROOT / "configs" / "baselines"
K_VALUES = (2.0, 2.5, 3.0, 3.5, 4.0, 4.5)


def load_baselines():
    files = sorted(BASELINE_DIR.glob("*_baseline.json"))
    if not files:
        print(f"No baseline files found in {BASELINE_DIR}")
        return []
    out = []
    for path in files:
        try:
            with open(path) as f:
                data = json.load(f)
        except Exception as e:
            print(f"[skip] {path.name}: {e}")
            continue
        scores = np.array(data.get("scores", []), dtype=float)
        if scores.size < 50:
            print(f"[skip] {path.name}: only {scores.size} samples (<50)")
            continue
        median = float(np.median(scores))
        mad = max(float(np.median(np.abs(scores - median))), 1e-6)
        out.append((path.name, str(data.get("camera_id")), str(data.get("mode")),
                    scores.size, median, mad, scores))
    return out


def main():
    parser = argparse.ArgumentParser(description="Validate k_mad choice")
    parser.add_argument("--target", type=float, default=0.01,
                        help="max acceptable baseline exceedance (default 0.01)")
    args = parser.parse_args()

    baselines = load_baselines()
    if not baselines:
        return 1

    header = f"{'file':<32}{'mode':>9}{'n':>7}{'median':>9}{'MAD':>8}"
    print(header)
    print("-" * len(header))
    for name, _cid, mode, n, median, mad, _s in baselines:
        print(f"{name:<32}{mode:>9}{n:>7}{median:>9.4f}{mad:>8.4f}")

    for k in K_VALUES:
        print(f"\n--- k = {k} ---")
        print(f"{'file':<32}{'threshold':>11}{'exceedance':>12}")
        worst = 0.0
        for name, _cid, _mode, _n, median, mad, scores in baselines:
            thr = float(np.clip(median + k * mad, 0.15, 0.95))
            exc = float(np.mean(scores > thr))
            worst = max(worst, exc)
            print(f"{name:<32}{thr:>11.4f}{exc:>12.5f}")
        verdict = "OK" if worst <= args.target else "above target"
        print(f"worst-file exceedance: {worst:.5f}  [{verdict}]")

    print("\nRecommendation: smallest k whose worst-file exceedance "
          f"<= {args.target:g}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
