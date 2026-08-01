# Report ↔ App feature parity

Tracks every section of the Python birding report (`WyattHoutz/birding`,
`report.py`) against its status in this iPhone app. Keep this in sync as
features land so the two stay at parity.

**Status: ✅ every report section is accounted for.** Each one is either
implemented in the app or carries a ➖ row below saying why it isn't. That
second half used to be a blind spot: a heading could be added to
`tests/fixtures/report-contract.json`'s `reportSectionsAppOmits` and disappear
from the app forever with every test still green and this document still
claiming full parity. Since v1.0.16 an omission must record a **reason** and
have a **row in the matrix below**, enforced from both repos
(`birding/tests/parity/test_report_toc.py`).

## v1.0.38 — the drag, take four: stop guessing, make the phone do the measuring

**v1.0.37 fixed five real overflows and the drag still happens.** That is now
three fixes in a row that were *correct* about something and *wrong* about this,
so this release stops proposing causes and ships the instrument instead.

**What the evidence actually says.** A real-browser sweep of **every element in
the document** — now checking the **left** edge as well as the right, which
nothing in this project had ever done — across 320px–430px and Normal→Huge text,
finds **nothing past either edge**. The layout is clean on desktop Chrome. So
whatever moves on the phone is not a width this project can see from here.

That leaves three candidates, and they are indistinguishable to a finger because
all three pan the whole screen including the sticky navbar:
1. the document really is wider (`scrollWidth > clientWidth`),
2. the page is **zoomed**, so the visual viewport is a window onto a larger one,
3. iOS is panning the **visual** viewport with no zoom and no overflow.

**🐞 → 📐 Drag.** The debug panel gains a drag probe that names which of the
three is happening, in those words. Arm it, close the panel, drag the page
sideways, reopen: it reports `scale`, visual-viewport width/`offsetLeft`/
`pageLeft`, layout width, `scrollWidth` and `scrollLeft` at rest and at the peak
of the gesture, plus the extreme element on **both** sides. Every copied debug
log now also carries a `geometry:` line with the same figures, so a report is
diagnosable even if the probe was never armed.

**One mitigation ships with it, and it is not another guess about width.**
The app declared **no `touch-action` at all**, so the root scroller permitted
horizontal panning by default. `body { touch-action: pan-y }` says the page
scrolls down, not sideways — enforced by the compositor rather than by layout,
so unlike the two `overflow-x: clip` guards it does not care whether anything
overflows. Maps are the one thing that must pan both ways; `.leaflet-container`
restates `touch-action: none` (the mode Leaflet asks for, since it drives its
own gestures from JS) because an ancestor's value is *intersected* with the
element's.

If the drag stops, the probe says why. If it does not, the probe says what is
moving, and the next fix will be the first one aimed at a measurement rather
than a hypothesis.

## v1.0.37 — the side-scroll, found: a nowrap that inherited into a flexible track

**Reported three times across three releases and "fixed" twice blind.** The
third report came with a screenshot, and the screenshot is what cracked it: the
whole page — navbar included — panned sideways, which is *chrome*, outside
every `.panel`. Both previous fixes and all three headless sweeps had only ever
looked **inside** panels.

**The bug — `index.html`, `.cklrows`.** `white-space: nowrap` on `.when` was
written for the 3-column checklist row, where `.when` is an `auto` track
holding a short stamp like *Jul 31 5:06 pm*. The **labelled** variant
(`li.lblrow`, the WHERE / OBSERVER / LATEST rows) reuses that class in a
**2-column** grid where `.when` lands in the flexible track and carries the
value **plus a checklist link**. A flexible track defaults to `min-width:
auto`, so it cannot shrink below its content's min-content width — and `nowrap`
makes that width *the entire unbroken line*. The track blew out and took the
grid, the card, the panel and the page with it. `.where`, on the very next
line, already carried the `min-width: 0` guard that `.when` lacked.

**Measured:** Today's rarity reports, 375px viewport, text scale 1.75 —
`span.when` right edge at **458px against a 375px viewport, +83px**.

**Why it hid for so long, which is the part worth keeping.** `html` and
`.panel` both set `overflow-x: clip`, and one side effect is that
`documentElement.scrollWidth` is **clamped to `clientWidth`**. In the sweep
that finally caught this, `docScrollW` read exactly 375 in **all 28 sections**
while an element stuck out 83px. Any check keyed on `scrollWidth`,
`body.scrollWidth` or "can the document scroll?" is *structurally incapable* of
seeing this class of bug. Only a per-element `getBoundingClientRect()` sweep
can, because a rect is unaffected by ancestor clipping. The clip rules stay —
they are containment, not the fix.

Four more elements were found by the same sweep and fixed with it: button rows
now wrap (320px: `📍 Here` +22.8px, the birdlist copy button +15px), Contents
tiles and their labels may shrink, the needs-verification thumbnail yields
width before the ▲▼✕ touch targets do, and a hostname in a settings hint
breaks instead of widening the panel.

**The reporter was part of the problem, so it changed too.** The in-app 🐞
overflow reporter swept `.panel *` — the same blind spot — and skipped Leaflet
by testing `className`, which on an SVG element is an `SVGAnimatedString` and
therefore silently never matches. It now sweeps `body *` and skips Leaflet by
both the class *attribute* and ancestry.

**New: `npm run test:layout`, wired into CI.** jsdom has no layout engine, so
the 195-test suite is blind to geometry *by construction* — that is why this
survived three releases. `assets/audit-overflow.js` serves `www/` over HTTP,
drives real headless Chrome, walks every section and fails if any element's
right edge passes the viewport. Proven against the bug itself: reverting the
one-line fix makes it report `+98px  span.when`; restoring it reports clean.
Verified across 20 width × text-scale combinations from 320px to 430px and
Normal through Huge.

## v1.0.36 — the checklist pulse was sorted by a string that isn't a date

**The bug:** eBird's `product/lists` returns **two** date fields, and the
obvious one is the wrong one. `obsDt` is a *human* date — `"31 Jul 2026"` —
so sorting it lexicographically ranks **31 Jul above 01 Aug**, because `'3'`
sorts after `'0'`. A section whose entire premise is *newest first* silently
buried the newest checklists on the first of every month. `isoObsDate`
(`"2026-07-31 17:06"`) is the sortable one, and it is also the only field
carrying the **clock time**. Both repos now sort and render from it, so the
`When` column reads `Jul 31 5:06 pm` instead of a bare `31 Jul 2026` — for a
"what is happening right now" section, an 06:00 list and a 21:00 list are
different answers.

**Why the guard didn't catch it:** the fixture invented
`obsDt: '2026-07-31 06:00'`, an ISO shape eBird never returns for that field.
A fixture that doesn't match the real payload tests a world in which the bug
cannot occur — worse than no fixture, because it is green. Both repos now pin
the real field shapes and a **cross-month** pair.

**Timezone divergence, now removed.** `renderTides` read `Date.now()`
internally, so the whole section could only be tested at certain times of day.
CI ran at 01:31 UTC — before the fixture's first tide window opened — and
failed on a banner that is correct at 09:00 and absent at 01:31. It now takes
`nowMs` as a parameter, exactly as `tideNow` already did. Reproduced locally
under `TZ=Atlantic/Cape_Verde` (which put the wall clock in the same gap), and
the suite now passes at UTC, UTC−1 and UTC+14. **A render that reaches for the
global clock is untestable by construction.**

Also: standing *outside* the fetched windows no longer prints an empty state
line. The banner's job is "when is next prime birding", and that question has
an answer even when the predictions start later today.

