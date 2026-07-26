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
| 🦜 Birdiest recent checklists | **Birdiest checklists** | ✅ | `product/lists/{region}` ranked by `numSpecies`, with observer + checklist link. |
| 🔥 Hot hotspots — recent surges | — | 🧪 | Needs recent-vs-baseline activity comparison. |
| 🥶 Cold hotspots — overlooked gems | — | 🧪 | Needs hotspot activity stats. |
| 👥 Birder convoys | — | 🧪 | Group-route detection across checklists; low priority. |
| ⏰ Time-of-day specialists | **Time-of-day specialists** | ✅ | Accumulates checklist observation hours (`historic/{y}/{m}/{d}` daily snapshots + passive from Notable/Targets), then flags dawn (≥50% before 7am) and dusk/night (≥30% after 7pm) species — mirrors the report's `time_of_day.py` thresholds (`MIN_OBS=5`). Sample grows richer each run. |

## Personal stats

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🐦 header — year list count | **My year** count | ✅ | Current-year species count from the imported CSV's Date column, or from the bundled sample list on first run. Top-100 rank now in **My eBird rankings** (login-gated). |
| 🐦 Year List | **My year** list | ✅ | Expandable current-year (and all-time, for CSV) species lists, from the imported CSV or the bundled sample data. |

## Environmental (non-eBird sources)

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🌤 Conditions — weather + tides | **Conditions for chasing** | ✅ | NOAA `api.weather.gov` 4-period forecast (🐦 southerly-wind flag) + NOAA CO-OPS tides (optional station) + locally-computed sunrise/sunset, first/last light, daylight length, and moon phase. Called straight from the device — no GitHub. |
| 🛬 Migration outlook | — | 🌦️ | eBird bar-chart history; complex. |
| 🌙 Nightly migration — BirdCast | **Nightly migration** | ✅ | Season-aware deep link to BirdCast's live radar dashboard for your region (`dashboard.birdcast.org/region/<code>`); knows the live-forecast windows (Mar 1–Jun 15, Aug 1–Nov 15) and shows the next active date between seasons — same season logic as the report's `section_birdcast`. No API (BirdCast has none). |

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
