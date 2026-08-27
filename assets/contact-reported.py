"""Contact sheet for the icons the owner reported, so head/tail can be LABELLED.

F190 scored its crop rule against 13 icons out of 1,290 and the owner has since
reported 12 more by eye. Every automated detector tried here has been unusable
(the margin audit flags 93.8% and produced false positives on bkcchi and
comcra), so the ground truth has to come from looking.

Each row shows the ORIGINAL with the crop window the algorithm chose drawn on
it, the head anchor it believes in, and the SHIPPED result beside it. That is
enough to say, per bird, whether the anchor or the source is at fault.

    python assets/contact-reported.py [out.png]
"""
from __future__ import annotations
import importlib.util, os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("si", os.path.join(HERE, "square-icons.py"))
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)

SRC  = r"C:\Users\wyhoutz\source\repos\birding\assets\birds-src"
SHIP = os.path.join(os.path.dirname(HERE), "www", "assets", "birds")

REPORTED = [
    ("glwgul",  "head cut off"),
    ("killde",  "tail cropped"),
    ("comloo",  "head still cropped"),
    ("brdowl",  "not centered"),
    ("baleag",  "tail still trimmed (REPEAT)"),
    ("shshaw",  "head too close to top"),
    ("batpig1", "head cropped"),
    ("brncre",  "tail cropped (REPEAT)"),
    ("pelcor",  "cropped"),
    ("redcro",  "two birds, both cropped"),
    ("rocpig",  "cropped"),
    ("vauswi",  "subject far too tiny"),
]

CELL, PAD, LABEL = 260, 14, 34


def find(d, code):
    for f in sorted(os.listdir(d)):
        if os.path.splitext(f)[0] == code:
            return os.path.join(d, f)
    return None


def main(argv):
    out_path = argv[1] if len(argv) > 1 else os.path.join(HERE, "reported-icons.png")
    rows = len(REPORTED)
    W = PAD * 3 + CELL * 2
    H = PAD + rows * (CELL + LABEL + PAD)
    sheet = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(sheet)

    y = PAD
    for code, why in REPORTED:
        sp, hp = find(SRC, code), find(SHIP, code)
        d.text((PAD, y + 4), f"{code}  -  {why}", fill="black")
        d.text((PAD, y + 18), "left: ORIGINAL + chosen crop (box) + head anchor (cross)   right: SHIPPED", fill="#555")
        top = y + LABEL

        if sp:
            with Image.open(sp) as im:
                im = im.convert("RGB"); w, h = im.size
                a = S.analyse(im)
                box = S.square_box(w, h, a, code)
                big = im.copy()
                dd = ImageDraw.Draw(big)
                # the crop the algorithm chose
                dd.rectangle([box[0], box[1], box[2] - 1, box[3] - 1], outline=(0, 114, 178), width=3)
                # the head anchor it believes in
                hx, hy = a["head"][0] * w, a["head"][1] * h
                dd.line([hx - 12, hy, hx + 12, hy], fill=(230, 159, 0), width=3)
                dd.line([hx, hy - 12, hx, hy + 12], fill=(230, 159, 0), width=3)
                # the subject box it detected
                bx = a["box"]
                dd.rectangle([bx[0] * w, bx[1] * h, bx[2] * w - 1, bx[3] * h - 1],
                             outline=(0, 158, 115), width=1)
                big.thumbnail((CELL, CELL))
                sheet.paste(big, (PAD, top))
        if hp:
            with Image.open(hp) as im:
                im = im.convert("RGB"); im.thumbnail((CELL, CELL))
                sheet.paste(im, (PAD * 2 + CELL, top))
        y = top + CELL + PAD

    sheet.save(out_path)
    print(f"wrote {out_path}  ({sheet.size[0]}x{sheet.size[1]}, {rows} birds)")
    print("blue box = crop chosen | orange cross = head anchor | green box = detected subject")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
