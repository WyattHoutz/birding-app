# Report ↔ App feature parity

Tracks every section of the Python birding report (`WyattHoutz/birding`,
`report.py`) against its status in this iPhone app. Keep this in sync as
features land so the two stay at parity.

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
| 🦅 ABA Code 3+ rarities | — | 🟡 | Approximate via country-level notable feed; eBird API exposes no ABA code. Planned. |
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
| 🦜 Birdiest recent checklists | **Birdiest checklists** | ✅ | `product/lists/{region}` ranked by `numSpecies`, with observer + checklist link. |
| 🔥 Hot hotspots — recent surges | — | 🧪 | Needs recent-vs-baseline activity comparison. |
| 🥶 Cold hotspots — overlooked gems | — | 🧪 | Needs hotspot activity stats. |
| 👥 Birder convoys | — | 🧪 | Group-route detection across checklists; low priority. |
| ⏰ Time-of-day specialists | — | 🧪 | Needs historical checklist-time aggregation. |

## Personal stats

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🐦 header — year list count | **My year** count | ✅ | Current-year species count from the imported CSV's Date column, or from the bundled sample list on first run. Top-100 rank omitted (eBird scrapes it — no API). |
| 🐦 Year List | **My year** list | ✅ | Expandable current-year (and all-time, for CSV) species lists, from the imported CSV or the bundled sample data. |

## Environmental (non-eBird sources)

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🌤 Conditions — weather + tides | **Conditions for chasing** | ✅ | NOAA `api.weather.gov` 4-period forecast (🐦 southerly-wind flag) + NOAA CO-OPS tides (optional station) + locally-computed sunrise/sunset, first/last light, daylight length, and moon phase. Called straight from the device — no GitHub. |
| 🛬 Migration outlook | — | 🌦️ | eBird bar-chart history; complex. |
| 🌙 Nightly migration — BirdCast | — | 🌦️ | BirdCast is a separate service (scraped in report). |

## Leaderboards (website-scraped in report)

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🏆 eBird Rankings | — | ⛔ | eBird has no public ranking API; report scrapes the website. |
| 🥇 Top 25 eBirders | — | ⛔ | Same — scraped, not an API. |
| 🏅 Your state rankings | — | ⛔ | Same — scraped, not an API. |

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
