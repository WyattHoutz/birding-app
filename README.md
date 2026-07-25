# Birding (iOS)

A self-contained iPhone app for personal eBird target tracking, built with
[Capacitor](https://capacitorjs.com/). It is a native app you sideload onto
your own device — no App Store, no paid Apple Developer account.

## Design principles

- **No runtime dependency on GitHub.** Once installed, the app talks only to
  public data APIs — the **eBird API** plus **NOAA** weather/tides — and your
  **on-device data**. It never fetches anything from this repo or GitHub Pages.
- **No server / no backend.** All network calls go straight to eBird and NOAA
  from the device. Capacitor's native HTTP layer (`CapacitorHttp`, enabled in
  `capacitor.config.json`) makes those calls natively, so there is no CORS
  problem and no proxy.
- **Your data stays on your phone.** The seen-list comes from an eBird
  *Download My Data* CSV that you import once and store locally. eBird's public
  API has no personal life/year/needs-list endpoint, so the CSV is how the app
  knows what you've already seen. On first launch the app also loads a **bundled
  sample list** (the owner's eBird 2026 year lists) so every panel has data to
  work with immediately — importing your CSV replaces it, and *Clear* removes it.

```
Settings  → your eBird API key (stored on device)
Seen list → bundled sample data on first run; import MyEBirdData.csv to replace
Live data → CapacitorHttp → eBird + NOAA APIs (no CORS, no server, no GitHub)
Analysis  → on-device (JS)
UI        → Notable / Targets / Destinations / Excursions / Trip / Birdiest /
            Fresh / Quick outing / Favorites / Conditions / My Year / Settings
```

## How it's built (no Mac required)

The `Build unsigned iOS IPA` GitHub Actions workflow compiles the app on a
GitHub-hosted **macOS** runner and uploads an **unsigned `.ipa`** as an
artifact. No Apple signing certificates are stored here — AltStore signs the
app with your free Apple ID at install time. GitHub Actions is only a build
tool; it leaves no trace in the shipped app.

The native `ios/` project is **not** committed — it is regenerated on every CI
run with `npx cap add ios`, so a Windows machine never needs Xcode or
CocoaPods. The app icon and launch image are generated during CI from the
committed `assets/*.png` (see [`assets/generate.js`](assets/generate.js)) via
`@capacitor/assets`, so we still don't need to commit `ios/`.

### Build + install

1. Push to `main` (or run the workflow manually from the **Actions** tab).
2. Download the `Birding-unsigned-ipa` artifact from the completed run.
3. Sideload it with [AltStore](https://altstore.io/) + AltServer on Windows,
   signing with your free Apple ID.
   - Free-Apple-ID limits: app expires every 7 days (AltServer auto-refreshes
     over Wi-Fi), max 3 sideloaded apps, no push notifications.

## Local development (Windows)

You can build and preview the entire UI in a browser — only the final compile
needs the cloud Mac.

```powershell
npm install
# open www/index.html in a browser to preview the UI
```

## Roadmap

- **P0** — Capacitor shell + CI → installable `.ipa`. ✅
- **P1** — Settings (eBird API key + region, on-device) + live notable-sightings
  call via `CapacitorHttp`. ✅
- **P2** — Import eBird CSV (on-device seen list) → Targets view (recent
  regional species you haven't logged) + My Year totals. ✅
- **P3** — Port ranking to JS: **Top destinations** (score = Σ 3×rarity / 1×target
  per unseen species, clustered by hotspot) with an inline SVG map, optional Home
  location for distances, and Maps links. ✅
- **P4** — Top excursions (distance-penalised), trip-planner route (nearest-
  neighbour + map path), and birdiest recent checklists. ✅
- **P5** — Discovery: fresh targets (recent report dates) + quick outing
  (richest hotspots near Home). ✅
- **P6** — Favorite hotspots: pin spots from any list + per-hotspot recent
  sightings. ✅
- **P7** — In-app "new rarities since last check" indicator on Notable. ✅
  (True background/push alerts are out of scope — no server, and free-Apple-ID
  sideloads can't use push notifications.)
- **P8** — Conditions for chasing: NOAA forecast (southerly-wind flag) + tides +
  sunrise/sunset/first-&-last-light/daylight + moon phase, all from the device.
  Plus a birding app icon + launch image. ✅
- **P9** — My Year: current-year species count + expandable year and all-time
  species lists, parsed from the imported eBird CSV. ✅
- **P10** — Bundled sample data: ships the owner's eBird 2026 year lists
  (`www/seed-birdlist.js`, ~330 species) so every panel works before any CSV
  import. Matches by eBird `speciesCode` (exact, locale-proof). Auto-loads on
  first run; *Load sample data* re-loads it; importing a CSV or *Clear*
  overrides it. Regenerate with `node assets/build-seed.js`. ✅
- **P11** — In-app eBird login (`@capgo/capacitor-inappbrowser`) unlocks the
  login-gated report features: **My eBird rankings** (your Top-100 rank +
  species + checklists + top-25 leaderboard, scoped to your region / Lower 48 /
  ABA Area) and the **ABA rare-bird alert** (continent-wide megararities, each
  flagged seen/need against your list). eBird pages redirect to Cornell SSO, so
  the app opens them in an in-app browser, lets you log in once (cookie persists
  on device — no GitHub, no proxy), then injects HTML parsers ported 1:1 from
  the pipeline's `rankings.py` / `aba_rba.py` and posts back compact JSON.
  Display name + alert `sid` + *Sign out* live in Settings. ✅

See **[PARITY.md](PARITY.md)** for the full report-feature → app-status matrix.
