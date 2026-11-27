(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BirdRegionBoundaries = factory();
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var PREFIX = 'ebird_region_boundary_v1:';
  var YEAR_MS = 365 * 86400 * 1000;
  var CENSUS = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer';
  var STATCAN = 'https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Digital_boundary_files/MapServer';
  var US = {
    AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09',
    DE: '10', DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17',
    IN: '18', IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24',
    MA: '25', MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31',
    NV: '32', NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38',
    OH: '39', OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46',
    TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54',
    WI: '55', WY: '56', AS: '60', GU: '66', MP: '69', PR: '72', VI: '78'
  };
  var CA = {
    NL: '10', PE: '11', NS: '12', NB: '13', QC: '24', ON: '35',
    MB: '46', SK: '47', AB: '48', BC: '59', YT: '60', NT: '61', NU: '62'
  };

  function requestFor(parent, code) {
    var match = /^(US|CA)-([A-Z]{2})(?:-(\d{3}))?$/.exec(code);
    if (!match || parent !== code.split('-').slice(0, 2).join('-')) return null;
    var canada = match[1] === 'CA', id = (canada ? CA : US)[match[2]];
    if (!id || canada && match[3]) return null;
    var county = match[3] || '', service = canada ? STATCAN : CENSUS;
    var sourceId = id + county;
    var query = new URLSearchParams({
      where: (canada ? 'PRUID' : 'GEOID') + "='" + sourceId + "'",
      outFields: canada ? 'PRUID,PRNAME,PRENAME'
        : county ? 'GEOID,BASENAME,STATE,COUNTY' : 'GEOID,BASENAME,STUSAB',
      returnGeometry: 'true', outSR: '4326', geometryPrecision: '5', f: 'geojson'
    });
    return {
      code: code, id: sourceId, state: id, abbr: match[2], county: county,
      canada: canada, source: canada ? 'Statistics Canada digital boundaries'
        : 'U.S. Census Bureau TIGERweb',
      version: canada ? 'statcan-2021-digital-v1' : 'census-state-county-v1',
      url: service + '/' + (canada ? 0 : county ? 5 : 4) + '/query?' + query
    };
  }

  function geometryBounds(geometry) {
    if (!geometry || !Array.isArray(geometry.coordinates)) return null;
    var polygons = geometry.type === 'Polygon' ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon' ? geometry.coordinates : null;
    if (!polygons || !polygons.length) return null;
    var bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    var valid = polygons.every(function (polygon) {
      return Array.isArray(polygon) && polygon.length && polygon.every(function (ring) {
        if (!Array.isArray(ring) || ring.length < 4) return false;
        var area = 0;
        for (var i = 0; i < ring.length; i++) {
          var point = ring[i];
          if (!Array.isArray(point) || typeof point[0] !== 'number' || typeof point[1] !== 'number'
              || !isFinite(point[0]) || !isFinite(point[1])
              || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) return false;
          bounds.minX = Math.min(bounds.minX, point[0]);
          bounds.maxX = Math.max(bounds.maxX, point[0]);
          bounds.minY = Math.min(bounds.minY, point[1]);
          bounds.maxY = Math.max(bounds.maxY, point[1]);
          if (i) area += ring[i - 1][0] * point[1] - point[0] * ring[i - 1][1];
        }
        return ring[0][0] === ring[ring.length - 1][0]
          && ring[0][1] === ring[ring.length - 1][1] && Math.abs(area) > 1e-12;
      });
    });
    return valid ? bounds : null;
  }

  function fromDocument(doc, request) {
    if (!doc || doc.type !== 'FeatureCollection' || !Array.isArray(doc.features)
        || doc.features.length !== 1) return null;
    if (doc.crs && !/(?:4326|CRS84)$/.test(String(doc.crs.properties && doc.crs.properties.name || ''))) {
      return null;
    }
    var feature = doc.features[0], properties = feature && feature.properties;
    if (!feature || feature.type !== 'Feature' || !properties) return null;
    if (String(properties[request.canada ? 'PRUID' : 'GEOID'] || '') !== request.id) return null;
    if (!request.canada && (request.county
      ? String(properties.STATE) !== request.state || String(properties.COUNTY) !== request.county
      : properties.STUSAB !== request.abbr)) return null;
    var bounds = geometryBounds(feature.geometry);
    if (!bounds) return null;
    return {
      code: request.code,
      name: String(properties.PRENAME || properties.BASENAME || properties.PRNAME || request.code),
      geometry: feature.geometry, bounds: bounds,
      accuracyMi: 0.1, boundaryVersion: request.version,
      source: request.source, sourceUrl: request.url, sourceId: request.id,
      maxAllowableOffsetDegrees: 0
    };
  }

  function cacheKey(code) { return PREFIX + code; }

  function create(options) {
    var inflight = Object.create(null), memory = Object.create(null);
    var now = options.now || Date.now;
    function validRecord(record, request) {
      var boundary = record && record.boundary;
      var bounds = boundary && geometryBounds(boundary.geometry);
      if (!record || record.version !== request.version || !boundary
          || boundary.code !== request.code || boundary.sourceId !== request.id
          || boundary.boundaryVersion !== request.version || boundary.sourceUrl !== request.url
          || boundary.source !== request.source || boundary.accuracyMi !== 0.1 || !bounds
          || !boundary.bounds || Object.keys(bounds).some(function (key) { return bounds[key] !== boundary.bounds[key]; })
          || typeof record.at !== 'number' || !isFinite(record.at)
          || record.at > now() || now() - record.at >= YEAR_MS) return false;
      return true;
    }
    function download(request) {
      var controller = typeof AbortController === 'function' ? new AbortController() : null, timer;
      var network = Promise.resolve().then(function () {
        return options.fetch(request.url, {
          headers: { Accept: 'application/geo+json, application/json' },
          signal: controller ? controller.signal : undefined
        });
      }).then(function (response) {
        if (!response || !response.ok) throw new Error('Boundary HTTP ' + (response && response.status));
        return response.json();
      });
      var deadline = new Promise(function (resolve, reject) {
        timer = setTimeout(function () {
          reject(new Error('Boundary request timed out'));
          if (controller) controller.abort();
        }, options.timeoutMs || 20000);
      });
      return Promise.race([network, deadline]).finally(function () { clearTimeout(timer); });
    }
    function load(parent, code, controls) {
      parent = String(parent || '').trim().toUpperCase();
      code = String(code || '').trim().toUpperCase();
      var request = requestFor(parent, code);
      if (!request) return Promise.resolve(null);
      var owner = options.owner(), cacheOnly = !!(controls && controls.cacheOnly);
      function current() { return owner === options.owner(); }
      var key = owner + '|' + code, pendingKey = key + (cacheOnly ? '|cache' : '|fetch');
      if (validRecord(memory[key], request)) return Promise.resolve(memory[key].boundary);
      if (inflight[pendingKey]) return inflight[pendingKey];
      var pending = Promise.resolve().then(async function () {
        var cached;
        try { cached = await options.persistence.getJson(cacheKey(code)); } catch (e) {}
        if (!current()) return null;
        if (validRecord(cached, request)) {
          memory[key] = cached;
          return cached.boundary;
        }
        if (cacheOnly) return null;
        var boundary = fromDocument(await download(request), request);
        if (!current()) return null;
        if (!boundary) throw new Error('Boundary identity or polygon is invalid for ' + code);
        var record = { version: request.version, at: now(), boundary: boundary };
        await options.persistence.putJson(cacheKey(code), record, { shouldWrite: current }).catch(function () {});
        if (!current()) return null;
        memory[key] = record;
        return boundary;
      }).catch(function (error) {
        if (current() && options.onError) options.onError(error, code);
        return null;
      }).finally(function () {
        if (inflight[pendingKey] === pending) delete inflight[pendingKey];
      });
      inflight[pendingKey] = pending;
      return pending;
    }
    return { load: load };
  }

  return { create: create, requestFor: requestFor, cacheKey: cacheKey };
}));
