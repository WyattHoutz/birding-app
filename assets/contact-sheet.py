#!/usr/bin/env python3
"""Build a contact sheet of ORIGINAL beside CROP so the crops can be LOOKED AT.

WHY THIS EXISTS
---------------
`square-icons.py` reports head_cut and kept, and both are derived from the same
head anchor the crop used.  When the anchor is wrong the numbers agree with
each other and are both wrong: fotfly cropped to lawn and two tail wires and
scored head_cut 0.000.  A number computed from a decision cannot audit that
decision.

So the audit is a human eye on a grid.  Each cell is the original with the crop
window drawn on it, next to the crop itself, labelled with the file name.

Usage:  python assets/contact-sheet.py <src-dir> <out.png> name1 name2 ...
        python assets/contact-sheet.py <src-dir> <out.png> --worst 24
"""

import os
import sys
import json
import glob
import importlib.util

from PIL import Image, ImageDraw

_spec = importlib.util.spec_from_file_location(
    'sqicons', os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            'square-icons.py'))
sq = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(sq)

CELL = int(os.environ.get('SHEET_CELL', '200'))
PAD = 6
COLS = int(os.environ.get('SHEET_COLS', '4'))


def cell(path):
    with Image.open(path) as im:
        im = im.convert('RGB')
        w, h = im.size
        if abs(w - h) <= 1:
            box = (0, 0, w, h)
            a = {'box': (0, 0, 1, 1), 'head': (0.5, 0.5)}
        else:
            a = sq.analyse(im)
            box = sq.square_box(w, h, a, os.path.basename(path))
        crop = im.crop(box)

        # left: original, crop window outlined, head anchor marked
        orig = im.copy()
        d = ImageDraw.Draw(orig)
        lw = max(2, int(min(w, h) * 0.012))
        d.rectangle(box, outline=(0, 114, 178), width=lw)          # blue box
        hx, hy = a['head'][0] * w, a['head'][1] * h
        r = max(3, int(min(w, h) * 0.03))
        d.ellipse((hx - r, hy - r, hx + r, hy + r),
                  outline=(230, 159, 0), width=lw)                 # orange head
        bx = (a['box'][0] * w, a['box'][1] * h,
              a['box'][2] * w, a['box'][3] * h)
        d.rectangle(bx, outline=(0, 0, 0), width=max(1, lw // 2))  # black subj

        orig.thumbnail((CELL, CELL), Image.LANCZOS)
        crop.thumbnail((CELL, CELL), Image.LANCZOS)
    return orig, crop


def main():
    src, out = sys.argv[1], sys.argv[2]
    rest = sys.argv[3:]
    if rest and rest[0] in ('--worst', '--rival'):
        key = rest[0]
        n = int(rest[1])
        rep = rest[2]
        skip = int(rest[3]) if len(rest) > 3 else 0
        rows = [r for r in json.load(open(rep)) if not r.get('already_square')]
        if key == '--rival':
            rows.sort(key=lambda r: -r.get('rival', 0))
        else:
            rows.sort(key=lambda r: (r.get('kept', 1), -r.get('head_cut', 0)))
        names = [r['file'] for r in rows[skip:skip + n]]
    else:
        names = []
        for a in rest:
            names += [os.path.basename(p) for p in glob.glob(os.path.join(src, a))] \
                if ('*' in a or '?' in a) else [a]

    cells = []
    for nm in names:
        p = os.path.join(src, nm)
        if not os.path.exists(p):
            for e in ('.jpg', '.jpeg', '.png'):
                if os.path.exists(p + e):
                    p = p + e
                    break
        if not os.path.exists(p):
            print('missing', nm)
            continue
        cells.append((nm, cell(p)))

    cw = CELL * 2 + PAD * 3
    ch = CELL + PAD * 2 + 16
    rows_n = (len(cells) + COLS - 1) // COLS
    sheet = Image.new('RGB', (cw * COLS, ch * rows_n), (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    for i, (nm, (orig, crop)) in enumerate(cells):
        ox, oy = (i % COLS) * cw, (i // COLS) * ch
        sheet.paste(orig, (ox + PAD, oy + PAD))
        sheet.paste(crop, (ox + PAD * 2 + CELL, oy + PAD))
        d.text((ox + PAD, oy + CELL + PAD + 2), nm, fill=(0, 0, 0))
    sheet.save(out)
    print(f'{out}  {len(cells)} cells  {sheet.size[0]}x{sheet.size[1]}')


if __name__ == '__main__':
    main()
