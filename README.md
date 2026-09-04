# Bird Chaser (iOS)

A self-contained iPhone app for personal eBird target tracking, built with
[Capacitor](https://capacitorjs.com/). It is a native app you sideload onto
your own device — no App Store, no paid Apple Developer account.

> **🐍 Looking for the Python pipeline, the backlog, or the release runbook?**
> They live in the sibling repository **`birding`** (private).

---

## Two repositories, and why

The project is split in two, and **you can land in either one**. Here is the map.

| | **`birding-app`** (this repo) | **`birding`** |
|---|---|---|
| Visibility | 🌍 **public** | 🔒 **private** |
| Holds | The app: `www/index.html`, `www/logic.js` | Python pipeline, `docs/` (backlog, algorithms, terms) |
| Actions minutes | **free** | **billed** (2,000/mo cap) |
| On disk | `C:\Users\wyhoutz\source\repos\birding-app` | `C:\Users\wyhoutz\source\repos\birding` |

**Why two.** This repo must be public so GitHub Actions builds it on a macOS
runner for free and the `.ipa` can be downloaded and sideloaded. The other repo
holds an eBird API key, a data cache containing **thousands of real birders'
names**, and the owner's personal life list — none of which may ever be public.
The split is by *what each thing needs*, not by convenience.

**They must be siblings on disk.** The private repo's checks resolve this one as
`..\birding-app`, and the parity suite reads `www/logic.js` directly.

**How the two stay honest.** `www/logic.js` and the private repo's Python are
two implementations of the same algorithms, **parity-tested against each
other**: Python computes a fixture, JS computes the same fixture, and the JSON
must match. Change one side and you must change the other, or the parity suite
fails. See **[PARITY.md](PARITY.md)** for the feature matrix.

ℹ️ The private repo's Markdown report was **archived on 2026-08-31** — this app
replaced it. Its `report.py` lives on as the Python reference implementation
that this app is tested against.

---

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
  knows what you've already seen. A fresh profile starts empty. The owner's
  bundled snapshot is available only through **Load sample data** and is never
  silently presented as the new account's list.

```
Settings  → your eBird API key (stored on device)
Seen list → empty on first run; import MyEBirdData.csv or explicitly load sample data
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

### How a change ships

> ⚠️ **Pushing `main` is what ships the app. Tags do not trigger anything —
> CI creates the tag and the Release itself.**

Getting that backwards produces a *phantom release*: a tag on your machine and
nothing on anyone's phone. On `git push origin main`, `ios-build.yml` runs:

| Order | Job | Runner | What it does |
|---|---|---|---|
| 1 | `test` | Ubuntu | `npm ci`, `npm test` (~670), `npm run test:layout` (real Chrome, 6 viewports) |
| 2 | `build` | **macOS** | `npx cap add ios`, icons, `cap sync`, `xcodebuild`, zips `BirdChaser-unsigned.ipa` |
| 3 | `release` | Ubuntu | Reads `package.json` → if `vX.Y.Z` has no Release yet, **creates the tag and the Release**, attaching the `.ipa` this run built |

So the version in `package.json` decides the tag name, and bumping it *is*
cutting the release. The job is idempotent — safe on every push, including ones
that don't touch the version. ⚠️ Push two version bumps at once and only the
newest is ever released.

Bump **both** version fields together or `tests/version.test.js` fails:

```
www/index.html      var APP_VERSION = 'X.Y.Z';
package.json        "version": "X.Y.Z",
```

📖 **The full step-by-step, including recovery when it goes wrong, is
`docs/RELEASE.md` in the private `birding` repo.**

### Install on the phone

For the complete illustrated first run—including Developer Mode, trusting the
signing Apple ID, obtaining an eBird key, and importing a seen list—follow
**[Bird Chaser first-time setup](docs/QUICKSTART.md)**.

1. Grab `BirdChaser-unsigned.ipa` from the
   [latest Release](https://github.com/WyattHoutz/birding-app/releases)
   (or `gh release download vX.Y.Z --pattern "*.ipa"`). It is also uploaded as a
   build artifact on every run, which is what you want if the version did not
   change.
2. Sideload it with [Sideloadly](https://sideloadly.io/) or
   [AltStore](https://altstore.io/) + AltServer on Windows, signing with your
   free Apple ID.
   - Free-Apple-ID limits: the app **expires every 7 days** unless the signing
     tool refreshes it, max 3 sideloaded apps, no push notifications.
3. Confirm what is actually running — the footer reads
   `Bird Chaser · vX.Y.Z · tap 5× for 🐞 debug`.

⚠️ **Verify a change inside the shipped `.ipa`, not just in the commit** — they
are different claims:

```powershell
gh release download vX.Y.Z --pattern "*.ipa"
Expand-Archive BirdChaser-unsigned.ipa -DestinationPath ipa-check -Force
Select-String ipa-check\Payload\App.app\public\index.html -Pattern "APP_VERSION"
```

## Local development (Windows)

You can build and preview the entire UI in a browser — only the final compile
needs the cloud Mac.

```powershell
npm install
npm test                 # unit + syntax + DOM suites (jsdom)
npm run test:layout      # six viewport/text combos in real Chrome
npm run mockups          # static UI mockups (also attached to each Release)
npm run info-catalog     # rebuild docs/info-dialogs.html from the app's prose sources
# open www/index.html in a browser to preview the UI
```

Open [`docs/info-dialogs.html`](docs/info-dialogs.html) directly to search and
review every informational popup without running the app. Section explanations
come from `www/section-docs.json`; the remaining authored sheets come from
`www/info-dialogs.js`. The generated page also names the transactional,
record-specific and error dialogs it deliberately excludes.

⚠️ **`npm test` is blind to geometry** — jsdom has no layout engine. v1.26.13
shipped a 55.6 px overflow with a fully green unit suite; only the layout audit
caught it. If you touched CSS or card markup, `test:layout` is the check that
matters.

### Fixing release notes after the fact

The notes are written automatically from the subject and body of the commit that
changed the version, so a good commit message *is* the release note. To correct
them afterwards, go through the retry wrapper:

```powershell
powershell -File scripts/gh-retry.ps1 release edit v1.3.1 --notes-file notes.md
```

Not ceremony. On 2026-08-12 the notes step failed with `net/http: TLS handshake
timeout` — nothing wrong with the release, the notes or the build, just a
handshake. `gh` exited non-zero and the release kept its **auto-generated body**,
which is indistinguishable from a release that published correctly until
somebody reads it. The failure was loud; its consequence was silent.

The wrapper retries transport failures (TLS, timeouts, resets, 5xx, secondary
rate limits) with exponential backoff, and fails **immediately** on anything
else — a bad tag or a missing file is not worth five attempts. Verified both
ways: a nonexistent tag fails in 1.4 s, a simulated handshake timeout retries
twice and succeeds.

Whatever you use, read the notes back before calling it done:

```powershell
powershell -File scripts/gh-retry.ps1 release view v1.3.1 --json body
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
- **P12** — Nightly migration: a season-aware BirdCast panel that deep-links your
  region's live radar dashboard and knows the live-forecast windows (spring
  Mar 1–Jun 15, fall Aug 1–Nov 15), showing the next active date between seasons.
  Pure logic ported from the report's `section_birdcast`; BirdCast has no API. ✅
