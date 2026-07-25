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
| 🌟 New arrivals today | — | 🔜 | Derive first-seen dates from `recent` `obsDt`. |

## Destinations & routing

| Report section | App feature | Status | Notes |
|---|---|---|---|
| 🥇 Top destinations | **Top destinations** | ✅ | Ports `score = Σ (3 if rarity else 1)` per unseen species, clustered by locId; inline SVG map + Maps links. |
| 📍 Closest spots with unseen birds | **Top destinations** (distance) | ✅ | Same ranking; distances shown when Home is set. |
| 🚗 Top excursions | **Top excursions** | ✅ | Far-from-home clusters with soft distance penalty `score/(1+extra/30)`; needs Home set. |
| 🧭 Trip planner — half-day route | **Trip planner** | ✅ | Nearest-neighbour route through the top ≤6 nearby target hotspots; SVG map with route path + per-leg / round-trip miles. |
| 🚶 Quick outing — best hotspots close by | — | 🔜 | Nearby hotspots by recent activity (`ref/hotspot/geo`). |
| 📍 Favorite hotspots | — | 🔜 | User-pinned hotspots + their recent notables. |

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
| 🐦 header — year list count | **My year** totals | 🟡 | Totals from imported CSV; top-100 rank omitted (scraped). |
| 🐦 Year List | **My year** | 🟡 | Totals shown; full species listing planned. |

## Environmental (non-eBird sources)

| Report section | App feature | Status | Notes |
|---|---|---|---|
| Weather + tides | — | 🌦️ | Open-Meteo / NOAA; optional later. |
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
