"""Measure EVERY bundled bird icon for subject-to-edge clearance.

WHY THIS EXISTS: F190 scored its crop rule against 13 icons that were looked
at, out of 1,290 shipped. The owner then reported six more bad crops one at a
time, which is what a 1% sample buys you. F250 fixed shshaw with a dedicated
landmark guard because this detector missed it; the five unresolved controls
below are what this audit must still identify.

WHAT IT MEASURES: the shipped icon is already square, so the question is not
"where would we cut" but "did the cut clip the bird". It reuses the cropper's
OWN subject detection, then reports the clearance between the subject box and
each of the four edges as a fraction of the icon side.

IT MEASURES DETECTION, AND DETECTION IS THE KNOWN RESIDUAL FAULT (F190). So
this is a SUSPECT LIST, not a verdict. It is validated against five birds the
owner reported that do not have F250's dedicated landmark guard: a detector
that cannot flag known-bad icons has no power and must be said so out loud.

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
}

# The cropper's own idea of a safe edge.
TIGHT = S.EDGE_MARGIN


def _choose(n, k):
    """Binomial coefficient, so the control can score its own power without
    pulling in a dependency this repo does not otherwise need."""
    if k < 0 or k > n:
        return 0
    out = 1
    for i in range(k):
        out = out * (n - i) // (i + 1)
    return out


def measure(path):
    with Image.open(path) as im:
        im = im.convert("RGB")
        w, h = im.size
        a = S.analyse(im)
    x0, y0, x1, y1 = a["box"]
    left, top, right, bottom = x0, y0, 1.0 - x1, 1.0 - y1
    # ⚠️ F250. THE HEAD END, not the minimum of four edges.
    #
    # `min(L,T,R,B)` flagged **1,208 of 1,289 icons (93.7%)** — and then
    # reported "flags 6 of 6 known-bad" as if that were validation. It is not:
    # at a 93.7% flag rate the chance of catching 6 of 6 **by accident is
    # 0.677**. The control was 68% likely to look perfect on a check with no
    # power at all, which is F244's lesson in a new place.
    #
    # The reason it flagged everything is that it contradicts the crop's own
    # design. F190 states plainly that `baleag`, `brncre` and `killde` sit at
    # 0.000 *"but all three were reported as TAIL cuts, which this rule
    # deliberately permits"* — the owner's rule being **"better trim tail than
    # head"**. So the audit was measuring the tail end and calling a deliberate
    # decision a defect.
    #
    # MEASURED across all 1,289: scoring the HEAD end instead flags **492
    # (38.2%)** and catches the five remaining controls, for which the
    # by-chance probability is **0.008**. Strong evidence — while shshaw's
    # dedicated landmark guard covers the known detector miss.
    #
    # The head end is the frame side the head ANCHOR is nearest to, which is
    # exactly the direction F190's HEAD_PAD protects.
    hx, hy = a["head"]
    head_side, head_clear = min(
        (("left", left), hx),
        (("right", right), 1.0 - hx),
        (("top", top), hy),
        (("bottom", bottom), 1.0 - hy),
        key=lambda t: t[1])[0]
    return {
        "w": w, "h": h,
        "left": left, "top": top,
        "right": right, "bottom": bottom,
        "head_side": head_side, "head_clear": head_clear,
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
        # Scored on the HEAD END. min of four edges scored the tail too,
        # which the crop deliberately trims (F190), so it flagged 93.7%.
        worst = m["head_clear"]
        which = m["head_side"]
        rows.append((code, worst, which, m))

    rows.sort(key=lambda r: r[1])
    flagged = [r for r in rows if r[1] < TIGHT]

    print(f"icons measured : {len(rows)}   unreadable: {len(errs)}")
    print(f"edge threshold : {TIGHT:.2f} of the side (square-icons.EDGE_MARGIN)")
    print(f"FLAGGED        : {len(flagged)}  ({100.0*len(flagged)/max(1,len(rows)):.1f}%)")
    print()

    # ---- THE CONTROL --------------------------------------------------------
    print("CONTROL - five owner-reported defects without dedicated landmark guards:")
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
    # ⚠️ AND HOW LIKELY THAT IS BY ACCIDENT. A control that reports only its
    # hit count cannot tell you whether it has any power: the previous version
    # of this audit flagged **93.7% of all 1,289 icons** and caught 6 of 6,
    # which sounds like vindication and has a **0.677** probability of
    # happening at random. It was measuring nothing and saying so confidently.
    #
    # Printing the by-chance probability makes that impossible to miss, and it
    # is the same rule as F244's: a control must be scored against a property
    # the thing under test cannot trivially satisfy.
    rate = len(flagged) / max(1, len(rows))
    n_rep = sum(1 for c in REPORTED if any(x[0] == c for x in rows))
    p = sum(_choose(n_rep, i) * rate ** i * (1 - rate) ** (n_rep - i)
            for i in range(hit, n_rep + 1))
    verdict = ("NO POWER - it would look this good by accident" if p > 0.25
               else "weak but real evidence" if p > 0.01
               else "strong evidence")
    print(f"  -> at a {100.0*rate:.1f}% flag rate that happens by chance with "
          f"p = {p:.3f}  ({verdict})")
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
