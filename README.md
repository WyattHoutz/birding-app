# Birding (iOS)

A self-contained iPhone app for personal eBird target tracking, built with
[Capacitor](https://capacitorjs.com/). It is a native app you sideload onto
your own device — no App Store, no paid Apple Developer account.

## Design principles

- **No runtime dependency on GitHub.** Once installed, the app talks only to
  the **eBird API** and your **on-device data**. It never fetches anything from
  this repo or GitHub Pages.
- **No server / no backend.** All network calls go straight to eBird from the
  device. Capacitor's native HTTP layer (`CapacitorHttp`, enabled in
  `capacitor.config.json`) makes those calls natively, so there is no CORS
  problem and no proxy.
- **Your data stays on your phone.** The seen-list comes from an eBird
  *Download My Data* CSV that you import once and store locally. eBird's public
  API has no personal life/year/needs-list endpoint, so the CSV is how the app
  knows what you've already seen.

```
Settings  → your eBird API key (stored on device)
Seen list → import MyEBirdData.csv once (local storage)
Live data → CapacitorHttp → eBird API 2.0   (no CORS, no server, no GitHub)
Analysis  → on-device (JS)
UI        → Notable sightings / Targets / My Year / Settings
```

## How it's built (no Mac required)

The `Build unsigned iOS IPA` GitHub Actions workflow compiles the app on a
GitHub-hosted **macOS** runner and uploads an **unsigned `.ipa`** as an
artifact. No Apple signing certificates are stored here — AltStore signs the
app with your free Apple ID at install time. GitHub Actions is only a build
tool; it leaves no trace in the shipped app.

The native `ios/` project is **not** committed — it is regenerated on every CI
run with `npx cap add ios`, so a Windows machine never needs Xcode or
CocoaPods. (When we start customizing native bits — icons, Info.plist — we'll
commit `ios/` instead.)

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
- **P3** — Port ranking (trip planner / top destinations) to JS; maps.
- **P4** — Local notifications, polish.
