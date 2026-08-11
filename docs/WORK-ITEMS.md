# Work items

The small stuff. `BACKLOG.md` (in the report repo) holds **features** — the things
with a design argument behind them, numbered `F1…F30`. This file holds everything
else: the one-liners, the bugs, the tweaks, the things that are a single line in a
release note.

**One ID space, `W1, W2, …`** — deliberately not split into "bug" and "change
request". Classifying the first 75 releases that way was tried and abandoned: 65 of
them quote a request of some kind, so the label was a coin toss that answered
neither question this file exists to answer. `Raised by` records where the item
actually came from, which is a fact rather than a judgement.

## How to read it

* **`Release` blank = still open.** That is the whole status model. "What have I
  asked for that has not shipped?" is a filter on one empty column.
* **`F`** links the item to the feature it serves, where there is one. Blank is
  normal — most one-liners do not belong to a feature.
* **`Guard`** names the test that stops the item coming back. `—` means there
  isn't one, which is worth seeing.

`scripts/work-items.js` checks all of that on every test run: IDs unique and
sequential, every `Release` a version that really shipped, every `Guard` a test
that really exists, every `F` a feature that really exists. A tracker nobody
verifies is a tracker that is wrong within a week.

```
node scripts/work-items.js          # validate, and list what is still open
```

## Open

| ID | Item | F | Raised by |
|---|---|---|---|
| W41 | Rate limiter reports `window 21/20` — one past its own cap; the token bucket (0.37/s) and the rolling window (20/60s = 0.333/s) disagree, and the window is defeated at the boundary | F26 | device log 2026-08-10 |
| W42 | Anchor cannot re-scope the wave — "Find Yakima" re-ranks King+Snohomish rather than fetching near Yakima | F30 | request 2026-08-10 |

## Shipped

