# AGENTS.md — Bird Chaser (the iPhone app)

Read this before changing anything. This repo is **public**; its sibling
`birding` (the Python pipeline and the backlog) is **private** and sits at
`..\birding`.

**The fuller playbook — the release ritual, guard conventions, house rules —
lives in `..\birding\AGENTS.md`.** Read it too if you have that checkout. What
follows is what matters when this repo is open on its own.

---

## The hard invariant

The app shows the same *content* as the Markdown report but has **no runtime
GitHub dependency**. Every eBird / GBIF / NOAA / Wikipedia call goes **direct
from the device**. Never add a proxy, a server, or a build-time fetch of report
output. The app must work with nothing but an eBird API key.

`www/logic.js` is the shared-algorithm half and is **parity-tested against the
private repo's Python**. Change a shared algorithm here and the Python side must
change with it, or `tests/parity/run_all.py` over there fails.

---

## Before you push

```powershell
npm test                 # ~480 unit + DOM tests (jsdom)
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

1. Bump **both** `www/index.html` (`var APP_VERSION`) and `package.json`.
   `tests/version.test.js` fails if they disagree.
2. Add a release-index row in `..\birding\docs\BACKLOG.md` — a guard rejects a
   tag with no row.
3. `git push` then `git tag -a vX.Y.Z && git push origin vX.Y.Z`.
4. The tag triggers a macOS build producing the sideloadable unsigned `.ipa`.
5. **Verify your change is inside the `.ipa`**, not merely in the commit:

```powershell
gh release download vX.Y.Z --pattern "*.ipa"
Expand-Archive BirdChaser-unsigned.ipa -DestinationPath x
# grep the extracted www/index.html for your change
```

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
