#!/usr/bin/env python3
"""Square every bird icon, keeping the HEAD.

WHY THIS EXISTS
---------------
The icons are Wikimedia thumbnails at a fixed 240-250px width and whatever
height the original had.  `.thumb .birdpic` is `object-fit: contain` over
`.thumb`'s #eceff3 background, so a non-square photo letterboxes and the grey
bars read as a border drawn round every bird.

MEASURED before touching anything: of 1,288 icons, 966 are landscape and 238
portrait; only 84 are already square.  The median icon loses 28.6% of the slot
to grey, and 1,000 of them lose more than 20%.  So it is not a border and it
was never drawn - it is the shape of the source photo.

A SQUARE icon cannot letterbox, whatever `object-fit` says.  That is the whole
fix, and it needs no CSS change to work.

WHY NOT JUST object-fit: cover
------------------------------
`cover` crops from the CENTRE, and a bird's head is almost never in the centre
of its photo.  That is precisely the crop that decapitates.  Cropping here
instead means the decision can be made per bird, and checked.

FINDING THE HEAD
----------------
There is no ML here and none is claimed.  The estimate is:

  1. downscale to 160px on the long side, greyscale
  2. gradient magnitude - the bird is the detailed part, the sky/water is not
  3. subject box = the smallest window holding CENTRAL_MASS of that energy
  4. the head anchor is the energy centroid of the TOP BAND of the subject box

Step 4 is the assumption, stated plainly: a perched, standing, swimming or
wading bird carries its head at the top of its own silhouette.  It is wrong for
a bird in flight seen from below, and for a head-down feeding posture.  Those
are what the verification pass is for - it re-measures the CROP and reports
every icon whose anchor ends up near an edge, so they can be looked at rather
than assumed.

THE RULE WHEN IT DOES NOT FIT
-----------------------------
"If you must crop part of the bird, do not crop the head."  So the window is
placed to contain the anchor with a margin, and when the subject is longer than
the frame the loss is taken from the far end - the tail - never the head end.
"""

import os
import sys
import glob
import json

import numpy as np
from PIL import Image, ImageChops, ImageFilter, ImageOps, ImageStat

# The fraction of gradient energy the subject box must contain.  Lower keeps
# only the most detailed core (risking a cropped tail); higher drags the box
# out to include background texture.  0.90 measured as a good middle on this
# corpus - see --report.
CENTRAL_MASS = 0.90

# How much of the subject box counts as "the head end" when locating the eye.
TOP_BAND = 0.35

# The anchor must sit at least this far inside the crop, as a fraction of the
# crop side, or the head is judged to be at risk of clipping.
EDGE_MARGIN = 0.10
# F190. How much clear frame the HEAD END of the subject box must keep, as a
# fraction of the square's side. EDGE_MARGIN guards the head ANCHOR (a point);
# this guards the bird's actual extremity, which is what was landing on the
# edge.
#
# MEASURED against the 17 icons the owner flagged, running the real
# analyse()/square_box() at 0.00 (shipped) and at 0.05:
#
#     touching the frame at the head end:  before 9  ->  after 4
#     fixed outright: comloo -0.003 -> 0.051, norpin 0.000 -> 0.048,
#                     renpha 0.001 -> 0.049, pelcor 0.002 -> 0.050,
#                     bongul 0.002 -> 0.049
#
# ⚠️ NOT a complete fix, and the residual is a DIFFERENT fault. baleag, brncre
# and killde stay at 0.000 -- but all three were reported as TAIL cuts, which
# this rule deliberately permits. marmur stays at 0.000 and is a real miss.
# More telling: comter (0.100), caster1 (0.112) and parjae (0.079) already had
# healthy head-end margins and were STILL reported as beaks cut. So for those
# the subject BOX is under-covering the extremity -- a thin beak against water
# falls below the energy threshold and the box stops at the head. That is a
# detection problem, not a placement one, and moving this number cannot fix it.
HEAD_PAD = 0.05

ANALYSIS_LONG_SIDE = 160

