/* F362: offline jurisdiction choices, not observation data or county boundaries.
 * Codes/names checked against eBird reference endpoints 2026-09-30.
 * Coordinates are approximate administrative reference points, never Home.
 * Offsets describe those points, not every location in multi-zone regions.
 */
(function (root) {
  'use strict';
  var rows = [
    ['US-AL', 'Alabama', 32.37, -86.30, -6],
    ['US-AK', 'Alaska', 58.30, -134.42, -9],
    ['US-AZ', 'Arizona', 33.45, -112.07, -7, false],
    ['US-AR', 'Arkansas', 34.75, -92.29, -6],
    ['US-CA', 'California', 38.58, -121.49, -8],
    ['US-CO', 'Colorado', 39.74, -104.99, -7],
    ['US-CT', 'Connecticut', 41.77, -72.68, -5],
    ['US-DE', 'Delaware', 39.16, -75.52, -5],
    ['US-DC', 'District of Columbia', 38.91, -77.04, -5],
    ['US-FL', 'Florida', 30.44, -84.28, -5],
    ['US-GA', 'Georgia', 33.75, -84.39, -5],
    ['US-HI', 'Hawaii', 21.31, -157.86, -10, false],
    ['US-ID', 'Idaho', 43.62, -116.20, -7],
    ['US-IL', 'Illinois', 39.80, -89.65, -6],
    ['US-IN', 'Indiana', 39.77, -86.16, -5],
    ['US-IA', 'Iowa', 41.59, -93.62, -6],
    ['US-KS', 'Kansas', 39.05, -95.68, -6],
    ['US-KY', 'Kentucky', 38.20, -84.87, -5],
    ['US-LA', 'Louisiana', 30.45, -91.19, -6],
    ['US-ME', 'Maine', 44.31, -69.78, -5],
    ['US-MD', 'Maryland', 38.98, -76.49, -5],
    ['US-MA', 'Massachusetts', 42.36, -71.06, -5],
    ['US-MI', 'Michigan', 42.73, -84.56, -5],
    ['US-MN', 'Minnesota', 44.95, -93.09, -6],
    ['US-MS', 'Mississippi', 32.30, -90.18, -6],
    ['US-MO', 'Missouri', 38.58, -92.17, -6],
    ['US-MT', 'Montana', 46.59, -112.04, -7],
    ['US-NE', 'Nebraska', 40.81, -96.68, -6],
    ['US-NV', 'Nevada', 39.16, -119.77, -8],
    ['US-NH', 'New Hampshire', 43.21, -71.54, -5],
    ['US-NJ', 'New Jersey', 40.22, -74.76, -5],
    ['US-NM', 'New Mexico', 35.69, -105.94, -7],
    ['US-NY', 'New York', 42.65, -73.76, -5],
    ['US-NC', 'North Carolina', 35.78, -78.64, -5],
    ['US-ND', 'North Dakota', 46.81, -100.78, -6],
    ['US-OH', 'Ohio', 39.96, -83.00, -5],
    ['US-OK', 'Oklahoma', 35.47, -97.52, -6],
    ['US-OR', 'Oregon', 44.94, -123.04, -8],
    ['US-PA', 'Pennsylvania', 40.27, -76.89, -5],
    ['US-RI', 'Rhode Island', 41.82, -71.41, -5],
    ['US-SC', 'South Carolina', 34.00, -81.03, -5],
    ['US-SD', 'South Dakota', 44.37, -100.35, -6],
    ['US-TN', 'Tennessee', 36.16, -86.78, -6],
    ['US-TX', 'Texas', 30.27, -97.74, -6],
    ['US-UT', 'Utah', 40.76, -111.89, -7],
    ['US-VT', 'Vermont', 44.26, -72.58, -5],
    ['US-VA', 'Virginia', 37.54, -77.44, -5],
    ['US-WA', 'Washington', 47.04, -122.90, -8],
    ['US-WV', 'West Virginia', 38.35, -81.63, -5],
    ['US-WI', 'Wisconsin', 43.07, -89.40, -6],
    ['US-WY', 'Wyoming', 41.14, -104.82, -7],
    ['CA-AB', 'Alberta', 53.55, -113.49, -7],
    ['CA-BC', 'British Columbia', 48.43, -123.37, -8],
    ['CA-MB', 'Manitoba', 49.90, -97.14, -6],
    ['CA-NB', 'New Brunswick', 45.96, -66.64, -4],
    ['CA-NL', 'Newfoundland and Labrador', 47.56, -52.71, -3.5],
    ['CA-NT', 'Northwest Territories', 62.45, -114.38, -7],
    ['CA-NS', 'Nova Scotia', 44.65, -63.58, -4],
    ['CA-NU', 'Nunavut', 63.75, -68.52, -5],
    ['CA-ON', 'Ontario', 43.65, -79.38, -5],
    ['CA-PE', 'Prince Edward Island', 46.24, -63.13, -4],
    ['CA-QC', 'Quebec', 46.81, -71.21, -5],
    ['CA-SK', 'Saskatchewan', 50.45, -104.62, -6, false],
    ['CA-YT', 'Yukon Territory', 60.72, -135.06, -7, false],
    ['PM', 'Saint Pierre and Miquelon', 46.78, -56.18, -3]
  ];
  var regions = rows.map(function (r) {
    return Object.freeze({
      code: r[0], label: r[1], lat: r[2], lng: r[3],
      tzStdOffset: r[4], tzObservesDst: r[5] !== false
    });
  });
  var api = Object.freeze({
    regions: Object.freeze(regions),
    find: function (code) {
      return regions.find(function (r) { return r.code === code; }) || null;
    }
  });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AbaRegions = api;
})(typeof window === 'object' ? window : globalThis);
