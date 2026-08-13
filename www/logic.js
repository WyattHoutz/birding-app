/*
 * Bird Chaser — shared pure logic (BirdLogic)
 * ------------------------------------------------------------------
 * This module is the SINGLE SOURCE OF TRUTH for the app's data scope and
 * section transforms, ported 1:1 from the Python birding report so the app
 * and the Markdown report produce the same results from the same eBird data.
 *
 * It is intentionally free of DOM / fetch / localStorage so it can run both
 * in the browser (attached to window.BirdLogic) and under Node (for the
 * cross-language parity test suite in the sibling `birding` repo).
 *
 * Report anchors (birding repo): ebird.py, fetch_ebird.py, regions.py,
 * analyze.py (load_snapshot/score/seen), report.py (_cluster_by_proximity,
 * _approx_meters, _pick_canonical_loc, _score_destination_clusters,
 * section_destinations/excursions/today/new_today), time_of_day.py.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; // Node
  root.BirdLogic = api;                                                   // browser
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---- constants (mirror the report) ---------------------------------------
  var CONST = {
    FETCH_BACK: 7,          // fetch_ebird.py --back default
    CUTOFF_DAYS: 2,         // analyze.CUTOFF_DAYS (daily-section recency)
    GEO_DIST_KM: 50,        // regions.py geo_dist_km
    DAILY_DRIVE_MI: 12,     // regions.py _WA daily_drive_mi
    // How far you will actually drive for one bird. report.chase_max_mi().
    // Written down once for Closest spots, then every other chase section
    // quietly went unbounded — Today's rarity reports was listing birds 60+
    // miles out beside one four miles from the house.
    //
    // 35, up from 30, and per-region on the report side (regions.Region
    // .chase_max_mi, rebound by analyze.set_region). This is the DEFAULT and the
    // value for WA; the app reads a per-region override from settings.
    //
    // STRAIGHT-LINE, always. Travel zones produce "effective miles" that price
    // in ferries and water, and those are right for ranking and for labelling a
    // trip — but never for inclusion. Murden Cove is 17 straight-line miles and
    // 52 effective; a real Arctic Tern chase went there, and a penalised radius
    // would have dropped it. eBird's own dist= is a straight-line radius too.
    CHASE_MAX_MI: 35,
    CLUSTER_RADIUS_M: 250,  // report._cluster_by_proximity radius_m
    STAKEOUT_MIN_CHECKLISTS: 3,  // report.STAKEOUT_MIN_CHECKLISTS
    STAKEOUT_CLUSTER_M: 300,     // report.STAKEOUT_CLUSTER_M
    EXCURSION_DECAY_MI: 30, // report effective = score/(1+extra/30)
    TRIP_WINDOW_DAYS: 7,    // report.TRIP_WINDOW_DAYS (special-trip window)
    TOP_DEST: 10,
    TOP_EXC: 10,
    FRESH_24H_MS: 24 * 3600 * 1000,
    // time-of-day (time_of_day.py)
    TOD_DAWN_END: 7, TOD_DUSK_START: 19, TOD_MIN_OBS: 5,
    TOD_DAWN_TH: 0.50, TOD_NIGHT_TH: 0.30,
    // convoys (report.py CONVOY_*)
    CONVOY_LOOKBACK_DAYS: 7, CONVOY_MIN_STOPS: 2, CONVOY_MAX_RESULTS: 200
  };

  // ---- report registry (mirror regions.py REGIONS) -------------------------
  // Every report the Markdown pipeline generates is defined here so the app can
  // offer the SAME menu of reports and scope its eBird fetches identically.
  // Each profile carries every assumption regions.py bakes into its Region:
  // target counties, home coordinate, geo radius, daily-drive split, whether it
  // is a rarity tracker (no county/geo feeds — national alert only), which
  // birdlist supplies the "already seen" filter (seenFromRegion), and per-report
  // location exclusions. Keyed by slug; profileFor() also resolves stateCode.
  //
  //   birdlistSlug   — the seed key for THIS report's own year list (display)
  //   seenFromRegion — chase against ANOTHER region's list ('' = own)
  // The chase "seen" set = seenFromRegion || birdlistSlug (see seenSlugFor).
  var REPORTS = {
    wa: {
      slug: 'wa', label: 'Washington', kind: 'region', stateCode: 'US-WA',
      counties: [
        { slug: 'king', code: 'US-WA-033', label: 'King' },
        { slug: 'snohomish', code: 'US-WA-061', label: 'Snohomish' }
      ],
      home: { lat: 47.76, lng: -122.14 }, homeLabel: 'Woodinville, WA',
      geoDistKm: 50, dailyDriveMi: 12, chaseMaxMi: 35, tideStation: '9447130',
      geoFeed: true, isRarityTracker: false, birdlistSlug: 'wa', seenFromRegion: '',
      tzStdOffset: -8, tzObservesDst: true
    },
    mo: {
      slug: 'mo', label: 'Missouri', kind: 'region', stateCode: 'US-MO',
      counties: [
        { slug: 'platte', code: 'US-MO-165', label: 'Platte' },
        { slug: 'clay', code: 'US-MO-047', label: 'Clay' },
        { slug: 'jackson', code: 'US-MO-095', label: 'Jackson' }
      ],
      home: { lat: 39.22, lng: -94.75 }, homeLabel: 'Parkville, MO',
      geoDistKm: 50, dailyDriveMi: 20, chaseMaxMi: 35, tideStation: '',
      geoFeed: true, isRarityTracker: false, birdlistSlug: 'mo', seenFromRegion: 'lower48',
      tzStdOffset: -6, tzObservesDst: true
    },
    ks: {
      slug: 'ks', label: 'Kansas', kind: 'region', stateCode: 'US-KS',
      counties: [
        { slug: 'wyandotte', code: 'US-KS-209', label: 'Wyandotte' },
        { slug: 'johnson', code: 'US-KS-091', label: 'Johnson' },
        { slug: 'leavenworth', code: 'US-KS-103', label: 'Leavenworth' }
      ],
      home: { lat: 39.22, lng: -94.75 }, homeLabel: 'Parkville, MO',
      geoDistKm: 50, dailyDriveMi: 20, chaseMaxMi: 35, tideStation: '',
      geoFeed: true, isRarityTracker: false, birdlistSlug: 'ks', seenFromRegion: 'lower48',
      tzStdOffset: -6, tzObservesDst: true
    },
    az: {
      slug: 'az', label: 'Arizona', kind: 'region', stateCode: 'US-AZ',
      counties: [
        { slug: 'maricopa', code: 'US-AZ-013', label: 'Maricopa' },
        { slug: 'yavapai', code: 'US-AZ-025', label: 'Yavapai' }
      ],
      home: { lat: 33.85, lng: -112.11 }, homeLabel: 'Anthem, AZ',
      geoDistKm: 50, dailyDriveMi: 20, chaseMaxMi: 35, tideStation: '',
      geoFeed: true, isRarityTracker: false, birdlistSlug: 'az', seenFromRegion: 'lower48',
      tzStdOffset: -7, tzObservesDst: false
    },
    ca: {
      slug: 'ca', label: 'California', kind: 'region', stateCode: 'US-CA',
      counties: [
        { slug: 'placer', code: 'US-CA-061', label: 'Placer' },
        { slug: 'sacramento', code: 'US-CA-067', label: 'Sacramento' }
      ],
      home: { lat: 38.76, lng: -121.19 }, homeLabel: 'Granite Bay, CA',
      geoDistKm: 50, dailyDriveMi: 20, chaseMaxMi: 35, tideStation: '',
      geoFeed: true, isRarityTracker: false, birdlistSlug: 'ca', seenFromRegion: 'lower48',
      tzStdOffset: -8, tzObservesDst: true
    },
    lower48: {
      slug: 'lower48', label: 'Lower 48', kind: 'region', stateCode: 'lower48',
      counties: [], home: { lat: 39.8283, lng: -98.5795 }, homeLabel: 'Lower 48',
      // Not a place anyone lives — the geographic centre of the contiguous US,
      // used only to centre maps. Conditions must ask for a real home rather
      // than report the weather in a field near Lebanon, Kansas.
      homeIsPlaceholder: true,
      geoDistKm: 50, dailyDriveMi: 20, chaseMaxMi: 35, tideStation: '',
      geoFeed: false, isRarityTracker: true, birdlistSlug: 'lower48', seenFromRegion: '',
      // eBird subnational1 codes dropped from the rarity feed (non-CONUS).
      excludeSubnational1: ['US-AK', 'US-HI', 'US-PR', 'US-VI', 'US-GU', 'US-MP', 'US-AS', 'US-UM'],
      tzStdOffset: -8, tzObservesDst: true
    },
    aba: {
      slug: 'aba', label: 'ABA Area', kind: 'region', stateCode: 'aba',
      counties: [], home: { lat: 39.8283, lng: -98.5795 }, homeLabel: 'ABA Area',
      homeIsPlaceholder: true,
      geoDistKm: 50, dailyDriveMi: 20, chaseMaxMi: 35, tideStation: '',
      geoFeed: false, isRarityTracker: true, birdlistSlug: 'aba', seenFromRegion: '',
      // Inclusive companion to Lower 48: keeps HI + Canada, drops only US territories.
      excludeSubnational1: ['US-PR', 'US-VI', 'US-GU', 'US-MP', 'US-AS', 'US-UM'],
      tzStdOffset: -8, tzObservesDst: true
    },
    'fort-casey': {
      slug: 'fort-casey', label: 'Fort Casey Camping Trip', kind: 'trip', stateCode: 'US-WA',
      counties: [
        { slug: 'island', code: 'US-WA-029', label: 'Island' },
        { slug: 'jefferson', code: 'US-WA-031', label: 'Jefferson' }
      ],
      home: { lat: 48.1607, lng: -122.6776 }, homeLabel: 'Fort Casey, Whidbey Island',
      geoDistKm: 40, dailyDriveMi: 15, chaseMaxMi: 35, tideStation: '9444900',
      geoFeed: true, isRarityTracker: false, birdlistSlug: 'wa', seenFromRegion: 'wa',
      excludeLocIds: ['L7706326', 'L34755635'],
      excludeNameSubstrings: ['Smith Island', 'Partridge Bank'],
      tzStdOffset: -8, tzObservesDst: true,
      activeFrom: '2026-06-28', activeTo: '2026-07-04'
    },
    waikoloa: {
      slug: 'waikoloa', label: 'Waikoloa / Big Island Trip', kind: 'trip', stateCode: 'US-HI',
      counties: [{ slug: 'hawaii', code: 'US-HI-001', label: 'Hawaii' }],
      home: { lat: 19.9223, lng: -155.8836 }, homeLabel: 'Vista Waikoloa, Big Island',
      geoDistKm: 50, dailyDriveMi: 25, chaseMaxMi: 35, tideStation: '1617433',
      geoFeed: true, isRarityTracker: false, birdlistSlug: 'hi', seenFromRegion: '',
      tzStdOffset: -10, tzObservesDst: false,
      activeFrom: '2026-08-27', activeTo: '2026-09-18'
    }
  };

  // publish.py REGION_ORDER — drives the report selector order.
  var REGION_ORDER = ['wa', 'mo', 'ks', 'az', 'ca', 'lower48', 'aba', 'fort-casey', 'waikoloa'];

  // Backwards-compatible alias (older callers referenced PROFILES['US-WA']).
  var PROFILES = REPORTS;

  // The seed key whose bundled "already seen" codes filter this report's chases.
  function seenSlugFor(profile) {
    return (profile && (profile.seenFromRegion || profile.birdlistSlug || profile.slug)) || '';
  }

  // Ordered, UI-friendly list of every available report for the selector menu.
  function reports() {
    return REGION_ORDER.map(function (s) {
      var r = REPORTS[s];
      return {
        slug: r.slug, label: r.label, kind: r.kind,
        isRarityTracker: !!r.isRarityTracker, stateCode: r.stateCode
      };
    });
  }

  function profileFor(region) {
    var key = (region || '').toString().trim();
    if (!key) return REPORTS.wa;
    var low = key.toLowerCase();
    if (REPORTS[low]) return REPORTS[low];                 // by slug: 'wa', 'mo', 'fort-casey'…
    var up = key.toUpperCase();
    for (var i = 0; i < REGION_ORDER.length; i++) {        // by eBird state code: 'US-WA', 'lower48', 'aba'
      var r = REPORTS[REGION_ORDER[i]];
      if (r.stateCode.toUpperCase() === up) return r;
    }
    // Fallback: treat an arbitrary region code as a single "county" feed with
    // no geo feed, so the app still works for regions outside the registry.
    return {
      slug: low, label: up, kind: 'region', stateCode: up,
      counties: [{ slug: low, code: up, label: up }],
      home: null, geoDistKm: 50, dailyDriveMi: CONST.DAILY_DRIVE_MI, tideStation: '',
      geoFeed: true, isRarityTracker: false, birdlistSlug: low, seenFromRegion: ''
    };
  }

  // ---- request plan (contract) — mirror ebird.py + fetch_ebird._build_jobs --
  // Returns an ORDERED list of normalized eBird requests. Order matches the
  // report's _build_jobs (per-county recent+notable, then geo recent+notable)
  // which is also the merge order load_snapshot relies on.
  function round4(x) { return Math.round(x * 1e4) / 1e4; }

  function planFeeds(profile, back) {
    back = back == null ? CONST.FETCH_BACK : back;
    var jobs = [];
    profile.counties.forEach(function (c) {
      jobs.push({
        file: c.slug + '-recent.json', kind: 'recent', src: c.label,
        path: 'data/obs/' + c.code + '/recent',
        params: { back: back, detail: 'full', includeProvisional: 'true' }
      });
      jobs.push({
        file: c.slug + '-notable.json', kind: 'notable', src: c.label,
        path: 'data/obs/' + c.code + '/recent/notable',
        params: { back: back, detail: 'full' }
      });
    });
    if (profile.geoFeed !== false && profile.home && profile.home.lat && profile.home.lng) {
      var lat = round4(profile.home.lat), lng = round4(profile.home.lng);
      var dist = Math.min(Math.max(profile.geoDistKm, 0), 50);
      jobs.push({
        file: 'geo-recent.json', kind: 'recent', src: 'Geo' + dist + 'km',
        path: 'data/obs/geo/recent',
        params: { lat: lat, lng: lng, dist: dist, back: back, detail: 'full', includeProvisional: 'true' }
      });
      jobs.push({
        file: 'geo-notable.json', kind: 'notable', src: 'Geo' + dist + 'km',
        path: 'data/obs/geo/recent/notable',
        params: { lat: lat, lng: lng, dist: dist, back: back, detail: 'full' }
      });
    }
    return jobs;
  }

  // ---- phase 2 of the fetch plan: one call per unseen species --------------
  // The county and geo `recent` feeds return AT MOST ONE OBSERVATION PER
  // SPECIES. That is a property of eBird's endpoint, not of our filtering, and
  // it is the measured cause of "Closest spots seems sparse on data": a bird
  // you still need contributes exactly ONE location however many places it was
  // reported from, so every section that ranks places by which targets are
  // there is ranking a SAMPLE rather than the data.
  //
  // /data/obs/{region}/recent/{speciesCode} has no such collapse - it returns
  // every recent observation of that one species. So the fix is a second pass,
  // and the reason it was parked is that it makes the fetch plan depend on the
  // ANALYSIS RESULT: you cannot know which species to ask about until you have
  // merged phase 1 and subtracted the year list.
  //
  // Scope is the STATE, not the counties: one call per species covers strictly
  // more than a per-county fan-out would (2 counties + geo = 3 calls each for
  // the same bird) and the rows are distance-filtered locally anyway. Measured
  // on live WA: Western Kingbird returns 317 records at state scope, 2 at
  // county scope, 0 at hotspot scope.
  var SPECIES_FEED_MAX = 60;

  // Deterministic and code-sorted, because this list IS the fetch plan and a
  // plan that depends on iteration order cannot be proven equal across two
  // languages. Capped because call volume is the whole reason this is a second
  // phase - the cap is what keeps a bad day (a big unseen list early in the
  // year) from turning into a 200-call run against a ~50/min throttle.
  function speciesTargetCodes(recs, max) {
    max = (max === undefined || max === null) ? SPECIES_FEED_MAX : max;
    var seen = {}, out = [];
    (recs || []).forEach(function (r) {
      var c = r && r.code;
      if (c && !seen[c]) { seen[c] = 1; out.push(c); }
    });
    out.sort();
    return max > 0 ? out.slice(0, max) : out;
  }

  function speciesFeedRegion(profile) {
    if (!profile) return '';
    if (profile.stateCode && /^[A-Z]{2}-/.test(profile.stateCode)) return profile.stateCode;
    var c = profile.counties && profile.counties[0];
    return c ? c.code : '';
  }

  function planSpeciesFeeds(profile, codes, back) {
    back = back == null ? CONST.FETCH_BACK : back;
    var region = speciesFeedRegion(profile);
    if (!region || !codes || !codes.length) return [];
    return codes.map(function (code) {
      return {
        file: 'sp-' + code + '.json', kind: 'species', src: 'Sp:' + code,
        path: 'data/obs/' + region + '/recent/' + code,
        params: { back: back, detail: 'full', includeProvisional: 'true' }
      };
    });
  }

  function speciesMergePlan(codes) {
    return (codes || []).map(function (code) {
      return { file: 'sp-' + code + '.json', kind: 'species', src: 'Sp:' + code };
    });
  }

  // Merge order (mirror analyze._county_sources): recents FIRST (county order
  // then geo), THEN notables (county order then geo). This differs from the
  // fetch/plan order and is what load_snapshot iterates, so dedup base-row and
  // cluster iteration order match the report.
  //
  // Phase-2 species feeds go LAST, deliberately. Merge order decides which row
  // becomes the base row for a duplicated obsId, so appending means every
  // observation phase 1 already had keeps exactly the row and the kind it had
  // before - the second pass can only ADD locations, never restate existing
  // ones differently.
  function mergePlan(profile, speciesCodes) {
    var recents = [], notables = [];
    profile.counties.forEach(function (c) {
      recents.push({ file: c.slug + '-recent.json', kind: 'recent', src: c.label });
      notables.push({ file: c.slug + '-notable.json', kind: 'notable', src: c.label });
    });
    if (profile.geoFeed !== false && profile.home && profile.home.lat && profile.home.lng) {
      var dist = Math.min(Math.max(profile.geoDistKm, 0), 50);
      recents.push({ file: 'geo-recent.json', kind: 'recent', src: 'Geo' + dist + 'km' });
      notables.push({ file: 'geo-notable.json', kind: 'notable', src: 'Geo' + dist + 'km' });
    }
    return recents.concat(notables).concat(speciesMergePlan(speciesCodes));
  }

  // Assemble merge-ordered feeds from a {file: rows[]} map, then merge.
  function mergeFromFiles(profile, rowsByFile, speciesCodes) {
    var feeds = mergePlan(profile, speciesCodes).map(function (f) {
      return { kind: f.kind, src: f.src, rows: rowsByFile[f.file] || [] };
    });
    return mergeSnapshot(feeds);
  }

  function planConvoyFeeds(profile) {
    return profile.counties.map(function (c) {
      return {
        file: c.slug + '-checklists.json', src: c.label,
        path: 'product/lists/' + c.code,
        params: { maxResults: CONST.CONVOY_MAX_RESULTS }
      };
    });
  }

  // Render {path, params} to a stable query string for contract comparison.
  function requestUrl(req) {
    var keys = [];
    for (var k in req.params) if (req.params.hasOwnProperty(k) && req.params[k] != null) keys.push(k);
    keys.sort();
    var qs = keys.map(function (k) { return k + '=' + req.params[k]; }).join('&');
    return req.path + (qs ? '?' + qs : '');
  }

  // ---- merge snapshot (mirror analyze.load_snapshot) -----------------------
  // feeds: [{ kind:'recent'|'notable', src:'King'|'Geo50km'|..., rows:[...] }]
  // Union all rows, dedup by obsId (fallback subId:speciesCode), mark
  // kind='Rarity' if the obsId appeared in ANY notable feed, track sources.
  function obsKey(r) {
    return r.obsId || ((r.subId || '') + ':' + (r.speciesCode || ''));
  }

  function mergeSnapshot(feeds) {
    var order = [];        // encounter order of obsIds (parity with dict insertion)
    var byObs = {};        // obsId -> merged raw row + sources
    var notableIds = {};   // obsId -> 1 if seen in a notable feed
    var notableCodes = {}; // speciesCode -> 1 if ANY notable feed carried it
    var fromSpecies = {};  // obsId -> 1 if phase 2 is what introduced it
    (feeds || []).forEach(function (feed) {
      var isNotable = feed.kind === 'notable';
      var isSpecies = feed.kind === 'species';
      (feed.rows || []).forEach(function (r) {
        var id = obsKey(r);
        if (isNotable) { notableIds[id] = 1; if (r.speciesCode) notableCodes[r.speciesCode] = 1; }
        var ex = byObs[id];
        if (!ex) {
          byObs[id] = { row: r, sources: [feed.src] };
          if (isSpecies) fromSpecies[id] = 1;
          order.push(id);
        } else if (ex.sources.indexOf(feed.src) < 0) {
          ex.sources.push(feed.src);
        }
      });
    });
    var out = [];
    order.forEach(function (id) {
      var e = byObs[id], r = e.row;
      // A rarity reported from five places used to arrive as ONE flagged row,
      // because the notable feed collapses per species too. Phase 2 brings the
      // other four in through a feed that carries no rarity flag at all, so
      // without this they would render as ordinary needs and the section that
      // exists to say "a rare bird is HERE" would point at one of five spots.
      // Scoped to rows phase 2 introduced, so phase-1 output is untouched.
      var rare = notableIds[id] || (fromSpecies[id] && notableCodes[r.speciesCode]);
      out.push({
        obsId: id,
        kind: rare ? 'Rarity' : 'Need',
        code: r.speciesCode || '',
        name: r.comName || '',
        sciName: r.sciName || '',
        loc: r.locName || '',
        locId: r.locId || '',
        lat: r.lat != null ? +r.lat : 0,
        lon: r.lng != null ? +r.lng : 0,
        dateStr: r.obsDt || '',
        count: (r.howMany == null ? null : r.howMany),
        observer: r.userDisplayName || '',
        subId: r.subId || '',
        valid: r.obsValid == null ? true : !!r.obsValid,
        location_private: !!r.locationPrivate,
        // Evidence attached to the observation, straight off the notable feed
        // — no checklist lookup, so this costs NOTHING. 'P' photo, 'A' audio,
        // 'V' video; 'None' is normalised to '' so absence reads as absence.
        //
        // This was being DROPPED here, and dropping it is what made checklist
        // rows slow: the media mark had to be recovered later with one
        // product/checklist/view per row, which the eBird token bucket serves
        // at ~0.37/s — 2.7 seconds each to re-learn a letter the feed had
        // already handed over. analyze.py has carried it since the report
        // gained evidence marks; the app simply never copied the line.
        //
        // NOTE the plain data/obs/{region}/recent feed carries NEITHER field,
        // so these are empty for non-notable records. Empty means "unknown",
        // not "no photo" — nothing may render absence as a claim.
        evidence: (r.evidence && r.evidence !== 'None') ? r.evidence : '',
        has_comments: !!r.hasComments,
        // The COUNTY the sighting was filed in, straight off the feed. Free —
        // detail=full carries subnational2 on every row — and it is what lets a
        // rarity row link to the county rare-bird alert it appeared in.
        county: r.subnational2Code || '',
        countyName: r.subnational2Name || '',
        sources: e.sources.slice()
      });
    });
    return out;
  }

  // ---- seen / unseen (mirror analyze.seen + report unseen/own) -------------
  function normName(s) { return (s || '').toString().trim().toLowerCase(); }

  // seen is a set (plain object) of eBird speciesCodes (WA life list).
  function isSeen(code, seen) { return !!(code && seen && seen[code]); }

  function isOwn(observer, ownName) {
    var o = normName(observer);
    return !!o && o === normName(ownName);
  }

  // Returns unseen records (code present and not in seen), optionally
  // excluding the user's own sightings (report: unseen = drop is_own).
  function computeUnseen(records, seen, opts) {
    opts = opts || {};
    return (records || []).filter(function (r) {
      if (!r.code || isSeen(r.code, seen)) return false;
      if (opts.excludeOwn && isOwn(r.observer, opts.ownName)) return false;
      return true;
    });
  }

  function inTargetCounties(rec, countyLabels) {
    var srcs = rec.sources || [];
    for (var i = 0; i < srcs.length; i++) if (countyLabels.indexOf(srcs[i]) >= 0) return true;
    return false;
  }

  function inExcursionPool(rec, countyLabels) {
    if (inTargetCounties(rec, countyLabels)) return true;
    var srcs = rec.sources || [];
    for (var i = 0; i < srcs.length; i++) if (/^Geo/.test(srcs[i])) return true;
    return false;
  }

  // ---- distance (mirror analyze.haversine km R=6371 → mi ×0.621371) --------
  function haversineKm(la1, lo1, la2, lo2) {
    var R = 6371.0, toR = Math.PI / 180;
    var p1 = la1 * toR, p2 = la2 * toR;
    var dp = (la2 - la1) * toR, dl = (lo2 - lo1) * toR;
    var a = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return R * 2 * Math.asin(Math.sqrt(a));
  }
  function haversineMi(la1, lo1, la2, lo2) {
    return haversineKm(la1, lo1, la2, lo2) * 0.621371;
  }

  function annotateDistance(records, home) {
    (records || []).forEach(function (r) {
      r.distMi = home ? haversineMi(home.lat, home.lng, r.lat, r.lon) : null;
    });
    return records;
  }

  // ---- date helpers --------------------------------------------------------
  // eBird obsDt is "YYYY-MM-DD HH:MM" or "YYYY-MM-DD".
  function parseObsDt(s) {
    s = (s || '').toString();
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, 0, 0);
  }
  function dayStr(s) { return (s || '').toString().slice(0, 10); }
  // Local-time YYYY-MM-DD from a timestamp. dayStr() only slices an existing
  // string; feeding it a Date yields "Tue Jul 28" and every day-keyed compare
  // silently stops matching.
  function isoDay(ms) {
    var d = new Date(ms), p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function dayMs(dateStr) {
    var d = parseObsDt(dateStr);
    if (!d) return NaN;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  // ---- proximity clustering (mirror report._approx_meters/_cluster) --------
  function approxMeters(lat1, lon1, lat2, lon2) {
    var dlat = (lat1 - lat2) * 111000.0;
    var dlon = (lon1 - lon2) * 75000.0;
    return Math.sqrt(dlat * dlat + dlon * dlon);
  }

  // Greedy single-link clustering by centroid within radiusM. Preserves input
  // order (which the caller keeps deterministic via mergeSnapshot order).
  function clusterByProximity(records, radiusM) {
    radiusM = radiusM == null ? CONST.CLUSTER_RADIUS_M : radiusM;
    var clusters = [];
    (records || []).forEach(function (r) {
      var lat = +r.lat || 0, lon = +r.lon || 0;
      var bestI = -1, bestD = radiusM;
      for (var i = 0; i < clusters.length; i++) {
        var d = approxMeters(lat, lon, clusters[i].clat, clusters[i].clon);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (bestI >= 0) {
        var c = clusters[bestI];
        c.items.push(r); c._sumLat += lat; c._sumLon += lon;
        var n = c.items.length; c.clat = c._sumLat / n; c.clon = c._sumLon / n;
      } else {
        clusters.push({ clat: lat, clon: lon, _sumLat: lat, _sumLon: lon, items: [r] });
      }
    });
    return clusters.map(function (c) { return c.items; });
  }

  var _PERSONAL_LOC_RE = /\(\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*\)|^\s*\d|\d+\.\d{4,}/;
  // Mirror report._is_personal_loc_name: an empty/missing name is treated as
  // personal (True), and the pattern is tested against the trimmed name.
  function isPersonalLocName(name) { return !name ? true : _PERSONAL_LOC_RE.test(name.trim()); }

  function pickCanonicalLoc(items) {
    var clean = items.filter(function (r) { return !isPersonalLocName(r.loc); });
    var pool = clean.length ? clean : items;
    var best = pool[0];
    for (var i = 1; i < pool.length; i++) {
      if ((pool[i].loc || '').length > (best.loc || '').length) best = pool[i];
    }
    return best;
  }

  // ---- scoring (mirror analyze.score) --------------------------------------
  // One vote per species per cluster (prefer the Rarity record). Total =
  // sum(3 if Rarity else 1). (species_weight/NV omitted — app has no watchlist.)
  function scoreCluster(records) {
    var byCode = {}, order = [];
    (records || []).forEach(function (r) {
      if (!r.code) return;
      if (!byCode[r.code]) { byCode[r.code] = r; order.push(r.code); }
      else if (r.kind === 'Rarity') byCode[r.code] = r;
    });
    var sp = order.map(function (c) { return byCode[c]; });
    var total = sp.reduce(function (a, r) { return a + (r.kind === 'Rarity' ? 3 : 1); }, 0);
    return { total: total, species: sp };
  }

  // ---- destinations / excursions (mirror report sections) ------------------
  // Returns scored clusters sorted (−score, min distMi). Each:
  //   { score, loc, lat, lon, locId, distMi(min), rareCount, species:[...], records:[...] }
  function scoreDestinationClusters(nearRecent) {
    var clusters = clusterByProximity(nearRecent, CONST.CLUSTER_RADIUS_M);
    var scored = clusters.map(function (rs) {
      var sc = scoreCluster(rs);
      var rep = pickCanonicalLoc(rs);
      var minDist = rs.reduce(function (m, r) {
        var d = (r.distMi == null ? Infinity : r.distMi); return d < m ? d : m;
      }, Infinity);
      return {
        score: sc.total,
        loc: rep.loc || '', lat: rep.lat, lon: rep.lon, locId: rep.locId || '',
        distMi: minDist,
        rareCount: sc.species.reduce(function (a, r) { return a + (r.kind === 'Rarity' ? 1 : 0); }, 0),
        species: sc.species,
        records: rs
      };
    });
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.distMi - b.distMi;
    });
    return scored;
  }

  function fresh24Count(records, snapshotDate) {
    var snap = parseObsDt(snapshotDate);
    if (!snap) return 0;
    var cutoff = snap.getTime() - CONST.FRESH_24H_MS;
    return records.reduce(function (a, r) {
      var d = parseObsDt(r.dateStr);
      return a + (d && d.getTime() >= cutoff ? 1 : 0);
    }, 0);
  }

  // Sort a cluster's species for display: Rarity first, then name.
  function sortClusterSpecies(species) {
    return species.slice().sort(function (a, b) {
      var ar = a.kind !== 'Rarity' ? 1 : 0, br = b.kind !== 'Rarity' ? 1 : 0;
      if (ar !== br) return ar - br;
      return (a.name || '') < (b.name || '') ? -1 : ((a.name || '') > (b.name || '') ? 1 : 0);
    });
  }

  function destinations(nearRecent, opts) {
    opts = opts || {};
    var threshold = opts.dailyDriveMi == null ? CONST.DAILY_DRIVE_MI : opts.dailyDriveMi;
    var top = opts.top == null ? CONST.TOP_DEST : opts.top;
    var scored = scoreDestinationClusters(nearRecent).filter(function (c) {
      return c.distMi <= threshold;
    });
    return scored.slice(0, top);
  }

  function excursions(excursionRecent, opts) {
    opts = opts || {};
    var threshold = opts.dailyDriveMi == null ? CONST.DAILY_DRIVE_MI : opts.dailyDriveMi;
    var top = opts.top == null ? CONST.TOP_EXC : opts.top;
    var decay = CONST.EXCURSION_DECAY_MI;
    // A cluster belongs in excursions if it's beyond the daily-drive radius OR
    // it hosts a special-trip location (ferry / pelagic / open water / strait) —
    // those warrant a dedicated outing regardless of distance, so a ferry
    // pelagic just off Edmonds still lands here rather than vanishing (mirror
    // report.section_excursions's far filter).
    var scored = scoreDestinationClusters(excursionRecent).filter(function (c) {
      return c.distMi > threshold ||
             c.records.some(function (r) { return isSpecialTrip(r); });
    }).map(function (c) {
      var extra = Math.max(0, c.distMi - threshold);
      c.effective = c.score / (1 + extra / decay);
      return c;
    });
    scored.sort(function (a, b) {
      if (b.effective !== a.effective) return b.effective - a.effective;
      return a.distMi - b.distMi;
    });
    return scored.slice(0, top);
  }

  // ---- chaseability gates (mirror report._is_special_trip / _is_reachable /
  //      _is_chaseable / _compute_stakeout_locids) ---------------------------
  // The report filters section inputs so ferry/pelagic/open-water sightings
  // (a bird off a moving boat can't be refound) go to Excursions not the daily
  // sections, and private/access-restricted spots are dropped unless they host
  // an active stakeout. Both regexes are ported verbatim from report.py.
  var _SPECIAL_TRIP_LOC_RE =
    /\bpelagic\b|\bferry\b(?!\s*(?:terminal|landing|dock))|\bstrait\s+of\b|--\s*open\s+water\b/i;
  var _COLD_SKIP_NAME_RE =
    /\((?:restricted|no\s+public|private|historical|closed|defunct|retired|do\s+not\s+visit|members[^)]*only|permit[^)]*only)[^)]*\)/i;

  function isSpecialTrip(rec) { return _SPECIAL_TRIP_LOC_RE.test(rec.loc || ''); }

  // reachable: public hotspot, or a private location that's an active stakeout.
  // Access-restricted names are never reachable. stakeoutLocIds = set (obj).
  function isReachable(rec, stakeoutLocIds) {
    if (_COLD_SKIP_NAME_RE.test(rec.loc || '')) return false;
    if (!rec.location_private && !rec.locationPrivate) return true;
    return !!(stakeoutLocIds && stakeoutLocIds[rec.locId]);
  }

  function isChaseable(rec, stakeoutLocIds) {
    if (isSpecialTrip(rec)) return false;
    return isReachable(rec, stakeoutLocIds);
  }

  // locIds hosting a rarity/unseen stakeout (many checklists clustered near one
  // spot) — mirror report._compute_stakeout_locids (STAKEOUT_MIN_CHECKLISTS=3,
  // STAKEOUT_CLUSTER_M=300). seen = set (obj) of speciesCodes.
  function computeStakeoutLocids(allRecs, seen) {
    var targets = (allRecs || []).filter(function (r) {
      return r.subId && (r.kind === 'Rarity' || (r.code && !isSeen(r.code, seen)));
    });
    var byCode = {}, order = [];
    targets.forEach(function (r) {
      if (!byCode[r.code]) { byCode[r.code] = []; order.push(r.code); }
      byCode[r.code].push(r);
    });
    var out = {};
    order.forEach(function (code) {
      clusterByProximity(byCode[code], CONST.STAKEOUT_CLUSTER_M).forEach(function (cluster) {
        var subs = {};
        cluster.forEach(function (r) { if (r.subId) subs[r.subId] = 1; });
        if (Object.keys(subs).length >= CONST.STAKEOUT_MIN_CHECKLISTS) {
          cluster.forEach(function (r) { if (r.locId) out[r.locId] = 1; });
        }
      });
    });
    return out;
  }

  // ---- personal checklist locations (F29) ---------------------------------
  //
  // "with rare birds, often people make checklists from custom checklist
  // locations. these tiny pins are visible on the ebird map."
  //
  // They are already IN the feeds, flagged locationPrivate — 23 of 189 King
  // County notable rows over 14 days when this was measured. isReachable drops
  // them unless they are a stakeout, which kept 5 and dropped 18, and the 18
  // include the day-one rarity at a roadside pull-out, which is when chasing
  // matters most.
  //
  // What separates a public pin from somebody's garden is PROXIMITY TO A KNOWN
  // HOTSPOT, not how many people reported it (requiring 2+ observers rescued
  // only 6 of 23). Within 500 m: Sandel Lookout 92 m, Union Bay 105 m,
  // Discovery Park 438 m — all people dropping a pin inside a major hotspot
  // rather than selecting it.
  //
  // *** CAVEAT KEPT DELIBERATELY VISIBLE FOR REVIEW ***
  // "Ravenna apartment" sits 516 m from Ravenna Park — it fails by SIXTEEN
  // METRES. Distance is therefore NOT the safety net and must not be treated
  // as one: a house 400 m from a park would be published by distance alone.
  // The residential name test below is what actually protects a private
  // address. Note also that name SIMILARITY would get that case exactly
  // backwards, since "Ravenna apartment" and "Ravenna Park" share a word —
  // which is why this compares NAMES AGAINST A DENYLIST and never against the
  // hotspot's name.
  var PERSONAL_NEAR_HOTSPOT_M = 1000;
  var _RESIDENTIAL_RE = new RegExp(
    '\\b(' +
    'apartment|apartments|apt|condo|townhouse|duplex|' +
    'house|home|residence|residential|' +
    'yard|backyard|back\\s*yard|front\\s*yard|garden|driveway|balcony|patio|deck|' +
    'feeder|feeders|birdbath|bird\\s*bath|' +
    'my\\s|our\\s|casa|villa|cabin|cottage|farmhouse' +
    ')\\b', 'i');
  // A bare street address is a home even when it says so in no other way.
  var _STREET_RE = /^\s*\d{3,6}\s+\S+.*\b(ave|avenue|st|street|rd|road|dr|drive|ln|lane|way|blvd|ct|court|pl|place|ter|terrace|cir|circle|hwy|highway)\b/i;

  function looksResidential(name) {
    var n = String(name || '');
    if (!n) return true;                 // unnamed is not something to publish
    return _RESIDENTIAL_RE.test(n) || _STREET_RE.test(n);
  }

  // locIds of PRIVATE locations that sit beside a public hotspot and are not
  // named like a home. `hotspots` = [{lat,lng}|{latitude,longitude}].
  function publicPersonalLocids(allRecs, hotspots) {
    var out = {};
    var hs = (hotspots || []).map(function (h) {
      return { lat: +(h.lat != null ? h.lat : h.latitude),
               lng: +(h.lng != null ? h.lng : h.longitude) };
    }).filter(function (h) { return isFinite(h.lat) && isFinite(h.lng); });
    if (!hs.length) return out;
    (allRecs || []).forEach(function (r) {
      if (!r.locId || out[r.locId]) return;
      if (!(r.location_private || r.locationPrivate)) return;
      if (looksResidential(r.loc || r.locName)) return;
      var la = +(r.lat != null ? r.lat : r.latitude);
      var ln = +(r.lon != null ? r.lon : (r.lng != null ? r.lng : r.longitude));
      if (!isFinite(la) || !isFinite(ln)) return;
      for (var i = 0; i < hs.length; i++) {
        if (haversineKm(la, ln, hs[i].lat, hs[i].lng) * 1000 <= PERSONAL_NEAR_HOTSPOT_M) {
          out[r.locId] = 1;
          return;
        }
      }
    });
    return out;
  }

  // ---- notable (mirror report.section_today) -------------------------------
  // Rarities from the notable feeds in the LAST 24 HOURS, deduped by checklist
  // (sub_id), newest first.
  //
  // "when it hits midnight, the list goes blank and every morning I see no
  // rare birds in the app."
  //
  // It used to be the CALENDAR DAY — `date_str.startswith(snapshotDate)` — and
  // that is exactly the reported behaviour, not a bug on top of it. At 00:01
  // the set of rows dated "today" is empty, and stays near-empty through the
  // morning because eBird's own processing lag means the night's checklists
  // arrive later. The section that exists to answer "what is around right now"
  // was blank precisely when a birder was deciding where to go.
  //
  // A rolling window has no such edge. `nowMs` is passed in rather than read
  // from the clock so the report (built once, at a known time) and the app
  // (live) can both use this one function and the golden can pin it.
  var NOTABLE_WINDOW_H = 24;
  function notableRecent(records, nowMs, hours) {
    var now = isFinite(nowMs) ? nowMs : Date.now();
    var span = (isFinite(hours) ? hours : NOTABLE_WINDOW_H) * 3600000;
    var seenSubs = {}, out = [];
    (records || []).forEach(function (r) {
      if (r.kind !== 'Rarity') return;
      var t = Date.parse(String(r.dateStr || '').replace(' ', 'T'));
      // An unreadable date is DROPPED, not kept: this list is a claim about
      // when something happened, and a row that cannot support the claim has
      // no business leading it.
      if (!isFinite(t)) return;
      var age = now - t;
      // A little slack forward for clock skew between the phone and the
      // observer's device — the same tolerance BirdLogic.isFresh allows.
      if (age > span || age < -span) return;
      var sub = r.subId;
      if (sub && seenSubs[sub]) return;
      if (sub) seenSubs[sub] = 1;
      out.push(r);
    });
    out.sort(function (a, b) {
      return a.dateStr < b.dateStr ? 1 : (a.dateStr > b.dateStr ? -1 : 0);
    });
    return out;
  }
  // Kept as the old name so a caller that really does want one calendar day
  // still has it — the report's archived days are dated documents, not live
  // views, and re-reading one should show that day.
  function notableToday(records, snapshotDate) {
    var seenSubs = {}, out = [];
    (records || []).forEach(function (r) {
      if (r.kind !== 'Rarity') return;
      if (dayStr(r.dateStr) !== snapshotDate) return;
      var sub = r.subId;
      if (sub && seenSubs[sub]) return;
      if (sub) seenSubs[sub] = 1;
      out.push(r);
    });
    out.sort(function (a, b) {
      return a.dateStr < b.dateStr ? 1 : (a.dateStr > b.dateStr ? -1 : 0);
    });
    return out;
  }

  // ---- surge detection (report.section_surge) ------------------------------
  // computeStakeoutLocids above answers "is this bird STILL there?" — three
  // checklists clustered within 300 m, at any pace, over the whole feed window.
  // It cannot answer "is this bird being TWITCHED right now?", and that is the
  // event worth interrupting someone for: ~20 observers converged on a Tufted
  // Puffin at the Edmonds waterfront in a single day and the only signal the
  // pipeline emitted was a routine rarity row, read the following morning.
  //
  // A twitch has a shape that a stakeout does not: distinct OBSERVERS, packed
  // into hours rather than days, far above what that species normally draws in
  // the region. So score each species x 300 m cluster on
  //
  //     ratio = observers in the last SURGE_WINDOW_H hours
  //             ------------------------------------------
  //             that species' mean observers/day over the trailing window
  //
  // and fire on either of two gates:
  //
  //   * CROWD  — SURGE_MIN_OBSERVERS distinct observers AND ratio >= SURGE_MIN_RATIO.
  //              Catches a bird that is locally regular but suddenly mobbed
  //              (the Edmonds puffin: ~20 vs a baseline near zero).
  //   * NOVEL  — SURGE_NOVEL_OBSERVERS observers of a species with NO prior
  //              report in the window at all. Catches a mega on its second
  //              independent report rather than its twentieth (Terek Sandpiper,
  //              Red-necked Stint, Ruff, White Wagtail), which is the whole
  //              point: by report #20 everyone already knows.
  //
  // Observers, not checklists: one birder filing three lists at a stakeout is
  // one person, and counting lists is exactly how a quiet spot fakes a crowd.
  // Deliberately NOT filtered to unseen birds — a mob on a bird you already
  // have is still real news; ranking (not detection) is where "do I need it"
  // belongs, so the caller decides.
  var SURGE = {
    WINDOW_H: 36,          // "now" — long enough to survive an overnight gap
    BASELINE_DAYS: 14,     // what "normal" means for this species here
    MIN_OBSERVERS: 4,      // crowd gate
    MIN_RATIO: 4,          // ...and it must be well above normal
    NOVEL_OBSERVERS: 2,    // novelty gate: nothing else in the window
    CLUSTER_M: 300         // same radius as a stakeout
  };

  // 'YYYY-MM-DD HH:MM' / ISO -> epoch ms. Feeds carry local time with no zone,
  // so parse the parts rather than trusting Date's zone guessing.
  function recTime(rec) {
    var s = String((rec && rec.dateStr) || '');
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
    if (!m) return NaN;
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0).getTime();
  }
  // Who filed it. Falls back to the checklist id so an anonymous row still
  // counts once instead of collapsing every anonymous report into one person.
  function observerKey(rec) {
    var who = String((rec && (rec.observer || rec.userDisplayName)) || '').trim().toLowerCase();
    return who || ('sub:' + ((rec && rec.subId) || Math.random()));
  }

  // How many days of NON-hot history the input actually carries.
  //
  // This looks like a detail and is not. Dividing the trailing observer-days by
  // the CONFIGURED baseline length assumes the feed goes back that far. It does
  // not: planFeeds asks for back=7, so a 14-day divisor understates every
  // baseline by ~2.3x and inflates every ratio by the same factor — which turns
  // MIN_RATIO 4 into an effective gate of ~1.7x and makes "a slightly busier
  // Saturday" read as a twitch. A detector that cries wolf is worse than no
  // detector, so the divisor is measured from the data, capped at the config so
  // a longer feed cannot dilute the baseline instead.
  function baselineDays(earliestT, now, cfg) {
    var spanD = isFinite(earliestT) ? (now - earliestT) / 86400000 : cfg.BASELINE_DAYS;
    return Math.max(1, Math.min(cfg.BASELINE_DAYS, spanD) - cfg.WINDOW_H / 24);
  }

  // records = merged snapshot rows (same shape computeChaseViews consumes).
  // opts.now = epoch ms (defaults to Date.now()), opts.seen = seen-code set.
  // Returns fired events, strongest first.
  function surgeEvents(records, opts) {
    opts = opts || {};
    var now = opts.now == null ? Date.now() : opts.now;
    var cfg = opts.cfg || SURGE;
    var hotFrom = now - cfg.WINDOW_H * 3600 * 1000;
    var baseFrom = now - cfg.BASELINE_DAYS * 86400 * 1000;

    var byCode = {}, order = [], earliest = Infinity;
    (records || []).forEach(function (r) {
      if (!r || !r.code) return;
      var t = recTime(r);
      if (!isFinite(t) || t < baseFrom || t > now + 86400000) return;
      if (t < earliest) earliest = t;
      if (!byCode[r.code]) { byCode[r.code] = []; order.push(r.code); }
      byCode[r.code].push({ rec: r, t: t });
    });
    var coldDays = baselineDays(earliest, now, cfg);

    var out = [];
    order.forEach(function (code) {
      var all = byCode[code];
      var hot = all.filter(function (x) { return x.t >= hotFrom; });
      if (!hot.length) return;

      // Baseline is everything OUTSIDE the hot window, as observers/day, so a
      // bird reported daily by one person does not read as a surge.
      var coldObs = {};
      all.forEach(function (x) { if (x.t < hotFrom) coldObs[observerKey(x.rec) + '|' + dayStr(x.rec.dateStr)] = 1; });
      var baseline = Object.keys(coldObs).length / coldDays;

      // Cluster the hot reports spatially: a species seen by six people at six
      // different lakes is a movement, not a stakeout you can drive to.
      clusterByProximity(hot.map(function (x) { return x.rec; }), cfg.CLUSTER_M).forEach(function (cluster) {
        var obs = {}, subs = {}, newest = null, newestT = -Infinity, oldestT = Infinity;
        cluster.forEach(function (r) {
          obs[observerKey(r)] = 1;
          if (r.subId) subs[r.subId] = 1;
          var t = recTime(r);
          if (t > newestT) { newestT = t; newest = r; }
          if (t < oldestT) oldestT = t;
        });
        var nObs = Object.keys(obs).length;
        var nSubs = Object.keys(subs).length;
        // No baseline means the ratio is UNDEFINED, not infinite. Treating it
        // as infinite made every novel bird also satisfy the crowd gate, so
        // `reason` stopped partitioning and the two repos disagreed on the
        // label for the same event. novel = nothing here for two weeks;
        // crowd = there IS a norm and this blew past it.
        var novel = baseline === 0;
        var ratio = novel ? null : (nObs / baseline);
        var crowdFires = !novel && nObs >= cfg.MIN_OBSERVERS && ratio >= cfg.MIN_RATIO;
        // The novelty gate also needs the reports to be INDEPENDENT. Two
        // birders on one shared checklist are two names on a single
        // observation, and eBird returns a row per participant — which is how
        // one couple's dawn walk up a mountain fired "novel" for every montane
        // species at once. Independence is what makes a second report
        // corroboration instead of an echo.
        var novelFires = novel && nObs >= cfg.NOVEL_OBSERVERS && nSubs >= cfg.NOVEL_OBSERVERS;
        if (!crowdFires && !novelFires) return;

        var canon = pickCanonicalLoc(cluster) || newest;
        // Observers per hour over the span the cluster actually covers, floored
        // at an hour so a 10-minute burst does not report an absurd rate.
        var spanH = Math.max(1, (newestT - oldestT) / 3600000);
        out.push({
          code: code,
          name: newest.name || code,
          locId: canon.locId || newest.locId || '',
          loc: canon.loc || newest.loc || '',
          lat: canon.lat, lon: canon.lon,
          observers: nObs,
          checklists: Object.keys(subs).length,
          baseline: baseline,
          ratio: ratio,
          novel: novel,
          reason: novel ? 'novel' : 'crowd',
          rarity: cluster.some(function (r) { return r.kind === 'Rarity'; }),
          seen: opts.seen ? isSeen(code, opts.seen) : null,
          perHour: nObs / spanH,
          latest: newest.dateStr || '',
          distMi: (newest.distMi != null && newest.distMi !== Infinity) ? newest.distMi : null,
          subId: newest.subId || ''
        });
      });
    });

    // Strongest first: a novel mega outranks a merely busy regular, then raw
    // crowd size, then how far above normal it is.
    out.sort(function (a, b) {
      if (a.novel !== b.novel) return a.novel ? -1 : 1;
      if (b.observers !== a.observers) return b.observers - a.observers;
      var ra = a.ratio == null ? Infinity : a.ratio, rb = b.ratio == null ? Infinity : b.ratio;
      if (rb !== ra) return rb - ra;
      return a.latest < b.latest ? 1 : -1;
    });
    return out;
  }

  // ---- leaderboard tick cascade (report.section_surge, second lane) --------
  // The top-100 board prints each birder's most recent addition. When several
  // of the hundred best birders in a region add the SAME species within days,
  // that species is a mega being twitched — a completely independent signal
  // from the observation feeds, and one that sees birds outside your counties.
  // Lagging by up to a day (the board caches daily) but very high precision.
  //
  // rows = [{name, rank, recent}] as rankings._top_rows returns them.
  // parse(recent) -> {species, date} | null, supplied by the caller because the
  // two repos already own that regex.
  var CASCADE_MIN_BIRDERS = 3, CASCADE_WINDOW_DAYS = 3;
  function tickCascades(rows, parse, opts) {
    opts = opts || {};
    var minB = opts.minBirders || CASCADE_MIN_BIRDERS;
    var windowDays = opts.windowDays || CASCADE_WINDOW_DAYS;
    var groups = {}, order = [];
    (rows || []).forEach(function (r) {
      var p = r && r.recent ? parse(r.recent) : null;
      if (!p || !p.species || !r.name) return;
      var g = groups[p.species];
      if (!g) { g = groups[p.species] = { species: p.species, birders: [], latest: '', earliest: '' }; order.push(p.species); }
      // One birder counts once even if the board lists them twice (your own
      // row is appended after the hundredth).
      if (g.birders.some(function (b) { return b.name === r.name; })) return;
      g.birders.push({ name: r.name, rank: r.rank, date: p.date });
      if (!g.latest || p.date > g.latest) g.latest = p.date;
      if (!g.earliest || p.date < g.earliest) g.earliest = p.date;
    });
    var out = [];
    order.forEach(function (sp) {
      var g = groups[sp];
      if (g.birders.length < minB) return;
      // All the ticks must fall inside one window, or this is just a common
      // bird that people happen to add at different times of year.
      var a = new Date(g.earliest).getTime(), b = new Date(g.latest).getTime();
      if (isFinite(a) && isFinite(b) && (b - a) > windowDays * 86400000) return;
      g.birders.sort(function (x, y) { return (x.rank || 9999) - (y.rank || 9999); });
      out.push(g);
    });
    out.sort(function (x, y) {
      if (y.birders.length !== x.birders.length) return y.birders.length - x.birders.length;
      return x.latest < y.latest ? 1 : -1;
    });
    return out;
  }

  // ---- hotspot convergence (report.section_surge, third lane) --------------
  // Species-blind: when distinct observers at one hotspot jump above that
  // hotspot's own norm, birders are converging on something before you know
  // what. Catches the event when the bird itself is not flagged notable (the
  // Tufted Puffin is locally regular; eBird may not flag it at all).
  //
  // rows = recent checklist rows [{locId, locName, userDisplayName, obsDt}]
  // (eBird product/lists shape).
  var CONVERGE_MIN_OBSERVERS = 5, CONVERGE_MIN_RATIO = 3;
  function hotspotConvergence(rows, opts) {
    opts = opts || {};
    var now = opts.now == null ? Date.now() : opts.now;
    var cfg = opts.cfg || SURGE;
    var minObs = opts.minObservers || CONVERGE_MIN_OBSERVERS;
    var minRatio = opts.minRatio || CONVERGE_MIN_RATIO;
    var hotFrom = now - cfg.WINDOW_H * 3600 * 1000;
    var baseFrom = now - cfg.BASELINE_DAYS * 86400 * 1000;
    var byLoc = {}, order = [], earliest = Infinity;
    (rows || []).forEach(function (r) {
      if (!r || !r.locId) return;
      var t = recTime({ dateStr: r.obsDt || r.dateStr });
      if (!isFinite(t) || t < baseFrom || t > now + 86400000) return;
      if (t < earliest) earliest = t;
      if (!byLoc[r.locId]) { byLoc[r.locId] = []; order.push(r.locId); }
      byLoc[r.locId].push({ row: r, t: t });
    });
    var coldDays = baselineDays(earliest, now, cfg);
    // Remembered observer-days, accumulated across sessions (mirror of
    // report.update_hotspot_history). The feed alone cannot supply a baseline:
    // capped at 200 checklists per county it reaches back 2-3 days, and the
    // 36 h hot window eats most of that, so only 32 of 229 locations had any
    // trailing data at all.
    var hist = opts.history || {};
    var loDay = isoDay(baseFrom), hiDay = isoDay(hotFrom);
    var histEarliest = Infinity;
    Object.keys(hist).forEach(function (locId) {
      Object.keys(hist[locId] || {}).forEach(function (ds) {
        if (ds < loDay || ds >= hiDay) return;
        var t = new Date(ds + 'T00:00:00').getTime();
        if (isFinite(t) && t < histEarliest) histEarliest = t;
      });
    });
    // The divisor must grow with the evidence, or a remembered baseline still
    // divided by the feed's shallow span inflates every ratio by exactly the
    // factor the memory was added to fix.
    if (histEarliest < earliest) coldDays = baselineDays(histEarliest, now, cfg);
    var out = [];
    order.forEach(function (locId) {
      var all = byLoc[locId];
      var hotObs = {}, coldObs = {}, name = '';
      all.forEach(function (x) {
        var who = observerKey({ observer: x.row.userDisplayName, subId: x.row.subId });
        if (!name) name = x.row.locName || x.row.loc || '';
        if (x.t >= hotFrom) hotObs[who] = 1;
        else coldObs[who + '|' + dayStr(x.row.obsDt || x.row.dateStr)] = 1;
      });
      var n = Object.keys(hotObs).length;
      if (n < minObs) return;

      // Named days merge exactly; settled days arrive pre-counted, so drop any
      // feed rows for the same date rather than counting that day twice.
      var settled = 0, days = hist[locId] || {};
      Object.keys(days).forEach(function (ds) {
        if (ds < loDay || ds >= hiDay) return;
        var v = days[ds];
        if (Object.prototype.toString.call(v) === '[object Array]') {
          v.forEach(function (w) {
            coldObs[String(w).trim().toLowerCase() + '|' + ds] = 1;
          });
        } else {
          var c = parseInt(v, 10);
          if (!(c > 0)) return;
          Object.keys(coldObs).forEach(function (k) {
            if (k.slice(-ds.length) === ds) delete coldObs[k];
          });
          settled += c;
        }
      });
      var baseline = (Object.keys(coldObs).length + settled) / coldDays;
      // No norm, no claim. This lane's assertion is COMPARATIVE — "busier
      // than its own normal" — so a location with no trailing history has
      // escaped measurement rather than cleared the bar. Treating a zero
      // baseline as Infinity meant `Infinity < minRatio` was false and every
      // such row passed: product/lists returns the most recent 200 checklists
      // per county (~1.3 days in King), so the 36 h window swallows the feed
      // and almost nothing has cold data. The lane fired for any hotspot with
      // 5+ observers in a day and called it "new", listing Seattle's busiest
      // parks as unprecedented under a heading that promises the opposite.
      if (baseline <= 0) return;
      var ratio = n / baseline;
      if (ratio < minRatio) return;
      out.push({
        locId: locId, loc: name, observers: n,
        baseline: baseline, ratio: ratio
      });
    });
    out.sort(function (a, b) {
      if (b.observers !== a.observers) return b.observers - a.observers;
      return b.ratio - a.ratio;
    });
    return out;
  }

  // ---- time of day (mirror time_of_day.py) ---------------------------------
  // Build {code:[hour,...]} + {code:name} from observation rows, deduped by
  // (subId, speciesCode). Rows are raw eBird objs (speciesCode, subId, obsDt,
  // comName) — same shape the report reads from snapshot feeds.
  function todBuildHours(rows) {
    var hours = {}, names = {}, seen = {};
    (rows || []).forEach(function (o) {
      var code = o.speciesCode, sub = o.subId, dt = (o.obsDt || '').toString();
      if (!code || !sub || dt.length < 13) return;
      var key = sub + '|' + code;
      if (seen[key]) return;
      var hh = parseInt(dt.slice(11, 13), 10);
      if (!(hh >= 0 && hh <= 23)) return;
      seen[key] = 1;
      (hours[code] = hours[code] || []).push(hh);
      if (names[code] == null && o.comName) names[code] = o.comName;
    });
    return { hours: hours, names: names };
  }

  function todProfile(hs) {
    var n = hs.length;
    if (!n) return { n: 0, early_pct: 0, late_pct: 0, median_hour: null, min_hour: null, max_hour: null };
    var early = 0, late = 0;
    for (var i = 0; i < n; i++) { if (hs[i] < CONST.TOD_DAWN_END) early++; if (hs[i] >= CONST.TOD_DUSK_START) late++; }
    var srt = hs.slice().sort(function (a, b) { return a - b; });
    var median = (n % 2) ? srt[(n - 1) / 2] : (srt[n / 2 - 1] + srt[n / 2]) / 2;
    return { n: n, early_pct: early / n, late_pct: late / n, median_hour: median, min_hour: srt[0], max_hour: srt[n - 1] };
  }

  function todSpecialists(hours, names, minObs) {
    minObs = minObs == null ? CONST.TOD_MIN_OBS : minObs;
    var dawn = [], night = [];
    Object.keys(hours).forEach(function (code) {
      var p = todProfile(hours[code]);
      if (p.n < minObs) return;
      var e = { code: code, name: (names[code] != null ? names[code] : code), n: p.n,
        early_pct: p.early_pct, late_pct: p.late_pct, median_hour: p.median_hour,
        min_hour: p.min_hour, max_hour: p.max_hour };
      if (p.early_pct >= CONST.TOD_DAWN_TH) dawn.push(e);
      if (p.late_pct >= CONST.TOD_NIGHT_TH) night.push(e);
    });
    dawn.sort(function (a, b) { return (b.early_pct - a.early_pct) || (b.n - a.n); });
    night.sort(function (a, b) { return (b.late_pct - a.late_pct) || (b.n - a.n); });
    return { dawn: dawn, night: night };
  }

  // ---- rolling hotspot history (mirror report.update_hotspot_history) ------
  // Pure merge: takes the previous tally and this run's rows, returns the new
  // tally. The caller owns persistence (localStorage in the app, a JSON file
  // in the report), so this stays testable and side-effect free.
  var HISTORY_KEEP_DAYS = 21, HISTORY_NAMED_DAYS = 2;

  function mergeHotspotHistory(hist, rows, now) {
    now = now == null ? Date.now() : now;
    hist = hist || {};
    var out = {};
    Object.keys(hist).forEach(function (k) {
      out[k] = {};
      Object.keys(hist[k] || {}).forEach(function (d) {
        var v = hist[k][d];
        out[k][d] = Object.prototype.toString.call(v) === '[object Array]'
          ? v.slice() : v;
      });
    });
    (rows || []).forEach(function (r) {
      var locId = r && (r.locId || (r.loc && r.loc.locId));
      if (!locId) return;
      var t = recTime({ dateStr: r.obsDt || r.dateStr || r.isoObsDate });
      if (!isFinite(t) || t > now + 86400000) return;
      var day = isoDay(t);
      var who = observerKey({ observer: r.userDisplayName, subId: r.subId });
      var slot = out[locId] || (out[locId] = {});
      var cur = slot[day];
      if (Object.prototype.toString.call(cur) === '[object Array]') {
        if (cur.indexOf(who) < 0) cur.push(who);
      } else if (cur == null) {
        slot[day] = [who];
      }
      // An already-collapsed day is settled; re-opening it would let a late
      // arrival be counted twice (once in the count, once by name).
    });
    var keepFrom = isoDay(now - HISTORY_KEEP_DAYS * 86400000);
    var collapseFrom = isoDay(now - HISTORY_NAMED_DAYS * 86400000);
    Object.keys(out).forEach(function (locId) {
      var days = out[locId];
      Object.keys(days).forEach(function (d) {
        if (d < keepFrom) { delete days[d]; return; }
        if (d < collapseFrom &&
            Object.prototype.toString.call(days[d]) === '[object Array]') {
          days[d] = days[d].length;
        }
      });
      if (!Object.keys(days).length) delete out[locId];
    });
    return out;
  }

  // ---- feed depth (mirror report._checklist_feed_span/_feed_window) --------
  // product/lists is capped at CONVOY_MAX_RESULTS *per county*, so it is not a
  // date range: it is "however far back 200 checklists happen to reach". On
  // live Washington data that is 2 days in King County against sections that
  // announce 7. A section must state the window it actually has.
  function feedSpanDays(lists) {
    var days = {}, any = false;
    (lists || []).forEach(function (chk) {
      var iso = String((chk && chk.isoObsDate) || '').slice(0, 10);
      if (iso) { days[iso] = 1; any = true; }
    });
    if (!any) return null;
    var keys = Object.keys(days).sort();
    var lo = new Date(keys[0] + 'T00:00:00');
    var hi = new Date(keys[keys.length - 1] + 'T00:00:00');
    return Math.round((hi - lo) / 86400000) + 1;
  }

  // Returns {days, warning}. A feed that covers its window gets no warning —
  // a banner that cries wolf stops being read.
  function feedWindow(lists, claimed) {
    var span = feedSpanDays(lists);
    if (span === null || span >= claimed) return { days: claimed, warning: '' };
    var p = span === 1 ? '' : 's';
    return {
      days: span,
      warning: 'Showing ' + span + ' day' + p + ', not ' + claimed +
        '. eBird caps this feed at ' + CONST.CONVOY_MAX_RESULTS +
        ' checklists per county, and in a county this busy that only reaches ' +
        'back ' + span + ' day' + p + '. Anything older is not missing — it ' +
        'was never returned.'
    };
  }

  // ---- convoys (mirror report.section_birder_convoys) ----------------------
  // One self-describing convoy heading, mirroring report._convoy_title. Two
  // groups birding the same day both rendered as "Jul 28 Convoy of 2", so the
  // second read as a duplicate of the first and looked like a lost route.
  // nSpecies === 0 means no checklist detail is loaded yet, so the species
  // clause is omitted rather than printed as a zero that reads as "birdless".
  function convoyTitle(dayLabel, nMembers, nStops, nSpecies, nUnseen) {
    var bits = [dayLabel, 'Convoy of ' + nMembers,
                nStops + ' stop' + (nStops === 1 ? '' : 's')];
    if (nSpecies) {
      bits.push(nSpecies + ' species');
      bits.push(nUnseen ? '\uD83D\uDD0D ' + nUnseen + ' unseen' : '\u2705 all seen');
    }
    return bits.join(' \u00B7 ');
  }

  // lists: recent checklists (product/lists rows) merged across counties.
  // snapDate: JS Date (snapshot day). ownName: user's display name to exclude.
  function convoyDetect(lists, snapDate, ownName) {
    lists = lists || [];
    var cutoff = new Date(snapDate.getTime());
    cutoff.setDate(cutoff.getDate() - CONST.CONVOY_LOOKBACK_DAYS);
    cutoff.setHours(0, 0, 0, 0);
    var own = normName(ownName);
    var bySub = {};
    lists.forEach(function (chk) {
      if (own && normName(chk.userDisplayName) === own) return;
      var sub = chk.subId || chk.subID;
      if (sub && !bySub[sub]) bySub[sub] = chk;
    });
    var shared = {};
    Object.keys(bySub).forEach(function (sub) {
      var chk = bySub[sub], loc = chk.locId || (chk.loc && chk.loc.locId), iso = chk.isoObsDate;
      if (!loc || !iso) return;
      var d = parseObsDt(dayStr(iso));
      if (!d || d < cutoff) return;
      var key = loc + '|' + iso;
      (shared[key] = shared[key] || []).push(chk);
    });
    var convoys = {};
    Object.keys(shared).forEach(function (key) {
      var chks = shared[key];
      if (chks.length < 2) return;
      var uniq = {};
      chks.forEach(function (c) { var m = (c.userDisplayName || '?').trim(); if (m) uniq[m] = 1; });
      var members = Object.keys(uniq).sort();
      if (members.length < 2) return;
      var iso = key.split('|')[1], day = dayStr(iso);
      var mkey = members.join(' + ') + '|' + day;
      var g = convoys[mkey] = convoys[mkey] || { members: members, day: day, stops: [] };
      // Copy the representative checklist and hang every member's subId off
      // it (mirrors report.section_birder_convoys) — the links are how a
      // reader sees who was in the group without printing their names.
      var visit = {};
      Object.keys(chks[0]).forEach(function (k) { visit[k] = chks[0][k]; });
      visit._subs = chks.map(function (c) { return c.subId || c.subID; })
        .filter(Boolean);
      g.stops.push(visit);
    });
    var routes = [];
    Object.keys(convoys).forEach(function (k) {
      var g = convoys[k];
      if (g.stops.length < CONST.CONVOY_MIN_STOPS) return;
      g.stops.sort(function (a, b) { return String(a.isoObsDate).localeCompare(String(b.isoObsDate)); });
      routes.push(g);
    });
    // Newest first, mirroring report.section_birder_convoys: date leads, then
    // stop count and group size as tiebreakers within a day.
    routes.sort(function (a, b) {
      if (a.day !== b.day) return a.day < b.day ? 1 : -1;
      if (b.stops.length !== a.stops.length) return b.stops.length - a.stops.length;
      return b.members.length - a.members.length;
    });
    return routes;
  }

  // ---- region location exclusions (mirror Region.exclude_locids / _substrings)
  // Drop unreachable spots (e.g. a boat-only offshore island inside the radius)
  // from EVERY section by removing their records from the merged snapshot.
  function applyExclusions(records, profile) {
    var ids = (profile && profile.excludeLocIds) || [];
    var subs = (profile && profile.excludeNameSubstrings) || [];
    if (!ids.length && !subs.length) return records;
    var idset = {};
    ids.forEach(function (i) { idset[i] = 1; });
    var lows = subs.map(function (s) { return String(s).toLowerCase(); });
    return (records || []).filter(function (r) {
      if (r.locId && idset[r.locId]) return false;
      var nm = (r.loc || '').toLowerCase();
      for (var i = 0; i < lows.length; i++) if (lows[i] && nm.indexOf(lows[i]) >= 0) return false;
      return true;
    });
  }

  // ---- chase pipeline (mirror report.build_report L5900-5990) --------------
  // The SINGLE orchestration shared by the iPhone app and the parity test.
  // Given a report profile and a day's six feeds (keyed by planFeeds file name),
  // reproduce Top destinations / Top excursions / today's rarities / fresh
  // targets exactly as the Markdown report does. Keeping this here (rather than
  // duplicated in the app and the test harness) guarantees the app can never
  // silently diverge from the report — the parity suite drives this same code.
  //
  // opts: { rowsToday:{file:rows[]}, seen:{code:1}, ownName, snapshotDate,
  //         home:{lat,lng}|null, dailyDriveMi }
  function computeChaseViews(profile, opts) {
    opts = opts || {};
    var seen = opts.seen || {};
    var ownName = opts.ownName || '';
    var home = opts.home !== undefined ? opts.home : (profile.home || null);
    var dailyDriveMi = opts.dailyDriveMi == null ? profile.dailyDriveMi : opts.dailyDriveMi;
    var snapshotDate = opts.snapshotDate;
    var countyLabels = (profile.counties || []).map(function (c) { return c.label; });

    // merged snapshot (analyze.load_snapshot) → exclusions → distances.
    var allRecs = applyExclusions(mergeFromFiles(profile, opts.rowsToday || {}, opts.speciesCodes), profile);
    annotateDistance(allRecs, home);

    var stakeout = computeStakeoutLocids(allRecs, seen);
    // F29: a personal pin beside a public hotspot is a public place, so it
    // joins the same set of "private but chaseable anyway" locIds rather than
    // needing its own parameter threaded through every caller. `hotspots` is
    // the list the caller already has; with none supplied this is a no-op and
    // behaviour is exactly as before.
    var publicPins = publicPersonalLocids(allRecs, opts.hotspots);
    Object.keys(publicPins).forEach(function (k) { stakeout[k] = 1; });
    var unseenAll = computeUnseen(allRecs, seen, { excludeOwn: false });
    var unseen = computeUnseen(allRecs, seen, { excludeOwn: true, ownName: ownName });
    var near = unseen.filter(function (r) { return inTargetCounties(r, countyLabels); });

    var snapMid = parseObsDt(snapshotDate);
    function recMs(r) { var d = parseObsDt(r.dateStr); return d ? d.getTime() : NaN; }
    var cutoff = snapMid
      ? new Date(snapMid.getFullYear(), snapMid.getMonth(), snapMid.getDate() - CONST.CUTOFF_DAYS).getTime()
      : -Infinity;
    var excCutoff = snapMid
      ? new Date(snapMid.getFullYear(), snapMid.getMonth(), snapMid.getDate() - CONST.TRIP_WINDOW_DAYS).getTime()
      : -Infinity;

    var nearRecent = near.filter(function (r) { return recMs(r) >= cutoff; });
    var excursionRecent = unseen.filter(function (r) {
      if (!inExcursionPool(r, countyLabels)) return false;
      var t = recMs(r);
      return t >= cutoff || (isSpecialTrip(r) && t >= excCutoff);
    });

    var nearRecentGo = nearRecent.filter(function (r) { return isChaseable(r, stakeout); });
    var excursionRecentGo = excursionRecent.filter(function (r) { return isReachable(r, stakeout); });

    var dest = destinations(nearRecentGo, { dailyDriveMi: dailyDriveMi });
    var exc = excursions(excursionRecentGo, { dailyDriveMi: dailyDriveMi });
    // The live view is a rolling 24 hours; see notableRecent.
    var notable = notableRecent(unseenAll, opts && opts.nowMs);

    return {
      merged: allRecs, stakeout: stakeout, unseenAll: unseenAll, unseen: unseen,
      near: near, destinations: dest, excursions: exc,
      notableToday: notable
    };
  }

  // Adapt a scored cluster (destinations/excursions) to the app's render shape:
  //   { locId, locName, lat, lng, species:[{code,comName,rare}], score, rare, dist }
  //
  // The species CODE has to survive this hop. Without it the shared species list
  // loses all three things a code buys: the bundled icon seed (tier 1, zero
  // network — every destination row fell through to a Wikipedia lookup), the
  // /species/{code} deep link, and code-based seen resolution, which is the only
  // one that follows the taxonomy parent chain.
  function toRenderDest(cluster) {
    return {
      locId: cluster.locId || '', locName: cluster.loc || 'Unknown location',
      lat: cluster.lat, lng: cluster.lon,
      species: (cluster.species || []).map(function (s) {
        return { code: s.code || '', comName: s.name || s.code || 'Unknown species', rare: s.kind === 'Rarity' };
      }),
      score: cluster.score, rare: cluster.rareCount,
      dist: cluster.distMi == null || cluster.distMi === Infinity ? null : cluster.distMi
    };
  }


  // Collapse repeat obs of same species at same location (keep max howMany).
  // ---- Checklist evidence: photos, recordings and the observer's note -------
  //
  // eBird returns both on product/checklist/view as obs[].mediaCounts (P photo,
  // A audio, V video) and obs[].comments. The app ALREADY fetches that endpoint
  // to hydrate the finder's name, so these ride along on a call it was making
  // anyway - the same free ride report.py takes, and the reason this costs no
  // extra eBird traffic.
  //
  // Mirrors report.py's media_icon/comment_icon exactly: the app and the report
  // must not disagree about what a row says.
  //
  // Photo, VIDEO, audio and note each get their own mark. Photo and video used
  // to share the camera, which threw away the one distinction the `evidence`
  // letters were already carrying for free — and a video of a bird moving is a
  // different kind of proof from a still. For a skulking rail or an empidonax
  // the recording IS the identification, so a camera over a sound file would be
  // quietly wrong in the other direction.
  var MEDIA_ICON = '\ud83d\udcf7';     // camera  — P, a photo
  var VIDEO_ICON = '\ud83c\udfa5';     // movie camera — V
  var AUDIO_ICON = '\ud83d\udd0a';     // speaker — A
  var COMMENT_ICON = '\ud83e\uddfe';   // receipt — a written note
  var WAYPOINT_ICON = '\ud83c\udfaf';  // target  — a note carrying COORDINATES

  // A note that carries coordinates is a different object from a note.
  //
  // "often rare bird observations will contain waypoints, so id primarily like
  // to highlight comments with waypoints because they clarify chasing. todays
  // lark sparrow had a waypoint that pointed to a helipad in union bay hotspot"
  //
  // That is the real one, and it is the case this was written against:
  //
  //   "47.65798° N, 122.29830° W thanks Alec and Louis! Continuing sparrow with
  //    reddish well defined streaks on head. Foraging on far side of helipad,
  //    viewable from parking lot side of helipad. Photos"
  //
  // Union Bay Natural Area is ~100 acres. The hotspot pin puts you in the car
  // park; the waypoint puts you at the helipad. Everything else on the card —
  // species, distance, how many people saw it — tells you whether to go. This
  // is the only thing that tells you where to stand when you arrive.
  //
  // Note the trap in that string: the longitude is written POSITIVE with a W.
  // Taking it at face value puts the bird in Kazakhstan.
  var _DMS = /(\d{1,3})\s*°\s*(\d{1,2})\s*['\u2032]\s*([\d.]+)\s*["\u2033]?\s*([NSns])[\s,]+(\d{1,3})\s*°\s*(\d{1,2})\s*['\u2032]\s*([\d.]+)\s*["\u2033]?\s*([EWew])/;
  var _DEC_HEMI = /(\d{1,3}(?:\.\d+)?)\s*°?\s*([NSns])[\s,]+(\d{1,3}(?:\.\d+)?)\s*°?\s*([EWew])/;
  // Bare signed pair. THREE decimals minimum: "1.5, 2.0" is a count, not a
  // place, and at two decimals a coordinate is only good to ~1 km anyway — far
  // too coarse to be the waypoint someone bothered to type.
  var _DEC_PAIR = /(-?\d{1,3}\.\d{3,})\s*[,\s]\s*(-?\d{1,3}\.\d{3,})/;

  function _wp(lat, lng) {
    if (!isFinite(lat) || !isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    if (lat === 0 && lng === 0) return null;      // null island is a parse bug
    return { lat: lat, lng: lng };
  }

  // How far a typed waypoint may sit from the sighting it annotates before we
  // stop believing it. A note pins a spot INSIDE a site — the far side of a
  // helipad, the second pond — so a couple of miles is generous. Past that it
  // is a parse artefact (a count, an elevation, a date read as a coordinate),
  // and sending someone to the wrong county is far worse than showing no mark.
  var WAYPOINT_MAX_MI = 5;

  // Best-effort read. `explicit` records whether the text NAMED which number is
  // which (N/S/E/W, or DMS) — because that is exactly what decides whether the
  // pair may later be swapped.
  function parseWaypointParts(text) {
    var s = String(text == null ? '' : text);
    if (!s) return null;
    var m = _DMS.exec(s);
    if (m) {
      var la = +m[1] + (+m[2]) / 60 + (+m[3]) / 3600;
      var lo = +m[5] + (+m[6]) / 60 + (+m[7]) / 3600;
      if (/[Ss]/.test(m[4])) la = -la;
      if (/[Ww]/.test(m[8])) lo = -lo;
      return { lat: la, lng: lo, explicit: true };
    }
    m = _DEC_HEMI.exec(s);
    if (m) {
      var la2 = +m[1], lo2 = +m[3];
      if (/[Ss]/.test(m[2])) la2 = -la2;
      // The hemisphere letter WINS over the sign. eBird notes are typed by hand
      // and "122.29830° W" is the common shape; honouring the letter is what
      // keeps that from landing on the wrong side of the planet.
      if (/[Ww]/.test(m[4])) lo2 = -Math.abs(lo2);
      return { lat: la2, lng: lo2, explicit: true };
    }
    m = _DEC_PAIR.exec(s);
    // Nothing here says which number is which, and nothing says the signs
    // survived being retyped. Both are repairable — but only against an oracle.
    if (m) return { lat: +m[1], lng: +m[2], explicit: false };
    return null;
  }

  function parseWaypoint(text) {
    var p = parseWaypointParts(text);
    return p ? _wp(p.lat, p.lng) : null;
  }

  // THE SIGHTING'S OWN COORDINATE IS THE ORACLE.
  //
  // "sometimes waypoints are backwards, so they may need to be flipped so they
  // dont point to china by accident"
  //
  // Two ways a hand-typed pair goes wrong, and both are common:
  //   * the MINUS is lost. "47.658, 122.298" is Union Bay with the sign eaten,
  //     and read literally it is Heilongjiang — the China case, exactly.
  //   * the pair is BACKWARDS, longitude first.
  //
  // Guessing between those is not safe in the abstract. It is completely safe
  // against a reference point: the bird was reported somewhere, so a reading is
  // only accepted if it lands beside where the bird actually was. A repair that
  // cannot be checked is not applied at all — with no oracle we return only
  // what was already unambiguous.
  //
  // Order matters: the literal reading is tried first, so a correct waypoint is
  // never "repaired" into something else.
  function waypointFrom(text, near) {
    var p = parseWaypointParts(text);
    if (!p) return null;
    var haveNear = near && isFinite(near.lat) && isFinite(near.lng);
    if (!haveNear) return _wp(p.lat, p.lng);

    var tries = [{ w: _wp(p.lat, p.lng), fix: '' }];
    // A sign can be lost whichever way the numbers were typed.
    tries.push({ w: _wp(p.lat, -p.lng), fix: 'sign' });
    if (!p.explicit) {
      // Only an UNLABELLED pair may be reordered. "122° W" said which it was.
      tries.push({ w: _wp(p.lng, p.lat), fix: 'swapped' });
      tries.push({ w: _wp(p.lng, -p.lat), fix: 'swapped + sign' });
      tries.push({ w: _wp(-p.lng, p.lat), fix: 'swapped + sign' });
    }
    for (var i = 0; i < tries.length; i++) {
      var t = tries[i];
      if (!t.w) continue;
      if (haversineMi(near.lat, near.lng, t.w.lat, t.w.lng) <= WAYPOINT_MAX_MI) {
        if (t.fix) t.w.repaired = t.fix;
        return t.w;
      }
    }
    return null;
  }

  // Is a comment worth a mark?
  //
  // eBird's species comment is free text and is very often not a note at all —
  // a bare count ("2"), a plus sign, a stray character left by a submission
  // app. Marking those trains the reader to ignore the glyph, which costs the
  // real notes their meaning. The bar is deliberately LOW, though: "in willows"
  // and "heard only" are ten characters and both tell you something you cannot
  // get anywhere else, and on a rare bird the note is frequently the only
  // record of exactly where the bird was standing.
  function hasNote(text) {
    var c = String(text == null ? '' : text).trim();
    if (c.length < 3) return false;
    return /[a-z]{3}/i.test(c);          // at least one real word
  }

  // One obs entry -> {m: 'AP', c: 'note', w: {lat,lng}}. Empty keys are omitted,
  // so a missing key means "nothing there" while a missing ENTRY means "never
  // looked" - the distinction that stops an icon's absence being read as a
  // claim.
  //
  // `near` is the observation's own coordinate when the caller has it, and is
  // what makes a parsed waypoint trustworthy rather than merely well-formed.
  function checklistDetail(ob, near) {
    var out = {};
    if (!ob) return out;
    var counts = ob.mediaCounts || {};
    var letters = Object.keys(counts).map(function (k) {
      return String(k).charAt(0).toUpperCase();
    }).sort().join('');
    if (letters) out.m = letters;
    var c = String(ob.comments || '').trim();
    if (hasNote(c)) out.c = c;
    var w = c ? waypointFrom(c, near) : null;
    if (w) out.w = w;
    return out;
  }

  // Marks for one row, in a fixed order so a column of rows stays readable.
  // Nothing outranks anything else - these are kinds of evidence, not a ladder.
  //
  // `opts.noteRequired` DROPS the plain note mark, and that is the whole point
  // rather than a tidying option:
  //
  //   "rare birds require comments in observations, so all rare bird
  //    observations are not interesting, but some have chasing details like
  //    waypoints"
  //
  // eBird demands details on a flagged species, so on a rarity every single row
  // has a comment. A mark that is always present is not a mark - it is a column
  // of identical glyphs that teaches the eye to skip the place where the real
  // signal appears. So on those lists the note badge is suppressed and the
  // WAYPOINT badge is not: one is mandatory, the other is somebody choosing to
  // tell you where to stand.
  //
  // The comment itself is never hidden - it is still read through the row, and
  // "foraging on the far side of the helipad" is worth more than most columns
  // on the card. Only the redundant BADGE goes.
  function checklistIcons(detail, opts) {
    if (!detail) return '';
    var m = String(detail.m || ''), out = '';
    if (m.indexOf('P') >= 0) out += MEDIA_ICON;
    if (m.indexOf('V') >= 0) out += VIDEO_ICON;
    if (m.indexOf('A') >= 0) out += AUDIO_ICON;
    if (detail.w) out += WAYPOINT_ICON;
    else if (detail.c && !(opts && opts.noteRequired)) out += COMMENT_ICON;
    return out;
  }

  // The version that actually reaches the reader.
  //
  // checklistIcons above only knows about checklists something else already
  // opened, which on most rows is none of them - the marks were invisible, and
  // the owner reported exactly that twice. The NOTABLE feed carries `evidence`
  // on every row (P photo, A audio, V video, 'None'), verified against 343 real
  // rows where it correlated exactly with hasRichMedia. So presence AND type
  // come free from a feed the app already fetches.
  //
  // hasComments is present in the schema but was False on every row sampled -
  // 343 in the probe and 1,436 in a day's snapshot - so the note mark still
  // falls back to checklist detail and has only partial coverage. Do not assume
  // that field works.
  // NEW means RECENT, not "you have not been shown this before".
  //
  // "if an observation is within the last 24 hours it should get the new icon
  // (everywhere), not just today's rarities."
  //
  // The old rule was per-reader state: a row was NEW until you had opened the
  // list once, which made the badge answer "have I looked at this?" rather
  // than "did this just happen?". Two problems followed. It could not be used
  // in any section that does not track what you have been shown, so the badge
  // existed on exactly one list. And it went stale in the other direction: a
  // bird found ten minutes ago stopped being NEW the moment you glanced at the
  // screen, which is the opposite of what the word means to somebody deciding
  // whether to get in the car.
  //
  // A property of the OBSERVATION works everywhere, needs no storage, and
  // cannot disagree between two sections.
  var FRESH_HOURS = 24;
  function isFresh(dateStr, nowMs, hours) {
    var t = Date.parse(String(dateStr || '').replace(' ', 'T'));
    if (!isFinite(t)) t = Date.parse(String(dateStr || ''));
    if (!isFinite(t)) return false;          // unreadable is NOT a claim of fresh
    var now = isFinite(nowMs) ? nowMs : Date.now();
    var span = (isFinite(hours) ? hours : FRESH_HOURS) * 3600000;
    // A future timestamp is a clock disagreement, not a fresher bird — eBird
    // dates are local to the observation, so a phone a few minutes behind must
    // not start calling tomorrow's rows stale.
    return (now - t) <= span && (t - now) <= span;
  }

  function recordIcons(rec) {
    if (!rec) return '';
    var ev = String(rec.evidence || '');
    if (ev === 'None') ev = '';
    var out = '';
    // Photo, video and audio each get their OWN mark, exactly as report.py's
    // record_icons does. This used to fold V into the camera, which threw away
    // the distinction the `evidence` letters carry for free and — worse — made
    // the same row change glyph when the slower checklist pass upgraded it,
    // because checklistIcons above has always split them.
    if (ev.indexOf('P') >= 0) out += MEDIA_ICON;
    if (ev.indexOf('V') >= 0) out += VIDEO_ICON;
    if (ev.indexOf('A') >= 0) out += AUDIO_ICON;
    // NO note badge on a rarity row, and the field is spelled BOTH ways: raw
    // feed rows carry `hasComments`, records built by mergeSnapshot carry
    // `has_comments` (the name analyze.py uses). Reading only one of them is
    // how a mark silently stops appearing. Mirrors report.py's record_icons,
    // rarity suppression included — eBird REQUIRES details on a flagged
    // species, so a badge there is a column of identical glyphs.
    var note = rec.has_comments != null ? rec.has_comments : rec.hasComments;
    if (note && rec.kind !== 'Rarity') out += COMMENT_ICON;
    if (out) return out;
    return checklistIcons(rec._detail);
  }

  // ---- How long a stored checklist stays believable -----------------------
  //
  // "checklists are sometimes posted and then later updated with media, but
  // then they do not change very often. so they are good candidates to cache,
  // esp if they have media attached already."
  //
  // A checklist is not a feed. It is one person's morning, filed once and then
  // almost never touched again. The cache was scoped to the DAY because of the
  // single thing that does change after filing — media, uploaded hours or days
  // later — and it paid for that caution by re-buying EVERY checklist EVERY
  // day at roughly 2.7 seconds each, which is the eBird token bucket's price
  // for one call, not a network cost we can optimise away.
  //
  // Volatility decays with age, and it collapses once the media has landed:
  //
  //   filed in the last 2 days -> 1 day.  Still settling. Species get added,
  //                                       photos are still being uploaded.
  //   already carries media    -> 30 days. THE THING THE SHORT TTL WAS WAITING
  //                                       FOR HAS ALREADY HAPPENED. Re-buying
  //                                       it cannot change the mark it
  //                                       produced, so the daily re-fetch was
  //                                       pure cost.
  //   older, still silent      -> 7 days.  Media can still appear late, but a
  //                                       week-old checklist that never had
  //                                       any rarely speaks up now.
  //
  // Deliberately NOT permanent even when settled: a checklist can be edited or
  // withdrawn, and a cache with no expiry is a cache you can never correct.
  var CKL_TTL_SETTLING_AGE_D = 2;
  var CKL_TTL_SETTLING_D = 1, CKL_TTL_WITH_MEDIA_D = 30, CKL_TTL_QUIET_D = 7;

  function dayNum(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return NaN;
    return Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000);
  }

  // TTL in days for an entry: { o: the checklist's own date, m: has media }.
  function checklistCacheTtl(entry, today) {
    var e = entry || {};
    var age = dayNum(today) - dayNum(e.o);
    // An unknown or future date is treated as brand new. Guessing "old" here
    // would hand a long TTL to the rows most likely to still be changing.
    if (!isFinite(age) || age < CKL_TTL_SETTLING_AGE_D) return CKL_TTL_SETTLING_D;
    return e.m ? CKL_TTL_WITH_MEDIA_D : CKL_TTL_QUIET_D;
  }

  function checklistCacheFresh(entry, today) {
    var e = entry || {};
    if (!e.v) return false;
    var since = dayNum(today) - dayNum(e.d);
    if (!isFinite(since) || since < 0) return false;   // clock moved backwards
    return since < checklistCacheTtl(e, today);
  }

  function dedupeObs(obs) {
    var idx = {}, out = [];
    (obs || []).forEach(function (o) {
      var sp = normName(o.sciName || o.comName);
      var loc = o.locId || o.locName || '';
      var k = sp + '|' + loc;
      if (idx[k]) { var i = idx[k] - 1; if ((o.howMany || 0) > (out[i].howMany || 0)) out[i] = o; return; }
      out.push(o); idx[k] = out.length;
    });
    return out;
  }

  // ---- anchors (home, plus whatever transient one the reader picked) --------
  // report.py builds the same [("home", lat, lon)] list in
  // section_closest_spots, the quick-outing section and cold hotspots, and
  // ranks each candidate on the distance to the NEAREST one.
  //
  // There used to be a second FIXED anchor here, the workplace. F1 step 1
  // retired it. It was measurably useful for ranking -- of 138 live WA
  // locations, 59 (43%) were closer to the office than to home -- but it was a
  // STORED GUESS about where you would be, hand-kept in sync with a geocode,
  // and it could not serve the office, a friend's house, a lunch break
  // somewhere new, or being away on a trip. The app replaced it with a
  // transient `here` / `found` anchor, which is not a guess; the Markdown
  // report simply has one pin, because a file generated hours ago cannot know
  // where you are standing.
  //
  // Anchors were, and remain, a RANKING input and never a coverage one: a
  // work-centred 50 km feed circle would have added just 2 of those 138
  // locations, because Redmond is only 7 miles from Woodinville -- double the
  // fetch for a 1.4% gain. Anchors never touch planFeeds().
  function anchorsFor(profile, opts) {
    opts = opts || {};
    profile = profile || {};
    var out = [];
    var h = opts.home !== undefined ? opts.home : profile.home;
    if (h && isFinite(h.lat) && isFinite(h.lng))
      out.push({ name: 'home', lat: +h.lat, lng: +h.lng });
    // A transient anchor (current location, or a searched place) ranks exactly
    // as the work anchor used to, but is never stored as a waypoint.
    var t = opts.here;
    if (t && isFinite(t.lat) && isFinite(t.lng))
      out.push({ name: t.name || 'here', lat: +t.lat, lng: +t.lng });
    return out;
  }

  // Nearest anchor to a point: { name, dist } in miles, or null when there is
  // no usable anchor at all. Ties keep the FIRST anchor, so home wins a draw.
  function nearestAnchor(anchors, lat, lng) {
    var best = null;
    (anchors || []).forEach(function (a) {
      var d = haversineMi(a.lat, a.lng, +lat, +lng);
      if (best === null || d < best.dist) best = { name: a.name, dist: d };
    });
    return best;
  }

  function annotateAnchorDistance(rows, anchors, latKey, lngKey) {
    latKey = latKey || 'lat'; lngKey = lngKey || 'lng';
    (rows || []).forEach(function (r) {
      var n = nearestAnchor(anchors, r[latKey], r[lngKey]);
      r.distMi = n ? n.dist : null;
      r.anchor = n ? n.name : 'home';
    });
    return rows;
  }

  // ---- F1: travel zones — what a ferry costs -------------------------------
  // Port Townsend is ~33 mi from home as the crow flies and about two and a
  // quarter hours away: a ferry, then the Hood Canal Bridge.
  //
  // THE PENALTY RANKS AND LABELS. IT MUST NEVER FILTER. F1 decision 5. Every
  // function here takes the straight-line distance as an ARGUMENT rather than
  // computing one, so there is no way to call this that replaces a distance —
  // only ways to add to a copy of it. `<= CHASE_MAX_MI` and the geo feed radius
  // keep the raw number, which is also all eBird can honour: its geo feed takes
  // `dist=` as a true radius and has never heard of a ferry.
  //
  // A real chase is the regression test: an Arctic Tern at Murden Cove on
  // Bainbridge is 17 mi straight-line — inside the 30 mi chase cap — but 52
  // effective miles, so a penalised 35 mi radius drops it. Rarities arrive
  // through the geo feed, so that would not rank the bird lower, it would hide
  // it entirely.
  //
  // `cfg` is the parsed travel-zones.json, passed in because this module stays
  // free of fetch. Port of travel.py; the parity suite cross-checks the two.
  var TRAVEL_DEFAULT_ZONE = 'mainland';

  function travelMph(cfg) {
    var m = cfg && Number(cfg.mph);
    return (m && isFinite(m)) ? m : 35;
  }

  function pointInPoly(lat, lng, poly) {
    var inside = false, n = poly.length, j = n - 1, i;
    for (i = 0; i < n; i++) {
      var yi = poly[i][0], xi = poly[i][1];
      var yj = poly[j][0], xj = poly[j][1];
      if ((yi > lat) !== (yj > lat)) {
        if (yj !== yi && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
      }
      j = i;
    }
    return inside;
  }

  function travelZoneOf(cfg, lat, lng) {
    var la = Number(lat), ln = Number(lng);
    if (!isFinite(la) || !isFinite(ln)) return TRAVEL_DEFAULT_ZONE;
    var zones = (cfg && cfg.zones) || [];
    for (var i = 0; i < zones.length; i++) {
      var p = zones[i].poly;
      if (p && p.length >= 3 && pointInPoly(la, ln, p)) {
        return String(zones[i].id || TRAVEL_DEFAULT_ZONE);
      }
    }
    return TRAVEL_DEFAULT_ZONE;
  }

  function travelZoneLabel(cfg, zoneId) {
    if (zoneId === TRAVEL_DEFAULT_ZONE) {
      return String((cfg && cfg.default_label) || TRAVEL_DEFAULT_ZONE);
    }
    var zones = (cfg && cfg.zones) || [];
    for (var i = 0; i < zones.length; i++) {
      if (zones[i].id === zoneId) return String(zones[i].label || zoneId);
    }
    return zoneId || TRAVEL_DEFAULT_ZONE;
  }

  // Symmetric: a crossing costs the same both ways, so the file lists one.
  function travelHop(cfg, fromZone, toZone) {
    if (fromZone === toZone) return null;
    var hops = (cfg && cfg.hops) || {};
    var e = hops[fromZone + '|' + toZone] || hops[toZone + '|' + fromZone];
    return (e && typeof e === 'object') ? e : null;
  }

  // Between two POINTS, never a property of the hotspot — which is the point.
  // Standing in Kingston, Point No Point is free and Marymoor costs an hour;
  // a `ferry: true` flag on the hotspot could not express that.
  // What a gate costs when it is shut for the season with no detour. Mirrors
  // travel.CLOSED_GATE_MINUTES. Large enough that every band lands on the far
  // end, without an "unreachable" sentinel every arithmetic caller must know.
  var TRAVEL_CLOSED_GATE_MINUTES = 480;

  // Is this gate shut in the given month? THE GATE NEED NOT BE WATER: Puget
  // Sound's are ferries and bridges, but the mechanism is just a fixed time
  // cost between two zones with a human-readable reason, so a mountain pass, a
  // border crossing, a toll road or a flight all fit. Seasonal closure is the
  // one thing a fixed cost cannot express, and it is not hypothetical even
  // here — SR-20 over Rainy and Washington Passes shuts roughly November to
  // May every year, and Chinook Pass with it.
  function travelGateShut(entry, month) {
    var closed = entry && entry.closed_months;
    if (!closed || !closed.length) return false;
    var m = (month == null) ? (new Date().getMonth() + 1) : Number(month);
    for (var i = 0; i < closed.length; i++) {
      if (Number(closed[i]) === m) return true;
    }
    return false;
  }

  function travelHopMinutes(cfg, lat1, lng1, lat2, lng2, month) {
    var e = travelHop(cfg, travelZoneOf(cfg, lat1, lng1), travelZoneOf(cfg, lat2, lng2));
    if (!e) return 0;
    if (travelGateShut(e, month)) {
      var c = Number(e.closed_minutes);
      return (c && isFinite(c)) ? Math.round(c) : TRAVEL_CLOSED_GATE_MINUTES;
    }
    var m = Number(e.minutes);
    return (m && isFinite(m)) ? Math.round(m) : 0;
  }

  function travelHopVia(cfg, lat1, lng1, lat2, lng2, month) {
    var e = travelHop(cfg, travelZoneOf(cfg, lat1, lng1), travelZoneOf(cfg, lat2, lng2));
    if (!e) return '';
    if (travelGateShut(e, month)) {
      return String(e.closed_via
        || ((e.via || 'the crossing') + ' — closed this season'));
    }
    return e.via ? String(e.via) : '';
  }

  // Virtual extra MILES rather than minutes, so every existing numeric
  // comparison keeps working unchanged — the codebase ranks in miles.
  function travelPenaltyMi(cfg, lat1, lng1, lat2, lng2) {
    var mins = travelHopMinutes(cfg, lat1, lng1, lat2, lng2);
    return mins ? (mins / 60) * travelMph(cfg) : 0;
  }

  // A SORT KEY, NOT A FILTER.
  function travelEffectiveMi(cfg, straightMi, lat1, lng1, lat2, lng2) {
    var base = Number(straightMi);
    if (!isFinite(base)) return 0;
    return base + travelPenaltyMi(cfg, lat1, lng1, lat2, lng2);
  }

  function travelRoundTripH(cfg, effectiveMi) {
    var e = Number(effectiveMi);
    if (!isFinite(e)) return 0;
    return (e / travelMph(cfg)) * 2;
  }

  // The SHAPE OF THE DAY. F1 decision 6: the reader's vocabulary for this is
  // never distance. An Arctic Tern 110 mi out was "a half to full day
  // excursion" and then "too far"; one 17 mi out across a ferry was worth "an
  // excursion". "52 effective miles" answers neither question.
  // The band that needs no annotation — under an hour each way is somewhere you
  // simply go. Mirrors travel._ROUTINE_BAND.
  var TRAVEL_ROUTINE_BAND = 'quick';

  function travelDayBand(cfg, effectiveMi) {
    var hours = travelRoundTripH(cfg, effectiveMi);
    var bands = (cfg && cfg.bands) || [];
    for (var i = 0; i < bands.length; i++) {
      var cap = bands[i].max_round_trip_h;
      if (cap === null || cap === undefined || hours < Number(cap)) {
        return { id: String(bands[i].id || ''), label: String(bands[i].label || '') };
      }
    }
    if (bands.length) {
      var last = bands[bands.length - 1];
      return { id: String(last.id || ''), label: String(last.label || '') };
    }
    return { id: '', label: '' };
  }

  // Integer arithmetic rather than toFixed: Python rounds half to EVEN and JS
  // does not, so a formatted float is a silent parity failure waiting for the
  // first x.5 value. floor(h * 2 + 0.5) means the same in both languages.
  function travelHalfHours(hours) {
    var h = Number(hours);
    if (!isFinite(h) || h < 0) h = 0;
    var halves = Math.floor(h * 2 + 0.5);
    var whole = Math.floor(halves / 2);
    return (halves % 2) ? (whole + '½') : String(whole);
  }

  function travelNote(cfg, straightMi, lat1, lng1, lat2, lng2) {
    // THE GATE IS TIME, NOT WATER — mirrors travel.travel_note. Gating on a
    // ferry produced two wrong answers at once: Ocean Shores is 110 miles and
    // over three hours each way with no water anywhere and said NOTHING,
    // reading exactly like somewhere you might pop out to; while Port Townsend
    // and Murden Cove both read the same when one is a real outing and the
    // other is over two hours away and would never be attempted.
    //
    // Silence inside the routine band is equally deliberate: Edmonds Marina is
    // a weekend-morning destination visited many times a year, and annotating
    // it is the noise that stops the notes that matter from being read.
    var eff = travelEffectiveMi(cfg, straightMi, lat1, lng1, lat2, lng2);
    var band = travelDayBand(cfg, eff);
    // No bands at all means no config, and a missing config must degrade to no
    // annotation rather than to a bare round-trip figure computed from
    // defaults. Same reason the zone lookup degrades to "no penalty".
    if (!band.id || band.id === TRAVEL_ROUTINE_BAND) return '';
    // NO HOUR FIGURE, on purpose. This used to lead with an "≈3 h round trip"
    // estimate, and travel time varies "significantly due to rush hour and peak
    // season" — so that is a point estimate of a quantity the model cannot
    // stand behind, competing with the mileage already shown everywhere, which
    // does not vary and can be checked on a map. The band survives the variance
    // where a figure does not, which is why the owner's own vocabulary is
    // banded rather than numeric. Time decides the band; only the band is shown.
    var parts = band.label ? [band.label] : [];
    var via = travelHopVia(cfg, lat1, lng1, lat2, lng2);
    if (via) parts.push(via);
    return parts.join(' · ');
  }

  // ---- F11/F12: species-first ranking --------------------------------------
  // Every other section starts from a PLACE or a rarity flag, so a bird that is
  // hard to find but not rare is invisible: a Western Kingbird never trips the
  // notable flag, yet there is one hotspot where it is an order of magnitude
  // more likely than the surrounding region.
  //
  // The multiplier below is OUR metric and the UI must never present it as
  // eBird's. eBird divides CHECKLIST FREQUENCIES (what share of checklists at a
  // spot report the bird); we divide RECORD SHARES, because record shares are
  // what a keyless public dataset actually exposes. A heavily-birded park
  // dilutes its own denominator, so our numbers run about an order of magnitude
  // below eBird's. The RANKING - which is the thing you chase on - is what
  // reproduces: measured on Western Kingbird / Washington, McNary NWR scores
  // 10.4x, Bennington Lake 6.3x, Marymoor Park 0.6x.
  var ICONIC_BOX_KM = 2;

  function gbifBoxWkt(lat, lng, km) {
    km = km || ICONIC_BOX_KM;
    var dLat = km / 111;
    var dLng = km / (111 * Math.cos(lat * Math.PI / 180));
    var pts = [
      [lng - dLng, lat - dLat], [lng + dLng, lat - dLat], [lng + dLng, lat + dLat],
      [lng - dLng, lat + dLat], [lng - dLng, lat - dLat]
    ];
    return 'POLYGON((' + pts.map(function (p) {
      return p[0].toFixed(4) + ' ' + p[1].toFixed(4);
    }).join(',') + '))';
  }

  function iconicMultiplier(spBox, allBox, spRegion, allRegion) {
    if (!allBox || !allRegion || !spRegion) return null;
    // A box with a handful of records can produce a spectacular ratio off one
    // sighting, which is exactly the kind of number that sends someone on a
    // two-hour drive for nothing.
    if (allBox < 200) return null;
    var regionRate = spRegion / allRegion;
    if (!regionRate) return null;
    return (spBox / allBox) / regionRate;
  }

  function iconicLabel(mult) {
    if (mult === null || mult === undefined) return '';
    if (mult >= 10) return Math.round(mult) + '\u00d7 the regional average';
    if (mult >= 1.5) return mult.toFixed(1) + '\u00d7 the regional average';
    if (mult >= 0.75) return 'about average for the region';
    return 'below the regional average';
  }

  // Pooled across every year GBIF holds rather than year-by-year: pooling is
  // both more robust and 2 calls instead of 14, which matters on a phone.
  // Measured per-year on Western Kingbird / Washington the pooled answer lands
  // inside the seven-year spread (2018-2024 arrivals: Apr 17-23).
  function arrivalDay(dayCounts, pct, order) {
    pct = pct === undefined ? 0.05 : pct;
    // `order` exists because a season can cross the year boundary. Sorting the
    // keys is right for a spring arrival (03-xx before 04-xx) and wrong for a
    // winter one: a season running December into January sorts January first,
    // so the answer comes back as the middle of the season rather than its
    // start. When the caller knows the chronological order, it passes it.
    var keys = (order && order.length ? order.slice() : Object.keys(dayCounts || {}).sort())
      .filter(function (k) { return dayCounts && dayCounts[k] !== undefined; });
    if (!keys.length) return null;
    var peak = 0;
    keys.forEach(function (k) { if (dayCounts[k] > peak) peak = dayCounts[k]; });
    if (!peak) return null;
    var need = pct * peak;
    for (var i = 0; i < keys.length; i++) if (dayCounts[keys[i]] >= need) return keys[i];
    return null;
  }

  function daysUntil(mmdd, today) {
    if (!mmdd) return null;
    var t = today ? new Date(today) : new Date();
    var y = t.getFullYear();
    var parts = String(mmdd).split('-');
    var now = new Date(y, t.getMonth(), t.getDate());
    var day = 86400000;
    var d = Math.round((new Date(y, +parts[0] - 1, +parts[1]) - now) / day);
    // Already well past this year: the useful answer is next year's return.
    if (d < -30) d = Math.round((new Date(y + 1, +parts[0] - 1, +parts[1]) - now) / day);
    return d;
  }

  // How many months a species is ACTUALLY present in, ignoring the months that
  // hold a rounding error's worth of records. See the long note at the call
  // site in index.html and ARRIVAL_MONTH_SHARE in birding/gbif.py: counting
  // months with ANY record filed 106 of 295 Washington migrants as residents.
  function meaningfulMonths(months, share) {
    var total = 0, i;
    for (i = 0; i < (months || []).length; i++) total += months[i].n || 0;
    if (!total) return 0;
    var n = 0;
    for (i = 0; i < months.length; i++) {
      if ((months[i].n || 0) / total >= share) n++;
    }
    return n;
  }

  // US state/territory codes -> the name GBIF indexes them under.
  //
  // GBIF's `stateProvince` is a NAME, not a code, and every arrival query in
  // this app is scoped by it. For the built-in regions that was invisible
  // because their `label` already IS the state name ("Washington", "Missouri")
  // — so the code read `getReport().label` and worked by coincidence.
  //
  // It stops being a coincidence the moment a region is added by hand. A trip
  // called "Tucson in April" would be sent to GBIF as
  // stateProvince=Tucson%20in%20April, match nothing, and return null for every
  // species — which is indistinguishable from "this state has no migrants".
  // Silence is the wrong failure for a question whose honest answer is
  // sometimes "nothing is due back".
  var US_STATES = {
    'US-AL': 'Alabama', 'US-AK': 'Alaska', 'US-AZ': 'Arizona', 'US-AR': 'Arkansas',
    'US-CA': 'California', 'US-CO': 'Colorado', 'US-CT': 'Connecticut',
    'US-DE': 'Delaware', 'US-DC': 'District of Columbia', 'US-FL': 'Florida',
    'US-GA': 'Georgia', 'US-HI': 'Hawaii', 'US-ID': 'Idaho', 'US-IL': 'Illinois',
    'US-IN': 'Indiana', 'US-IA': 'Iowa', 'US-KS': 'Kansas', 'US-KY': 'Kentucky',
    'US-LA': 'Louisiana', 'US-ME': 'Maine', 'US-MD': 'Maryland',
    'US-MA': 'Massachusetts', 'US-MI': 'Michigan', 'US-MN': 'Minnesota',
    'US-MS': 'Mississippi', 'US-MO': 'Missouri', 'US-MT': 'Montana',
    'US-NE': 'Nebraska', 'US-NV': 'Nevada', 'US-NH': 'New Hampshire',
    'US-NJ': 'New Jersey', 'US-NM': 'New Mexico', 'US-NY': 'New York',
    'US-NC': 'North Carolina', 'US-ND': 'North Dakota', 'US-OH': 'Ohio',
    'US-OK': 'Oklahoma', 'US-OR': 'Oregon', 'US-PA': 'Pennsylvania',
    'US-RI': 'Rhode Island', 'US-SC': 'South Carolina', 'US-SD': 'South Dakota',
    'US-TN': 'Tennessee', 'US-TX': 'Texas', 'US-UT': 'Utah', 'US-VT': 'Vermont',
    'US-VA': 'Virginia', 'US-WA': 'Washington', 'US-WV': 'West Virginia',
    'US-WI': 'Wisconsin', 'US-WY': 'Wyoming', 'US-PR': 'Puerto Rico'
  };

  // The name to send GBIF for this report, or '' when there isn't one.
  //
  // The state code is the authority, because it is DERIVED (deriveRegionCode
  // resolves it from the coordinates) while the label is typed. Falling back to
  // the label keeps every existing region working unchanged, and returning ''
  // rather than a guess matters for the continent-wide trackers: "Lower 48" is
  // not a stateProvince, and a query scoped to it would quietly return nothing
  // instead of saying the question does not apply.
  function stateNameFor(profile) {
    if (!profile) return '';
    var byCode = US_STATES[String(profile.stateCode || '').toUpperCase()];
    if (byCode) return byCode;
    var label = String(profile.label || '');
    for (var k in US_STATES) {
      if (US_STATES[k] === label) return label;
    }
    return '';
  }

  // ---- "is this a good one?" — a score, said in words ----------------------
  //
  // "the score is a random number, it doesnt really communicate anything
  //  meaningful. Instead of 3.0 id like some value that indicates whether this
  //  is average or high yield."
  //
  // Right, and the number was never comparable to anything. `score 4` is one
  // rarity plus one target, or four targets, and 4 is only good or bad relative
  // to what else is on the list today — a quiet Tuesday in January and a fallout
  // morning in May produce completely different numbers for the same place.
  //
  // So the answer is not a better formula, it is a REFERENCE POINT. Every place
  // is graded against the median of the list it appears in, which is exactly
  // the comparison a reader makes by eye and the one F31 was blocked on.
  //
  // Median, not mean: these distributions have a long tail (one fallout site
  // can be five times the next), and a mean dragged upwards by a single outlier
  // would report every other place as "below average" on a good morning.
  //
  // Bands rather than a percentage, because "top 23%" invites arithmetic that
  // the underlying number cannot support — it is a weighted count of birds, not
  // a measurement.
  var YIELD_MIN_SAMPLE = 4;      // fewer than this and a "grade" is noise
  function yieldBand(value, values) {
    // Number(null) is 0 and Number('') is 0, both of which are finite — so a
    // MISSING score would grade as "below average" rather than as no grade at
    // all. Python's float(None) raises and returns '', and the parity test
    // caught the two disagreeing. A place with no score is not a bad place.
    if (value === null || value === undefined || value === '') return '';
    var v = Number(value);
    if (!isFinite(v)) return '';
    var nums = (values || []).map(Number).filter(function (x) { return isFinite(x); });
    // A grade against two other places says more about the sample than the
    // place. Below this, say nothing rather than something unfounded.
    if (nums.length < YIELD_MIN_SAMPLE) return '';
    nums.sort(function (a, b) { return a - b; });
    var mid = Math.floor(nums.length / 2);
    var med = nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
    if (!(med > 0)) return '';   // everything is zero: there is nothing to grade
    var ratio = v / med;
    if (ratio >= 2) return 'high yield';
    if (ratio >= 1.25) return 'above average';
    if (ratio >= 0.75) return 'average';
    return 'below average';
  }

  // ---- F32: a bird you NEED just turned up near you -----------------------
  //
  // "alerts on unseen birds in chase area... for example the spotted sandpiper
  //  showed up at redmond retention ponds and i missed it because it was not
  //  the top destination... maybe a grouped by species list."
  //
  // The bird was never missing. It was in All unseen, which fetches every
  // unseen report in the chase area, so the data was already on the phone.
  // What failed was SALIENCE: nothing said "this one is new, and it is close".
  //
  // Every other Happening-now lane answers "what are other birders doing" —
  // crowd, cascade, convergence. A Spotted Sandpiper at a retention pond is
  // invisible to all three BY DESIGN: it draws no crowd (it is not rare), it
  // cascades through nobody's leaderboard, and the pond will never out-rank
  // Marymoor. This is the fourth question, and it is the project's mission #1
  // where the other three are the crowd's business.
  //
  // GROUPED BY SPECIES, and that is not cosmetic: one bird at three ponds is
  // ONE decision, not three rows. Place-first is what Top destinations is for,
  // and place-first is exactly what buried this bird.
  //
  // Costs nothing: these are the records the chase wave already merged, and
  // both filters already exist — isFresh (24 h, v1.1.0) and the report's own
  // chaseMaxMi (v1.2.1).
  function needNearby(records, opts) {
    opts = opts || {};
    var now = opts.now == null ? Date.now() : opts.now;
    var seen = opts.seen || {};
    var maxMi = opts.maxMi == null ? Infinity : Number(opts.maxMi);
    var hours = opts.hours == null ? FRESH_HOURS : opts.hours;
    var from = now - hours * 3600 * 1000;

    var byCode = {}, order = [];
    (records || []).forEach(function (r) {
      if (!r || !r.code) return;
      if (isSeen(r.code, seen)) return;              // not a target for you
      var t = recTime(r);
      // A record with an unreadable date cannot be shown to be fresh, and this
      // lane's whole claim is freshness — so it is dropped rather than assumed.
      if (!isFinite(t) || t < from || t > now + 86400000) return;
      var d = r.distMi == null ? null : Number(r.distMi);
      if (d != null && isFinite(d) && d > maxMi) return;
      if (!byCode[r.code]) {
        byCode[r.code] = { code: r.code, name: r.name || r.code, reports: 0,
                           places: {}, nPlaces: 0, distMi: null, latest: 0,
                           locId: '', locName: '', subId: '', lat: null, lon: null,
                           rare: false };
        order.push(r.code);
      }
      var g = byCode[r.code];
      g.reports += 1;
      if (r.kind === 'Rarity') g.rare = true;
      var pid = r.locId || r.loc;
      if (pid && !g.places[pid]) { g.places[pid] = 1; g.nPlaces += 1; }
      // The row carries the NEAREST place, because the row is a decision about
      // driving. The newest report answers "is it still there", which the
      // freshness filter has already answered for every row here.
      if (d != null && isFinite(d) && (g.distMi == null || d < g.distMi)) {
        g.distMi = d;
        // `loc` and `lon` are the merged record's own field names (see the
        // projection in mergeSnapshot); reading locName/lng here would
        // silently produce a row with no place on it.
        g.locId = r.locId || ''; g.locName = r.loc || r.locName || '';
        g.subId = r.subId || '';
        g.lat = r.lat == null ? null : r.lat;
        g.lon = (r.lon == null ? r.lng : r.lon);
      }
      if (t > g.latest) g.latest = t;
    });

    var out = order.map(function (c) { return byCode[c]; });
    // Closest first. Everything here is already fresh, so recency cannot
    // separate the rows; how far you have to drive can.
    out.sort(function (a, b) {
      var ad = a.distMi == null ? Infinity : a.distMi;
      var bd = b.distMi == null ? Infinity : b.distMi;
      if (ad !== bd) return ad - bd;
      return b.latest - a.latest;
    });
    return out;
  }

  // ---- F30 tier 3: a temporary anchor somewhere the report never fetched ---
  //
  // "summarize cost of a fresh fetch of feeds for yakima or another county that
  //  would support showing hotspots outside of chase distance. id like to
  //  support this kind of lookup. it would be like temporary change of home
  //  location"
  //
  // rerankFromAnchor could always re-rank; it could never DISCOVER. The
  // candidates came from this report's counties plus a 50 km circle around
  // home, so "Find Yakima" re-sorted a list that contained nothing near
  // Yakima. coverageNote (v1.0.98) made that honest; this makes it unnecessary.
  //
  // MEASURED 2026-08-13 against the live API, anchored on Yakima city:
  //   geo recent 50 km   111 species
  //   geo notable 50 km    0
  //   ref/hotspot/geo    246 hotspots — in ONE call
  //   still unseen        33 species
  //
  // Three calls, whatever the distance. The hotspot list — the thing actually
  // asked for — is the CHEAPEST part, which is the opposite of how it feels.
  //
  // Scoped by GEO rather than by county on purpose: a temporary home should
  // cover what a home covers, which is a radius. Adding county feeds would
  // mean resolving a region code first (a fourth call) to buy a wider net than
  // the question asked for.
  function scoutGroups(rows, opts) {
    opts = opts || {};
    var seen = opts.seen || {};
    var at = opts.at || null;
    var dist = opts.distFn;
    var byCode = {}, order = [];
    (rows || []).forEach(function (r) {
      var code = r && (r.speciesCode || r.code);
      if (!code) return;
      var name = r.comName || r.name || code;
      var lat = r.lat == null ? null : +r.lat;
      var lng = (r.lng == null ? r.lon : r.lng);
      lng = lng == null ? null : +lng;
      var d = (at && dist && lat != null && lng != null)
        ? dist(at.lat, at.lng, lat, lng) : null;
      if (!byCode[code]) {
        byCode[code] = {
          code: code, name: name, need: !isSeen(code, seen),
          rare: false, reports: 0, nPlaces: 0, places: {},
          distMi: null, locId: '', locName: '', subId: '', lat: null, lng: null,
          latest: ''
        };
        order.push(code);
      }
      var g = byCode[code];
      g.reports += 1;
      if (r.__notable) g.rare = true;
      var pid = r.locId || r.locName;
      if (pid && !g.places[pid]) { g.places[pid] = 1; g.nPlaces += 1; }
      // Nearest place wins the row, because the row is a decision about
      // driving — the same rule the needs lane uses.
      if (d != null && isFinite(d) && (g.distMi == null || d < g.distMi)) {
        g.distMi = d; g.locId = r.locId || ''; g.locName = r.locName || '';
        g.subId = r.subId || ''; g.lat = lat; g.lng = lng;
      }
      var when = r.obsDt || r.isoObsDate || '';
      if (when > g.latest) g.latest = when;
    });
    var all = order.map(function (c) { return byCode[c]; });
    // Birds you NEED lead, and within that the closest first. A scouting trip
    // is planned around what you cannot get at home.
    all.sort(function (a, b) {
      if (a.need !== b.need) return a.need ? -1 : 1;
      var ad = a.distMi == null ? Infinity : a.distMi;
      var bd = b.distMi == null ? Infinity : b.distMi;
      if (ad !== bd) return ad - bd;
      return a.name.localeCompare(b.name);
    });
    return all;
  }

  // "04-20" -> "20 Apr". The stored form sorts and compares correctly, which
  // is why it is stored that way; it just does not read like a date to a
  // person scanning a list of them.
  var _MMDD_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function prettyMMDD(mmdd) {
    if (!mmdd) return '';
    var p = String(mmdd).split('-');
    var m = +p[0], d = +p[1];
    if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return String(mmdd);
    return d + ' ' + _MMDD_MON[m - 1];
  }

  // "Where has this bird been" - the F12 ask. One row per PLACE, not per
  // observation, because a hotspot reported five times is still one place to
  // drive to. Sorted by date then distance, in the user's words.
  function speciesPlaces(rows, home) {
    var byLoc = {}, order = [];
    (rows || []).forEach(function (r) {
      var id = r.locId || r.locName;
      if (!id) return;
      if (!byLoc[id]) {
        byLoc[id] = {
          locId: r.locId, loc: r.locName, lat: r.lat, lon: r.lng,
          last: r.obsDt || '', n: 0, count: 0, obs: []
        };
        order.push(id);
      }
      var p = byLoc[id];
      p.n += 1;
      var howMany = typeof r.howMany === 'number' ? r.howMany : 0;
      if (howMany > p.count) p.count = howMany;
      if ((r.obsDt || '') > p.last) p.last = r.obsDt || '';
      p.obs.push(r);
    });
    var out = order.map(function (id) { return byLoc[id]; });
    if (home && home.lat != null && home.lng != null) {
      out.forEach(function (p) {
        p.distMi = (p.lat == null || p.lon == null) ? null
          : haversineMi(home.lat, home.lng, p.lat, p.lon);
      });
    }
    return sortSpeciesPlaces(out);
  }

  function sortSpeciesPlaces(places) {
    return (places || []).slice().sort(function (a, b) {
      // Date first: a bird seen yesterday two hours away beats one seen three
      // weeks ago down the road, because the old one is probably gone.
      var da = (a.last || ''), db = (b.last || '');
      if (da !== db) return da < db ? 1 : -1;
      var xa = a.distMi == null ? Infinity : a.distMi;
      var xb = b.distMi == null ? Infinity : b.distMi;
      if (xa !== xb) return xa - xb;
      return String(a.loc || '').localeCompare(String(b.loc || ''));
    });
  }

  return {
    CONST: CONST,
    PROFILES: PROFILES,
    REPORTS: REPORTS,
    REGION_ORDER: REGION_ORDER,
    reports: reports,
    profileFor: profileFor,
    seenSlugFor: seenSlugFor,
    applyExclusions: applyExclusions,
    computeChaseViews: computeChaseViews,
    toRenderDest: toRenderDest,
    planFeeds: planFeeds,
    planSpeciesFeeds: planSpeciesFeeds,
    speciesTargetCodes: speciesTargetCodes,
    speciesFeedRegion: speciesFeedRegion,
    SPECIES_FEED_MAX: SPECIES_FEED_MAX,
    gbifBoxWkt: gbifBoxWkt,
    iconicMultiplier: iconicMultiplier,
    iconicLabel: iconicLabel,
    arrivalDay: arrivalDay,
    daysUntil: daysUntil,
    prettyMMDD: prettyMMDD,
    scoutGroups: scoutGroups,
    needNearby: needNearby,
    yieldBand: yieldBand,
    YIELD_MIN_SAMPLE: YIELD_MIN_SAMPLE,
    stateNameFor: stateNameFor,
    US_STATES: US_STATES,
    meaningfulMonths: meaningfulMonths,
    ARRIVAL_MONTH_SHARE: 0.01,
    speciesPlaces: speciesPlaces,
    sortSpeciesPlaces: sortSpeciesPlaces,
    ICONIC_BOX_KM: ICONIC_BOX_KM,
    mergePlan: mergePlan,
    mergeFromFiles: mergeFromFiles,
    planConvoyFeeds: planConvoyFeeds,
    requestUrl: requestUrl,
    round4: round4,
    mergeSnapshot: mergeSnapshot,
    obsKey: obsKey,
    isSeen: isSeen,
    isOwn: isOwn,
    computeUnseen: computeUnseen,
    inTargetCounties: inTargetCounties,
    inExcursionPool: inExcursionPool,
    haversineKm: haversineKm,
    haversineMi: haversineMi,
    annotateDistance: annotateDistance,
    parseObsDt: parseObsDt,
    dayStr: dayStr,
    dayMs: dayMs,
    approxMeters: approxMeters,
    clusterByProximity: clusterByProximity,
    isPersonalLocName: isPersonalLocName,
    pickCanonicalLoc: pickCanonicalLoc,
    scoreCluster: scoreCluster,
    isSpecialTrip: isSpecialTrip,
    isReachable: isReachable,
    isChaseable: isChaseable,
    computeStakeoutLocids: computeStakeoutLocids,
    publicPersonalLocids: publicPersonalLocids,
    looksResidential: looksResidential,
    PERSONAL_NEAR_HOTSPOT_M: PERSONAL_NEAR_HOTSPOT_M,
    scoreDestinationClusters: scoreDestinationClusters,
    fresh24Count: fresh24Count,
    sortClusterSpecies: sortClusterSpecies,
    destinations: destinations,
    excursions: excursions,
    notableToday: notableToday,
    notableRecent: notableRecent, NOTABLE_WINDOW_H: NOTABLE_WINDOW_H,
    SURGE: SURGE,
    surgeEvents: surgeEvents,
    tickCascades: tickCascades,
    hotspotConvergence: hotspotConvergence,
    recTime: recTime,
    observerKey: observerKey,
    baselineDays: baselineDays,
    todBuildHours: todBuildHours,
    todProfile: todProfile,
    todSpecialists: todSpecialists,
    convoyDetect: convoyDetect,
    convoyTitle: convoyTitle,
    mergeHotspotHistory: mergeHotspotHistory,
    feedSpanDays: feedSpanDays,
    feedWindow: feedWindow,
    anchorsFor: anchorsFor,
    nearestAnchor: nearestAnchor,
    annotateAnchorDistance: annotateAnchorDistance,
    travelZoneOf: travelZoneOf,
    travelZoneLabel: travelZoneLabel,
    travelHopMinutes: travelHopMinutes,
    travelHopVia: travelHopVia,
    travelPenaltyMi: travelPenaltyMi,
    travelEffectiveMi: travelEffectiveMi,
    travelRoundTripH: travelRoundTripH,
    travelDayBand: travelDayBand,
    travelHalfHours: travelHalfHours,
    travelNote: travelNote,
    MEDIA_ICON: MEDIA_ICON,
    VIDEO_ICON: VIDEO_ICON,
    AUDIO_ICON: AUDIO_ICON,
    COMMENT_ICON: COMMENT_ICON,
    WAYPOINT_ICON: WAYPOINT_ICON,
    parseWaypoint: parseWaypoint,
    waypointFrom: waypointFrom,
    hasNote: hasNote,
    WAYPOINT_MAX_MI: WAYPOINT_MAX_MI,
    checklistDetail: checklistDetail,
    checklistIcons: checklistIcons,
    recordIcons: recordIcons,
    isFresh: isFresh, FRESH_HOURS: FRESH_HOURS,
    checklistCacheTtl: checklistCacheTtl,
    checklistCacheFresh: checklistCacheFresh,
    CKL_TTL_WITH_MEDIA_D: CKL_TTL_WITH_MEDIA_D,
    CKL_TTL_QUIET_D: CKL_TTL_QUIET_D,
    dedupeObs: dedupeObs
  };
}));
