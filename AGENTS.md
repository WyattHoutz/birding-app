# AGENTS.md — Bird Chaser (the iPhone app)

Read this before changing anything. This repo is **public**; its sibling
`birding` (the Python pipeline and the backlog) is **private** and sits at
`..\birding`.

**The fuller playbook — the release ritual, guard conventions, house rules —
lives in `..\birding\AGENTS.md`.** Read it too if you have that checkout. What
follows is what matters when this repo is open on its own.

---

## The hard invariant

The app is now **the product**, not a mirror of anything. ℹ️ The private repo's
Markdown report was **archived 2026-08-31** (*"im no longer using the markdown
report"*) — but its `report.py` lives on as the **Python reference
implementation** this app is proved against, so nothing about parity changes.

The app has **no runtime GitHub dependency**. Every eBird / GBIF / NOAA /
Wikipedia call goes **direct from the device**. Never add a proxy, a server, or
a build-time fetch of pipeline output. The app must work with nothing but an
eBird API key.

`www/logic.js` is the shared-algorithm half and is **parity-tested against the
private repo's Python**. Change a shared algorithm here and the Python side must
change with it, or `tests/parity/run_all.py` over there fails.

---

## Before you push

```powershell
npm test                 # ~670 unit + DOM tests (jsdom)
npm run test:layout      # SIX viewport/text combos in REAL Chrome
```

⚠️ **Both, always.** jsdom has **no layout engine**, so `npm test` is blind to
geometry. v1.26.13 shipped a 55.6 px overflow with a fully green unit suite;
only the layout audit caught it — and it caught it in CI, after the expensive
macOS job had started. If you touched CSS or card markup, `test:layout` is the
check that matters.

If you have the private repo checked out, run its parity suite as well:

```powershell
cd ..\birding ; python tests\parity\run_all.py
```

---

## Releasing

> ⚠️ **Pushing `main` is what ships. Tags trigger nothing — CI makes the tag.**

1. Bump **both** `www/index.html` (`var APP_VERSION`) and `package.json`.
   `tests/version.test.js` fails if they disagree. The `package.json` value
   becomes the tag name.
2. Add a release-index row in `..\birding\docs\BACKLOG.md` — a guard rejects a
   release with no row.
3. `git push origin main`. That single push runs the tests, builds the unsigned
   `.ipa` on a macOS runner, and then **creates the tag and the GitHub Release
   itself** from `package.json` — idempotently, so it is safe on every push.
4. **Verify your change is inside the `.ipa`**, not merely in the commit:

```powershell
gh release download vX.Y.Z --pattern "*.ipa"
Expand-Archive BirdChaser-unsigned.ipa -DestinationPath x
# grep the extracted www/index.html for your change
```

⚠️ **CORRECTED 2026-08-31 — this used to say "the tag triggers a macOS build".**
It does not; `ios-build.yml` triggers on `push: branches: [main]` and has no tag
trigger. A hand-made local tag ships **nothing**. Measured that day: `v1.63.0`
was a local tag on an unpushed commit and the backlog called it shipped, while
`origin/main` was still v1.62.0 — no build, no Release, no `.ipa`.

**A release exists only if `gh release list` shows it.** ⚠️ Push two version
bumps at once and only the newest is ever released.

Actions minutes are **free here** (public repo) — measured at 0 billable
minutes including macOS. Do not move work into the private repo to "save"
anything; it is the opposite.

---

## Conventions that are easy to get wrong

**One card family, no hand-rolled rows.** Every bird row is
`SpeciesCards.small/medium/large`; every place row is `HotspotCards.*`. A slot
the template does not declare is **silently dropped** — `medium` has no
`{{rows}}`, no `{{count}}` and no `{{right}}`. Check the template before
passing a slot; a dropped slot renders nothing and reports nothing.

**Mutation-test every guard.** Write it, then break the code and watch it fail.
A check that cannot fail is not a check — that mistake was made three times in
one session.

**Assert the property, not the file layout.** Guards pinned to literal pixel
values or to two functions being adjacent break when unrelated code moves.
Compare against the other value that must match instead.

**A failure is not an answer.** `gbifJson` resolves errors to `null`; caching
one `null` disabled a whole section for 30 days. Never cache a falsy result, and
treat a stored falsy as a miss so already-poisoned devices heal themselves.

**Accessibility is a requirement.** The owner has red–green colour blindness.
Never use colour alone to carry meaning; never a red/amber/green palette. Pair
it with text, shape or an icon (✅ / ⚠️ / ⛔).

**Rate limits are real.** eBird is throttled to ~0.37/s through a token bucket;
GBIF is a ~60-call burst budget then ~17/s. Both go through their own limiter —
do not add a call path that bypasses one.
