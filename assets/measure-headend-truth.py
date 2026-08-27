"""F190: score head-end rules against GROUND TRUTH THAT WAS LOOKED AT.

The previous attempt derived its labels from which end the shipped crop cut,
which is a function of the algorithm under test. Those labels turned out to be
WRONG FOR 5 OF 13 when the images were actually examined -- so the experiment
was not merely weak, it was measuring the wrong thing.

These labels come from viewing the images. Landscape birds only; the two
portrait ones (cangoo, westan) are the vertical case and are handled by a
different branch of square_box.
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
# LOOKED AT, 2026-08-26. Which side of the frame the bill/head is on.
TRUTH = {
    "baleag": "L",    # perched, yellow bill at left
    "bongul": "R",    # in flight, bill pointing right
    "caster1": "L",   # standing, orange bill left
    "comloo": "L",    # swimming, head and bill left
    "comter": "L",    # standing, red bill left
    "eleter1": "R",   # group of terns, bills right
    "gresca": "L",    # swimming, bill left
    "marmur": "R",    # on water, head right
    "norpin": "L",    # pair, brown head left
    "parjae": "R",    # on water, head right
    "pelcor": "L",    # in flight, bill left
    "renpha": "L",    # wading, bill left
    "wesgre": "L",    # swimming, yellow bill left
}


def stats(im, a):
    e = np.asarray(sq._energy(im), dtype=np.float64)
    h, w = e.shape
    x0, y0, x1, y1 = a["box"]
    px0, px1 = int(x0 * w), min(w, int(x1 * w) + 1)
    py0, py1 = int(y0 * h), min(h, int(y1 * h) + 1)
    sub = e[py0:py1, px0:px1]
    if sub.size == 0:
        return None
    n = sub.shape[1]
    k = max(1, n // 3)
    out = {}
    for nm, blk in (("L", sub[:, :k]), ("R", sub[:, -k:])):
        cols, rows = blk.sum(axis=0), blk.sum(axis=1)
        tot = rows.sum()
        if tot:
            c = np.cumsum(rows) / tot
            depth = (int(np.searchsorted(c, .95)) - int(np.searchsorted(c, .05))
                     + 1) / float(blk.shape[0])
        else:
            depth = 1.0
        out[nm] = {"peak": float(cols.max()) if cols.size else 0.,
                   "mass": float(blk.sum()), "depth": depth}
    return out


RULES = {
    "always L (control)":  lambda s, sh: "L",
    "always R (control)":  lambda s, sh: "R",
    "centroid (shipped)":  lambda s, sh: sh,
    "higher peak energy":  lambda s, sh: "L" if s["L"]["peak"] > s["R"]["peak"] else "R",
    "more mass":           lambda s, sh: "L" if s["L"]["mass"] > s["R"]["mass"] else "R",
    "slender end":         lambda s, sh: "L" if s["L"]["depth"] < s["R"]["depth"] else "R",
    "less mass (taper)":   lambda s, sh: "L" if s["L"]["mass"] < s["R"]["mass"] else "R",
}
score = {k: 0 for k in RULES}
n = 0
hdr = f"{'bird':9} {'truth':5} " + " ".join(f"{k[:9]:>9}" for k in RULES)
print(hdr)
for name, truth in sorted(TRUTH.items()):
    hit = [f for f in os.listdir(SRC) if os.path.splitext(f)[0] == name]
    if not hit:
        continue
    im = Image.open(os.path.join(SRC, hit[0])).convert("RGB")
    w, h = im.size
    if w < h:
        continue
    a = sq.analyse(im)
    s = stats(im, a)
    if not s:
        continue
    n += 1
    bx0, bx1, hxp = a["box"][0] * w, a["box"][2] * w, a["head"][0] * w
    sh = "L" if (hxp - bx0) <= (bx1 - hxp) else "R"
    cells = []
    for k, fn in RULES.items():
        v = fn(s, sh)
        if v == truth:
            score[k] += 1
        cells.append(f"{v:>9}")
    print(f"{name:9} {truth:5} " + " ".join(cells))
print(f"\nover {n} birds whose head end was LOOKED AT:")
for k, v in sorted(score.items(), key=lambda kv: -kv[1]):
    print(f"  {k:22} {v:>2}/{n}")