- **P13** — Time-of-day specialists: samples recent checklist observation times
  (backfilled from `historic/{y}/{m}/{d}` daily snapshots, plus passive
  accumulation from the Notable/Targets fetches) into a per-region localStorage
  store, then flags dawn (≥50% before 7am) and dusk/night (≥30% after 7pm)
  species — same thresholds as the pipeline's `time_of_day.py`. The sample grows
  richer every time you tap *Sample recent checklists*. ✅
- **P14** — Hot & cold hotspots: two API calls (region 30-day hotspot recent feed
  + `ref/hotspot/{region}` metadata) rank, within 35 mi of Home, hotspots
  *running hot* (concentrating the region's freshest sightings, scored
  `fresh × (1 + fresh/all-time) ÷ (1 + dist/10)`) and *overlooked gems* (high
  all-time diversity but currently quiet, scored `all-time × √(1 + min(silent,30))
  ÷ (dist + 5)`). Ports `section_hot_hotspots` and the cold-hotspot pre-rank. ✅
- **P15** — Migration outlook: a one-time, resumable bootstrap fetches ~2 years of
  weekly `historic/{y}/{m}/{d}` checklists for your region into localStorage,
  then derives per-species weekly phenology and predicts which species should
  **arrive** (unseen targets due within 2 weeks) or **depart** (year-list species
  leaving soon). Ports `migration.py`'s `_detect_run` / `expected_soon`. ✅
- **P16** — Birder convoys: scans the region's recent checklists (`product/lists`,
  last 7 days), dedupes by `subId`, skips your own, and groups by shared hotspot +
  exact submitted time (eBird's shared-checklist signature) to surface birding
  **groups** — 2+ people who hit 2+ hotspots together in a day. Each route is a
  field-tested itinerary, ranked by stops → group size → recency. A lazy per-route
  expander pools every stop's `checklist/view` species and flags 🆕 birds not on
  your list via one batched `ref/taxonomy` call. Ports `section_birder_convoys` /
  `_convoy_species_cell`. This completes **full report parity**. ✅

See **[PARITY.md](PARITY.md)** for the full report-feature → app-status matrix.

## Data sources and attribution

Bird data comes from the **eBird API**, © **Cornell Lab of Ornithology**, used
under the [eBird API Terms of Use](https://www.birds.cornell.edu/home/ebird-api-terms-of-use/).
Weather and tides come from NOAA; see **[DATA.md](DATA.md)** for the full list,
the terms each source arrives under, and what the bundled sample list actually
contains.

This is a free, personal, **non-commercial** tool. It is not affiliated with or
endorsed by the Cornell Lab of Ornithology or eBird, and it ships no API key —
you supply your own.
