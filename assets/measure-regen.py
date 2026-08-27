"""Does regenerating from the ORIGINALS actually save the head end?

The v1.41.1 head-protection has never run on a single icon, because
process() skips anything already square and every icon already is. So the
question is not "is the rule better" but "what does the rule DO when it finally
runs". Measured against head ends that were looked at.

Reports, per bird, how much clear frame the TRUE head end keeps, as a fraction
of the square's side. Negative means the bird is cut there.
"""
import os, sys, importlib.util
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    "sq", os.path.join(HERE, "square-icons.py"))
sq = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sq)

SRC = sys.argv[1]
TRUTH = {  # looked at 2026-08-26
    "baleag": "L", "bongul": "R", "caster1": "L", "comloo": "L", "comter": "L",
    "eleter1": "R", "gresca": "L", "marmur": "R", "norpin": "L", "parjae": "R",
    "pelcor": "L", "renpha": "L", "wesgre": "L",
}

print(f"{'bird':9} {'truth':5} {'chose':5} {'TRUE head margin':>17}  verdict")
cut = ok = 0
for name, truth in sorted(TRUTH.items()):
    hit = [f for f in os.listdir(SRC) if os.path.splitext(f)[0] == name]
    if not hit:
        continue
    im = Image.open(os.path.join(SRC, hit[0])).convert("RGB")
    w, h = im.size
    if w < h:
        continue
    a = sq.analyse(im)
    box = sq.square_box(w, h, a, hit[0])
    side = min(w, h)
    bx0, bx1 = a["box"][0] * w, a["box"][2] * w
    hxp = a["head"][0] * w
    chose = "L" if (hxp - bx0) <= (bx1 - hxp) else "R"
    # margin at the TRUE head end, not the chosen one
    m = (bx0 - box[0]) / side if truth == "L" else (box[2] - bx1) / side
    if m < 0.01:
        cut += 1
        verdict = "CUT"
    else:
        ok += 1
        verdict = ""
    print(f"{name:9} {truth:5} {chose:5} {m:17.3f}  {verdict}")
print(f"\ntrue head end cut: {cut} of {cut + ok}")