# ── PER-BIRD JUDGEMENTS ─────────────────────────────────────────────────────
# "Make a judgement for each bird icon... find any that cut off the head or
# bill of the head and crop them in a different way."
#
# The heuristic is good but it is a heuristic, and two icons were found by eye
# to have lost the bird.  Both are recorded here rather than patched into the
# scoring, because tuning a global rule to rescue two images is how the other
# 1,286 get quietly broken.
#
# The value is where the crop window sits in its slide range: 0.0 flush to the
# left (landscape) or top (portrait), 1.0 flush to the far end.
#
# Each entry states what was seen and why the automatic answer was wrong.
OVERRIDES = {
    # Yellow-billed Pintail lying in dry reeds.  The duck's plumage is the
    # same browns as the reed bed, so colour distance cannot separate them and
    # the reeds' texture wins on gradient; the window went right and kept
    # reeds while the yellow bill sat at the left edge.  rival 0.869.
    'yebpin1.jpg': 0.0,
    # A small dark bird in a leafy tree against pale sky.  Every part of the
    # foliage is far from the sky's colour AND highly textured, so the
    # foliage outscores a bird occupying ~2% of the frame.  The crop came back
    # as bare branches.  rival 0.887.
    #
    # ⚠️ FIRST OVERRIDE HERE WAS 0.0 AND WAS ALSO WRONG.  "Bird at the left"
    # was inferred from the crop having gone right, not from looking; at 3x
    # the whydah is at x=0.53 with its tail streaming to y=0.75.  Guessing the
    # opposite of a wrong answer is not the same as finding the right one.
    'topwhy1.jpeg': 0.55,
    # Yellow-green Vireo among bare twigs against blue sky.  Same shape as
    # topwhy1: the twigs are dark against bright sky, so they carry both the
    # colour distance and the gradient, and the bird is 4% of the frame.  The
    # window slid right and left the vireo on the edge.  Measured at 3x: bird
    # at x=0.42, y=0.44.
    'yegvir.jpg': 0.26,
    # Great Argus walking on leaf litter, tail streaming left across the whole
    # frame.  The fotfly archetype: a long tail lying over high-detail ground
    # gives the left half more contained energy than the bird does, so the
    # window took tail and litter and left the head outside.  rival 0.871.
    # Measured on a 3x grid: the blue face is at x=0.71, the tail runs back to
    # x=0.10.  0.70 puts the crop at x 0.35-0.85, which keeps the head with a
    # 14%-of-width margin and still carries half the tail, which is the part
    # that makes the bird recognisable.
    'grearg1.jpg': 0.70,
}


