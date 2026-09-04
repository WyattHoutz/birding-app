/*
 * Bird Chaser informational-dialog content.
 *
 * section-docs.json remains the prose source for each section's calculation
 * disclosure. This file owns the informational bottom sheets that are not
 * section docs, plus the explicit inventory of popup types that are outside
 * the review catalog. It runs unchanged in the app and in the catalog
 * generator, so the static page cannot acquire a second copy of the prose.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BirdInfoDialogs = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function defaultEscape(value) {
    return String(value == null ? '' : value).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function escapeWith(fn, value) {
    return (typeof fn === 'function' ? fn : defaultEscape)(value);
  }

  function laneDocs(BL) {
    if (!BL || !BL.SURGE || !BL.CASCADE) {
      throw new Error('BirdLogic alert constants are required for info dialogs');
    }
    var docs = {
      mega: {
        title: '🦅 ABA Code 3+ megas',
        body: '<p>Continent-level rarities — <b>ABA Code 3, 4 and 5</b> — currently '
          + 'reported in this region, one line per species, newest report kept.</p>'
          + '<p><b>This category never fetches.</b> It shows whatever the '
          + '<b>Rare birds</b> section last loaded, and prints how old that is. '
          + 'The ABA alert is a scraped continent-wide page, and fetching it '
          + 'every time you opened Happening now is what put this section on a '
          + '30-second rate-limit timeout. So the section you open deliberately '
          + 'pays that cost, and this lane never does. If it looks empty, open '
          + '<b>Rare birds</b> once.</p>'
          + '<p><b>New locality, or near and unseen.</b> A first record inside '
          + 'a four-mile locality cluster is news at any distance. Nearby hotspot '
          + 'labels inside that radius remain one continuing bird. The other qualifiers — nearby, '
          + 'multiple reports, or multiple reports at one hotspot — require the '
          + 'bird to be within the 55-mile day-trip gate and still missing from '
          + 'your year list. A far bird that is not new, or one you have already '
          + 'seen, stays in <b>Mega rarities</b> instead of alerting again here.</p>'
          + '<p>For photos, state history and the rarity evidence, open '
          + '<b>Rare birds</b>: this feed keeps one compact row per bird.</p>'
      },
      celebrity: {
        title: '🎯 Celebrity Birds',
        body: '<p>Birds <b>eBird flags as notable in this region</b> that are '
          + 'not on your year list, with <b>' + BL.NEED_MIN_SIGHTINGS
          + ' or more independent sightings</b> at one hotspot or adjacent '
          + 'walkable hotspots, within chase distance and the last '
          + BL.FRESH_HOURS + ' hours plus checklist-start grace.</p>'
          + '<p><b>Notable, not merely unseen.</b> A bird earns this category '
          + 'by being unusual <i>here</i> and drawing a real local stakeout. '
          + 'An unseen-but-ordinary bird belongs in <b>All unseen reports</b> '
          + 'and <b>Closest spots</b>. A one-report mega belongs in '
          + '<b>Twitches today</b>; CELEBRITY has no reviewed-rarity exemption.</p>'
          + '<p>Within this category the unified feed uses the newest report '
          + 'time, just as its Buzz and Newest descriptions state.</p>'
          + '<p>Every report-specific fact on a row comes from the <b>same newest '
          + 'report</b> — place, distance, count, date and checklist link. Private addresses '
          + 'are never listed.</p>'
      },
      crowd: {
        title: '🐦 Species drawing a crowd',
        body: '<p><b>Distinct observers</b> — not checklists, because one birder '
          + 'filing three lists is how a quiet spot fakes a crowd — at one spot '
          + 'in the last ' + BL.SURGE.WINDOW_H + ' hours, measured against what '
          + 'that species normally draws <i>at that place</i>.</p>'
          + '<p>It fires at <b>' + BL.SURGE.MIN_OBSERVERS + '+ observers</b> and '
          + '<b>' + BL.SURGE.MIN_RATIO + '× the local norm</b>, or — for a bird with '
          + 'no trailing history at all — at <b>' + BL.SURGE.NOVEL_OBSERVERS
          + ' independent observers on two different checklists</b>.</p>'
          + '<p>With no trailing history there is no ratio to quote. A ratio '
          + 'over a zero baseline would invent precision, so the bold third '
          + 'line names the missing baseline instead.</p>'
          + '<p>Rarities are deliberately excluded: they already have their own '
          + 'sections, and this category exists to catch the birds those miss.</p>'
      },
      cascade: {
        title: '🏆 Species cascading through the leaderboard',
        body: '<p>eBird\u2019s Top 100 board prints, for each birder, the <b>most '
          + 'recent species they added</b> this year. Group that column by bird '
          + 'and it becomes a chase board: when several of the top 100 add the '
          + '<b>same</b> species within a few days, that bird is demonstrably '
          + 'findable right now.</p>'
          + '<p>That is the whole rule — <b>' + BL.CASCADE.MIN_BIRDERS
          + '+ of the top 100 within ' + BL.CASCADE.WINDOW_DAYS
          + ' days</b>. It is not a rarity feed, so a bird can appear here '
          + 'without being flagged rare anywhere, and a mega nobody has ticked '
          + 'yet will not appear at all.</p>'
          + '<p>This category sees the <b>whole region</b>, including counties your '
          + 'own feeds never cover — which is its real value — but the board is '
          + 'cached daily, so it can lag about a day.</p>'
          + '<p>The board names the bird and the date and <i>nothing else</i>, so '
          + 'the place and time on each row come from a species-scoped state '
          + 'feed. That is where to actually go.</p>'
      },
      busy: {
        title: '📍 Hotspots unusually busy',
        body: '<p>These are <b>places, not birds</b>. The category is '
          + '<b>species-blind</b>, so it fires even when whatever everyone is '
          + 'looking at was never flagged notable — a locally common bird draws '
          + 'no rarity alert however big the crowd gets. That is the one signal '
          + 'the other lanes cannot produce.</p>'
          + '<p>Each spot is measured against <b>its own</b> trailing norm, so an '
          + 'always-busy park is not news; a quiet one suddenly filling up is. '
          + 'A place with no trailing history is <i>unmeasured</i>, not busy, so '
          + 'it is dropped rather than called new.</p>'
          + '<p>The headline opens Stakeout hotspot. Bird Gen does not duplicate '
          + '<b>Hot patches</b> or the Stakeout section’s species/checklist lists.</p>'
      },
      patch: {
        title: '🥇 High-yield top patches',
        body: '<p>Today’s patches grades every current destination against the '
          + 'median score of the same list. Bird Gen includes only the top '
          + '<b>high yield</b> category — score at least twice that median — '
          + 'and only after the complete chase view is ready.</p>'
          + '<p>The headline opens Stakeout hotspot; <b>Find local patches</b> '
          + 'keeps the place in its full local-patch context. This is a local '
          + 'projection of data the chase '
          + 'wave already computed, so it adds no API call.</p>'
      }
    };
    docs.feed = {
      title: '🔔 Bird Gen',
      body: '<p>One feed ranks every active alert. <b>Buzz</b> orders the '
        + 'six categories — mega, celebrity, crowd, cascade, hotspot, top patch — then '
        + 'uses recency inside each category. <b>Newest</b> ignores category '
        + 'severity and orders every row by its latest report time.</p>'
        + '<p>Hotspot alerts stay visible in Unseen mode because they describe '
        + 'a place, not one bird.</p>'
        + '<p>If one species qualifies more than once, it appears once under '
        + 'its strongest category and keeps every qualifying reason on that '
        + 'row in accessible category metadata. The visible third line explains '
        + 'the strongest category.</p>'
        + '<p>Every card has three lines: name plus category; four-letter code, '
        + '<b>xN</b>, linked place and linked compact date; then a bold category '
        + 'explanation. The alert icon and relative age remain at the right. '
        + 'The whole headline opens Stakeout bird or Stakeout hotspot; this '
        + 'news feed does not expand into report, species or checklist lists.</p>'
        + '<p>If a source fails or the mega snapshot has not been loaded, '
        + 'the feed names that gap instead of claiming nothing is happening. '
        + 'A complete retained snapshot may still supply TOP PATCH rows while '
        + 'live data refreshes; partial or failed destination views may not.</p>'
        + '<h3>' + docs.mega.title + '</h3>' + docs.mega.body
        + '<h3>' + docs.celebrity.title + '</h3>' + docs.celebrity.body
        + '<h3>' + docs.crowd.title + '</h3>' + docs.crowd.body
        + '<h3>' + docs.cascade.title + '</h3>' + docs.cascade.body
        + '<h3>' + docs.busy.title + '</h3>' + docs.busy.body
        + '<h3>' + docs.patch.title + '</h3>' + docs.patch.body
    };
    return docs;
  }

  function birdGenContext(context, escapeHtml) {
    context = context || {};
    var n = Math.max(0, Number(context.count) || 0);
    var count = n ? n + ' active alert' + (n === 1 ? '' : 's') : 'no active alerts';
    var mega = context.megaAge
      ? ' Mega snapshot ' + escapeWith(escapeHtml, context.megaAge) + '.'
      : ' No mega snapshot loaded.';
    return '<p><b>Current feed:</b> ' + count + '.' + mega + '</p>';
  }

  function sectionNoteHtml(warning, escapeHtml) {
    return warning
      ? '<p class="docnote">⚠️ ' + escapeWith(escapeHtml, warning) + '</p>' : '';
  }

  function renderSectionDocHtml(doc, noteHtml, escapeHtml) {
    var h = noteHtml || '';
    if (!doc) {
      return h || '<p class="hint">No calculation notes for this section yet.</p>';
    }
    if (doc.summary) h += '<p class="docsum">' + escapeWith(escapeHtml, doc.summary) + '</p>';
    function list(title, items, cls) {
      if (!items || !items.length) return '';
      return '<p class="doch">' + title + '</p><ul class="' + cls + '">'
        + items.map(function (item) {
          return '<li>' + escapeWith(escapeHtml, item) + '</li>';
        }).join('') + '</ul>';
    }
    h += list('Data it reads', doc.inputs, 'doclist');
    h += list('How it is calculated', doc.how, 'doclist');
    h += list('What it cannot tell you', doc.limits, 'doclist doclimits');
    return h;
  }

  function renderBirdGen(context, deps) {
    var docs = laneDocs(deps && deps.BirdLogic);
    return {
      title: docs.feed.title,
      subtitle: 'How this lane is calculated',
      bodyHtml: ((context && context.contextHtml) || '') + docs.feed.body
    };
  }

  function renderSpuh(context, deps) {
    context = context || {};
    var esc = deps && deps.escapeHtml;
    return {
      title: context.name || 'Spuh explanation',
      subtitle: 'What this spuh means',
      bodyHtml: '<p>' + escapeWith(esc, context.definition || '') + '</p>'
        + '<h4>Sources and boundary</h4>'
        + '<p>Generated on this device from the eBird taxonomy '
        + 'and eBird’s definition of a spuh; no taxonomy bundle ships in '
        + 'the public app.</p>'
        + '<p>Example candidate images come from Wikipedia/Wikimedia through '
        + 'the app’s existing attributed photo pipeline. One image illustrates '
        + 'a possible member; it does not define the whole spuh.</p>'
    };
  }

  var CATALOG = {
    'bird-gen-feed': {
      name: 'Bird Gen alert categories',
      group: 'Category and calculation sheets',
      contextLabel: 'Sample live context — alert count and snapshot age vary on the device.',
      render: renderBirdGen
    },
    'spuh-explanation': {
      name: 'Spuh group explanation',
      group: 'Dynamic explanations',
      contextLabel: 'Sample dynamic context — the title and first paragraph come from the active eBird taxonomy.',
      render: renderSpuh
    }
  };

  var EXCLUDED = {
    'share-ebird': {
      surface: 'sheet',
      name: 'Share an eBird page',
      reason: 'Transactional sharing sheet; its QR code and destination are generated for the selected species, hotspot or checklist.'
    },
    'observer-notes': {
      surface: 'sheet',
      name: 'Observer notes and waypoint',
      reason: 'Record detail populated with third-party eBird prose, coordinates and media flags; not authored help, and never copied into the catalog.'
    },
    'location-unavailable': {
      surface: 'sheet',
      name: 'Location unavailable',
      reason: 'Transient error and recovery notice rather than informational help.'
    },
    'rank-from-place': {
      surface: 'sheet',
      name: 'Rank from a place',
      reason: 'Interactive place-entry workflow used for navigation and ranking, not a help or calculation sheet.'
    },
    'delete-region': {
      surface: 'confirmation',
      name: 'Delete a custom region',
      reason: 'Destructive native confirmation.'
    },
    'add-region': {
      surface: 'confirmation',
      name: 'Add a custom region',
      reason: 'Transactional native confirmation before creating local data.'
    },
    'erase-device-data': {
      surface: 'confirmation',
      name: 'Erase device data',
      reason: 'Destructive native confirmation.'
    }
  };

  function render(id, context, deps) {
    var entry = CATALOG[id];
    if (!entry) throw new Error('Unknown informational dialog: ' + id);
    return entry.render(context || {}, deps || {});
  }

  function renderSample(id, deps) {
    var esc = deps && deps.escapeHtml;
    if (id === 'bird-gen-feed') {
      return render(id, {
        contextHtml: birdGenContext({
          count: 3,
          megaAge: 'from the ABA alert, 3h ago'
        }, esc)
      }, deps);
    }
    if (id === 'spuh-explanation') {
      return render(id, {
        name: 'peep sp.',
        definition: '[Definition generated from the active eBird taxonomy appears here.]'
      }, deps);
    }
    throw new Error('No sample context for informational dialog: ' + id);
  }

  function sectionSampleContext(at, BL, escapeHtml) {
    if (at !== 'cklBtn' && at !== 'convoyBtn') return null;
    var window = BL.feedWindow([
      { isoObsDate: '2000-01-01 08:00' },
      { isoObsDate: '2000-01-02 08:00' }
    ], 7);
    return {
      label: 'Conditional live note — sample truncated checklist window.',
      noteHtml: sectionNoteHtml(window.warning, escapeHtml)
    };
  }

  function isExcluded(id, surface) {
    var entry = EXCLUDED[id];
    return !!entry && (!surface || entry.surface === surface);
  }

  return {
    catalog: CATALOG,
    excluded: EXCLUDED,
    laneDocs: laneDocs,
    birdGenContext: birdGenContext,
    sectionNoteHtml: sectionNoteHtml,
    renderSectionDocHtml: renderSectionDocHtml,
    render: render,
    renderSample: renderSample,
    sectionSampleContext: sectionSampleContext,
    isExcluded: isExcluded
  };
}));