| ID | Item | F | Raised by | Release | Guard |
|---|---|---|---|---|---|
| W1 | Hotspot cards list only the checklists holding a bird you need | | request 2026-08-08 | 1.0.80 | — |
| W2 | Missing R badge on one Tufted Puffin — rarity flag not OR'd across rows | | screenshot 2026-08-08 | 1.0.80 | — |
| W3 | Checklist evidence icons painted at build time — the notable feed already carries `evidence` on 400 of 400 rows | F23 | request 2026-08-08 | 1.0.81 | — |
| W4 | A settled checklist is bought once, not once a launch — age-aware durable cache | F27 | request 2026-08-08 | 1.0.81 | — |
| W5 | Chase radius belongs to the report, not one global knob | F1 | queue 2026-08-08 | 1.0.82 | — |
| W6 | 250 hotspots in across-water counties were zoned `mainland` | F1 | measurement 2026-08-08 | 1.0.83 | — |
| W7 | Place search dead on device — Nominatim sends no CORS header at all | | device 2026-08-08 | 1.0.84 | the geocoder points at a host that a webview can actually read |
| W8 | A fetch set a forbidden `User-Agent` header the webview strips | | measurement 2026-08-08 | 1.0.84 | no fetch tries to set a header the platform forbids |
| W9 | Seen and unseen rows look different — contrast raised from 1.15:1 to 4.98:1 | | request 2026-08-08 | 1.0.84 | the seen / unseen divider is a real separator, not a hairline |
| W10 | San Juan Islands routed as open road — measured 80-min ferry hop | F1 | measurement 2026-08-08 | 1.0.85 | — |
| W11 | Refresh button did nothing — the cache answered it, two layers deep | | device 2026-08-08 | 1.0.86 | Refresh actually refetches; opening the section does not |
| W12 | Both rarity lists sort by date or distance from one control | | request 2026-08-08 | 1.0.86 | both rarity lists sort by date or distance, from one control |
| W13 | Pull to refresh | | request 2026-08-08 | 1.0.86 | pull-to-refresh exists, and cannot fire by accident |
| W14 | Refresh re-reads the county alerts, not the whole 47-call wave | F27 | request 2026-08-08 | 1.0.87 | a rarity refresh re-reads the alerts, not the whole wave |
| W15 | "N new since you last looked" on the rarity lists | | request 2026-08-08 | 1.0.87 | — |
| W16 | Checklist rows say what differs between them | | screenshot 2026-08-09 | 1.0.88 | — |
| W17 | A card announced 5 unseen birds and showed no checklists | | screenshot 2026-08-09 | 1.0.88 | — |
| W18 | "3 checklist with a bird you needs" — plural on the wrong word | | screenshot 2026-08-09 | 1.0.88 | — |
| W19 | Here/Find did nothing on Top destinations and Top excursions | F30 | device 2026-08-09 | 1.0.89 | all four Go birding sections offer the same anchor, and rank from it |
| W20 | Every list says where it measures from | F30 | request 2026-08-09 | 1.0.89 | all four Go birding sections offer the same anchor, and rank from it |
| W21 | Species search accepts an eBird species code | | request 2026-08-09 | 1.0.89 | — |
| W22 | Sandel Lookout ranked #1 with no unseen list — 3-day feed vs 7-day scoring | | screenshot 2026-08-09 | 1.0.89 | — |
| W23 | Own checklists keep the year list current, at no extra call | F8 | request 2026-08-09 | 1.0.90 | your own checklists top up the year list, for free |
| W24 | A bird you just logged stayed a chase target for 30 minutes | F8 | measurement 2026-08-09 | 1.0.91 | learning a bird from your own checklist refreshes what is a target |
| W25 | `Can't find variable: slot` — a ReferenceError swallowed into a warning | | device log 2026-08-09 | 1.0.92 | — |
| W26 | Cheap checklist entries were evicting the expensive chase snapshot | F27 | device log 2026-08-09 | 1.0.92 | the expensive snapshot evicts cheap caches rather than giving up |
| W27 | A forced refresh raced the running wave instead of joining it | F27 | device log 2026-08-10 | 1.0.93 | a forced refresh joins a running wave instead of racing it |
| W28 | 403 on the leaderboard web-token fallback — made cheap and quiet | F26 | device log 2026-08-10 | 1.0.94 | — |
| W29 | #1 hotspot's facts line went stale the moment the harvester credited two birds | | screenshot 2026-08-10 | 1.0.95 | — |
| W30 | All-unseen checklist rows had no media icons — `evidence` dropped at hand-off | F23 | screenshot 2026-08-10 | 1.0.96 | unseen place rows carry the media mark, like every other list |
| W31 | Go birding moved above Rare birds — `MENU` and `MENU_GROUPS` disagreed | F24 | request 2026-08-10 | 1.0.96 | the menu leads with Go birding, not Rare birds |
| W32 | My year missing birds harvested from your own checklists | F8 | screenshot 2026-08-10 | 1.0.96 | a bird harvested from your own checklist is a row, not just a tick |
| W33 | Chase snapshot lost to `QuotaExceededError` — 141 s and 48 calls discarded | F27 | device log 2026-08-10 | 1.0.97 | a full store gives up its cheapest caches, not the wave |
| W34 | Rare bird alerts paint after 3 calls instead of 6 | F27 | request 2026-08-10 | 1.0.97 | the rarity feeds are fetched first, and paint without waiting for the rest |
| W35 | `QUERY-PLAN.md` written; `API-CALLS.md` refreshed and pinned against drift | F27 | request 2026-08-10 | 1.0.97 | the API docs quote the constants the app actually uses |
| W36 | Destinations say what the report covers when the anchor is outside it | F30 | screenshot 2026-08-10 | 1.0.98 | a list that cannot reach the anchor says what it covers |
| W37 | Find lit the Home pill — the anchor control disagreed with its own label | F30 | screenshot 2026-08-10 | 1.0.98 | choosing Find lights Find, not Home |
| W38 | Portrait card photos cropped to 3:2 lost up to 53% of the bird | | screenshot 2026-08-10 | 1.0.99 | a card photo frame follows the photo, within limits |
| W39 | Quick outing hydrates its cards like Top destinations does | F30 | request 2026-08-10 | 1.0.99 | quick outing hydrates its cards like top destinations does |
| W40 | `N species all-time` was being rewritten to `N species in 3d all-time` | | measurement 2026-08-10 | 1.0.99 | quick outing hydrates its cards like top destinations does |

