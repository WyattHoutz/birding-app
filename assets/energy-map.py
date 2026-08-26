#!/usr/bin/env python3
"""Render the ENERGY MAP itself, so the thing driving the crop can be seen.

The crop is only ever as good as `_energy`. When a crop is wrong the question
is always "what did it think was the bird?", and that is not answerable from
head_cut or kept — both are computed downstream of the same map.

Emits, per icon, a row of: original | colour-distance | gradient | combined.
"""

import os
import sys

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps, ImageStat

CELL = 190
LONG = 160


def bg_distance(rgb):
    w, h = rgb.size
    edge = max(1, min(w, h) // 12)
    strips = Image.new('RGB', (max(w, h), 4 * edge))
    strips.paste(rgb.crop((0, 0, w, edge)), (0, 0))
    strips.paste(rgb.crop((0, h - edge, w, h)), (0, edge))
    strips.paste(rgb.crop((0, 0, edge, h)).rotate(90, expand=True), (0, 2 * edge))
    strips.paste(rgb.crop((w - edge, 0, w, h)).rotate(90, expand=True), (0, 3 * edge))
    med = ImageStat.Stat(strips).median
    bg = Image.new('RGB', (w, h), (med[0], med[1], med[2]))
    d = ImageChops.difference(rgb, bg).convert('L')
    return d.point(lambda v: min(255, int(v * 1.6)))


def maps(path):
    with Image.open(path) as im:
        rgb = im.convert('RGB')
    w, h = rgb.size
    s = LONG / max(w, h)
    if s < 1:
        rgb = rgb.resize((max(1, int(w * s)), max(1, int(h * s))), Image.BILINEAR)
    dist = bg_distance(rgb)
    grad = ImageOps.grayscale(rgb).filter(ImageFilter.FIND_EDGES)
    lighter = ImageChops.lighter(dist, grad)
    d = np.asarray(dist, dtype=np.float64)
    g = np.asarray(grad, dtype=np.float64)
    prod = np.clip(d * g / 255.0, 0, 255)
    gated = np.clip(np.maximum(d, g) * (d / 255.0), 0, 255)
    out = [rgb, dist, grad, lighter,
           Image.fromarray(prod.astype('uint8')),
           Image.fromarray(gated.astype('uint8'))]
    return out


LABELS = ['original', 'bg-distance', 'gradient', 'max (now)',
          'dist x grad', 'max gated by dist']


def main():
    src, out = sys.argv[1], sys.argv[2]
    names = sys.argv[3:]
    rows = []
    for nm in names:
        p = os.path.join(src, nm)
        rows.append((nm, maps(p)))
    ncol = len(LABELS)
    sheet = Image.new('RGB', (CELL * ncol + 10, (CELL + 20) * len(rows) + 20),
                      (255, 255, 255))
    d = ImageDraw.Draw(sheet)
    for c, lab in enumerate(LABELS):
        d.text((c * CELL + 8, 4), lab, fill=(0, 0, 0))
    for r, (nm, ims) in enumerate(rows):
        y = 20 + r * (CELL + 20)
        for c, im in enumerate(ims):
            t = im.convert('RGB').copy()
            t.thumbnail((CELL - 8, CELL - 8), Image.LANCZOS)
            sheet.paste(t, (c * CELL + 6, y))
        d.text((6, y + CELL - 4), nm, fill=(0, 0, 0))
    sheet.save(out)
    print(out, sheet.size)


if __name__ == '__main__':
    main()
