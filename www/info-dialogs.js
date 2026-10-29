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

  var ALERT_KINDS = {
    twitch: {
      priority: -1, word: 'TWITCH', glyph: '🚨', name: 'New unseen rarities',
      description: 'An unseen, non-WATCH rarity newly appearing today inside the saved chase area after a successful baseline. Explicit Refresh can also recover a never-alerted opportunity with a usable in-range report in the past 24 hours, even when feed history already knows it or includes earlier reports; recovery is not proof of a new arrival. Initial baselines stay silent and previously alerted species are not re-announced. Verified unseen membership, review, source coverage and chase-distance checks still apply. Counts are known independent reports at the displayed walkable locality, not individual birds or an exhaustive total. Opens Twitches.'
    },
    mega: {
      priority: 0, word: 'MEGA', glyph: '🦤', name: 'Mega rarities',
      description: 'ABA Code 3+ rarities with qualifying new-locality or nearby-unseen evidence.'
    },
    migration: {
      priority: 1, word: 'MIGRATION', glyph: '🌙', name: 'Migration news',
      description: 'County migration forecasts, heavy overnight movement, observed arrivals or expected departures. Expected movement is not a confirmed sighting.'
    },
    sensitive: {
      priority: 11, word: 'SENSITIVE', glyph: '!', name: 'Sensitive species this month',
      description: 'Public regional species membership for the stated calendar month. Exact observation dates and locations are withheld by eBird. This is not a located chase opportunity.'
    },
    mass: {
      priority: 2, word: 'MASS FLOCK', glyph: '🪶', name: 'Mass flocks',
      description: 'Large recent counts at verified public hotspots, qualifying as nearby unseen news or an evidence-backed new report.'
    },
    need: {
      priority: 3, word: 'CELEBRITY', glyph: '🎯', name: 'Celebrity birds',
      description: 'Locally notable birds with multiple qualifying sightings within chase distance, whether already seen or not.'
    },
    crowd: {
      priority: 4, word: 'CROWD', glyph: '🐦', name: 'Species drawing a crowd',
      description: 'Non-rarities attracting unusually many distinct observers at one place, relative to that species and place.'
    },
    cascade: {
      priority: 5, word: 'CASCADE', glyph: '🏆', name: 'Leaderboard cascades',
      description: 'At least five distinct Top 100 birders added the same species in the past seven calendar days, with the latest addition within three days. Distant destinations need public sighting evidence within three days; leaderboard interest does not prove independent reporting parties.'
    },
    favorite: {
      priority: 6, word: 'FAVORITE PATCH', glyph: '★', name: 'Favorite Patch birds',
      description: 'Fresh birds missing from your selected personal list, reported at one of your saved patches.'
    },
    hotspot: {
      priority: 7, word: 'BUSY PATCH', glyph: '📍', name: 'Unusually busy patches',
      description: 'At least five independent parties in 36 hours and at least four times the place’s own historical daily baseline. No lower-multiplier crowd exception; without a baseline there is no alert. The multiplier compares recent parties with historical observers per day, not equal-length windows. This signal is species-blind.'
    },
    patch: {
      priority: 8, word: 'TOP PATCH', glyph: '🥇', name: 'High-yield top patches',
      description: 'The highest-yield destinations from the complete current chase view, compared with that view’s median patch score.'
    },
    foy: {
      priority: 9, word: 'FOY', glyph: '📅', name: 'First-of-year reports',
      description: 'Newly learned first regional reports this year. These can describe earlier dates and do not establish current presence.'
    },
    ppte: {
      priority: 10, word: 'PATAGONIA',
      glyph: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 8h18M8 8 4 21M16 8l4 13M1 15h22"/></svg>',
      name: 'Patagonia picnic table effect',
      description: 'A celebrity-style rarity plus a subsequently reported rarity at the same actual site, not merely two rare birds together. The attracting bird needs the Celebrity threshold of four separate recent sightings; shared same-minute visits count once across site aliases. Each bird needs a latest report-date age of at most three calendar days, plus two checklists and two reporting names on the same qualification day. The anchor must appear on an earlier captured date; this does not prove first discovery or causation. Mega status is not required. Qualifying PPTE events are ordered nearest first, with unknown distances last; farther events remain visible. Bird and place links have no underline. Bird names open Stakeout bird; the place opens the exact public patch or focused Twitches evidence. Small print gives the qualification date, known straight-line distance from the selected origin and qualification-day report counts, not individual birds. Unknown distance is omitted. Only known inside-radius events mention the chase area.'
    }
  };

  function alertTypeKey() {
    return '<h3>Alert-type key</h3><ul class="doclist" data-alert-type-key>'
      + Object.keys(ALERT_KINDS).sort(function (a, b) {
        return ALERT_KINDS[a].priority - ALERT_KINDS[b].priority;
      }).map(function (kind) {
        var meta = ALERT_KINDS[kind];
        return '<li data-alert-key-kind="' + defaultEscape(kind) + '"><b>'
          + '<span aria-hidden="true">' + meta.glyph + '</span> '
          + defaultEscape(meta.word) + ' — ' + defaultEscape(meta.name)
          + '</b><br>' + defaultEscape(meta.description) + '</li>';
      }).join('') + '</ul>';
  }

  function laneDocs(BL) {
    if (!BL || !BL.SURGE || !BL.CASCADE) {
      throw new Error('BirdLogic alert constants are required for info dialogs');
    }
    var docs = {
      mega: {
        title: '🦤 ABA Code 3+ megas',
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
          + 'your exact selected personal list. Unknown history does not prove absence. A far bird that is not new, or one you have already '
          + 'seen, stays in <b>Mega rarities</b> instead of alerting again here.</p>'
          + '<p>For photos, state history and the rarity evidence, open '
          + '<b>Rare birds</b>: this feed keeps one compact row per bird.</p>'
      },
      celebrity: {
        title: '🎯 Celebrity Birds',
        body: '<p>Birds <b>eBird flags as notable in this region</b>, with <b>' + BL.NEED_MIN_SIGHTINGS
          + ' or more independent sightings</b> and at least ' + BL.NEED_MIN_SIGHTINGS
          + ' distinguishable known reporting parties at one hotspot or adjacent '
          + 'walkable hotspots, within chase distance and the last '
          + BL.FRESH_HOURS + ' hours plus checklist-start grace. This independent '
          + 'news remains useful for recorded birds and unknown personal history.</p>'
          + '<p>Reporting names are source identity evidence, not verified people. '
          + 'Repeated names and shared parties count once; unnamed reports remain '
          + 'useful evidence but do not establish additional known parties.</p>'
          + '<p><b>Notable, not merely unseen.</b> A bird earns this category '
          + 'by being unusual <i>here</i> and drawing a real local stakeout. '
          + 'An unseen-but-ordinary bird belongs in <b>All unseen reports</b> '
          + 'and <b>Closest spots</b>. A one-report mega belongs in '
          + '<b>Twitches today</b>; CELEBRITY has no reviewed-rarity exemption.</p>'
          + '<p>The unified feed sorts every category by newest observation '
          + 'or event date/time first. Missing dates sort last.</p>'
          + '<p>Every report-specific fact on a row comes from the <b>same newest '
          + 'report</b> — place, distance, count, date and checklist link. Private addresses '
          + 'are never listed.</p>'
      },
      crowd: {
        title: '🐦 Species drawing a crowd',
        body: '<p><b>Distinct observers</b> — not checklists, because one birder '
          + 'filing three lists is how a quiet spot fakes a crowd — at one spot '
          + 'in the last ' + BL.SURGE.WINDOW_H + ' hours, measured against what '
          + 'that species normally draws <i>at that place</i>, clustered to 300 metres. '
          + 'At least two distinct observers and two distinct checklists are required; '
          + 'two names on one shared checklist do not establish corroboration.</p>'
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
          + '<b>same</b> species, that is evidence of recent interest, not proof '
          + 'of independent parties or continued presence.</p>'
          + '<p>Require <b>' + BL.CASCADE.MIN_BIRDERS
          + '+ distinct people from the top 100 in the past ' + BL.CASCADE.WINDOW_DAYS
          + ' calendar days</b>, with the latest addition within '
          + BL.CASCADE.MAX_AGE_DAYS + ' calendar days. Each person counts once; '
          + 'future and older additions do not count. It is not a rarity feed, so a bird can appear here '
          + 'without being flagged rare anywhere, and a mega nobody has ticked '
          + 'yet will not appear at all.</p>'
          + '<p>This category sees the <b>whole region</b>, including counties your '
          + 'own feeds never cover — which is its real value — but the board is '
          + 'cached daily, so it can lag about a day.</p>'
          + '<p>The board names the bird and the date and <i>nothing else</i>, so '
          + 'the place and time on each row come from a species-scoped state '
          + 'feed. That is where to actually go.</p>'
          + '<p>Nearby sightings keep the existing local selection rules and may '
          + 'be older. Outside your chase radius there is no distance cap within '
          + 'the active region, but the public sighting used must be within '
          + BL.CASCADE.MAX_AGE_DAYS + ' calendar days. Home, public-place and valid-coordinate '
          + 'checks still apply. Distant alerts explicitly show that they are outside '
          + 'your chase area, their distance and the evidence dates.</p>'
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
          + '<p>The compact date is the newest hotspot checklist that triggered '
          + 'the event, not a species observation merged for detail. '
          + 'The headline opens Stakeout hotspot. Bird Gen does not duplicate '
          + '<b>Hot patches</b> or the Stakeout section’s species/checklist lists.</p>'
      },
      favorite: {
        title: '★ Favorite Patch birds',
        body: '<p>Fresh unseen species at a saved patch, using its own recent feed. '
          + 'One alert per species and patch keeps the newest evidence. The bird photo '
          + 'identifies the species; the headline opens the patch. County scope requires '
          + 'the exact selected personal list and matching patch/observation ownership. '
          + 'Each patch publishes as it arrives, without waiting for later patches. '
          + 'Failed sibling feeds are named while successful and still-relevant retained '
          + 'results remain visible.</p>'
      },
      mass: {
        title: '🪶 Mass flocks',
        body: '<p>One count-sorted regional eBird webpage supplies current-month high counts. '
          + 'A single species observation of at least 500 birds within the last seven days '
          + 'can qualify; independent visits are not required. Counts are reported evidence, '
          + 'not a guarantee the flock remains there or that every count was reviewed.</p>'
          + '<p>The shared public-hotspot directory supplies coordinates by exact location ID. '
          + 'Unresolved or private locations are withheld, not guessed. Native/naturalized '
          + 'and provisional species are supported; escapees, hybrids and additional taxa are not. '
          + 'Counts are never added across observations. Regional maxima can hide other flocks, '
          + 'so this is not an exhaustive census. Early in a month, previous-month days are '
          + 'not covered and the source is marked partial.</p>'
          + '<p>Reopening reuses successfully acquired evidence for up to 30 minutes and '
          + 'rechecks observation eligibility without downloading again. Stale evidence is refreshed '
          + 'on the next load, not by an extra background sweep.</p>'
          + '<p>Ordinary Bird Gen refresh downloads stale high-count evidence and reuses the shared '
          + 'hotspot directory. '
          + 'A website challenge, unreadable page or failed directory is reported as failed '
          + 'coverage; still-relevant retained alerts remain visible.</p>'
          + '<p>Like Mega alerts, nearby news requires a bird missing from your selected personal '
          + 'list and uses the same 55-mile day-trip boundary, not the configurable chase radius. '
          + 'An evidence-backed new report at a public hotspot can qualify at any distance, '
          + 'whether or not you have seen the species elsewhere. All eligible flocks appear '
          + 'without an expansion button.</p>'
          + '<p>For other candidates, dated hotspot observations check up to 30 days of history. '
          + 'Older days are checked first, moving backwards from the seven-day freshness boundary; '
          + 'an earlier species report at any count stops the arrival check. Only survivors need '
          + 'recent days to date their first report. Missing, capped, mismatched-location or '
          + 'unsurveyed earlier days leave arrival unverified, not absent. Nearby news can appear '
          + 'while this evidence loads. First reported means within that checked window, not '
          + 'first-ever or proven physical arrival. A higher count does not restart an arrival.</p>'
          + '<p>Events sort by newest evidence with the rest of the feed. '
          + 'A large count is not proof of seasonal rarity or fallout. Recurring resident '
          + 'gatherings can still qualify; there is no seasonal population baseline.</p>'
          + '<p>More eyes on this flock appears only alongside an independently qualifying '
          + 'Crowd signal. It describes Patagonia-effect potential, not proof that associated '
          + 'rarities have appeared. All evidence comes directly from eBird.</p>'
      },
      patch: {
        title: '🥇 High-yield top patches',
        body: '<p>Today’s patches grades every current destination against the '
          + 'median score of the same list. Bird Gen includes only the top '
          + '<b>high yield</b> category — score at least twice that median — '
          + 'when at least four destinations can be compared, and only after '
          + 'the complete chase view is ready.</p>'
          + '<p>The headline opens Stakeout hotspot; <b>Nearby Patches</b> '
          + 'keeps the place in its full local-patch context. This is a local '
          + 'projection of data the chase '
          + 'wave already computed, so it adds no API call. The two-by-two photo '
          + 'grid shows up to four distinct proven unseen species, never padded '
          + 'with recorded birds. When none are proven unseen, unknown-history '
          + 'birds are labelled explicitly; otherwise a place image is used.</p>'
      }
    };
    docs.feed = {
      title: '🔔 Bird Gen',
      body: alertTypeKey() + '<p>One feed sorts every active alert by <b>newest observation or event '
        + 'date/time first</b>, including newly loaded sources. Category priority '
        + 'and stable bird/place/checklist identity break equal-time ties. Missing '
        + 'or invalid dates sort last; a date without a time is labelled honestly. '
        + 'Migration forecasts use their validity date, not the time you refreshed.</p>'
        + '<p>There is no feed-wide Unseen filter. Favorite Patch eligibility is personal; '
        + 'flock and place news remain useful even for species already seen.</p>'
        + '<p>If one species qualifies more than once, it appears once under '
        + 'its strongest category and keeps every qualifying reason on that '
        + 'row in accessible category metadata. The visible category headline explains '
        + 'the strongest category. Place-specific favorite and flock stories remain separate.</p>'
        + '<p>Select a category/count tag to show only that category. The selected tag has '
        + 'a checkmark and emphasized border; select it again to show all alerts. '
        + 'The filter survives incoming results but resets whenever Bird Gen opens or refreshes. '
        + 'It is not saved, and filtering makes no network requests. '
        + 'Applicable categories remain visible while loading, with an hourglass or their known '
        + 'retained count. Failed and incomplete categories keep a separate retry button; '
        + 'filtering and retry are different actions. A healthy zero disappears only after '
        + 'its sources finish. Overlapping FOY reasons do not add a primary-category card.</p>'
        + '<p>Bird headlines read <b>species name at place</b>, with no inline RARE or MEGA tag. '
        + 'The category badge and bold explanation sit below the headline. '
        + 'Four-letter code, <b>xN</b> and linked compact date with checklist ID come first '
        + 'in the extra evidence below, using the same small-print styling; existing evidence '
        + 'and caveats follow. PPTE keeps its event-specific evidence. '
        + 'The alert icon and relative age remain at the right. '
        + 'The whole headline opens Stakeout bird or Stakeout hotspot; this '
        + 'news feed does not expand into report, species or checklist lists.</p>'
        + '<p>Slow loading: fresh scans may take 30 seconds or more; broad scans '
        + 'can take several minutes. Cached results can appear sooner. Useful '
        + 'results remain visible while more evidence loads. The active loader '
        + 'shows estimated time remaining when its work plan is known.</p>'
        + '<p>Some megas are not news today: they are too far and not new, '
        + 'already seen, or supported by only one report. All remain in '
        + '<b>Mega rarities</b>. This explanation is not a live count.</p>'
        + '<p>A bird count uses the most recent qualifying checklist, not '
        + 'the sum of repeat sightings or the number of reports. When that '
        + 'checklist has no known count, the xN value is omitted.</p>'
        + '<p>Progress counts successfully loaded logical source groups, not HTTP calls. '
        + 'Failed, incomplete, loading and not-applicable groups are counted separately; '
        + 'skipped groups do not inflate the loaded total. The bar fills only for loaded groups. '
        + 'Open Source status to see current group names and retry failed or incomplete work '
        + 'without refreshing successful groups. Detailed errors remain in debug logs; '
        + 'the feed does not claim nothing is happening when sources are incomplete. '
        + 'Custom-region county checklist scope is resolved automatically; '
        + 'other source results can appear while it loads. '
        + 'A complete retained snapshot may still supply TOP PATCH rows while '
        + 'live data refreshes; partial or failed destination views may not.</p>'
        + '<p>Regional reporting activity, if shown elsewhere, counts checklists, '
        + 'contributors and species reported in a completed regional day. These '
        + 'counts describe reporting activity, not bird abundance or chase odds. '
        + 'Late submissions and review can revise them, and they do not show how '
        + 'well a hotspot was searched.</p>'
        + '<h3>' + docs.mega.title + '</h3>' + docs.mega.body
        + '<h3>' + docs.mass.title + '</h3>' + docs.mass.body
        + '<h3>' + docs.favorite.title + '</h3>' + docs.favorite.body
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
    var coverage = context.massCoverage;
    if (coverage && /candidate species|daily samples/i.test(coverage)) {
      coverage = 'Retained evidence from an older sampled source; current-page coverage not verified';
    }
    return '<p><b>Current feed:</b> ' + count + '.' + mega + '</p>'
      + (coverage ? '<p><b>Mass flock coverage:</b> ' + escapeWith(escapeHtml, coverage)
        + '. Regional maxima are not exhaustive and can hide other flocks; large counts do not'
        + ' by themselves establish seasonal rarity.</p>' : '');
  }

  function sectionNoteHtml(warning, escapeHtml) {
    return warning
      ? '<p class="docnote">⚠️ ' + escapeWith(escapeHtml, warning) + '</p>' : '';
  }

  function renderSectionDocHtml(doc, noteHtml, escapeHtml) {
    var h = '';
    if (!doc) {
      return noteHtml || '<p class="hint">No calculation notes for this section yet.</p>';
    }
    if (doc.introduction) h += '<p class="docintro">' + escapeWith(escapeHtml, doc.introduction) + '</p>';
    h += noteHtml || '';
    h += '<details class="doctechnical"><summary>Sources, calculations and limitations</summary>';
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
    return h + '</details>';
  }

  function renderBirdGen(context, deps) {
    var docs = laneDocs(deps && deps.BirdLogic);
    return {
      title: docs.feed.title,
      subtitle: 'How Bird Gen works',
      bodyHtml: (context && context.sectionDoc
        ? renderSectionDocHtml(context.sectionDoc, context.contextHtml || '', deps && deps.escapeHtml)
        : '<p class="docintro">'
        + 'Bird Gen combines different kinds of birding news, each identified by a category. '
        + 'This explanation describes what each category means and why an item can appear in the feed.</p>'
          + ((context && context.contextHtml) || '')) + docs.feed.body
    };
  }

  function renderSpuh(context, deps) {
    context = context || {};
    var esc = deps && deps.escapeHtml;
    return {
      title: context.name || 'Spuh explanation',
      subtitle: 'What this spuh means',
      bodyHtml: '<p class="docintro">A spuh is a broad identification, such as a gull or a group of similar birds, '
        + 'rather than one definite species. This explanation describes the selected group and its possible members; '
        + 'an example picture does not identify a bird you saw.</p>'
        + '<p>' + escapeWith(esc, context.definition || '') + '</p>'
        + '<h4>Marked spuh names</h4>'
        + '<p>An italic name followed by * is a spuh for which eBird does not '
        + 'publish its own set of birds. The count on the taxonomic backbone '
        + 'belongs to that verified set, not to the marked spuh.</p>'
        + '<h4>Sources and boundary</h4>'
        + '<p>Generated on this device from the eBird taxonomy '
        + 'and eBird’s definition of a spuh; no taxonomy bundle ships in '
        + 'the public app.</p>'
        + '<p>Example candidate images come from Wikipedia/Wikimedia through '
        + 'the app’s existing attributed photo pipeline. One image illustrates '
        + 'a possible member; it does not define the whole spuh.</p>'
    };
  }

  function apiApplicationHelpHtml(expanded) {
    return '<details data-birdchaser-api-help' + (expanded ? ' open' : '')
      + ' style="margin:12px 0;padding:12px;border:1px solid #0072B2;border-radius:8px;overflow-wrap:anywhere">'
      + '<summary style="min-height:44px;padding:8px 0;box-sizing:border-box;cursor:pointer">'
      + 'First-time API access: instructions and examples</summary>'
      + '<p>Already have a key? The installed app reads and verifies it automatically. '
      + 'If eBird shows Request API Access, complete that form yourself.</p>'
      + '<p><strong>Examples only if accurate for your personal, non-commercial use.</strong> '
      + 'Keep your description generic; your key is not limited to Bird Chaser.</p>'
      + '<dl><dt><strong>Organization</strong></dt><dd>None</dd>'
      + '<dt><strong>Project title</strong></dt><dd>Personal use</dd>'
      + '<dt><strong>Project Type</strong></dt><dd>General</dd>'
      + '<dt><strong>Use Cases</strong></dt><dd>Personal use</dd>'
      + '<dt><strong>Description of Use</strong></dt>'
      + '<dd>Personal, non-commercial use of eBird data.</dd></dl>'
      + '<p>Use your own contact and organization details where applicable. For organizational or commercial use, describe '
      + 'your actual use and review <a href="https://www.birds.cornell.edu/home/ebird-api-terms-of-use/" '
      + 'target="_blank" rel="noopener">eBird API terms</a>; permission may be required.</p>'
      + '<p>Review the form and terms before submitting it yourself. Bird Chaser does not '
      + 'fill fields, accept terms or submit the request. When eBird displays a key, '
      + 'capture continues automatically. If it is not issued now, return later or paste '
      + 'your key manually. Approval is eBird\'s decision.</p></details>';
  }

  var SETUP_HELP = {
    account: {
      title: 'Connect eBird',
      body: '<p class="docintro">Connect for read-only access to your seen-bird list. Bird Chaser does not change your eBird records.</p>'
        + '<p>Sign in directly on eBird\'s website. Bird Chaser does not need your password.</p>'
        + '<p>Connect identifies your account from its profile. Your exact seen list is fetched after you '
        + 'confirm Home and region. Your sign-in is reused when retrieving your API key. Live reports, Home and your seen list '
        + 'are separate setup steps; skipping one does not mark it ready.</p>'
    },
    key: {
      title: 'Live bird reports',
      body: '<p class="docintro">A personal API key enables live eBird sightings and hotspot data.</p>'
        + '<p>This key is separate from signing in. In the installed app, your website login is reused; '
        + 'a displayed key is read and checked automatically. In a browser, copy the key and paste it '
        + 'under Other options. Both actions open the same eBird key page; only the installed flow '
        + 'captures the key automatically. Finish any application on eBird yourself.</p><p>Key verification is sent directly to eBird. '
        + 'Your key is saved only after eBird accepts it. You review and submit any application yourself.</p>'
        + apiApplicationHelpHtml(false)
    },
    home: {
      title: 'Choose Home',
      body: '<p class="docintro">Home sets distances, weather and nearby birding choices.</p>'
        + '<p>A nearby city center is fine; no exact address is needed. The closer it is to where '
        + 'you bird, the more accurate nearby results and distances will be.</p>'
        + '<p>Enter a waypoint as latitude, longitude (for example 47.6, -122.3), an address or a city. '
        + 'Use current location fills this same field only after your tap; it does not approve Home. '
        + 'Validate Home checks a typed location. If several places match, choose the intended candidate. '
        + 'Review the selected location, then Continue to find its state or province.</p>'
        + '<p>Nothing is saved until you validate Home and confirm its matching region. '
        + 'Existing Homes remain unchanged while you review it. You can add more Home/region pairs later.</p>'
        + '<p>The selected-location confirmation shows OpenStreetMap tiles around the candidate. '
        + 'Open Maps opens your selected external map app only when tapped. '
        + 'Coordinates remain readable offline; previewing does not save Home.</p>'
    },
    region: {
      title: 'Confirm region',
      body: '<p class="docintro">Save the Home you approved together with its matching region.</p>'
        + '<p>Your Home must be within its region. To use another region, choose a Home there. '
        + 'No additional device-location request is needed.</p>'
        + '<p>If that region already has a different Home, replacement requires your explicit confirmation. '
        + 'You can add more Home/region pairs later, each with its own Home.</p>'
        + '<p>First-time setup uses the state or province containing Home. After setup, the region picker '
        + 'also offers broader reports such as Lower 48 and ABA Area. No county or broader-region choice '
        + 'is required here. Where bundled boundary data is available, the picture shows an approximate '
        + 'region outline with Home marked; it does not request GPS or send Home to a map provider.</p>'
    },
    seen: {
      title: 'Your seen birds',
      body: '<p class="docintro">Your seen list distinguishes birds you have recorded from birds you still need.</p>'
        + '<p>This reads your eBird list for the selected region and period. Signing in and verifying '
        + 'an API key are separate. A matching saved list remains usable while an update runs.</p>'
        + '<p>You can continue while fetching. If it fails, retry eBird first; CSV is an optional fallback, '
        + 'but an annual import cannot certify the exact regional list. Missing evidence is not proof '
        + 'that a bird is unseen.</p>'
    },
    summary: {
      title: 'Your setup',
      body: '<p class="docintro">The summary shows which capabilities are ready and which still need setup.</p>'
        + '<p>Each capability is independent. Skipping a step does not mark it ready. '
        + 'Home is required to complete setup, but can be approximate.</p>'
        + '<p>Reopen setup in Settings at any time. You can add more Home/region pairs later; '
        + 'each region has its own Home.</p>'
    }
  };

  var SETUP_ACTION_HELP = {
    setupConnectEbird: 'Opens eBird so you can sign in. Bird Chaser reads your profile to identify the account, then fetches the matching seen-bird list after Home and region are confirmed. It does not change your eBird records.',
    setupGetKey: 'Opens the eBird API-key page. In the installed app, your website sign-in is reused and a displayed key is captured and checked directly with eBird before saving. In a browser, copy the key, return and paste it under Other options. The optional browser button opens the same page for manual copying, not a second kind of key. Complete any application yourself; this button does not fill fields, accept terms or submit a request.',
    setupVerifyKey: 'Checks the key you entered directly with eBird. Only a successful check saves it. Review the confirmation before continuing to Home. A rejected key stays editable; this does not connect or change your eBird account.',
    setupHomeHere: 'Requests this device location only after your tap, fills the Home field and shows the selected location on a map for confirmation. Continue finds its matching region; Back lets you enter a waypoint, address or city instead. Nothing is saved until Home and region are confirmed together.',
    setupHomeFind: 'Validates the waypoint coordinates, address or city in the Home field without requesting GPS. Review the matching location on its map, then Continue to find its state or province. If several places match, choose the intended candidate first. Nothing is saved until Home and region are confirmed together.',
    setupHomeApprove: 'Shows the displayed candidate on a map for confirmation. Continue looks up its containing state or province; Back lets you correct the Home field. This button alone does not save or replace Home.',
    setupHomeReview: 'Returns to the confirmation screen for the approved Home draft and its matching region. Review the pair before saving it; changing Home is still available.',
    setupNext: 'Confirms the displayed region and saves it together with your validated Home, then continues to your seen birds. To pick a different region, use Back and select a different Home. If this region has a different saved Home, the replacement checkbox must be confirmed first. More regions are available after setup.',
    setupFetchSeen: 'Reads your exact seen-bird list for the selected account, region and period. The result helps distinguish seen and unseen birds. A failed refresh does not invalidate a matching saved list or prove that missing birds are unseen.',
    setupSeenConnect: 'Returns to account connection so Bird Chaser can read your seen-bird list. Connecting is read-only and does not change your eBird records.',
    setupSeenRegion: 'Returns to Home and region setup so your seen list can be matched to the right area. It does not select a region or request location automatically.',
    setupContinue: 'Opens the setup summary without requiring you to wait for the seen-list fetch. Unfinished capabilities remain marked as unfinished; skipping does not certify a list as complete.',
    setupHomeOptions: 'Choose the place that matches your intended Home. No result is selected for you. The chosen coordinates remain a draft until Home and its matching region are explicitly confirmed.'
  };

  function setupActionHelp(context) {
    if (context.action === 'setupConnectEbird' && context.connected) {
      return 'Reviews the connected eBird account before automatic key capture. Back lets you switch accounts.';
    }
    if (context.action === 'setupVerifyKey' && context.verified) {
      return 'Keeps your already verified key and shows its confirmation before continuing to Home. No new key request or eBird application is submitted.';
    }
    if (context.action === 'setupContinue' && (context.ready || context.step === 'summary')) {
      return 'Finishes setup and opens Bird Chaser. Any unfinished capability remains marked as unfinished. You can return to setup in Settings; this action does not erase your saved data.';
    }
    return SETUP_ACTION_HELP[context.action] || '';
  }

  function renderSetupHelp(context) {
    var entry = SETUP_HELP[context.step] || SETUP_HELP.account;
    var action = setupActionHelp(context);
    return {
      title: 'Help: ' + (context.step === 'all' ? 'Setup Bird Chaser' : context.label || entry.title),
      subtitle: 'Optional setup guidance',
      bodyHtml: context.step === 'all'
        ? '<p class="docintro">Setup is a sequence of short actions. Open Help on any step for details.</p>'
          + Object.keys(SETUP_HELP).map(function (step) {
            return '<h3>' + SETUP_HELP[step].title + '</h3>' + SETUP_HELP[step].body;
          }).join('')
          + '<h3>Action-specific explanations</h3><dl>'
          + Object.keys(SETUP_ACTION_HELP).map(function (id) {
            return '<dt><code>' + defaultEscape(id) + '</code></dt><dd>'
              + defaultEscape(SETUP_ACTION_HELP[id]) + '</dd>';
          }).join('') + '</dl><p>' + setupActionHelp({action:'setupConnectEbird',connected:true})
          + '</p><p>' + setupActionHelp({action:'setupVerifyKey',verified:true})
          + '</p><p>' + setupActionHelp({action:'setupContinue',ready:true}) + '</p>'
        : (action ? '<p class="docintro">' + defaultEscape(action) + '</p>' : '') + entry.body
    };
  }

  function renderSetupConfirmation(context, deps) {
    var kind = context.kind, esc = deps.escapeHtml || defaultEscape;
    var point = context.point || { lat: 47.6, lng: -122.3, label: 'Example Seattle location' };
    var title = kind === 'key' ? 'API key verified!'
      : kind === 'home' ? 'Confirm Home' : 'Connected as ' + String(context.name || 'Sample Birder') + '!';
    var body = kind === 'key' ? '<p class="docintro">Your key works with eBird. Live reports are ready.</p>'
      : kind === 'home' ? '<p class="docintro"><strong>Home:</strong> ' + esc(point.label) + '</p>'
        + '<div id="setupConfirmationMap" class="map" role="region" aria-label="Selected Home map"></div>'
        + '<p class="hint">' + Number(point.lat).toFixed(5) + ', ' + Number(point.lng).toFixed(5)
        + ' · <a data-setup-confirm-map href="' + esc(context.mapUrl || '#')
        + '" target="_blank" rel="noopener noreferrer">Open Maps</a></p>'
        + '<p class="hint">Continue to confirm its region before saving.</p>'
      : '<p class="docintro">Wrong account? Choose Back, then Switch account.</p>';
    return { title: title, subtitle: 'Step ' + (kind === 'key' ? '2' : kind === 'home' ? '3' : '1') + ' of 5', bodyHtml: body
      + '<div class="setupactions setupconfirmation">'
      + '<button data-setup-confirm-continue class="setupprimary" type="button">Continue</button>'
      + '<button data-setup-confirm-back class="secondary" type="button">Back</button></div>' };
  }

  var CATALOG = {
    'setup-account-connected': {
      name: 'Confirm the connected eBird account',
      group: 'Setup guidance',
      contextLabel: 'Sample account confirmation; the captured display name is shown as text.',
      render: function (context, deps) { return renderSetupConfirmation(Object.assign({}, context, {kind:'account'}), deps); }
    },
    'setup-key-verified': {
      name: 'Confirm the verified eBird API key',
      group: 'Setup guidance',
      contextLabel: 'Successful verification without displaying the credential.',
      render: function (context, deps) { return renderSetupConfirmation(Object.assign({}, context, {kind:'key'}), deps); }
    },
    'setup-home-confirmed': {
      name: 'Review the selected Home',
      group: 'Setup guidance',
      contextLabel: 'Sample selected Home with a visible map; external Maps opens only on tap.',
      render: function (context, deps) { return renderSetupConfirmation(Object.assign({}, context, {kind:'home'}), deps); }
    },
    'setup-help': {
      name: 'First-time setup help',
      group: 'Setup guidance',
      contextLabel: 'All step and action explanations; the question-mark button opens help for the current recommended action.',
      render: renderSetupHelp
    },
    'event-feed': {
      name: 'Mass Flocks and Patagonia calculations',
      group: 'Category and calculation sheets',
      contextLabel: 'Sample Mass Flocks calculation; live coverage and retained-result notes vary.',
      render: function (context) {
        if (!context.sectionHtml) throw new Error('Event-feed calculation notes are required');
        return {
          title: context.title,
          subtitle: 'Source rules and current coverage',
          bodyHtml: context.sectionHtml
        };
      }
    },
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
    'close-setup': {
      surface: 'confirmation',
      name: 'Close setup',
      reason: 'Transactional dismissal confirmation; unverified key input is discarded only after acceptance.'
    },
    'birdgen-alert-evidence': {
      surface: 'sheet',
      name: 'Bird Gen alert evidence',
      reason: 'Per-alert source evidence, dates, checklist links and merged reasons generated from the selected live or retained alert, not authored help.'
    },
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
    'favorite-save-failed': {
      surface: 'sheet',
      name: 'Favorite not saved',
      reason: 'Transient persistence-error and recovery notice, not informational help.'
    },
    'set-home-anchor': {
      surface: 'sheet',
      name: 'Set Home to Here',
      reason: 'Interactive missing-anchor workflow, not an informational help sheet.'
    },
    'find-anchor-required': {
      surface: 'sheet',
      name: 'Find an anchor',
      reason: 'Interactive fallback place-entry workflow, not an informational help sheet.'
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
    },
    'regionChooser': {
      surface: 'fullscreen',
      name: 'Choose active region',
      reason: 'Interactive Current/Recent/All navigation, not informational prose.'
    },
    'setupSheet': {
      surface: 'fullscreen',
      name: 'Setup Bird Chaser',
      reason: 'Resumable credential and capability actions, not a read-only information dialog.'
    },
    'capture-page-fragments': {
      surface: 'confirmation',
      name: 'Capture redacted page fragments',
      reason: 'Explicit opt-in to bounded local source-structure diagnostics, not an informational sheet.'
    },
    'copy-page-fragments': {
      surface: 'confirmation',
      name: 'Copy redacted page fragments',
      reason: 'Separate clipboard export requiring review before sharing; excluded from ordinary Copy all.'
    },
    'clear-diagnostics': {
      surface: 'confirmation',
      name: 'Clear diagnostic history',
      reason: 'Destructive confirmation before removing the bounded diagnostic store.'
    }
  };

  function render(id, context, deps) {
    var entry = CATALOG[id];
    if (!entry) throw new Error('Unknown informational dialog: ' + id);
    return entry.render(context || {}, deps || {});
  }

  function renderSample(id, deps) {
    var esc = deps && deps.escapeHtml;
    if (id === 'setup-help') return render(id, { step: 'all' }, deps);
    if (['setup-account-connected', 'setup-key-verified', 'setup-home-confirmed'].indexOf(id) >= 0)
      return render(id, {}, deps);
    if (id === 'event-feed') {
      var doc = deps && deps.sectionDocs && deps.sectionDocs.massBtn;
      if (!doc) throw new Error('Mass Flocks section docs are required for the catalog sample');
      return render(id, {
        title: 'Mass Flocks',
        sectionHtml: renderSectionDocHtml(doc, '', esc)
      }, deps);
    }
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
    alertKinds: ALERT_KINDS,
    catalog: CATALOG,
    excluded: EXCLUDED,
    laneDocs: laneDocs,
    birdGenContext: birdGenContext,
    sectionNoteHtml: sectionNoteHtml,
    renderSectionDocHtml: renderSectionDocHtml,
    apiApplicationHelpHtml: apiApplicationHelpHtml,
    render: render,
    renderSample: renderSample,
    sectionSampleContext: sectionSampleContext,
    isExcluded: isExcluded
  };
}));
