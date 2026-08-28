# Bird icon crops — how to review and override them

Every bundled bird icon is a **square** cut from a Wikimedia photo by
`assets/square-icons.py`. This file is the runbook for when one is wrong.

## Why this process exists, and why it is manual

Automatic detection of "is this crop wrong" has been tried repeatedly and does
not work here. Measured 2026-08-27:

| attempt | result |
|---|---|
| subject-box edge margin over all icons | flagged **93.8%** — no discriminating power |
| the same, checked by eye | **false positives** on `bkcchi` and `comcra`, both well framed |
| `rival` confidence gate | wrong and acceptable ranges **overlap**; rejected once in F190 and again here |
| subject longer than the square | over-flagged: predicted 66.8% "cannot fit", ground truth said **1 of 12** |

The root cause is in the detector itself: the head anchor is the energy centroid
of the **top band** of the subject box. That is right for an upright perching
bird and wrong for a **horizontal** one — a swimming loon, a standing gull, a
perched eagle in profile — where the top band spans the bird's *back*, so the
anchor lands mid-body and the crop slides to the wrong end.

Measured against twelve owner-drawn labels, the automatic answer was off by
**0.40–1.00 of the slide range on 11 of 12**, four of them at the *opposite end*
of the photo (`killde` 0.004 drawn vs 1.000 computed; `rocpig` 1.000 vs 0.000).

**So the eye is the instrument, and the algorithm is what is under test.** Never
the other way round — a metric computed from the decision it audits cannot fail
(F190).

## Reviewing icons

1. **Put the source images beside the tool.** They live in the private repo at
   `birding/assets/birds-src/`.

   ```powershell
   $d = "$env:TEMP\crop-review"
   New-Item -ItemType Directory -Force -Path $d
   Copy-Item birding-app\assets\crop-annotator.html "$d\annotate.html"
   # copy just the birds you are reviewing
   foreach ($c in 'glwgul','comloo') {
     Copy-Item "birding\assets\birds-src\$c.*" $d
   }
   ```

2. **Serve it.** A `file://` page cannot reliably load the images beside it.

   ```powershell
   cd $env:TEMP\crop-review
   python -m http.server 8777
   # then open http://localhost:8777/annotate.html
   ```

   Reviewing a different set? Append `?birds=code1,code2,...` to the URL.

3. **Drag a square** around each bird, head to tail. The drag is **locked to
   1:1**, because the icon is square and any other shape describes a crop that
   cannot exist.

4. **Read the verdict.** This is the part that matters — it says *which kind of
   problem* each bird has:

   | verdict | meaning | fixable today? |
   |---|---|---|
   | `CROPPER CAN DO THIS` | your square is the sliding square | **yes** — paste `slide` into `OVERRIDES` |
   | `ZOOM IN` | you drew tighter than `min(w,h)` | no — the cropper only slides a fixed size |
   | `DOES NOT FIT` | your square is larger than the photo allows | no — needs padding or a better photo |

5. **Copy all** emits JSON. Keep it in
   `tests/fixtures/icon-crops/owner-labels.json`, which is the ground truth the
   crop guard asserts against.

## Applying an override

`OVERRIDES` in `assets/square-icons.py` maps a **source filename** to where the
square sits in its slide range, `0.0` flush left/top to `1.0` flush right/bottom.
That single number is the *only* degree of freedom the cropper has.

```python
OVERRIDES = {
    'glwgul.jpg': 0.733,   # head cut off; drawn by the owner 2026-08-27
}
```

Then regenerate — **never** with `src == out`, which `main()` refuses:

```powershell
python assets\square-icons.py birding\assets\birds-src birding-app\www\assets\birds
```

### Overrides are pinned to the image they were drawn against

`OVERRIDE_SRC_SHA` records a fingerprint of each source. `stale_overrides(src)`
returns any whose image has changed.

This is the safety the owner asked for: *"this is a static set of birds, so it
may be fine to have a look up table for overrides on these known issues. if the
images update, then overrides can be reset."* An override is a judgement about
**one picture**; carrying it silently onto a different picture is how a
hand-checked fix becomes a hand-made bug. A changed photo invalidates its
override **loudly**.

