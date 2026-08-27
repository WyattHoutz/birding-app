"""F190: is the HEAD END being chosen correctly at all?

The shipped measurement (measure-headpad.py) asks `square_box` about the end
`square_box` itself chose -- both use the same `hx` side test. If the anchor
lands mid-body and the side test picks the TAIL, then the crop protects the
tail and the measurement measures the tail, and it reports a healthy margin
while the beak is on the frame. That is exactly the contradiction on file:
comter 0.100, caster1 0.112 and parjae 0.079 all "healthy", all still cut.

So measure BOTH ends independently, and check the chosen end against the
ground truth the owner supplied.
"""
import os, sys, importlib.util
import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "sq", os.path.join(HERE, "square-icons.py"))
sq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sq)

SRC = sys.argv[1]
# Ground truth from the owner's screenshots. "head"/"beak" mean the HEAD end
# was cut; "tail" means the tail end was; "OK" means neither.
REPORTED = {
    "comloo": "head", "comter": "beak", "parjae": "beak", "baleag": "tail",
    "brncre": "tail", "cangoo": "head", "bongul": "beak", "caster1": "beak",
    "killde": "tail", "marmur": "head", "pelcor": "head", "renpha": "head",
    "norpin": "head", "westan": "head",
    "gresca": "OK", "wesgre": "OK", "eleter1": "OK",
}


def peak_x(im, a):
    """Head anchor by PEAK of the top band rather than by centroid."""
    e = np.asarray(sq._energy(im), dtype=np.float64)
    h, w = e.shape
    x0, y0, x1, y1 = a["box"]
    bx0, by0, bx1, by1 = a["body"]
    hy0 = max(int(y0 * h), int(by0 * h))
    hy1 = max(hy0 + 1, min(int(y1 * h) + 1, int(by1 * h)))
    hx0 = max(int(x0 * w), int(bx0 * w))
    hx1 = max(hx0 + 1, min(int(x1 * w) + 1, int(bx1 * w)))
    band_hi = min(hy1, hy0 + max(1, int((hy1 - hy0) * sq.TOP_BAND)))
    prof = e[hy0:band_hi, hx0:hx1].sum(axis=0)
    if prof.size < 3 or not prof.sum():
        return None
    k = max(1, prof.size // 12)
    sm = np.convolve(prof, np.ones(k) / k, mode="same")
    return (hx0 + int(np.argmax(sm))) / float(w)


print(f"{'bird':9} {'truth':6} {'chose':6} {'headend':>8} {'tailend':>8} "
      f"{'peak':6} verdict")
wrong = agree = 0
for name, kind in sorted(REPORTED.items()):
    hit = [f for f in os.listdir(SRC) if os.path.splitext(f)[0] == name]
    if not hit:
        continue
    im = Image.open(os.path.join(SRC, hit[0])).convert("RGB")
    w, h = im.size
    if w == h:
        continue
    a = sq.analyse(im)
    box = sq.square_box(w, h, a, hit[0])
    side = min(w, h)
    bx0, bx1 = a["box"][0] * w, a["box"][2] * w
    hxp = a["head"][0] * w
    chose = "LEFT" if (hxp - bx0) <= (bx1 - hxp) else "RIGHT"
    if w >= h:
        left_margin = (bx0 - box[0]) / side
        right_margin = (box[2] - bx1) / side
    else:
        left_margin = (a["box"][1] * h - box[1]) / side       # top
        right_margin = (box[3] - a["box"][3] * h) / side      # bottom
        chose = "TOP"
    px = peak_x(im, a)
    pchose = "-"
    if px is not None and w >= h:
        pxp = px * w
        pchose = "LEFT" if (pxp - bx0) <= (bx1 - pxp) else "RIGHT"
    flips = (pchose != "-" and pchose != chose)
    if flips:
        wrong += 1
    else:
        agree += 1
    print(f"{name:9} {kind:6} {chose:6} {left_margin:8.3f} {right_margin:8.3f} "
          f"{pchose:6} {'FLIPS' if flips else ''}")
print(f"\ncentroid and peak choose the same end for {agree}, differ for {wrong}")