## v1.0.35 — a hotspot's species list, the checklist pulse, and the tide now

**🕒 Recent checklists (new section, both repos).** Birdiest answers *where was
the best birding this week* by collapsing to one checklist per hotspot. That
collapse destroys the other signal: three lists filed at one park this morning
means people are **still there**. The new section keeps them, newest first, and
shares Birdiest's single cached `product/lists` fetch, so the second question
costs no extra network in either repo.

**🔥 Hot / 🥶 Cold / 🥇 destinations — the species lists now describe the
hotspot.** Reported from the device: a well-birded park read *"5 unseen · 7 more
species already seen"*. Nothing was wrong with the split; the **input** was.
Every card built its lists out of the region-wide `recent` feed, and that feed
returns **exactly one observation per species for the whole region**, so a
hotspot only ever received the species whose single region-wide representative
row happened to land there. Cards now hydrate from `data/obs/{locId}/recent`
after paint — still one row per species, but scoped to the LOCATION, so "one per
species" is now exactly the list wanted, complete, in **one call per card**
(cached per locId per day, pooled 3-wide, only for rendered cards). This is
backlog **F9's blocker surfacing as a UI bug**, solved for hotspot cards.

**🌊 Tides — a DIVERGENCE, deliberately.** The ask was *"it was difficult at a
glance to see current conditions and when next prime birding is."* Both repos
now mark **🦆 prime = an incoming tide in daylight** (a bird on every rising row
would say nothing the existing highlight does not; the marker earns its place
only by separating windows you can actually see birds in from ones at 2am), and
👀 for a rising tide after dark. Only the **app** additionally prints the live
state line — *rising now* / *falling now · next rising tide in 3h 20m* — marks
the row you are standing in, and drops windows that have already finished. Same
reasoning as the Quick-outing anchor divergence: **a Markdown report is
generated hours before it is read and does not know when "now" is**, so a
countdown printed in it would be a number that quietly goes wrong. The report
keeps the whole day's windows; the app keeps only the ones you can still chase.



The app ships all 9 reports. A **region picker sits in the Contents header and
in the section navbar** (v1.0.12), so you can switch without opening Settings;
Settings → "Default report" is the same setting and stays in sync. The choice
is persisted, so the app reopens on the last region you used.

Switching region rebuilds the report rather than just relabelling it: the
cached chase data and rendered lists are cleared, and **the Contents list is
regenerated from the sections that region's report builder actually emits**.
A rarity tracker has no counties and runs `report.py::build_rarity_report`, so
its county-only sections (birdiest checklists, hot/cold hotspots, convoys,
migration outlook, BirdCast, time-of-day) and its geo sections (trip planner,
destinations, closest spots, quick outing, excursions, conditions, new
arrivals) are absent from the menu instead of listed as dead ends.

**Home is per region** (v1.0.12). `ebird_home_{lat,lng,place}` and the tide
station are keyed by report slug, falling back to that report's `regions.py`
home coord — a home saved for Washington no longer decides chase distances on
the Big Island. Values saved before this migrate once into the region that was
active at the time.

