"""Measure EVERY bundled bird icon for subject-to-edge clearance.

WHY THIS EXISTS: F190 scored its crop rule against 13 icons that were looked
at, out of 1,290 shipped. The owner has since reported six more bad crops one
at a time (glwgul, killde, comloo, brdowl, baleag, shshaw), which is what a
1% sample buys you. This measures all of them.

WHAT IT MEASURES: the shipped icon is already square, so the question is not
"where would we cut" but "did the cut clip the bird". It reuses the cropper's
OWN subject detection, then reports the clearance between the subject box and
each of the four edges as a fraction of the icon side.

IT MEASURES DETECTION, AND DETECTION IS THE KNOWN RESIDUAL FAULT (F190). So
this is a SUSPECT LIST, not a verdict. It is validated against the six birds
the owner reported: a detector that cannot flag known-bad icons has no power
and must be said so out loud.

    python assets/audit-icon-margins.py [--csv out.csv]
"""
from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import importlib.util  # noqa: E402

from PIL import Image  # noqa: E402

# The module is `square-icons.py` — a hyphen, so it cannot be imported by name.
# Loading it by PATH is what makes this audit reuse the CROPPER'S OWN detection
# rather than a second copy that could drift from it.
_spec = importlib.util.spec_from_file_location(
    "square_icons", os.path.join(HERE, "square-icons.py"))
S = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(S)

ICONS = os.path.join(os.path.dirname(HERE), "www", "assets", "birds")

# Reported by the owner as visibly wrong. The audit must flag these or it is
# not measuring what he is seeing.
REPORTED = {
    "glwgul": "head cut off",
    "killde": "tail cropped",
    "comloo": "head still cropped",
    "brdowl": "not centered",
    "baleag": "tail still trimmed",
    "shshaw": "top of head too close to top edge",
}

# The cropper's own idea of a safe edge.
TIGHT = S.EDGE_MARGIN


def measure(path):
    with Image.open(path) as im:
        im = im.convert("RGB")
        w, h = im.size
        a = S.analyse(im)
    x0, y0, x1, y1 = a["box"]
    return {
        "w": w, "h": h,
        "left": x0, "top": y0,
        "right": 1.0 - x1, "bottom": 1.0 - y1,
        "rival": a.get("rival", 0.0),
    }


def main(argv):
    csv_path = None
    if "--csv" in argv:
        csv_path = argv[argv.index("--csv") + 1]

    files = sorted(f for f in os.listdir(ICONS)
                   if f.lower().endswith((".jpg", ".jpeg", ".png"))
                   and not f.startswith("fallback"))
    rows, errs = [], []
    for f in files:
        code = os.path.splitext(f)[0]
        try:
            m = measure(os.path.join(ICONS, f))
        except Exception as e:  # noqa: BLE001
            errs.append((code, str(e)[:60]))
            continue
        worst = min(m["left"], m["top"], m["right"], m["bottom"])
        which = min(("left", m["left"]), ("top", m["top"]),
                    ("right", m["right"]), ("bottom", m["bottom"]),
                    key=lambda t: t[1])[0]
        rows.append((code, worst, which, m))

    rows.sort(key=lambda r: r[1])
    flagged = [r for r in rows if r[1] < TIGHT]

    print(f"icons measured : {len(rows)}   unreadable: {len(errs)}")
    print(f"edge threshold : {TIGHT:.2f} of the side (square-icons.EDGE_MARGIN)")
    print(f"FLAGGED        : {len(flagged)}  ({100.0*len(flagged)/max(1,len(rows)):.1f}%)")
    print()

    # ---- THE CONTROL --------------------------------------------------------
    print("CONTROL - the six the owner reported by eye:")
    hit = 0
    for code, why in REPORTED.items():
        r = next((x for x in rows if x[0] == code), None)
        if not r:
            print(f"  {code:8} NOT FOUND among the icons")
            continue
        mark = "FLAGGED" if r[1] < TIGHT else "missed "
        if r[1] < TIGHT:
            hit += 1
        print(f"  {code:8} {mark}  worst {r[1]:.3f} at {r[2]:<6}  ({why})")
    print(f"  -> the audit flags {hit} of {len(REPORTED)} known-bad icons")
    print()

    print("WORST 40 BY CLEARANCE:")
    for code, worst, which, m in rows[:40]:
        star = "  <- reported" if code in REPORTED else ""
        print(f"  {code:10} {worst:.3f} at {which:<6} "
              f"L{m['left']:.2f} T{m['top']:.2f} R{m['right']:.2f} B{m['bottom']:.2f}{star}")

    if csv_path:
        with open(csv_path, "w", encoding="utf-8", newline="") as fh:
            fh.write("code,worst,edge,left,top,right,bottom,rival,w,h\n")
            for code, worst, which, m in rows:
                fh.write(f"{code},{worst:.4f},{which},{m['left']:.4f},{m['top']:.4f},"
                         f"{m['right']:.4f},{m['bottom']:.4f},{m['rival']:.4f},"
                         f"{m['w']},{m['h']}\n")
        print(f"\nwrote {csv_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