## Release index

Every release, from the commit that shipped it. Older releases are indexed rather
than itemised: the per-item detail could not be reconstructed from prose commit
messages accurately, and a tracker that guesses is worse than one that says less.

| Version | Date | Headline |
|---|---|---|
| 1.0.99 | 2026-08-10 | card photos stop cutting the bird in half, and Quick outing shows its data |
| 1.0.98 | 2026-08-10 | the anchor moves, the data cannot follow it, and now it says so |
| 1.0.97 | 2026-08-10 | the rarity feeds go first, and the wave stops being thrown away |
| 1.0.96 | 2026-08-10 | three things the screenshots caught, and one of them was a whole list |
| 1.0.95 | 2026-08-10 | a hotspot counts the targets you still need, right now |
| 1.0.94 | 2026-08-10 | the last two lines from the device log |
| 1.0.93 | 2026-08-10 | a forced refresh joins the running wave instead of racing it |
| 1.0.92 | 2026-08-09 | two bugs the device log found and the suite could not |
| 1.0.91 | 2026-08-09 | a bird you just logged stops being a target immediately |
| 1.0.90 | 2026-08-09 | your own checklists keep the year list current, for free |
| 1.0.89 | 2026-08-09 | Here and Find work everywhere, and every list says where it measures from |
| 1.0.88 | 2026-08-09 | checklist rows say what differs, and the NEW badge behaves |
| 1.0.87 | 2026-08-08 | a refresh re-reads what changed, and says what is new |
| 1.0.86 | 2026-08-08 | Refresh refreshes, pull to reload, and one shape for both rarity lists |
| 1.0.85 | 2026-08-08 | the San Juan Islands are not open road |
| 1.0.83 | 2026-08-08 | search works on the phone, and seen/unseen finally look different |
| 1.0.83 | 2026-08-08 | search works on the phone, and seen/unseen finally look different |
| 1.0.81 | 2026-08-08 | checklist marks appear at once, and a settled checklist is bought once |
| 1.0.80 | 2026-08-08 | a hotspot lists the checklists that hold a bird you need |
| 1.0.79 | 2026-08-08 | walking distance, validated against the Meadowbrook kingbird |
| 1.0.78 | 2026-08-08 | the tiny pins: rare birds at personal checklist locations |
| 1.0.77 | 2026-08-08 | the GBIF budget goes to the commonest unseen birds first |
| 1.0.76 | 2026-08-08 | a photo for every bird in every region |
| 1.0.75 | 2026-08-08 | a checklist is bought once a day, not once a launch |
| 1.0.74 | 2026-08-08 | one anchor for all four Go birding sections, and an R wherever a bird is rare |
| 1.0.73 | 2026-08-08 | sharp photos for 930 birds, one definition of "seen", and an R for rare |
| 1.0.72 | 2026-08-07 | 🎯 waypoints from the observer's note, and photos that aren't blurry |
| 1.0.71 | 2026-08-07 | 93 Washington birds come back, and the watchlist works again |
| 1.0.70 | 2026-08-07 | one second row for the medium card, and Today's rarities opens the checklist |
| 1.0.69 | 2026-08-07 | the hotspot card shows what was reported, and "…and N more" opens |
| 1.0.68 | 2026-08-07 | ticks split, icons that mean one thing, convoy cards, honest progress, chase radius |
| 1.0.67 | 2026-08-07 | Go birding leads, Trip planner steps back, rarities split by need |
| 1.0.66 | 2026-08-06 | the sub-header spans the row, and the marks follow the place |
| 1.0.65 | 2026-08-05 | the evidence marks are actually visible now |
| 1.0.64 | 2026-08-05 | the evidence marks reach the app |
| 1.0.63 | 2026-08-05 | south Kitsap stops claiming a ferry it never takes |
| 1.0.62 | 2026-08-05 | how far you will go, measured rather than guessed |
| 1.0.61 | 2026-08-03 | hidden means hidden, and the API budget becomes visible |
| 1.0.60 | 2026-08-03 | the distance takes you there, and the menu reads by intent |
| 1.0.59 | 2026-08-03 | the requests that landed in the wrong session |
| 1.0.58 | 2026-08-03 | un-merging the place sections, and an ABA sub-page |
| 1.0.57 | 2026-08-03 | six follow-ups, and a gallery so the templates can be seen |
| 1.0.56 | 2026-08-03 | the seed had quietly lost two regions' year lists |
| 1.0.55 | 2026-08-03 | Birdiest checklists, and the width the sweep never tested |
| 1.0.54 | 2026-08-03 | the seventh mode switch, found by asking the app to boot |
| 1.0.53 | 2026-08-03 | six on-device reports, and one of them was a CSS leak |
| 1.0.52 | 2026-08-03 | the screen comes up on phase 1; staged progress; the sustained cap |
| 1.0.51 | 2026-08-03 | Latest ticks stops re-fetching what it already has today |
| 1.0.50 | 2026-08-03 | checklist cards, medium cards everywhere, refresh in the heading |
| 1.0.49 | 2026-08-02 | hotspot card layout, the Happening now reload loop, and feed dedupe |
| 1.0.48 | 2026-08-02 | the 429s were contention with our own report job |
| 1.0.47 | 2026-08-02 | the app was DoSing itself; and a progress bar |
| 1.0.46 | 2026-08-02 | F25: add and remove your own regions, for trips |
| 1.0.45 | 2026-08-02 | retire the work anchor (F1 step 1) |
| 1.0.44 | 2026-08-02 | the chase snapshot survives closing the app, compressed |
| 1.0.43 | 2026-08-02 | re-derive the 429 pacing from a real device log |
| 1.0.42 | 2026-08-02 | HTTP 429: a rate-limited call was fatal, and nothing bounded the burst |
| 1.0.41 | 2026-08-01 | F11: the "hard to find, not rare" engine was built and never rendered |
| 1.0.40 | 2026-08-01 | one "where do I go?" report, one "what am I missing?" report, and 🔭 scope sites |
| 1.0.39 | 2026-07-31 | All unseen reports: four bugs from one screenshot |
| 1.0.38 | 2026-07-31 | the drag, take four: ship the instrument, not another hypothesis |
| 1.0.37 | 2026-07-31 | the side-scroll was a nowrap inheriting into a track that could not shrink, and species lookup |
| 1.0.36 | 2026-07-31 | the checklist pulse was sorted by a string that isn't a date |
| 1.0.35 | 2026-07-31 | a hotspot's species list describes the hotspot; the checklist pulse; the tide right now |
| 1.0.34 | 2026-07-31 | four device reports, one root cause: an action-link rule was styling card titles |
| 1.0.33 | 2026-07-31 | the navbar stops crowding out the section name, and a missing key stops being a dead end |
| 1.0.32 | 2026-07-31 | the app had two definitions of "seen", and they disagreed by 28 birds |
| 1.0.29 | 2026-07-30 | the cascade lane could not name a bird called Pectoral Sandpiper |
| 1.0.28 | 2026-07-30 | three card templates, and every list uses one of them |
| 1.0.24 | 2026-07-29 | Favorite hotspots content parity, three card templates, GBIF state records |
| 1.0.23 | 2026-07-29 | Needs-verification manager, map provider, legible surge counts |
| 1.0.22 | 2026-07-28 | every section explains itself, and the app scales for bad eyesight |
| 1.0.20 | 2026-07-28 | the bald eagle becomes the app icon and the in-app mark |
| 1.0.19 | 2026-07-28 | a lead board, a second anchor, and ten on-device fixes |
| 1.0.8 | 2026-07-27 | Last new bird section, swipe-back, parity tooling |
