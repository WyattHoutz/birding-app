'use strict';

const fs = require('fs');
const https = require('https');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVICE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/'
  + 'TIGERweb/State_County/MapServer';
const OFFSET_DEGREES = 0.001;
const ACCURACY_MI = 0.1;
const REGIONS = [
  { abbr: 'WA', fips: '53', parent: 'US-WA', file: 'region-boundaries-wa.json' },
  { abbr: 'HI', fips: '15', parent: 'US-HI', file: 'region-boundaries-hi.json' },
];

function getJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        } catch (error) {
          reject(new Error(`Invalid JSON from ${url}: ${error.message}`));
        }
      });
    }).on('error', reject);
  });
}

function query(layer, where, fields) {
  const params = new URLSearchParams({
    where,
    outFields: fields,
    returnGeometry: 'true',
    outSR: '4326',
    maxAllowableOffset: String(OFFSET_DEGREES),
    geometryPrecision: '5',
    f: 'geojson',
  });
  return getJson(`${SERVICE}/${layer}/query?${params}`);
}

function walkCoordinates(value, visit) {
  if (!Array.isArray(value)) return;
  if (value.length >= 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])) {
    visit(value[0], value[1]);
    return;
  }
  value.forEach((item) => walkCoordinates(item, visit));
}

function boundsOf(geometry) {
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  walkCoordinates(geometry && geometry.coordinates, (lng, lat) => {
    bounds.minX = Math.min(bounds.minX, lng);
    bounds.maxX = Math.max(bounds.maxX, lng);
    bounds.minY = Math.min(bounds.minY, lat);
    bounds.maxY = Math.max(bounds.maxY, lat);
  });
  if (!Number.isFinite(bounds.minX)) throw new Error('Geometry has no coordinates');
  return bounds;
}

function row(feature, code) {
  if (!feature || !feature.geometry) throw new Error(`Missing geometry for ${code}`);
  return {
    name: feature.properties.BASENAME,
    bounds: boundsOf(feature.geometry),
    geometry: feature.geometry,
  };
}

async function build(config) {
  const [stateDoc, countyDoc] = await Promise.all([
    query(4, `GEOID='${config.fips}'`, 'GEOID,BASENAME,STUSAB'),
    query(5, `STATE='${config.fips}'`, 'GEOID,BASENAME,STATE,COUNTY'),
  ]);
  if (!stateDoc.features || stateDoc.features.length !== 1) {
    throw new Error(`Expected one state feature for ${config.abbr}`);
  }
  const regions = {};
  regions[config.parent] = row(stateDoc.features[0], config.parent);
  for (const feature of countyDoc.features || []) {
    const county = feature.properties && feature.properties.COUNTY;
    if (!/^\d{3}$/.test(String(county || ''))) {
      throw new Error(`Invalid county code for ${config.abbr}`);
    }
    const code = `${config.parent}-${county}`;
    regions[code] = row(feature, code);
  }
  const output = {
    version: 1,
    source: 'U.S. Census Bureau TIGERweb State_County MapServer layers 4 and 5',
    sourceUrl: SERVICE,
    vintage: 'January 1, 2026',
    maxAllowableOffsetDegrees: OFFSET_DEGREES,
    accuracyMi: ACCURACY_MI,
    regions,
  };
  const target = path.join(ROOT, 'www', config.file);
  fs.writeFileSync(target, `${JSON.stringify(output)}\n`);
  console.log(`${config.file}: ${Object.keys(regions).length} regions, `
    + `${fs.statSync(target).size} bytes`);
}

Promise.all(REGIONS.map(build)).catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
