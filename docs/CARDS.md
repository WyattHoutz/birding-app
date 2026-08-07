# Card templates

Every list of birds, places and checklists in Bird Chaser is one of **nine
templates** in **three families**. The families live in their own files so a
shape can be read and changed without hunting through `index.html`:

| family | file | what a row IS |
|---|---|---|
| `SpeciesCards` | [`www/cards-species.js`](../www/cards-species.js) | a **bird** |
| `HotspotCards` | [`www/cards-hotspot.js`](../www/cards-hotspot.js) | a **place** |
| `ChecklistCards` | [`www/cards-checklist.js`](../www/cards-checklist.js) | a **checklist** |

Each file holds the HTML template **and** the CSS for its family, injected once
on load into `<style data-cards="…">`. **Do not re-declare a card rule in
`index.html`** — two definitions of one shape is what made six sections drift
into six lookalikes, which is the whole reason these files exist.

## Viewing them

Open **[`www/cards.html`](../www/cards.html)** in a browser. It renders all nine
templates with sample data, at any text scale, and makes **no network calls** —
so it works offline exactly like the app.

```
# from the repo root
npx serve www        # or: python -m http.server 8080 --directory www
# then open /cards.html
```

Use it when changing a template: the gallery shows every size of every family
at once, which is where drift between them becomes obvious.

## Which section uses which

Sizes are a **rank of attention**, not a rank of importance:

* **small** — a row you *scan*. One line, many of them.
* **medium** — a row you *weigh*. The default for a list you make decisions from.
* **large** — a card you *read*. One subject, in depth.

### SpeciesCards — a row is a bird

| template | built by | section |
|---|---|---|
| `small` | `speciesListHtml` | the bird lists nested inside a hotspot card ("3 unseen 🔍" / "40 more species already seen") |
| `medium` | `refresh` | 🌅 Today's rarity reports |
| `medium` | `renderSpeciesLookup` | 📖 Species lookup |
| `medium` | `loadActiveRarities` | ⭐ Active rarities |
| `medium` | `lastNewCard` | 🔭 Latest ticks on the leaderboard |
| `medium` | `speciesPlacesCard` | 📋 All unseen reports **and** 🥚 Easy misses — both render through this one builder |
| `large` | — | **unused** |

### HotspotCards — a row is a place

| template | built by | section |
|---|---|---|
| `medium` | `hotspotCard` | 🥇 Top destinations · 🚗 Top excursions · 🧭 Trip planner · 🚶 Quick outing · 📍 Closest spots · 🔥 Hot hotspots · ❄️ Cold hotspots — **every** hotspot list in the app goes through this one builder |
| `small` | `renderConvoys` | 👥 Birder convoys — the numbered stops on one route, each badge cloning that convoy's map pin |
| `large` | — | **unused** |
| `marker` | — | **unused** (Leaflet pins are built in `renderMap`) |

### ChecklistCards — a row is a checklist

| template | built by | section |
|---|---|---|
| `small` | `unseenPlacesHtml` | 📋 All unseen reports · 🥚 Easy misses — one line per checklist under each bird |
| `small` | `rarityChecklistDetails` | ⭐ Active rarities — the checklists behind one rarity |
| `small` | `lastNewCard` | 🔭 Latest ticks — the recent checklists for one bird |
| `medium` | `loadBirdiest` | 🦜 Birdiest checklists |
| `medium` | `loadRecentLists` | 🦜 Birdiest checklists → *Newest* mode |

## The unused four

`SpeciesCards.large`, `HotspotCards.small`, `HotspotCards.large` and
`HotspotCards.marker` are defined, styled and tested but called from nowhere in
`index.html`.

They are **kept deliberately**, not left by accident:

* They keep the families symmetrical. A family offering only the sizes
  currently in use invites the next section to invent a fourth shape rather
  than pick one — the exact failure mode these files exist to prevent.
* The `large` templates are the "read about ONE subject" shape. Today's
  rarities used the large species card before it became a scannable list, and
  it is the shape to reach for the next time a section profiles one bird.
* The gallery renders them, so they cannot silently rot: a change that breaks
  an unused template is visible on the page.

If one is still unused a year from now, delete it — but delete its CSS, its
tests and its gallery entry in the same commit, and say why.

## Rules

1. **Presentation only.** A card takes ready-made HTML for anything that needs
   a link, because the link builders (`locLink` / `checklistLink` / `mapPin`)
   live with the app's routing and must not be duplicated in a card file.
2. **Every field is optional.** The caller's context decides what is redundant
   — a place name is noise under a heading that already says it. A template
   prints *nothing at all* for a field it was not given: never an empty cell,
   never a stranded separator. Separators are **drawn** in CSS
   (`span + span::before`) for exactly this reason.
3. **One list, one size.** A container declares the family and size it holds.
   A hotspot list must not carry `.obs.xl` — the species rules are scoped three
   classes deep, outrank the hotspot card's own two-class rules, and silently
   replace its geometry. There is a test for this, and it was written after
   that bug shipped.
4. **Sizes are a rank of attention**, so a section picks its size from how the
   row is *used*, not from how important the section feels.
