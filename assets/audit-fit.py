"""Which birds CANNOT show head and tail in a square icon, at any crop?

Purely geometric, and that is the point: it needs only the SUBJECT EXTENT, not
the head anchor, which was measured unreliable (it lands on the back of
horizontal birds). If the subject is longer along the cropped axis than the
square side, then no choice of crop keeps the whole bird - something must be
lost. That is a fact about the SOURCE, not about the rule.

  wide source (w>h): the crop slides horizontally, side = h.
                     subject wider than h  -> head or tail must go.
  tall source (h>w): the crop slides vertically, side = w.
                     subject taller than w -> head or tail must go.

    python assets/audit-fit.py [--sheet out.png] [--top N]
"""
from __future__ import annotations
import importlib.util, os, sys
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("si", os.path.join(HERE, "square-icons.py"))
S = importlib.util.module_from_spec(spec); spec.loader.exec_module(S)
SRC = r"C:\Users\wyhoutz\source\repos\birding\assets\birds-src"

def main(argv):
    sheet = argv[argv.index("--sheet")+1] if "--sheet" in argv else None
    topn  = int(argv[argv.index("--top")+1]) if "--top" in argv else 24

    rows, square, err = [], 0, 0
    files = sorted(f for f in os.listdir(SRC) if f.lower().endswith((".jpg",".jpeg",".png")))
    for f in files:
        try:
            with Image.open(os.path.join(SRC,f)) as im:
                im=im.convert("RGB"); w,h=im.size; a=S.analyse(im)
        except Exception:
            err+=1; continue
        if abs(w-h)<=1:
            square+=1; continue                     # no crop happens at all
        x0,y0,x1,y1 = a["box"]
        side = min(w,h)
        if w>h:  extent, axis = (x1-x0)*w, "horizontal"
        else:    extent, axis = (y1-y0)*h, "vertical"
        rows.append((extent/side, os.path.splitext(f)[0], f, w, h, axis, extent, side))

    rows.sort(reverse=True)
    cannot = [r for r in rows if r[0] > 1.0]
    print(f"non-square sources measured : {len(rows)}   (square/no-op: {square}, unreadable: {err})")
    print(f"CANNOT fit head+tail in a square: {len(cannot)}  ({100.0*len(cannot)/max(1,len(rows)):.1f}%)")
    print("  ratio > 1.0 means the bird is longer than the square side, so a square icon MUST lose an end.\n")
    print(f"{'code':10}{'ratio':>7}  {'axis':11}{'subject px':>11}{'side px':>9}   source")
    for ratio,code,f,w,h,axis,ext,side in rows[:topn]:
        print(f"{code:10}{ratio:7.2f}  {axis:11}{ext:11.0f}{side:9.0f}   {w}x{h}")

    if sheet and cannot:
        n = min(topn, len(cannot))
        CELL, PAD, LAB = 250, 12, 30
        cols = 3
        rws = (n + cols - 1)//cols
        img = Image.new("RGB",(PAD+cols*(CELL+PAD), PAD+rws*(CELL+LAB+PAD)),"white")
        d = ImageDraw.Draw(img)
        for i,(ratio,code,f,w,h,axis,ext,side) in enumerate(cannot[:n]):
            cx = PAD + (i%cols)*(CELL+PAD); cy = PAD + (i//cols)*(CELL+LAB+PAD)
            d.text((cx,cy+3), f"{code}  {ratio:.2f}x too long", fill="black")
            d.text((cx,cy+16), f"{axis}  {w}x{h}", fill="#555")
            with Image.open(os.path.join(SRC,f)) as im:
                im=im.convert("RGB"); big=im.copy(); dd=ImageDraw.Draw(big)
                a=S.analyse(im); bx=a["box"]
                dd.rectangle([bx[0]*w,bx[1]*h,bx[2]*w-1,bx[3]*h-1],outline=(0,158,115),width=3)
                box=S.square_box(w,h,a,code)
                dd.rectangle([box[0],box[1],box[2]-1,box[3]-1],outline=(0,114,178),width=3)
                big.thumbnail((CELL,CELL)); img.paste(big,(cx,cy+LAB))
        img.save(sheet)
        print(f"\nwrote {sheet}  ({n} birds)  green = detected subject, blue = square crop chosen")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv))