```powershell
python -c "import importlib.util as u; s=u.spec_from_file_location('si','assets/square-icons.py'); m=u.module_from_spec(s); s.loader.exec_module(m); print(m.stale_overrides('../birding/assets/birds-src'))"
```

Empty is the good case.

## Known limits, stated rather than hidden

- **Nobody knows how many icons are wrong.** 13 were reviewed in F190 and 12
  more after it, then **15 more in F216 — 40 of 1,288 (~3%)**. Of the 12,
  **11 were wrong**; of the 15, **14 moved**. That rate cannot be extrapolated
  (they were reported *because* they looked wrong), but it is not evidence of
  health either.
- **No signal predicts which icons need review.** Tested and rejected above. The
  only known method is looking.
- **`ZOOM IN` and `DOES NOT FIT` have no fix yet.** The cropper slides a
  fixed-size square; it cannot zoom, and it cannot pad. Four of the twelve need
  zoom and one needs padding.

## Rejected: a species- or class-aware crop margin

**Proposed 2026-08-27 by the owner** — *"look up each bird's description to see
how long its beak is, to estimate cropping distance from its eye; many birds
have head to beak ratios"*, then refined to *"look up based on class of birds
like sandpipers and hawks and ducks"*.

It is a good idea and it targets a real thing: `HEAD_PAD` is one constant for
every bird, and a godwit plainly needs more clearance than a chickadee. The
class form is better than the species form — eBird's taxonomy supplies family
for free, so it is ~200 buckets rather than 1,290 lookups, and it maps onto the
root cause F190 named (the head anchor is *"the energy centroid of the top
band, right for an upright perching bird and wrong for a horizontal one"*).

**It was rejected on measurement, not on taste.** F216 produced the first
ground truth this project has ever had — **26 owner-drawn slides** — so the
question could finally be asked properly: is the residual error a MARGIN error,
which a table could fix, or a DIRECTION error, which it cannot?
`assets/f216_score.py` turns the overrides off, re-runs the automatic placement,
and compares:

| error vs the drawn slide | count | a smarter margin? |
|---|---|---|
| **> 0.50** — more than half the slide range, i.e. the wrong part of the bird | **15 (58%)** | no |
| 0.15 – 0.50 | 9 (35%) | unlikely |
| ≤ 0.15 | **2 (8%)** | plausibly |

Median error **0.563**, mean **0.555**, and **six sit at ~1.000 — the literal
opposite end of the photo**. *The margin is not what is wrong; the anchor is
landing in the wrong place, and a better allowance around a wrong point is
still a wrong point.*

**Then the class form was tested directly, with within-class controls**, since
that is the version worth taking seriously:

| class | spread of error |
|---|---|
| ducks (Anatidae) | **0.05 → 1.00** — `norpin` 0.05 against `yebpin1` 1.00, **both pintails** |
| gulls (Laridae) | 0.18 → 0.73 |
| shorebirds (Scolopacidae) | 0.31 → 0.56 |
| pigeons (Columbidae) | 0.97 → 1.00 — consistently bad |

**Two pintails, same genus and same posture, land at opposite extremes.** So the
error is determined by *the photograph* — which way the bird faces, what the
background does — and not by the species or its family. **A class table cannot
fix what varies that much inside a class.** Pigeons are the one bucket where a
class rule would genuinely help, and one bucket in four is not a system.

⚠️ **The sample is the failure set, by construction.** These 26 are the icons
that were *reported as wrong*, so 58% is the shape of the failures we know
about, **not** the error rate across 1,288 icons. Quoting it as the latter would
be wrong.

**What this leaves.** The bottleneck is not the detector's precision — it is
that only ~3% of icons have ever been looked at. A drawn box takes about a
minute and is ground truth; a cleverer detector produces unverified output on
1,250 unreviewed images, and F190 already measured a **fixed** crop tying the
best rule 9/13. If the detector is ever revisited, the target is **direction**
(which end is the head), not margin — and it should be scored against these 26
before anything is shipped.

