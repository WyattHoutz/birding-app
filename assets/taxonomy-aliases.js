'use strict';

function domesticReportAs(rows) {
  const pairs = [];
  (rows || []).forEach(function (row) {
    if (!row || String(row.category || '').toLowerCase() !== 'domestic') return;
    const child = String(row.speciesCode || '').trim().toLowerCase();
    const parent = String(row.reportAs || '').trim().toLowerCase();
    if (child && parent && child !== parent) pairs.push([child, parent]);
  });
  pairs.sort(function (a, b) { return a[0].localeCompare(b[0]); });
  const out = {};
  pairs.forEach(function (pair) { out[pair[0]] = pair[1]; });
  return out;
}

module.exports = { domesticReportAs };
