"""Measure the head-end margin before and after the F190 change.

Not a guess: for each reported icon this runs the REAL analyse()/square_box()
at HEAD_PAD = 0 (the shipped behaviour) and at the candidate value, and reports
how much clear frame the subject's head-end extremity keeps, as a fraction of
the square's side. Negative means the bird is cut.
"""
import os, sys, importlib.util
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "sq", os.path.join(HERE, "square-icons.py"))
sq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sq)

SRC = sys.argv[1]
REPORTED = {
    "comloo": "head", "comter": "beak", "parjae": "beak", "baleag": "tail",
    "brncre": "tail", "cangoo": "head", "bongul": "beak", "caster1": "beak",
    "killde": "tail", "marmur": "head", "pelcor": "head", "renpha": "head",
    "norpin": "head", "westan": "head",
    "gresca": "OK", "wesgre": "OK", "eleter1": "OK",
}


def head_margin(path, pad):
    sq.HEAD_PAD = pad
    im = Image.open(path).convert("RGB")
    w, h = im.size
    if w == h:
        return None
    a = sq.analyse(im)
    box = sq.square_box(w, h, a, os.path.basename(path))
    side = min(w, h)
    bx0, by0, bx1, by1 = a["box"]
    hx, hy = a["head"]
    if w >= h:
        hxp, l, r = hx * w, box[0], box[2]
        if (hxp - bx0 * w) <= (bx1 * w - hxp):
            return (bx0 * w - l) / side          # clear frame left of the beak
        return (r - bx1 * w) / side
    return (by0 * h - box[1]) / side             # clear frame above the crown


rows = []
for name, kind in REPORTED.items():
    hit = [f for f in os.listdir(SRC) if os.path.splitext(f)[0] == name]
    if not hit:
        continue
    p = os.path.join(SRC, hit[0])
    before = head_margin(p, 0.0)
    after = head_margin(p, 0.05)
    if before is None:
        continue
    rows.append((name, kind, before, after))

print(f"{'bird':10} {'reported':9} {'before':>8} {'after':>8}  verdict")
cut_before = cut_after = 0
for name, kind, b, a in sorted(rows, key=lambda r: r[2]):
    if b < 0.01:
        cut_before += 1
    if a < 0.01:
        cut_after += 1
    flag = "FIXED" if (b < 0.01 <= a) else ("still tight" if a < 0.01 else "ok")
    print(f"{name:10} {kind:9} {b:8.3f} {a:8.3f}  {flag}")
print(f"\ntouching the frame at the head end: before={cut_before} after={cut_after} "
      f"of {len(rows)} measured")