def _energy(im):
    """How much each pixel looks like BIRD rather than background.

    ⚠️ PURE GRADIENT WAS THE FIRST FLAW, AND max(dist, grad) WAS THE SECOND.
    Edge detection finds DETAIL, and a lawn has more detail per square inch
    than a bird does. The Fork-tailed Flycatcher survived three attempts —
    gradient peak, gradient mass, then the maximum of gradient and colour
    distance — because its tail streams across textured grass. The maximum
    fails for the reason a maximum always fails as a veto: where colour
    distance is zero the gradient still scores, so grass kept its vote. The
    crop came back as lawn and two wires with no bird in it.

    Rendering the maps (assets/energy-map.py) settled it by eye across fotfly,
    pifshe, amerob and baleag: distance must GATE detail, not sit beside it.

      energy = max(distance, gradient) x gate,  gate = distance / p98(distance)

      * DISTANCE FROM THE BACKGROUND COLOUR, sampled from the border ring —
        the one part of a wildlife photo that is almost never the animal. A
        dark flycatcher on green grass, a white tropicbird on blue sea and a
        yellow warbler in a bush are all far from their own background even
        where they carry no internal detail at all.
      * GRADIENT still does the work where a bird sits against plain sky and
        colour distance saturates over the whole silhouette.
      * THE GATE is what removes the lawn: grass IS the background colour, so
        its gate is ~0 however sharp it is.

    The gate is normalised by the image's own 98th percentile rather than by
    255, so a subtly-coloured subject against a similar background still gates
    to ~1 on itself instead of being crushed along with the background.
    """
    rgb = im.convert('RGB')
    w, h = rgb.size
    s = ANALYSIS_LONG_SIDE / max(w, h)
    if s < 1:
        rgb = rgb.resize((max(1, int(w * s)), max(1, int(h * s))), Image.BILINEAR)
    w, h = rgb.size

    # Median, not mean: a bird touching one edge should not drag the estimate
    # toward itself.
    edge = max(1, min(w, h) // 12)
    strips = Image.new('RGB', (max(w, h), 4 * edge))
    strips.paste(rgb.crop((0, 0, w, edge)), (0, 0))
    strips.paste(rgb.crop((0, h - edge, w, h)), (0, edge))
    strips.paste(rgb.crop((0, 0, edge, h)).rotate(90, expand=True), (0, 2 * edge))
    strips.paste(rgb.crop((w - edge, 0, w, h)).rotate(90, expand=True), (0, 3 * edge))
    med = ImageStat.Stat(strips).median
    bg = Image.new('RGB', (w, h), (med[0], med[1], med[2]))

    # Vectorised rather than looped in Python: this runs over ~1,300 images and
    # a per-pixel loop made each iteration of the heuristic a ten-minute wait,
    # which is how a measurement stops being run.
    dist = np.asarray(ImageChops.difference(rgb, bg).convert('L'),
                      dtype=np.float64) * 1.6
    grad = np.asarray(ImageOps.grayscale(rgb).filter(ImageFilter.FIND_EDGES),
                      dtype=np.float64)
    ref = np.percentile(dist, 98)
    gate = np.clip(dist / ref, 0.0, 1.0) if ref > 1 else np.ones_like(dist)
    return np.maximum(np.clip(dist, 0, 255), grad) * gate


def _span(profile, mass):
    """Smallest index range holding `mass` of the profile's total."""
    total = sum(profile)
    if total <= 0:
        return 0, len(profile) - 1
    want = total * mass
    best = (0, len(profile) - 1)
    best_len = len(profile)
    lo = 0
    run = 0.0
    for hi, v in enumerate(profile):
        run += v
        while run - profile[lo] >= want:
            run -= profile[lo]
            lo += 1
        if run >= want and (hi - lo) < best_len:
            best_len = hi - lo
            best = (lo, hi)
    return best


def _best_window(profile, side):
    """Start index of the `side`-wide window holding the most energy.

    This replaces a heuristic with an optimisation, and the difference matters.
    The previous rule asked "which END of the subject carries more mass?" and
    compared the outer quarters. It failed on fotfly for a reason worth
    recording: the bird perches on a WIRE that runs the whole frame, so both
    quarters were mostly wire, and the body's own peak (decile 2, 32,822 of
    182,000) fell OUTSIDE the left quarter, which stopped at x<0.21. The test
    compared wire with wire and picked the tail.

    A sliding window asks the question the crop actually poses — "which square
    holds the most bird?" — and cannot be fooled by where an arbitrary quarter
    boundary lands.
    """
    return _window_scores(profile, side)[0]


def _window_scores(profile, side):
    """(best start, best score, best RIVAL score at least half a side away).

    The rival is the ambiguity measure, and it is deliberately independent of
    whether the winner was right. When a bird sits at one end and a bank of
    foliage or reeds at the other, the two windows score almost the same and
    the choice is close to a coin toss — which is exactly how yebpin1 lost a
    pintail's head to a reed bed and topwhy1 cropped to bare branches.

    ⚠️ This is the check `head_cut` and `kept` could not be. Both are computed
    from the window that was chosen, so they agree with the choice by
    construction; reviewing the 24 worst by head_cut found the head in frame
    all 24 times. A rival score is about the road not taken.
    """
    n = len(profile)
    side = max(1, min(int(side), n))
    if side >= n:
        return 0, float(profile.sum()), 0.0
    scores = []
    run = float(profile[:side].sum())
    scores.append(run)
    for i in range(1, n - side + 1):
        run += float(profile[i + side - 1]) - float(profile[i - 1])
        scores.append(run)
    best_at = max(range(len(scores)), key=lambda i: scores[i])
    apart = max(1, side // 2)
    rivals = [s for i, s in enumerate(scores) if abs(i - best_at) >= apart]
    return best_at, scores[best_at], (max(rivals) if rivals else 0.0)


def analyse(im):
    """Subject box, body window and head anchor, in fractions of the image."""
    e = np.asarray(_energy(im), dtype=np.float64)
    h, w = e.shape
    cols = e.sum(axis=0)
    rows = e.sum(axis=1)
    x0, x1 = _span(cols, CENTRAL_MASS)
    y0, y1 = _span(rows, CENTRAL_MASS)

    # ── WHERE THE BIRD IS: the square window holding the most energy ────────
    # The crop is a square of the short side, so this is the actual choice the
    # cropper faces, asked directly.
    side = min(w, h)
    if w >= h:
        bw0, bscore, brival = _window_scores(cols, side)
        bw1 = bw0 + side
        wy0, wy1 = 0, h
    else:
        bw0, bw1 = 0, w
        wy0, bscore, brival = _window_scores(rows, side)
        wy1 = wy0 + side
    rival = (brival / bscore) if bscore else 0.0

    # ── THE HEAD, WITHIN THAT WINDOW ────────────────────────────────────────
    # Energy centroid of the TOP BAND of the subject box, but restricted to the
    # body window. The eye and bill are the highest-contrast small features a
    # bird has, and a perched, standing, swimming or wading bird carries its
    # head at the top of its own silhouette.
    #
    # ⚠️ RESTRICTING TO THE WINDOW IS THE FIX. Taken over the whole subject box
    # the band included a tail, a perch and a wire stretching off frame, and
    # the centroid landed between the bird and its own tail — on nothing.
    hy0 = max(y0, wy0)
    hy1 = max(hy0 + 1, min(y1 + 1, wy1))
    hx0 = max(x0, bw0)
    hx1 = max(hx0 + 1, min(x1 + 1, bw1))
    band_hi = min(hy1, hy0 + max(1, int((hy1 - hy0) * TOP_BAND)))
    band = e[hy0:band_hi, hx0:hx1]
    sw = band.sum()
    if sw:
        hx = float((band.sum(axis=0) * np.arange(hx0, hx1)).sum() / sw)
    else:
        hx = (hx0 + hx1 - 1) / 2.0
    hy = hy0 + (band_hi - hy0) / 2.0

    return {
        'box': (x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h),
        'body': (bw0 / w, wy0 / h, bw1 / w, wy1 / h),
        'head': (hx / w, hy / h),
        'rival': rival,
    }


def square_box(w, h, a, name=None):
    """Where to cut the square. Returns (left, top, right, bottom) in pixels."""
    side = min(w, h)
    hx, hy = a['head']
    wx0, wy0 = a['body'][0], a['body'][1]

    if name is not None and name in OVERRIDES:
        f = OVERRIDES[name]
        if w >= h:
            left = int(round(f * (w - side)))
            return (left, 0, left + side, side)
        top = int(round(f * (h - side)))
        return (0, top, side, top + side)

    if w >= h:
        # Full height; slide horizontally. Start from the window holding the
        # most bird, then lean toward the head so a bird that fills the window
        # is not trimmed at the wrong end.
        body_left = wx0 * w
        left = body_left * 0.65 + (hx * w - side / 2.0) * 0.35
        # THE RULE: the head keeps its margin whatever the body wants.
        lo = hx * w - side * (1 - EDGE_MARGIN)
        hi = hx * w - side * EDGE_MARGIN
        left = max(lo, min(hi, left))
        left = max(0, min(w - side, left))
        # F190: PROTECT THE HEAD END, LOSE THE TAIL. Owner's rule, 2026-08-26:
        # "better trim tail than head".
        #
        # EDGE_MARGIN above guards the head ANCHOR, which is a point roughly at
        # the centre of the head blob. A beak reaching past that centroid can
        # still land on the frame while the anchor sits a comfortable 10%
        # inside -- which is exactly what was reported for Common Tern,
        # Parasitic Jaeger, Bonaparte's Gull, Caspian Tern and Red-necked
        # Phalarope. So the SUBJECT BOX, not the anchor, is what must clear the
        # edge, and only at the head end: the other end is the tail and is
        # allowed to go.
        bx0, bx1 = a['box'][0] * w, a['box'][2] * w
        hxp = hx * w
        if (hxp - bx0) <= (bx1 - hxp):        # head nearer the LEFT extremity
            left = min(left, bx0 - HEAD_PAD * side)
        else:                                  # head nearer the RIGHT
            left = max(left, bx1 + HEAD_PAD * side - side)
        left = max(0, min(w - side, left))
        return (int(round(left)), 0, int(round(left)) + side, side)

    # Portrait: full width; slide vertically. Heads are up, so the top of the
    # subject is the thing to protect and the tail is what gets lost.
    top = a['box'][1] * h - side * 0.06        # a little air above the crown
    top = max(0, min(h - side, top))
    # ...unless that would push the head out of frame, which a head-down
    # posture can do.
    hi = hy * h - side * EDGE_MARGIN
    lo = hy * h - side * (1 - EDGE_MARGIN)
    top = max(lo, min(hi, top))
    # ...and never so far from the body window that the bird itself is missed.
    top = max(wy0 * h - side * 0.5, min(wy0 * h + side * 0.5, top))
    top = max(0, min(h - side, top))
    # F190: same rule on the vertical axis, and here the head end is simply UP.
    # Reported as "western tanager top of head", "canada geese head is cut off".
    # The crown sits ABOVE the head anchor, so a margin measured from the
    # anchor does not protect it; the subject box does. Whatever has to be lost
    # comes off the BOTTOM, which is the tail.
    top = min(top, a['box'][1] * h - HEAD_PAD * side)
    top = max(0, min(h - side, top))
    return (0, int(round(top)), side, int(round(top)) + side)


def crop_loss(w, h, crop, a):
    """How much of the subject is lost, and FROM WHICH END.

    ⚠️ The first version of this measured how far the head anchor sat from the
    crop edge — and it could not fail.  `square_box` clamps the anchor to
    EDGE_MARGIN, so measuring that margin afterwards asks the placement whether
    it did what it just did.  Measured over the whole corpus it returned a
    minimum of 0.137 against a margin of 0.10: 1,288 icons, not one flagged,
    because none could be.

    This measures what the placement does NOT control: whether the subject box
    runs off the edge, and whether the loss is at the head end or the tail end.
    Losing tail is allowed and often unavoidable.  Losing head is the failure
    the whole exercise exists to prevent.
    """
    bx0, by0, bx1, by1 = (a['box'][0] * w, a['box'][1] * h,
                          a['box'][2] * w, a['box'][3] * h)
    l, t, r, b = crop
    hx, hy = a['head'][0] * w, a['head'][1] * h

    if w >= h:
        span = max(1.0, bx1 - bx0)
        left_cut = max(0.0, l - bx0)
        right_cut = max(0.0, bx1 - r)
        # Which end is the head? Whichever the anchor sits nearer.
        head_is_left = abs(hx - bx0) <= abs(hx - bx1)
        head_cut = left_cut if head_is_left else right_cut
        tail_cut = right_cut if head_is_left else left_cut
    else:
        span = max(1.0, by1 - by0)
        head_cut = max(0.0, t - by0)      # heads up: the top is the head end
        tail_cut = max(0.0, by1 - b)
    return head_cut / span, tail_cut / span


def energy_kept(im, crop):
    """Fraction of the whole image's gradient energy that survives the crop.

    ⚠️ THIS EXISTS BECAUSE head_cut COULD NOT SEE A BIRDLESS CROP. When the
    head anchor is wrong, head_cut is measured from the wrong end and reports
    a confident zero: fotfly cropped to grass and two tail wires and scored
    0.000, a perfect result for a picture with no bird in it. A metric derived
    from the anchor cannot audit the anchor.

    This one is independent of every decision above. Whatever the subject is
    and wherever its head is, a crop that keeps almost none of the picture's
    detail has lost the bird.
    """
    e = np.asarray(_energy(im), dtype=np.float64)
    h, w = e.shape
    sw, sh = im.size
    sx, sy = w / sw, h / sh
    l, t, r, b = crop
    l, t, r, b = int(l * sx), int(t * sy), int(r * sx), int(b * sy)
    tot = float(e.sum())
    inside = float(e[max(0, t):max(0, b), max(0, l):max(0, r)].sum())
    return (inside / tot) if tot else 1.0


def process(path, out_dir, dry=False):
    with Image.open(path) as im:
        im = im.convert('RGB') if im.mode not in ('RGB', 'L') else im
        w, h = im.size
        if abs(w - h) <= 1:
            return {'file': os.path.basename(path), 'already_square': True,
                    'head_cut': 0.0, 'tail_cut': 0.0, 'kept': 1.0}
        a = analyse(im)
        box = square_box(w, h, a, os.path.basename(path))
        head_cut, tail_cut = crop_loss(w, h, box, a)
        kept = energy_kept(im, box)
        if not dry:
            im.crop(box).save(os.path.join(out_dir, os.path.basename(path)),
                              quality=88, optimize=True)
    return {'file': os.path.basename(path), 'already_square': False,
            'head_cut': round(head_cut, 3), 'tail_cut': round(tail_cut, 3),
            'kept': round(kept, 3), 'rival': round(a['rival'], 3),
            'size': [w, h], 'box': list(box)}


def main():
    args = sys.argv[1:]
    src = args[0]
    out = args[1]
    limit = int(args[2]) if len(args) > 2 else 0
    # ---- THE SOURCE IS NOT THE DESTINATION -------------------------------
    #
    # F190, measured 2026-08-26. This was once run with src == out, which
    # squared 1,335 icons IN PLACE and destroyed every original. The damage is
    # not the lost pixels — it is that `process()` then returns early on
    # `abs(w - h) <= 1` for every file, so the script became a NO-OP and stayed
    # one. The v1.41.1 head-protection change was written, reviewed, shipped
    # and ran on nothing; the owner reported the same cropped loon afterwards
    # and was right.
    #
    # A destructive pass that silently turns into a no-op is worse than one
    # that fails, because it keeps reporting success. Refuse it.
    if os.path.abspath(src) == os.path.abspath(out):
        sys.exit('src and out are the same directory. This squares the icons '
                 'in place, destroys the originals, and turns every later run '
                 'into a no-op — which is exactly how F190 shipped a fix that '
                 'could not run. Give it a separate output directory.')
    os.makedirs(out, exist_ok=True)
    files = sorted(f for f in glob.glob(os.path.join(src, '*'))
                   if f.lower().endswith(('.jpg', '.jpeg', '.png')))
    if limit:
        files = files[:limit]
    res = []
    for i, f in enumerate(files):
        try:
            res.append(process(f, out))
        except Exception as e:                      # noqa: BLE001
            res.append({'file': os.path.basename(f), 'error': str(e)})
        if i % 200 == 0:
            print(f'  {i}/{len(files)}', flush=True)
    with open(os.path.join(out, '_crop-report.json'), 'w') as fh:
        json.dump(res, fh, indent=1)
    # ANY loss at the head end is a failure. Tail loss is expected.
    risky = sorted((r for r in res if r.get('head_cut', 0) > 0.02),
                   key=lambda r: -r['head_cut'])
    print(f'cropped {len(res)}  already square '
          f'{sum(1 for r in res if r.get("already_square"))}  '
          f'HEAD-CUT {len(risky)}')
    for r in risky[:60]:
        print(f'  HEAD {r["head_cut"]:.3f} tail {r["tail_cut"]:.3f}  {r["file"]}')


if __name__ == '__main__':
    main()
