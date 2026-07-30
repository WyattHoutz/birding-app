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

## Multi-report selector

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
| 🌅 Today's rarity reports | **Today's rarity reports** | ✅ | Renders `BirdLogic.computeChaseViews().notableToday` — the parity-tested port of `section_today` (today's `obsDt` only, one row per checklist, newest first). Before v1.0.14 it read a raw `recent/notable` feed, which is eBird's **14-day** window, so the app showed birds the report never listed. v1.0.22 gives it the **baseball-card** treatment the ABA section uses — big photo, headline name, a Wikipedia blurb — because it is the same kind of bird (usually two or three, usually unfamiliar), and both repos now print the same **rarity evidence**: reports · observers · locations · days. That spread is the load-bearing part — 42 reports from **1 location over 7 days** is a stakeout you can still drive to; 42 reports from 12 locations is a bird moving through. **v1.0.28 reverses the v1.0.22 decision, in both repos.** The baseball card was the wrong instrument here: this section is a list of **every rare-bird checklist filed today** — one row per report, sometimes a dozen — and a full-bleed photo card per row turned a scannable list into a scroll. The rarity-evidence columns went with it: they are a claim about a **species**, so repeating "42 reports · 7 days" on each of five checklists of the same bird restates one fact five times. The report drops the *How rare* column and the app renders the **medium card**; depth about how rare a bird actually is now lives in Last 7-Days rarities, where the rows ARE species. `birdCard`/`rarityStats` stay — the ABA section still profiles one bird at a time, which is what a card is for. |
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
| 🚶 Quick outing — best hotspots close by | **Quick outing** | ✅ | `ref/hotspot/geo` hotspots within **5 mi** — an impulse detour of about five minutes (v1.0.15, both repos; was 15 mi). Quality (all-time diversity + recent activity) still decides *which* spots make the cut, but the table is **read closest-first**. The radius widens to 10 then 15 mi rather than print an empty section in a sparse region, and says so. **v1.0.22 makes the anchor a choice — the one deliberate divergence in this section.** The app offers 🏠 Home · 🏢 Work · 📍 Current location (unset anchors relabel to "Set home"/"Set work"; current location falls back to a typed place if location services are refused) and scans **one** circle around whichever you pick. A Markdown report is generated hours before you read it and cannot ask, so it keeps ranking from the fixed configured anchors. Same scoring, same widening ladder, same closest-first order — only the centre differs. |
| 📍 Favorite hotspots | **Favorite hotspots** | ✅ | Pin any hotspot from the lists (⭐); per-hotspot recent sightings via `data/obs/{locId}/recent`. **v1.0.22 makes the list editable in place**: a lookup field adds a hotspot by name (`ref/hotspot/{region}` scoped to the report's counties) without having to find it in another section first, and every row carries ▲ ▼ reorder and ✕ delete controls. Order is the user's, so it is stored, not derived — the report reads the same saved order. **v1.0.24 brings the CONTENT to parity, which is the part that was actually missing.** The app showed a name, a Maps link and a tap-to-load dump of every species at the spot — including the ones already on your year list, which answers "what lives here" rather than "should I drive there today". It now ports `section_favorites`' filter exactly: rarities (⭐) → watchlist verifications (🔍) → species not on your year list, newest first within tier, capped at 12, with the same header (distance from home · species in 7d · **reports in last 24h**) and the same empty-state sentence rather than a blank row. Your own checklists are dropped in both repos — favorites surface what OTHERS are finding at your regular spots. **One deliberate divergence, in the rarity input:** the report holds `rarity_codes` from the day's snapshot, while the app reuses the merged feed the chase sections already fetched (`kind === 'Rarity'`), so the section costs one hotspot feed per pin and **no** extra notable call. Detail is cached per `locId`, so ▲ ▼ ✕ repaint from memory instead of refetching. |

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
| 🔭 Latest ticks on the leaderboard | **Latest ticks on the leaderboard** | ✅ | v1.0.13 scoped this to the report’s **own** board in BOTH repos. Both sides pooled every board they fetched (WA also fetches Lower 48 for `section_year_list`), so a Washington chase board listed Palila, California Gnatcatcher and Yellow-headed Amazon — 20 of 33 rows unchaseable — each flagged 🔍 as a WA target. Guards: `tests/parity/test_last_new.py` + a `dom.test.js` fetch-count check. v1.0.15: large icon + title, the bird links to its region-scoped species page (`/species/{code}/{state}`), and `LAST_NEW_FRESH_DAYS = 3` means every checklist from the last three days is shown — the 5-row cap is now a floor, not a ceiling, because a 3-day-old list is still chaseable. |
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
