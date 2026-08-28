"""Would a species-aware margin help? Score the detector against ground truth.

The proposal: look up each bird's bill length relative to its head and use
that to set the crop margin, instead of the fixed HEAD_PAD constant.

That only pays off if the residual error is a MARGIN error - the anchor is
in the right place and the pad is the wrong size. It pays nothing if the
error is a DIRECTION error, where the head anchor has landed at the wrong
end of the photo entirely, because a bigger margin around the wrong point
is still the wrong point.

We can now tell those apart, because 26 owner-drawn slides exist. This
scores the automatic placement against each one and splits the error:

    |auto - drawn| > 0.5   the window is more than half the slide range
                           away - a different part of the bird, or the
                           wrong end. A margin cannot fix this.
    0.15 .. 0.5            substantially misplaced.
    <= 0.15                close; the kind of gap a better margin could
                           plausibly close.

HEAD_PAD is already measured: F190 found head-end losses fell 7/13 -> 4/13
going from 0 to 0.05, and 0.10 bought nothing further. So the pad is near
its useful ceiling already, and this asks what the remaining error IS.
"""
import importlib.util as u
import os
import sys

from PIL import Image

SRC = r"C:\Users\wyhoutz\source\repos\birding\assets\birds-src"
SI = os.path.join(os.path.dirname(os.path.abspath(__file__)), "square-icons.py")

spec = u.spec_from_file_location("si", SI)
m = u.module_from_spec(spec)
spec.loader.exec_module(m)

drawn = dict(m.OVERRIDES)
# Turn the overrides OFF so the automatic answer is what we measure. This is
# the control: with them on, the algorithm would simply return the owner's own
# number and score a perfect zero, which would prove nothing at all.
m.OVERRIDES = {}

rows = []
for name, want in sorted(drawn.items()):
    path = os.path.join(SRC, name)
    if not os.path.exists(path):
        print(f"  {name}: source missing")
        continue
    with Image.open(path) as im:
        im2 = im.convert("RGB") if im.mode not in ("RGB", "L") else im
        w, h = im2.size
        if abs(w - h) <= 1:
            continue
        a = m.analyse(im2)
        box = m.square_box(w, h, a, name)
    side = min(w, h)
    rng = (w - side) if w >= h else (h - side)
    got = (box[0] / rng) if (w >= h and rng) else ((box[1] / rng) if rng else 0.0)
    rows.append((name, want, got, abs(want - got)))

rows.sort(key=lambda r: -r[3])
big = [r for r in rows if r[3] > 0.5]
mid = [r for r in rows if 0.15 < r[3] <= 0.5]
small = [r for r in rows if r[3] <= 0.15]

print(f"{'bird':16s} {'drawn':>7s} {'auto':>7s} {'error':>7s}")
print("-" * 42)
for name, want, got, err in rows:
    print(f"{name:16s} {want:7.3f} {got:7.3f} {err:7.3f}")

n = len(rows)
print(f"\nscored {n} birds with owner-drawn ground truth\n")
print(f"  DIRECTION-scale error  (> 0.50) : {len(big):2d}  "
      f"({len(big)/n:.0%})  a margin cannot fix these")
print(f"  substantial      (0.15 - 0.50)  : {len(mid):2d}  ({len(mid)/n:.0%})")
print(f"  close            (<= 0.15)      : {len(small):2d}  "
      f"({len(small)/n:.0%})  a better margin might close these")
print(f"\n  median error : {sorted(r[3] for r in rows)[n // 2]:.3f}")
print(f"  mean error   : {sum(r[3] for r in rows) / n:.3f}")
