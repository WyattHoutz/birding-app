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
      home: { lat: 47.7616, lng: -122.1447 }, homeLabel: 'Woodinville, WA',
      geoDistKm: 50, dailyDriveMi: 12, tideStation: '9447130',
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
      home: { lat: 39.2152, lng: -94.7468 }, homeLabel: 'Parkville, MO',
      geoDistKm: 50, dailyDriveMi: 20, tideStation: '',
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
      home: { lat: 39.2152, lng: -94.7468 }, homeLabel: 'Parkville, MO',
      geoDistKm: 50, dailyDriveMi: 20, tideStation: '',
      geoFeed: true, isRarityTracker: false, birdlistSlug: 'ks', seenFromRegion: 'lower48',
      tzStdOffset: -6, tzObservesDst: true
    },
    az: {
      slug: 'az', label: 'Arizona', kind: 'region', stateCode: 'US-AZ',
      counties: [
        { slug: 'maricopa', code: 'US-AZ-013', label: 'Maricopa' },
        { slug: 'yavapai', code: 'US-AZ-025', label: 'Yavapai' }
      ],
      home: { lat: 33.8539, lng: -112.1133 }, homeLabel: 'Anthem, AZ',
      geoDistKm: 50, dailyDriveMi: 20, tideStation: '',
      geoFeed: true, isRarityTracker: false, birdlistSlug: 'az', seenFromRegion: 'lower48',
      tzStdOffset: -7, tzObservesDst: false
    },
    ca: {
      slug: 'ca', label: 'California', kind: 'region', stateCode: 'US-CA',
      counties: [
        { slug: 'placer', code: 'US-CA-061', label: 'Placer' },
        { slug: 'sacramento', code: 'US-CA-067', label: 'Sacramento' }
      ],
      home: { lat: 38.7622, lng: -121.1850 }, homeLabel: 'Granite Bay, CA',
      geoDistKm: 50, dailyDriveMi: 20, tideStation: '',
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
      geoDistKm: 50, dailyDriveMi: 20, tideStation: '',
      geoFeed: false, isRarityTracker: true, birdlistSlug: 'lower48', seenFromRegion: '',
      // eBird subnational1 codes dropped from the rarity feed (non-CONUS).
      excludeSubnational1: ['US-AK', 'US-HI', 'US-PR', 'US-VI', 'US-GU', 'US-MP', 'US-AS', 'US-UM'],
      tzStdOffset: -8, tzObservesDst: true
    },
    aba: {
      slug: 'aba', label: 'ABA Area', kind: 'region', stateCode: 'aba',
      counties: [], home: { lat: 39.8283, lng: -98.5795 }, homeLabel: 'ABA Area',
      homeIsPlaceholder: true,
      geoDistKm: 50, dailyDriveMi: 20, tideStation: '',
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
      geoDistKm: 40, dailyDriveMi: 15, tideStation: '9444900',
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
      geoDistKm: 50, dailyDriveMi: 25, tideStation: '1617433',
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

  // ---- notable (mirror report.section_today) -------------------------------
  // TODAY's rarities from the notable feeds, deduped by checklist (sub_id),
  // newest first. `records` = merged snapshot; `snapshotDate` = 'YYYY-MM-DD'.
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
    var notable = notableToday(unseenAll, snapshotDate);

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
  function travelHopMinutes(cfg, lat1, lng1, lat2, lng2) {
    var e = travelHop(cfg, travelZoneOf(cfg, lat1, lng1), travelZoneOf(cfg, lat2, lng2));
    var m = e && Number(e.minutes);
    return (m && isFinite(m)) ? Math.round(m) : 0;
  }

  function travelHopVia(cfg, lat1, lng1, lat2, lng2) {
    var e = travelHop(cfg, travelZoneOf(cfg, lat1, lng1), travelZoneOf(cfg, lat2, lng2));
    return (e && e.via) ? String(e.via) : '';
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
    if (!travelHopMinutes(cfg, lat1, lng1, lat2, lng2)) return '';
    var eff = travelEffectiveMi(cfg, straightMi, lat1, lng1, lat2, lng2);
    var band = travelDayBand(cfg, eff);
    var via = travelHopVia(cfg, lat1, lng1, lat2, lng2);
    var parts = ['≈' + travelHalfHours(travelRoundTripH(cfg, eff)) + ' h round trip'];
    if (band.label) parts.push(band.label);
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
  function arrivalDay(dayCounts, pct) {
    pct = pct === undefined ? 0.05 : pct;
    var keys = Object.keys(dayCounts || {}).sort();
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
    scoreDestinationClusters: scoreDestinationClusters,
    fresh24Count: fresh24Count,
    sortClusterSpecies: sortClusterSpecies,
    destinations: destinations,
    excursions: excursions,
    notableToday: notableToday,
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
    dedupeObs: dedupeObs
  };
}));