Each report carries its own counties, home base, geo radius, and bundled
year-list seen set (`seed-birdlist.js` → `seenByReport[slug]`, generated to
equal `analyze.py`'s exact seen formula). The two rarity-tracker reports
(Lower 48, ABA Area) have no county feeds, so their chase tabs redirect to the
ABA rare-bird alert + rankings — matching the Markdown report, which builds
those two from the same SN10489 scrape.

## Automated parity guarantee (same APIs · same inputs · same outputs)

The chase engine is not re-implemented in the app. Both the app and the report
run the **same orchestration** — `computeChaseViews()` in
[`www/logic.js`](www/logic.js) (`BirdLogic`) — which the report pipeline is
proven equivalent to by a cross-language test suite in the sibling repo:
[`birding/tests/parity/`](https://github.com/WyattHoutz/birding). Run it with
`python tests/parity/run_all.py`.

For every shared fixture it asserts, on **both** the live Python report code
and the app's JS `BirdLogic`, that they agree on 11 projections:

- **Same APIs** — `feed-plan.json`: identical eBird endpoint paths, query
  params, feed **merge order**, and per-county convoy (`product/lists`) feeds.
  The golden is captured from the report's real fetcher
  (`fetch_ebird._build_jobs`) via a monkeypatched HTTP layer, then the app's
  `planFeeds` / `requestUrl` / `mergePlan` / `planConvoyFeeds` must reproduce
  it byte-for-byte.
- **Same inputs** — both sides read the same fixture eBird rows.
- **Same outputs** — `merged`, `unseen`, `near`, `destinations`, `excursions`,
  `notable-today`, `tod-hours-built`, `tod-specialists`, `convoys`.

An app-side glue test, [`assets/smoke-wiring.js`](assets/smoke-wiring.js),
additionally proves `index.html`'s wired data layer (`getChase()`) reproduces
the golden destinations / excursions, and that `planFeeds` file names match the
`mergePlan` map keys for all 9 reports.

## County-scoped auxiliary panels

Beyond the chase engine, the auxiliary panels — BirdCast, time-of-day
specialists, hot/cold hotspots, migration outlook, weather-tides, birder
convoys, and birdiest checklists — are scoped to **each report's counties**
(and its NOAA tide station), exactly like the matching `report.py` sections
(`section_birdcast`, `section_time_of_day`, `section_cold/hot_hotspots`,
`section_migration_outlook`, `section_weather`, `section_birder_convoys`,
`section_birdiest_checklists`). The two rarity trackers (Lower 48, ABA Area)
have no counties, so every one of these panels shows a graceful "not
applicable" notice — matching the report, which returns `[]` and skips them.

These panels remain **live on-device approximations**: they call eBird
directly and pool samples across taps, so they use a different data source
than the report's committed offline caches (e.g. `migration-cache.json`,
accumulated daily time-of-day snapshots) and won't be byte-parity with a
given day's Markdown. What is guaranteed is that their **geographic scope,
thresholds, and — where shared — their math** match the report: convoys and
time-of-day specialists run the parity-tested `BirdLogic.convoyDetect` /
`todSpecialists`; BirdCast links and the tide station equal the report's; and
hotspots / migration / birdiest use the report's per-county feeds and
selection rules. (Cache keys are the report **slug**, so `wa` and `fort-casey`
— both `US-WA` — no longer collide.)

**Legend** — ✅ Done · 🟡 Partial · 🔜 Planned (feasible on eBird API) ·
🧪 Planned (needs historical/stats data) · 🌦️ Planned (needs non-eBird source) ·
⛔ Not feasible (eBird has no public API — website-scraped in the report) ·
➖ N/A on mobile

## Rarities & targets

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🔴 Happening now — birds a crowd is chasing | **Happening now** | ✅ | New in v1.0.16. Answers the one question no other section could: *what are people dropping everything for right now?* Motivating miss — ~20 birders saw a Tufted Puffin at the Edmonds waterfront and two of them year-ticked it, and neither repo said a word until the next day; the Terek Sandpiper at Stanwood and the ABA Ruff / White Wagtail / Red-necked Stint went the same way. `section_surge` ↔ `BirdLogic.surgeEvents` / `tickCascades` / `hotspotConvergence`, held to byte-identical results by `tests/parity/test_surge.py`, which runs one fixture through **both** languages. **Three independent lanes** so one failing source can't blind the section: (1) *observation surges* — distinct observers per species per 300 m cluster in the last 36 h vs that species' own trailing norm; (2) *leaderboard cascades* — 3+ of the top 100 adding the same bird within 3 days (sees the whole region, lags ≤1 day); (3) *hotspot convergence* — species-blind, a spot outdrawing **its own** norm, which is the only lane that fires when the bird was never flagged notable (the puffin is locally regular). Every lane reuses a feed another section already pays for. **Observers, not checklists** — one birder filing three lists at a stakeout is how a quiet spot fakes a crowd. **Not filtered to unseen**: a mob on a bird you have is still news, so the row says ✅/🔍 and lets you decide. **v1.0.29 fixes the cascade lane's name-to-code lookup, in both repos.** The lane resolved species names ONLY from the observation feeds this section had already fetched -- free, but those feeds are notable/hotspot-recent and therefore rarity-biased. A cascade is a bird several top-100 birders just added to a YEAR list, which skews the opposite way, to regular migrants. **Pectoral Sandpiper is the exact shape of the bug:** code `pecsan`, present in the WA species list, absent from every notable feed -- so the app printed *"could not resolve this name to an eBird species code"* about an entirely ordinary bird, and lost its link, its photo and its where-to-go feed with it. The message blamed the NAME when the dictionary was simply the wrong one. Resolution is now two-tier: the already-fetched feeds first (still free, still the common case), then the **region species index** -- which the old comment rejected as too costly but which already exists for the watchlist add field and is cached in localStorage for a day. Only a bird genuinely absent from the region list now goes unlinked, and the message says that instead. The Markdown report had the same gap in a quieter form -- it printed the species as **plain text**, linking nothing -- and now links it through `ebird.name_to_code()`, a full-taxonomy map already cached for other sections. |
| 🌅 Today's rarity reports | **Today's rarity reports** | ✅ | Renders `BirdLogic.computeChaseViews().notableToday` — the parity-tested port of `section_today` (today's `obsDt` only, one row per checklist, newest first). Before v1.0.14 it read a raw `recent/notable` feed, which is eBird's **14-day** window, so the app showed birds the report never listed. v1.0.22 gives it the **baseball-card** treatment the ABA section uses — big photo, headline name, a Wikipedia blurb — because it is the same kind of bird (usually two or three, usually unfamiliar), and both repos now print the same **rarity evidence**: reports · observers · locations · days. That spread is the load-bearing part — 42 reports from **1 location over 7 days** is a stakeout you can still drive to; 42 reports from 12 locations is a bird moving through. **v1.0.28 reverses the v1.0.22 decision, in both repos.** The baseball card was the wrong instrument here: this section is a list of **every rare-bird checklist filed today** — one row per report, sometimes a dozen — and a full-bleed photo card per row turned a scannable list into a scroll. The rarity-evidence columns went with it: they are a claim about a **species**, so repeating "42 reports · 7 days" on each of five checklists of the same bird restates one fact five times. The report drops the *How rare* column and the app renders the **medium card**; depth about how rare a bird actually is now lives in Last 7-Days rarities, where the rows ARE species. `birdCard`/`rarityStats` stay — the ABA section still profiles one bird at a time, which is what a card is for. **v1.0.30 takes it one size smaller still, to the small card**, at the user's request — the section is a list, and a list of a dozen checklists reads better as rows than as cards. Nothing was dropped to get there: the icon, the linked name, the 🔍/×N/📍/⚠️ tags and the distance stay on the row, and the three facts that no longer fit — **Where**, **Observer** and **Latest** — move to labelled rows beneath it, which is more legible than the dim `·`-joined run-on they were in before. |
| 🚨 Last 7-Days rarity reports | **Last 7-Days rarity reports** | ✅ | Own section (v1.0.7). Notable feed grouped by species with reports / observers / latest, scoped by `regions.py` rarity exclusions. Ports `section_rarities`. **v1.0.28 makes this the section that answers "how rare, really".** Each species is a medium card — name in the header, day count · report/observer/location counts · distance in the sub-header — with the closest hotspot and the latest checklist below it, and the full checklist list behind an expander rather than inline. That is the same shape the Markdown report uses (a `<details>` per species), and it is where the rarity evidence moved to when Today's rarities gave it up: here the row IS a species, so the numbers are stated once for the thing they describe. |
| 📋 All unseen reports | **📋 All unseen reports** | ✅ | Every unseen report, collapsed to one row per species-per-place (250 m clusters, mirrors `_group_unseen`), nearest first. |
| 🥚 Easy misses — common birds you haven't logged | **Easy misses** | ✅ | New in v1.0.16 — the highest hit-rate list in the report, and the last genuinely missing section. Ports `section_common_missing`: species **not** on your year list, ranked by **location-days** then frequency (a bird reported from eight places is one you can go and get; eight reports from one feeder is one lucky yard), each row offering the nearest 3 spots. **v1.0.22 makes the frequency bar adaptive in both repos.** A fixed ≥40%-of-days bar is correct but useless by mid-year: the genuinely common birds are already on the year list, so the section had thinned to two rows. The bar now steps 40% → 25% → 15% → 8% until 10 species qualify, exactly as Quick outing widens its radius — **and both repos print which bar was actually used**, because ">= 15% of days" is a materially different claim from ">= 40%" and a silently relaxed threshold is a lie by omission. **The sampling window is the one deliberate delta:** the report derives prevalence from every daily snapshot it has committed (75 days today) via `_build_local_prevalence`; the app has no such archive, so it samples the **last 30 days** live from each county's `historic/{y}/{m}/{d}?detail=full&cat=species` feed on the background lane. `cat=species` drops sp./slash/hybrid/domestic server-side — exactly what `report._non_countable_codes()` strips. A past day's checklists never change, so each fetched day is cached permanently: the first run pays ~60 background calls, later runs fetch only the days that have appeared since. |
| 🗺️ &lt;region&gt; unseen — closest first | — | ➖ | Overlaps three sections the app already carries (**Targets near you**, **Closest spots**, **Easy misses**). Merging the four "what haven't I seen?" views is a product decision about which axis you actually chase by — see the backlog before porting one of them in isolation. |
| 🔬 iNaturalist unseen | — | ➖ | Beta section reading a **non-eBird** source (iNaturalist). The app has no iNaturalist client, and adding one buys a second taxonomy to reconcile for a section that is still experimental in the report. |
| 📅 Year-to-date ABA rarities | — | ➖ | Rarity-tracker-only archive of every ABA rarity so far this year, accumulated from committed daily snapshots the app doesn't have. The app shows the **live** ABA alert instead, which is what you'd chase. |
| 🔍 Watchlist (verification chases) | **Needs verification** | ✅ | New in v1.0.23. The list is the one input that changes what "seen" MEANS: `seen = (year list ∪ imported codes) − watchlist`, so a tentative ID keeps surfacing as a target in Closest spots, Easy misses and everywhere else until you confirm it. The app ports that subtraction exactly (`getReportSeen`) and renders the same chase view the report does — nearest recent report per tracked species, closest first, silent species still listed so the inventory is complete. **It also MANAGES the list, which the report cannot:** search the region's species, ▲ ▼ reorder, ✕ remove — same controls and same layout as Favorite hotspots. **One deliberate divergence, and it is a hard constraint rather than a shortcut:** `birdlist-needsverification.md` lives in the PRIVATE pipeline repo and the app has **no runtime GitHub dependency**, so app edits are device-local. A 📋 button emits the exact `N. Common Name` shape `analyze.py` parses back, and the UI says so instead of pretending the edit round-trips. Un-tracking a species restores it to the seen set **only where that report actually held it back** (`watchHeld`, computed in `build-seed.js` before the subtraction) — otherwise dropping a bird you never recorded would invent a year tick. |
| 🦅 ABA Code 3+ rarities | **ABA Code 3+ rarities** | ✅ | Direct (keyless) read of the public ABA Rarities alert page; for county reports it filters to the active state and groups by species exactly like `section_state_aba_rarities`. In-app login is only a fallback. Ports `aba_rba.py` incl. `_resolve_subnational1`. **v1.0.22 renders each species as a card, not a row** — the section normally holds 0–3 birds you have most likely never seen, so the questions are "what does it look like", "how rare is this really" and "what IS it", in that order. Both repos print Reports · Observers · Places · Days. **One deliberate divergence:** the app also shows *reports ABA-wide* and *states/provinces*, because on device it holds the unfiltered continent alert; `section_state_aba_rarities` is state-scoped by construction and shows the local numbers only. **v1.0.25/26 — the ABA-wide stat, twice wrong.** It first read "N reports ABA-wide" from row counts in the continent-wide alert. MEASURED live: that page returns **exactly 500** observations, grouped by species in **taxonomic order**, with no pagination, no stated total and no truncation notice — so a species' row count is its slice of a fixed budget. Terek Sandpiper's slice read 26, 34, 34, 29, 36, 37 on consecutive days while the bird sat in one place. v1.0.25 replaced it with the species-scoped country feed (`data/obs/US|CA/recent/{code}`), which is uncapped — but MEASURED against the live API that endpoint returns exactly **one observation per location** (max 1 row at any single location for every species tested, where `recent/notable` returned 78 rows at one location over the same window). So v1.0.25 shipped a **location** count labelled "reports": a number too small where the old one was too big, and worse for being confidently precise. v1.0.26 labels it for what it measures — **"locations ABA-wide"** — and keeps "states/provinces", which is accurate because every location appears exactly once and carries its `subnational1Code`. A continent-wide **report** count is not cheaply obtainable from any endpoint, so it is no longer claimed. The Markdown report prints no ABA-wide line, so this is app-only enrichment, not a divergence in a shared number. **v1.0.27 — the cap is now DETECTED and stated, in both repos.** Knowing the page truncates was not the same as telling the reader, and the section still presented a capped list with the confidence of a complete one. Two further measurements closed it. First, the cap is hit **every single day**: a live parse returns exactly 500 rows. Second — and this is why it went unnoticed — the stored snapshots read 493–497 and looked like comfortable headroom, but that count is taken **after** the region filter: 500 parsed, 3 US-UM (Minor Outlying Islands) records dropped by the ABA-area filter, 497 written to disk. "Never above 497" was the cap plus a filter, not slack. So truncation is now measured on the **raw parse** and carried on the records (`_alert_truncated` / `_alert_raw_rows`, following the existing `_country`/`_source` underscore convention), because a 6-row Washington slice cannot testify about the continent-wide page it was cut from. Both repos render the same warning naming the cap and — the load-bearing part — the *shape* of the loss: the page is grouped by species in **taxonomic order** (49 species produced exactly 49 contiguous runs, Taiga Bean-Goose through Morelet's Seedeater), so the cut always takes the **tail** and whole species vanish rather than each shedding a few rows. The empty state no longer asserts a negative the feed cannot support. Region-scoped alerts are not an escape: `&r=`, `&regionCode=` and `&r1=` were all tried live and all returned the same 500 rows. |

## Destinations & routing

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🥇 Top destinations | **Top destinations** | ✅ | Ports `score = Σ (3 if rarity else 1)` per unseen species, clustered by locId; inline SVG map + Maps links. |
| 📍 Closest spots with unseen birds | **Top destinations** (distance) | ✅ | Same ranking, **sorted closest-first with the distance in miles on every row** (v1.0.15), as the report prints it. Needs Home set. |
| 🚗 Top excursions | **Top excursions** | ✅ | Far-from-home clusters with soft distance penalty `score/(1+extra/30)`; needs Home set. |
| 🧭 Trip planner — half-day route | **Trip planner** | ✅ | Nearest-neighbour route through the top ≤6 nearby target hotspots; SVG map with route path + per-leg / round-trip miles. |
| 🚶 Quick outing — best hotspots close by | **Quick outing** | ✅ | `ref/hotspot/geo` hotspots within **5 mi** — an impulse detour of about five minutes (v1.0.15, both repos; was 15 mi). Quality (all-time diversity + recent activity) still decides *which* spots make the cut, but the table is **read closest-first**. The radius widens to 10 then 15 mi rather than print an empty section in a sparse region, and says so. **v1.0.22 makes the anchor a choice — the one deliberate divergence in this section.** The app offers 🏠 Home · 🏢 Work · 📍 Current location (unset anchors relabel to "Set home"/"Set work"; current location falls back to a typed place if location services are refused) and scans **one** circle around whichever you pick. A Markdown report is generated hours before you read it and cannot ask, so it keeps ranking from the fixed configured anchors. Same scoring, same widening ladder, same closest-first order — only the centre differs. **v1.0.31 makes 📍 Current location actually work on device.** It called `navigator.geolocation`, which is the wrong API inside a Capacitor app: WebKit only honours the web Geolocation API on origins it considers secure, and Capacitor serves the app from `capacitor://localhost`, so on iOS the object *exists* (every `if (!navigator.geolocation)` guard passes) and then calls **neither** callback — no prompt, no error, no result, just "Asking for your location…" forever. It now goes through the native `@capacitor/geolocation` bridge to CoreLocation, which is not scheme-bound, with the web API kept only as the browser-preview fallback. Two further fixes ride along: iOS refuses the request outright unless `NSLocationWhenInUseUsageDescription` is in `Info.plist`, and since `ios/` is regenerated by CI on every build that key is injected by the workflow rather than committed; and the wait is now bounded by **our own watchdog**, because a `PositionOptions` timeout is enforced by the implementation and therefore cannot fire when the implementation is the thing that went quiet. Every failure — refused, silent, absent — still lands on the same typed-place fallback, and a refusal names the iOS switch to flip instead of quoting the browser's words. |
| 📍 Favorite hotspots | **Favorite hotspots** | ✅ | Pin any hotspot from the lists (⭐); per-hotspot recent sightings via `data/obs/{locId}/recent`. **v1.0.22 makes the list editable in place**: a lookup field adds a hotspot by name (`ref/hotspot/{region}` scoped to the report's counties) without having to find it in another section first, and every row carries ▲ ▼ reorder and ✕ delete controls. Order is the user's, so it is stored, not derived — the report reads the same saved order. **v1.0.24 brings the CONTENT to parity, which is the part that was actually missing.** The app showed a name, a Maps link and a tap-to-load dump of every species at the spot — including the ones already on your year list, which answers "what lives here" rather than "should I drive there today". It now ports `section_favorites`' filter exactly: rarities (⭐) → watchlist verifications (🔍) → species not on your year list, newest first within tier, capped at 12, with the same header (distance from home · species in 7d · **reports in last 24h**) and the same empty-state sentence rather than a blank row. Your own checklists are dropped in both repos — favorites surface what OTHERS are finding at your regular spots. **One deliberate divergence, in the rarity input:** the report holds `rarity_codes` from the day's snapshot, while the app reuses the merged feed the chase sections already fetched (`kind === 'Rarity'`), so the section costs one hotspot feed per pin and **no** extra notable call. Detail is cached per `locId`, so ▲ ▼ ✕ repaint from memory instead of refetching. **v1.0.30 fixes the layout, which was still the app's own.** The bird rows are now built by the shared small species card rather than hand-rolled markup, so this section inherits every fix the other lists get (and four raw `target="_blank"` links became Capacitor-safe `data-href` in the process). The hotspot name went 19px → **24px**, because at 19px it did not outrank the 17px species names beneath it and the row read as birds with a caption instead of a place with birds under it. The distance and the map link moved **out of the title and below the card**, where the other hotspot sections put them — crammed into the heading they made the name a caption with facts stuck to it, and the inline 🗺 duplicated the Open in Maps link sitting immediately below. |

## Hotspot intelligence

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🦜 Birdiest recent checklists | **Birdiest checklists** | ✅ | Per-county `product/lists` merged, then mirrors `section_birdiest_checklists`: dedup by checklist, last 7 days, public hotspots only (skips restricted), best checklist per hotspot by `numSpecies`, within 40 mi of Home, top 25 — with observer + checklist link. |
| 🔥 Hot hotspots — recent surges | **Hot hotspots** | ✅ | From each report county's 30-day hotspot recent feed (`recent?hotspot=true`), merged, buckets each species' freshest sighting by `locId`; joined with `ref/hotspot/{region}` metadata and ranked `fresh × (1 + fresh/all-time) ÷ (1 + dist/10)` within 35 mi of Home — same score as `section_hot_hotspots` (`HOT_MIN_FRESH=5`). |
| 🥶 Cold hotspots — overlooked gems | **Cold hotspots** | ✅ | High all-time diversity (`≥100`), currently quiet hotspots within 35 mi of Home, ranked by the report's pre-refinement `upper_score = all-time × √(1 + min(silent days, 30)) ÷ (dist + 5)`; `latestObsDt` overridden by the recent feed. Shares the per-county hotspot fetch with Hot hotspots. (Report additionally refines the top ~30 with per-hotspot historic sampling; the app uses the metadata pre-rank to stay at 2 calls.) |
| 👥 Birder convoys | **Birder convoys** | ✅ | Detects birding groups from the report's **per-county** `product/lists` feeds (merged, last 7 days): dedupes checklists by `subId`, skips your own, groups by shared `locId`+exact submitted time (eBird's shared-checklist signature). A convoy = ≥2 birders sharing ≥2 stops in one day; sorted by **date, newest first** (top 10). Detection runs the parity-tested `BirdLogic.convoyDetect` — same as `section_birder_convoys` (`CONVOY_LOOKBACK_DAYS=7`, `CONVOY_MIN_STOPS=2`). Since v1.0.14 each convoy renders as its own block — *Mon D Convoy of N* (v1.0.15), a map of its hotspots, an **unseen** species list, a **seen** species list, then the numbered stops with one checklist link per member labelled by `subId`. Nothing is collapsed and no member names are printed. Species are pooled from each stop's `product/checklist/view/{sub}` obs and hydrated automatically. Layout is guarded by `birding/tests/parity/test_convoys.py`. v1.0.15 fixed a false-unseen bug: `isSpeciesSeen` compared only the raw code and an exact name, so *Dark-eyed Junco (Oregon)* read as unseen for anyone with a Dark-eyed Junco on their year list. It now follows the taxonomy `reportAs` chain (a port of `analyze.py::_resolve_species`) and falls back to the name with its parenthetical form stripped. Bird lists are flex rows, so a floated thumbnail no longer stacks them diagonally. |
| ⏰ Time-of-day specialists | **Time-of-day specialists** | ✅ | Accumulates **per-county** checklist observation hours (`historic/{y}/{m}/{d}` daily snapshots + each county's Notable feed); the dawn (≥50% before 7am) / dusk-night (≥30% after 7pm) split delegates to the parity-tested `BirdLogic.todSpecialists` (report `time_of_day.py` thresholds, `MIN_OBS=5`). Sample grows richer each run. |

## Personal stats

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🐦 header — year list count | **My year** count | ✅ | Current-year species count from the imported CSV's Date column, or from the bundled seed on first run. Top-100 rank in **My eBird rankings**. |
| 🐦 {year} Year List | **My year** list | ✅ | Full per-report year list (v1.0.7): the same rows the report prints — oldest numbered 1, newest first, species → `/species/{code}/{state}`, date → `/checklist/{subId}`, location link, "all obs" lifelist link, plus a thumbnail per entry. Built by `assets/build-seed.js`, whose parser now mirrors `report.py::_parse_lower48_year_list` exactly (section-aware, native-only) — cross-checked against the report in CI. |

## Environmental (non-eBird sources)

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🌤 Conditions — weather + tides | **Conditions for chasing** | ✅ | NOAA `api.weather.gov` 4-period forecast (🐦 southerly-wind flag) + NOAA CO-OPS tides (defaults to the report's tide station; inland reports have none) + locally-computed sunrise/sunset, first/last light, daylight length, and moon phase. Called straight from the device — no GitHub. The tide table is **one row per window** (v1.0.15, both repos) rather than one per turning point, with the rising (incoming) windows marked 👀 and bolded — that is the one row in the section that should make you leave the house. The last turning point of the day emits a trailing "→ overnight" window so an overnight incoming tide isn't dropped. |
| 🛬 Migration outlook | **Migration outlook** | ✅ | User-triggered one-time bootstrap fetches ~2 years of weekly (`historic/{y}/{m}/{d}`) checklists **per county** (merged into one sample per week), cached in localStorage (resumable). Derives per-species weekly phenology and flags arrivals (unseen targets whose first-presence week is within 2 weeks) + departures (report year-list species whose last week is near) — ports `migration.py`'s `_detect_run`/`expected_soon` (year-round ≥40 wk or gap ≤4; window 2 wk). |
| 🌙 Nightly migration — BirdCast | **Nightly migration** | ✅ | Season-aware **per-county** deep links to BirdCast's live radar dashboards (`dashboard.birdcast.org/region/<county>` for each report county); knows the live-forecast windows (Mar 1–Jun 15, Aug 1–Nov 15) and shows the next active date between seasons — same season logic as the report's `section_birdcast`. No API (BirdCast has none). |

## Leaderboards (website-scraped in report; read directly on device)

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🏆 eBird Rankings — <region> | **eBird Rankings & Top 100** (standing) | ✅ | Direct keyless read of `ebird.org/top100`, cached once per day like `rankings.py`. Scoped to the selected region’s own board via `rankings.py::primary_region_for()`, mirrored by the app’s `rankPrimaryRegion()`. v1.0.13 makes the app **verify the region eBird declares on the page it served** (canonical link / hidden input) and refuse a mismatch, retrying alternate URL forms first — on device the request crosses Capacitor’s native HTTP stack and a shared eBird session, either of which could hand back a different board that parsed perfectly under the wrong heading. v1.0.15 prints the rank **out of the number of eBirders**, as the report does; `product/region/{rc}/ebirders/count` rejects a normal API key, so the app lifts eBird's own web token exactly as `rankings.py` does (resolved by parameter *name* so eBird can reorder its minified args) and omits the field size rather than fail if it can't. |
| ↳ Top 100 eBirders (same section) | **eBird Rankings & Top 100** (board) | ✅ | v1.0.12 folded the report’s separate `## 🥇 Top 25` headings into the rankings section in BOTH repos — one region, one standing, one board. Highlights your row. v1.0.16 widens both sides from 25 to the full 100 eBird publishes (`rankings.TOP_BOARD_N` / the app's `TOP_BOARD_N`) and drops the *Checklists* column: rank, birder and species answer "who is ahead of me and by how much"; checklists is effort, not standing, and cost a quarter of the width on a phone. In the **report** the 100 rows sit inside a collapsed `<details>` — each committed day is a dated snapshot of the board and eBird publishes no historical endpoint, so it has to stay in the file without pushing the rest of the report off the screen. |
| ↳ rank history / trend | **eBird Rankings** (trend) | ⚠️ | App-only, and *cannot* be brought to parity. `ebird.org/top100?year=` is year-to-date only, so a past standing can never be re-fetched. The report gets history for free (every committed `reports/<region>/<date>.md` is a dated board); the app has no GitHub access by design, so it records `{d, rank, species}` to `localStorage['ebird_rankhist:<region>']` on each successful read — one entry per region per day, capped at 180 — and renders a sparkline. **Forward-only: it starts the day you install and can never be backfilled.** |
| 🔭 Latest ticks on the leaderboard | **Latest ticks on the leaderboard** | ✅ | v1.0.13 scoped this to the report’s **own** board in BOTH repos. Both sides pooled every board they fetched (WA also fetches Lower 48 for `section_year_list`), so a Washington chase board listed Palila, California Gnatcatcher and Yellow-headed Amazon — 20 of 33 rows unchaseable — each flagged 🔍 as a WA target. Guards: `tests/parity/test_last_new.py` + a `dom.test.js` fetch-count check. v1.0.15: large icon + title, the bird links to its region-scoped species page (`/species/{code}/{state}`), and `LAST_NEW_FRESH_DAYS = 3` means every checklist from the last three days is shown — the 5-row cap is now a floor, not a ceiling, because a 3-day-old list is still chaseable. **v1.0.30 fixes the type ranking, which had it backwards.** The roster of who added the bird was set at the same size as everything else, so a list of eight names visually outweighed the species it was about. Sizes are now assigned by what a list *is* rather than by which section shows it: the bird name **29px** (it is the subject) > the checklist rows **17px** (they are the thing you act on) > the roster **14px** (it is corroboration, read at a glance). A guard parses the actual px values so the ranking cannot silently invert again. |
| 🏅 Your state rankings | — | ➖ | Rarity-tracker-only cross-region table (`section_state_leaderboards`). The app scopes to one region by design — switch regions in the nav to see another. |

## App structure

| Report piece | App equivalent | Status | Notes |
|---|---|---|---|
| Contents (TOC) | Panel layout | ➖ | Single-screen app; panels replace a TOC. |
| ⓘ How this is calculated | **ⓘ button on every section** | ✅ | New in v1.0.22, and the only feature in this file that is **authored once and shipped twice**. `section-docs.json` documents each section's *summary · data it reads · how it is computed · limits*; the app bundles it (so the button works with no network) and `birding/section-docs.json` is a byte-identical vendored copy that `report.py::_inject_section_anchors` renders under each H2 as a collapsed `<details>`. Byte-identity, full coverage and absence of orphans are enforced by `tests/parity/test_section_docs.py` — the same enforced-mirror pattern as `logic.js` ↔ `report.py`. It exists because several sections answer a question the reader cannot reverse-engineer from the output: why Closest spots looks sparse, or what "easy" means in Easy misses. |
| Reports | — | ➖ | The report's index of published Markdown files. Meaningless on device: the app builds the report locally and never reads GitHub. |
| Run this on another computer | — | ➖ | Setup instructions for the pipeline repo, not a birding section. |
| Footer | Footer badge | ✅ | Version / phase badge. |

## App-only

**Species lookup (v1.0.37) — the one section that answers a question you bring
to it.** Every other "where is this bird" view in the app starts from a list the
app chose: your unseen targets, today's rarities, the closest spots. This one
starts from a bird *you* name. Type any species, and it lists every place it has
been reported in the last 30 days, with the checklist, count, date and distance
behind each one — sortable by date ("is it still around?") or by distance ("how
far must I drive?"), which are two different questions served by **one** fetch.

Built on `data/obs/{region}/recent/{speciesCode}` — the same per-species
endpoint F9 introduced, which is why it cost one fetch and one sort rather than
a new pipeline. It reuses `searchSpecies` to resolve a name to a code and the
shared medium species card to render the answer.

**It deliberately answers for birds you have already seen**, marked ✅ *already
on your year list*. That is the whole point of a lookup as opposed to the target
lists: "I saw a Western Grebe in March, where are they now?" is a real question,
and every other section in the app refuses it by construction.

**No report equivalent, and there should not be one.** A Markdown report is a
daily snapshot with no input box — a lookup is interactive by definition. It is
recorded in `report-contract.json` with `report: null` and a stated reason,
following the `settingsPanel` precedent, so the parity checker knows the
omission is intentional rather than a section that silently went missing.

Not a report section, but an app-native touch: the **Notable** panel shows an
in-app "N new since last check" indicator, using a region-scoped baseline of
rarity species codes in localStorage. True background / push rarity alerts are
deliberately out of scope — the app runs with no server (by design) and
free-Apple-ID sideloads cannot use push notifications.

**Text scale for low vision (v1.0.22).** Settings → *Text size* scales the whole
UI from Normal to Huge. Implemented as a single CSS custom property (`--s`) that
every `font-size` and every fixed icon box multiplies through `calc()`, applied
before first paint. CSS `zoom` was rejected outright: it silently breaks
Leaflet's container measurement and hit-testing, so the maps would have gone
subtly wrong at every size but 1.0. Changing the scale re-runs
`refreshVisibleMaps()` so Leaflet re-measures. There is no report equivalent —
Markdown inherits the reader's own browser or GitHub text size.

**Three card templates, and every list uses one of them (v1.0.28).** The report
is Markdown, so every section is a table and consistency is free. The app had
drifted into a dozen bespoke row layouts, and the reports that arrived were all
the same complaint about different sections: the title is too small, the title
is too big, it wraps oddly, the icons are grey squares. There are now exactly
three: **`.card-sm`** (a compact species row inside another card),
**`.card-md` / `.obs.xl`** (the workhorse — icon, header, sub-header) and
**`.card-lg` / `.cards`** (the full-bleed profile card, used only where the
section is *about* one bird). **The odd wrapping had one root cause, and it was
not the font size.** `.card-md` floated the thumbnail left, so the sub-header's
position depended on how many lines the title took: a short species name let the
sub-header ride up beside the photo, a long one pushed it below, and no two rows
in a list ever aligned. It is now a real **2×2 grid** — icon spanning both rows
in column 1, header and sub-header stacked in column 2, everything else full
width beneath — which is what was asked for and what makes a list of rows look
like a list. This requires `display: contents` on the wrapper the markup nests
the photo inside; every rule is `>`-scoped because a medium card now *contains*
a `.card-sm` species list, and a descendant selector would hand those nested
rows the outer card's typography. **Five sections that all answer "which
hotspots, and which birds are there" now render through one function**
(`hotspotCard`): Top destinations, Closest spots with unseen birds, Quick
outing, Top excursions and the Trip planner. They differ only in what goes in
the icon (a rank, a stop number) and which facts the sub-header carries, so a
fix to any of them is now a fix to all of them.

**The templates move into their own files, and there are now two families
(v1.0.30).** The ask was explicit: *"I want two versions of the templates, one
for displaying hotspots and one for showing species. I'd like this templated
source in separate files so that I can tweak them by looking at the sources."*
A card describing a **place** and a card describing a **bird** are not one
template with a different photo — a place needs a map link, a save control and
a list of what is there; a bird needs a photo, a name that links to its species
page and the facts that decide whether to chase it. Squeezing both into one
`.card-md` is why the hotspot sections kept needing per-section patches.
`www/cards-species.js` and `www/cards-hotspot.js` each ship small / medium /
large plus the placeholders (name, icon, distance, score) and inject their own
CSS. **They are the single source of truth, which meant MOVING the rules out of
`index.html`, not copying them** — the first pass duplicated them, which is
exactly the drift the split was meant to end, so a guard now fails the build if
any card rule is redeclared in `index.html`. The modules are **pure layout**:
they receive already-escaped, already-linked HTML and assemble markup, because
they load as separate `<script src>` and cannot see the escaping and
link-building helpers inside the app's single hoisted IIFE. That split is also
the point — layout is the part being tweaked.

**The medium hotspot card fixes what "collapse the species" was hiding.** Hot
hotspots put every species — seen and unseen together — behind one `<details>`,
so the one fact that decides whether to drive was a tap away on every row. A
hotspot card answers one question: *is this worth the drive?* Only the unseen
birds answer it, so they render **open**, as small species cards. The seen
birds still earn a place — they say the spot is alive rather than empty — but
they are context, so they **collapse**, with the count on the `<summary>`
because that is the only thing readable while it is shut. Open in Maps and Save
sit below both, as they already did in Quick outing. That whole shape is now
the medium hotspot card rather than one section's markup, and a guard pins the
open/collapsed split so no section can invert it. The number is drawn as a
clone of the Leaflet map pin — pin 3 on the map and row 3 in the list are the
same place — at the small-icon size, not the photo size, because a one- or
two-digit number does not need 92px and the difference goes to the name, which
is the part that wraps.

**v1.0.32 — the seen list belongs to the CARD, and there is now one definition
of "seen".** Two bugs, one shipped fix. First, only Hot & Cold actually passed
a seen list: they are the one pair that runs its own hotspot scan, while the
other five sections read the CHASE feeds, which carry every recent observation
and are then *filtered* to unseen for ranking — so the seen birds were fetched,
merged, distance-annotated and then discarded one step before the card. They
are now recovered from the same cached `cv.merged` the rows were ranked from
(`locSpeciesIndex` / `locSpeciesSplit`), so the collapsed list costs **zero
extra network** and cannot describe a different moment than the sub-header
above it. A caller either brings its own scored unseen list and we fill in only
the seen half, or it brings neither and both halves come from the index —
never one without the other, because a card showing the seen list while hiding
the unseen one answers *"is this worth the drive?"* with a confident **no**
about a spot with a target sitting on it.

Second, and worse: the app had **two disagreeing definitions of "seen"**.
`getReportSeen()` is the active report's year list, mirroring the Markdown
report; `isSpeciesSeen()` reads `localStorage` `ebird_seen`, which `applySeed()`
fills with the **combined cross-region** code list. Measured against the shipped
seed those sets differ by **28 codes on the Washington report (331 vs 303)**,
and on the Waikoloa trip report — whose entire premise is that every Big Island
bird is a lifer target — the combined set claims **all 331**. Hot & Cold ranked
with `isSpeciesSeen` alone, so a bird ticked in Missouri was reported as already
seen in Washington and buried in the collapsed context list: the section that
exists to say *"there are birds here you still need"* hiding 28 of them. Both
paths now resolve through one report-scoped `seenResolver()`, which also
respects `watchHeld` so a tentative ID deliberately held off the year list
still resurfaces as a target. Guarded by *a bird ticked in another region is
still a target in this report*, which derives its fixtures from the shipped
seed and fails if the seed ever stops diverging.

**v1.0.34 — four device reports, ONE root cause: an action-link rule was
styling card titles.** `index.html`'s
`.maplink, .extlink, .favlink, .mylink { margin-top: 8px; font-size: calc(13px
* var(--s)) }` was written for **action** links — "Open in Maps", "eBird". But
nearly every card **title** is rendered as `<a class="extlink">` (via `extA` /
`speciesLink` / `locLink`) *inside* `.ntext`, and a direct rule on the anchor
beats the size inherited from its container. **Every card name in the app
rendered at 13px with an 8px top margin regardless of what the card asked
for** — which is why raising `.hscard-md .ntext` from 23px to 46px in v1.0.32
changed nothing on screen, and why *"the font size still has not increased"*
was reported three times across two releases. The same fact explains three more
symptoms: the 8px margin inside a tall line box **is** the reported blank line
above the name; the 15px `.meta` was **larger** than the 13px name, so the
card's sub-header outranked its own title; and because `.hsnum` spans both grid
rows at 46px while a 13px + 15px text block is only ~33px, the grid **stretched
the rows** to fit the badge — the reported dead space under the number. A grid
distributes a spanning item's height across the rows it spans, so
`align-content` cannot fix that; only a taller text block can. The fix is
scoping rather than deletion — a link in a name slot now inherits the title's
typography and keeps only its own colour — and the sizes are then set by what
the text *is*: hotspot name **26px** > meta **17px**, species medium name
**29px**. 46px was deliberately abandoned once it began to render at all: a
real name like *Marymoor Park--Audubon BirdLoop/Interpretive-Boardwalk* wraps
to about five lines on a 430px phone, which defeats the request that started
this ("make this more condensed"). `26×1.15 + 2 + 17×1.35 = 54.9 > 46` is what
holds the rows apart, and all three terms scale with `--s`.

**This one could not be found in jsdom, and that is the durable lesson.** jsdom
has no layout engine: it reported the `.ntext` rule as winning, because it
never resolves which of two matching declarations actually reaches the box. A
headless-Edge CDP probe measured the anchor itself — 13px before, 26px after.
For anything where the *cascade* is the bug, the test has to run in a real
layout engine.

**And the first guard written for it was VACUOUS, which is the sharper
lesson.** It booted the app and asserted `getComputedStyle(link).fontSize` was
not the action-link size — which looks like the strongest possible check and
proves nothing, because jsdom never applies index.html's action-link rule to
that link in the first place. The assertion passed identically with the fix
deleted; it was only caught by mutating the rule away and watching the test
stay green. jsdom *does* resolve specificity correctly on a stylesheet it
parses, so the guard now re-stages the card in a **clean document containing
the two real competing rules** — the action-link rule lifted from
`index.html` and the card CSS lifted from the modules' own injected `<style>`
elements, in shipped order — and asks which one wins, with a precondition
assertion that the staged sheet is live so it cannot quietly go vacuous again.
Both mutations (breaking either card family's reset) now fail it. Same rule
this project has hit twice before: **assert what a value means, and prove the
guard can fail.**

**All unseen reports now groups by species** (both repos still collapse
identically by (species, day) → 250 m cluster first — that is unchanged). One
medium species card per bird, listing every place it was seen with its
checklist link, count, date and distance, **newest place first**, while the
species themselves stay **nearest first** to match `section_all_unseen`. The
species count moved out of the header into the sub-header, where the other
counts live. **The report still prints one row per species per place**, because
a Markdown table cannot nest; the app groups because it can, and the same facts
are present on both sides.

**Two app-only fixes with no report equivalent:** the UI could be side-scrolled
off screen, now held by a root-only `html { overflow-x: clip }` guard —
root-only on purpose, because root overflow propagates to the viewport so
`#navbar`'s `position: sticky` survives, whereas putting it on `body` would
break it — plus `grid-template-columns: auto minmax(0, 1fr)` so a long unbroken
name cannot push a card wider than its container. And the kingfisher brand mark
was being cut mid-neck by its circular CSS mask: the crop is now **solved**
against the minimum enclosing circle of all four landmarks (centre (0.301,
0.295), R = 0.186 ⇒ s ≥ 0.372; shipped at 0.440 for margin) and `generate.js`
asserts the full **profile**, not just the face, so the nape can never be
clipped again. The mark grew 58 → 76px and the page header was condensed around
it. A square preview cannot reveal a circle-mask failure — this is the same
trap as the v1.0.21 clipped beak, so it was checked under the real mask.

**v1.0.33 — two app-only pieces of chrome, both with no report equivalent, and
one of them is the app's front door.** The section navbar had four things
competing for one flex row: a full `‹ Contents` **text** button, the 26px
brandmark, the section title, and a native `<select>` **sized by its longest
option label** ("Waikoloa / Big Island"). Only the title had no intrinsic
width, so the title was the one that got squeezed — the two separate device
reports ("the dropdown obscures the report name", "the back arrow is too
large") were the same bug seen from two sides. Measured: the fixed chrome ate
~354px of a 393px navbar, leaving **~39px** for the name of the section you are
reading; it now takes ~170px, leaving **~223px**. The region control stays a
real `<select>` — laid transparently (`opacity: 0`, which still receives taps,
unlike `visibility: hidden`) over a 🌎 glyph — because on iOS that opens the
native wheel picker showing the full labels, and because `syncRegionNav()` and
the existing region tests drive it as a `<select>`. The brandmark **stays**: it
costs 38px of the 223 reclaimed, and removing it would have meant weakening the
branding guard that requires the mark in both the header and the navbar. None
of this exists in the Markdown report, which has no chrome at all — the reader's
browser supplies the back button and the report is one region by construction.

**Guided eBird key acquisition (v1.0.33) — app-only, and the reason is
structural.** The report runs in CI with a key in the environment; the app runs
on a phone where a missing key means **nothing can load at all**, and the old
Settings copy was an untappable URL in a `<code>` block. Settings now carries
**Get a key** (opens `https://ebird.org/api/keygen` in the in-app web view, so
the eBird sign-in the form requires happens next to the field being filled in),
**Paste** (`navigator.clipboard.readText()` — no Capacitor Clipboard plugin is
installed, and the web API is gated behind a user gesture, so it only ever runs
from the tap; a refusal tells the user to long-press the field rather than
failing silently), and **Test** (one `ref/region/info/US-WA` call, which
distinguishes *eBird rejected this key* from *eBird is having a moment*). A
malformed key is now **named and refused instead of stored**: saved silently, it
turns into every section rendering empty, which reads as a broken app rather
than a typo. The Contents menu leads with a banner while no key is stored,
because that is the one screen a first-run user definitely sees.


OpenStreetMap, and every outbound map link in the app — every pin, every
"Directions", and the Trip planner route — is built from that choice. The
report hard-codes Google (`_route_maps_url`), which is correct for a Markdown
file: it is read on whatever device happens to open it, so it cannot know what
is installed. **The one honest wrinkle is waypoint support, which is not
uniform:** Google takes `&waypoints=a|b`, Apple chains `daddr=a+to:b`, Bing
takes `rtp=pos.a~pos.b~pos.c`, and **OpenStreetMap's directions URL accepts
exactly two points**. Rather than silently drop the middle of a six-stop route,
each provider declares whether it carries stops and the route link says
"(first → last stop only — OpenStreetMap cannot carry waypoints)" when it
cannot. A route link that quietly loses four of its six stops is worse than one
that admits it.

**Historic state records via GBIF (v1.0.24).** App-only, on the ABA rarity cards.
The ABA code is a *continental* rating, so the alert cannot tell you whether a
bird is a first state record or merely uncommon here — and that is the whole
difference between "drive now" and "note it". GBIF publishes eBird's own data as
the **EOD – eBird Observation Dataset** (`4fa7b334-…`), keyless and with no
account, so the card reads it directly from the device and spends **no eBird
quota**. Three cached calls per card (taxon match → state year facet → national
state facet), 30 days in `ebird_gbif_v1`. Two findings drive how it renders, both
measured rather than assumed:
- **A "record" is one row per observer per checklist**, so one staked-out bird
  twitched by 200 people reads as 200 records. Ruff in Washington is 1,085
  records but only 109 places across **36 years**. Years-with-records is the
  number that matches how rare a bird feels, and it orders the test species the
  way a birder would: Terek Sandpiper 0 < Red-necked Stint 8 < White Wagtail 12
  < Ruff 36.
- **A bare national count misleads.** 69% of the Terek Sandpiper's 898 US records
  are Alaska, where it is near-annual, across just 6 states. So the line names
  the top state and its share.
The snapshot stops short of today — as measured, at 2024 — so the card states the
window it searched instead of letting "1972–2023" imply the bird vanished.
`gbifSnapshotYear()` derives that edge from an Aves year facet (one call per
region per week) rather than hard-coding a year that would rot. The report has no
equivalent: it would need the same lookup per rarity per run, and its rarity
sections are already state-scoped by construction.

**Finder attribution (v1.0.24).** App-only. On an ABA card the earliest report in
the feed is credited as the finder — but **only when coverage opened before it**.
If the oldest record we hold sits at the edge of the window, the true finder is
someone earlier that we simply cannot see, so the card says "earliest report we
hold" rather than inventing a discovery. Useful for citing the original observer
in a follow-up checklist.


year lists (`www/seed-birdlist.js`, ~330 species codes) and loads it on first
launch so Targets / Destinations / My year / etc. have real data before any
CSV is imported. It matches by eBird `speciesCode` (exact and locale-proof).
Fully replaceable: importing a *Download My Data* CSV overrides it, *Clear*
removes it, and *Load sample data* brings it back. Regenerate from the private
report pipeline's `birdlist-*.md` exports with `node assets/build-seed.js`.

**In-app eBird login (P11) — now only a fallback.** The leaderboard and ABA
alert pages the report scrapes turn out to be **public**: `rankings.py` and
`aba_rba.py` both read them with a bare cookiejar and no credentials. Because
`CapacitorHttp` patches `fetch` natively (no CORS), the app reads the same HTML
directly and runs 1:1 ports of those regexes — so both sections show the
report's content with no sign-in. The in-app-browser login flow
(`@capgo/capacitor-inappbrowser`) is retained only as a fallback for when the
direct read fails: it opens the page, lets you log in once (the cookie persists
on device — no GitHub, no proxy), injects the same parser, and posts a small
JSON payload back over the bridge. *Sign out of eBird* in Settings clears the
browsing data.

**Bird photos.** Every species row carries a thumbnail. eBird/Macaulay has no
free photo API, so the app looks each common name up in the keyless,
CORS-enabled Wikipedia REST summary endpoint and caches hits *and* misses in
localStorage; a serial queue hydrates slots so a long list never fans out.
Misses simply hide the slot.

**External links.** The Markdown report links species, checklists, and hotspots
throughout; the app now emits the same three link shapes everywhere
(`/species/{code}/{state}`, `/checklist/{subId}`, `/hotspot/{locId}`, plus
`?/maps` for personal locations) and routes them to the system browser / Maps.

**Background history.** `migration.py`'s ~2-year weekly checklist bootstrap now
also runs unattended: a rate-limited background lane mirroring `ebird.py`
(1.2 s minimum interval ≈ 50 calls/min, `2**attempt` backoff on
429/500/502/503/504, max 4 retries) fills the cache 12 weeks at a time,
persists after every date so it resumes across launches, and yields to any
foreground request so the two never compete for the key.
