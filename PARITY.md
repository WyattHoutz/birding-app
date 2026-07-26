# Report ↔ App feature parity

Tracks every section of the Python birding report (`WyattHoutz/birding`,
`report.py`) against its status in this iPhone app. Keep this in sync as
features land so the two stay at parity.

**Status: ✅ full parity.** Every report section is either implemented in the
app or marked ➖ N/A (report-only concepts). Birder convoys — the last
historical/stats feature — landed alongside BirdCast, time-of-day, hot/cold
hotspots, and the migration outlook.

## Multi-report selector

The app ships all 9 reports. **Settings → "Default report"** switches between
Washington, Missouri, Kansas, Arizona, California, Lower 48, ABA Area, Fort
Casey, and Waikoloa. Each report carries its own counties, home base, geo
radius, and bundled year-list seen set (`seed-birdlist.js` →
`seenByReport[slug]`, generated to equal `analyze.py`'s exact seen formula).
The two rarity-tracker reports (Lower 48, ABA Area) have no county feeds, so
their chase tabs redirect to the ABA rare-bird alert + rankings — matching the
Markdown report, which builds those two from the same SN10489 scrape.

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
  `notable-today`, `new-arrivals`, `tod-hours-built`, `tod-specialists`,
  `convoys`.

An app-side glue test, [`assets/smoke-wiring.js`](assets/smoke-wiring.js) (21
checks), additionally proves `index.html`'s wired data layer (`getChase()`)
reproduces the golden destinations / excursions / new-arrivals, and that
`planFeeds` file names match the `mergePlan` map keys for all 9 reports.

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
| 🌅 Today's rarity reports / 🚨 Active rarities | **Notable sightings** | ✅ | `…/recent/notable` feed, live via CapacitorHttp. |
| 📋 All unseen reports | **Targets near you** | ✅ | Region `recent` minus your imported seen-list. |
| 🔍 Watchlist (verification chases) | — | ➖ | "Needs-verification" is a report-only concept; the app has no NV list. |
| 🦅 ABA Code 3+ rarities | **ABA rare-bird alert** | ✅ | In-app eBird login + scrape of the ABA Rarities needs alert (`sid` configurable); each record flagged seen/need against your list. Ports `aba_rba.py`. |
| 🌟 New arrivals today | **Fresh targets** | ✅ | Targets whose most-recent report is within 2 days (approximates arrivals — eBird API has no first-seen date). |

## Destinations & routing

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🥇 Top destinations | **Top destinations** | ✅ | Ports `score = Σ (3 if rarity else 1)` per unseen species, clustered by locId; inline SVG map + Maps links. |
| 📍 Closest spots with unseen birds | **Top destinations** (distance) | ✅ | Same ranking; distances shown when Home is set. |
| 🚗 Top excursions | **Top excursions** | ✅ | Far-from-home clusters with soft distance penalty `score/(1+extra/30)`; needs Home set. |
| 🧭 Trip planner — half-day route | **Trip planner** | ✅ | Nearest-neighbour route through the top ≤6 nearby target hotspots; SVG map with route path + per-leg / round-trip miles. |
| 🚶 Quick outing — best hotspots close by | **Quick outing** | ✅ | `ref/hotspot/geo` (≤32 km, active ≤30 days) ranked by all-time species; needs Home. |
| 📍 Favorite hotspots | **Favorite hotspots** | ✅ | Pin any hotspot from the lists (⭐); per-hotspot recent sightings via `data/obs/{locId}/recent`. |

## Hotspot intelligence

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🦜 Birdiest recent checklists | **Birdiest checklists** | ✅ | Per-county `product/lists` merged, then mirrors `section_birdiest_checklists`: dedup by checklist, last 7 days, public hotspots only (skips restricted), best checklist per hotspot by `numSpecies`, within 40 mi of Home, top 25 — with observer + checklist link. |
| 🔥 Hot hotspots — recent surges | **Hot hotspots** | ✅ | From each report county's 30-day hotspot recent feed (`recent?hotspot=true`), merged, buckets each species' freshest sighting by `locId`; joined with `ref/hotspot/{region}` metadata and ranked `fresh × (1 + fresh/all-time) ÷ (1 + dist/10)` within 35 mi of Home — same score as `section_hot_hotspots` (`HOT_MIN_FRESH=5`). |
| 🥶 Cold hotspots — overlooked gems | **Cold hotspots** | ✅ | High all-time diversity (`≥100`), currently quiet hotspots within 35 mi of Home, ranked by the report's pre-refinement `upper_score = all-time × √(1 + min(silent days, 30)) ÷ (dist + 5)`; `latestObsDt` overridden by the recent feed. Shares the per-county hotspot fetch with Hot hotspots. (Report additionally refines the top ~30 with per-hotspot historic sampling; the app uses the metadata pre-rank to stay at 2 calls.) |
| 👥 Birder convoys | **Birder convoys** | ✅ | Detects birding groups from the report's **per-county** `product/lists` feeds (merged, last 7 days): dedupes checklists by `subId`, skips your own, groups by shared `locId`+exact submitted time (eBird's shared-checklist signature). A convoy = ≥2 birders sharing ≥2 stops in one day; ranked by stops → group size → recency (top 10). Detection runs the parity-tested `BirdLogic.convoyDetect` — same as `section_birder_convoys` (`CONVOY_LOOKBACK_DAYS=7`, `CONVOY_MIN_STOPS=2`). Lazy per-route **combined species** expander pools each stop's `product/checklist/view/{sub}` obs and flags 🆕 species not on your list via one batched `ref/taxonomy` lookup (ports `_convoy_species_cell`). |
| ⏰ Time-of-day specialists | **Time-of-day specialists** | ✅ | Accumulates **per-county** checklist observation hours (`historic/{y}/{m}/{d}` daily snapshots + each county's Notable feed); the dawn (≥50% before 7am) / dusk-night (≥30% after 7pm) split delegates to the parity-tested `BirdLogic.todSpecialists` (report `time_of_day.py` thresholds, `MIN_OBS=5`). Sample grows richer each run. |

## Personal stats

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🐦 header — year list count | **My year** count | ✅ | Current-year species count from the imported CSV's Date column, or from the bundled sample list on first run. Top-100 rank now in **My eBird rankings** (login-gated). |
| 🐦 Year List | **My year** list | ✅ | Expandable current-year (and all-time, for CSV) species lists, from the imported CSV or the bundled sample data. |

## Environmental (non-eBird sources)

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🌤 Conditions — weather + tides | **Conditions for chasing** | ✅ | NOAA `api.weather.gov` 4-period forecast (🐦 southerly-wind flag) + NOAA CO-OPS tides (defaults to the report's tide station; inland reports have none) + locally-computed sunrise/sunset, first/last light, daylight length, and moon phase. Called straight from the device — no GitHub. |
| 🛬 Migration outlook | **Migration outlook** | ✅ | User-triggered one-time bootstrap fetches ~2 years of weekly (`historic/{y}/{m}/{d}`) checklists **per county** (merged into one sample per week), cached in localStorage (resumable). Derives per-species weekly phenology and flags arrivals (unseen targets whose first-presence week is within 2 weeks) + departures (report year-list species whose last week is near) — ports `migration.py`'s `_detect_run`/`expected_soon` (year-round ≥40 wk or gap ≤4; window 2 wk). |
| 🌙 Nightly migration — BirdCast | **Nightly migration** | ✅ | Season-aware **per-county** deep links to BirdCast's live radar dashboards (`dashboard.birdcast.org/region/<county>` for each report county); knows the live-forecast windows (Mar 1–Jun 15, Aug 1–Nov 15) and shows the next active date between seasons — same season logic as the report's `section_birdcast`. No API (BirdCast has none). |

## Leaderboards (website-scraped in report; in-app via eBird login)

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🏆 eBird Rankings | **My eBird rankings** | ✅ | In-app eBird login → scrape of `top100`; shows your rank + species + checklists + recent. Ports `rankings.py`. |
| 🥇 Top 25 eBirders | **My eBird rankings** (list) | ✅ | Renders the top-25 leaderboard rows, highlighting your row. |
| 🏅 Your state / Lower 48 / ABA rankings | **My eBird rankings** (scope) | ✅ | Scope selector — your region, Lower 48, or ABA Area — mirrors `rankings.py` REGIONS query construction. |

## App structure

| Report piece | App equivalent | Status | Notes |
|---|---|---|---|
| Contents (TOC) | Panel layout | ➖ | Single-screen app; panels replace a TOC. |
| Footer | Footer badge | ✅ | Version / phase badge. |

## App-only

Not a report section, but an app-native touch: the **Notable** panel shows an
in-app "N new since last check" indicator, using a region-scoped baseline of
rarity species codes in localStorage. True background / push rarity alerts are
deliberately out of scope — the app runs with no server (by design) and
free-Apple-ID sideloads cannot use push notifications.

**Bundled sample data.** The app ships a snapshot of the owner's eBird 2026
year lists (`www/seed-birdlist.js`, ~330 species codes) and loads it on first
launch so Targets / Destinations / My year / etc. have real data before any
CSV is imported. It matches by eBird `speciesCode` (exact and locale-proof).
Fully replaceable: importing a *Download My Data* CSV overrides it, *Clear*
removes it, and *Load sample data* brings it back. Regenerate from the private
report pipeline's `birdlist-*.md` exports with `node assets/build-seed.js`.

**In-app eBird login (P11).** The two leaderboard/ABA features above hit eBird
pages that redirect to Cornell SSO, so the REST key can't reach them. The app
opens the target page in an in-app browser (`@capgo/capacitor-inappbrowser`),
lets you log in once (the session cookie persists on device — no GitHub, no
proxy), then injects a parser into the eBird page that scrapes the
server-rendered HTML and posts a small JSON payload back over the bridge (never
piping eBird's multi-MB HTML across). The parsers are 1:1 ports of the
pipeline's `rankings.py` / `aba_rba.py` regexes. *Sign out of eBird* in Settings
clears the browsing data. The flow can only be exercised on-device with real
credentials; offline it's covered by parser unit tests + the CI compile.
