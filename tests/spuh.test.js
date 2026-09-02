'use strict';
/*
 * spuh.test.js — pure uncertain-ID model tests.
 *
 * The production model is built lazily from the user's direct eBird taxonomy
 * call. This deliberately synthetic taxonomy keeps public CI independent of
 * the private report repository while guarding the hard parts: exact species
 * lists, equal-coverage labels, overlapping groups, aliases and shared IDs.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const Spuh = require(path.join(__dirname, '..', 'www', 'spuh.js'));

function species(code, name, sci, order, family, taxonOrder) {
  return {
    speciesCode: code, comName: name, sciName: sci, category: 'species',
    order, familySciName: family, familyComName: family, taxonOrder
  };
}

function spuh(code, name, sci, order, family, taxonOrder) {
  return {
    speciesCode: code, comName: name, sciName: sci, category: 'spuh',
    order, familySciName: family, familyComName: family, taxonOrder
  };
}

const TAXONOMY = [
  species('sem', 'Semipalmated Sandpiper', 'Calidris pusilla',
    'Charadriiformes', 'Scolopacidae', 1),
  species('wes', 'Western Sandpiper', 'Calidris mauri',
    'Charadriiformes', 'Scolopacidae', 2),
  species('sol', 'Solitary Sandpiper', 'Tringa solitaria',
    'Charadriiformes', 'Scolopacidae', 3),
  species('les', 'Lesser Yellowlegs', 'Tringa flavipes',
    'Charadriiformes', 'Scolopacidae', 4),
  species('amg', 'American Golden-Plover', 'Pluvialis dominica',
    'Charadriiformes', 'Charadriidae', 5),
  species('eug', 'European Golden-Plover', 'Pluvialis apricaria',
    'Charadriiformes', 'Charadriidae', 6),
  species('pag', 'Pacific Golden-Plover', 'Pluvialis fulva',
    'Charadriiformes', 'Charadriidae', 7),
  species('rng', 'Ring-billed Gull', 'Larus delawarensis',
    'Charadriiformes', 'Laridae', 8),
  species('cag', 'California Gull', 'Larus californicus',
    'Charadriiformes', 'Laridae', 9),
  species('but', 'Test Buteo', 'Buteo testus',
    'Accipitriformes', 'Accipitridae', 10),
  species('eag', 'Test Eagle', 'Aquila testus',
    'Accipitriformes', 'Accipitridae', 11),
  species('a1', 'Alpha One', 'Alpha primus',
    'Passeriformes', 'Overlapidae', 12),
  species('b1', 'Beta One', 'Beta primus',
    'Passeriformes', 'Overlapidae', 13),
  species('g1', 'Gamma One', 'Gamma primus',
    'Passeriformes', 'Overlapidae', 14),

  spuh('bird', 'bird sp.', 'Aves sp.', '', '', 100),
  spuh('shore', 'shorebird sp.', 'Charadriiformes sp. (shorebird sp.)',
    'Charadriiformes', '', 101),
  spuh('scol', 'Scolopacidae sp.', 'Scolopacidae sp.',
    'Charadriiformes', 'Scolopacidae', 102),
  spuh('cal', 'Calidris sp.', 'Calidris sp.',
    'Charadriiformes', 'Scolopacidae', 103),
  spuh('peep', 'peep sp.', 'Calidris sp. (peep sp.)',
    'Charadriiformes', 'Scolopacidae', 104),
  spuh('trin', 'Tringa sp.', 'Tringa sp.',
    'Charadriiformes', 'Scolopacidae', 105),
  spuh('gpl', 'golden-plover sp.',
    'Pluvialis dominica/apricaria/fulva',
    'Charadriiformes', 'Charadriidae', 106),
  spuh('lar', 'Larus sp.', 'Larus sp.',
    'Charadriiformes', 'Laridae', 107),
  spuh('gul', 'gull sp.', 'Larinae sp. (gull sp.)',
    'Charadriiformes', 'Laridae', 108),
  spuh('mix', 'Buteo/eagle sp.', 'Buteo/eagle sp.',
    'Accipitriformes', 'Accipitridae', 109),
  spuh('ab', 'Alpha/Beta sp.', 'Alpha/Beta sp.',
    'Passeriformes', 'Overlapidae', 110),
  spuh('ag', 'Alpha/Gamma sp.', 'Alpha/Gamma sp.',
    'Passeriformes', 'Overlapidae', 111),
  {
    speciesCode: 'sem-form', comName: 'Semipalmated Sandpiper (form)',
    sciName: 'Calidris pusilla test', category: 'issf',
    order: 'Charadriiformes', familySciName: 'Scolopacidae',
    familyComName: 'Scolopacidae', taxonOrder: 112, reportAs: 'sem'
  }
];

function build() {
  return Spuh.createFromTaxonomy(TAXONOMY);
}

test('packTaxonomy keeps only the compact fields needed at runtime', () => {
  const packed = Spuh.packTaxonomy(TAXONOMY);
  assert.equal(packed.v, Spuh.SCHEMA);
  assert.equal(packed.species.length, 14);
  assert.equal(packed.spuhs.length, 12);
  assert.deepEqual(packed.aliases, [['sem-form', 'sem']]);
  assert.ok(JSON.stringify(packed).length < JSON.stringify(TAXONOMY).length);
});

test('explicit scientific species lists resolve exactly, not to the family', () => {
  const model = build();
  const node = model.node('gpl');
  assert.equal(node.route, 'species-list');
  assert.equal(node.limit, '');
  assert.deepEqual(model.candidates(node).map((s) => s.code),
    ['amg', 'eug', 'pag']);
});

test('published genus, family and order coverage stays exact', () => {
  const model = build();
  assert.deepEqual(model.candidates('cal').map((s) => s.code), ['sem', 'wes']);
  assert.deepEqual(model.candidates('scol').map((s) => s.code),
    ['sem', 'wes', 'sol', 'les']);
  assert.equal(model.candidates('shore').length, 9);
});

test('equal-coverage glosses and unpublished group names are coverage-limited', () => {
  const model = build();
  assert.equal(model.node('peep').limit, 'same-group');
  assert.equal(model.node('gul').limit, 'subfamily');
  assert.equal(model.node('mix').limit, 'unpublished-group');
  assert.match(model.definition('peep'), /automatic recommendations stop/);
});

test('narrowest shared spuhs use proven coverage and may return a DAG result', () => {
  const model = build();
  assert.deepEqual(
    model.narrowestShared(['sol', 'sem']).map((x) => x.node.code),
    ['scol'],
    'Solitary + Semipalmated stop at the sandpiper family'
  );
  assert.deepEqual(
    model.narrowestShared(['sem']).map((x) => x.node.code),
    ['cal'],
    'equal-coverage peep is warned, so Calidris is the safe automatic label'
  );
  assert.deepEqual(
    model.narrowestShared(['rng', 'cag']).map((x) => x.node.code),
    ['lar'],
    'two Larus gulls stop at Larus, not the unpublished Larinae label'
  );
  assert.deepEqual(
    model.narrowestShared(['a1']).map((x) => x.node.code).sort(),
    ['ab', 'ag'],
    'overlapping groups remain two incomparable narrowest answers'
  );
});

test('species aliases follow reportAs before finding related spuhs', () => {
  const model = build();
  assert.equal(model.speciesRow('sem-form').code, 'sem');
  assert.deepEqual(
    model.narrowestShared(['sem-form']).map((x) => x.node.code),
    ['cal']
  );
});

test('broader and narrower edges are minimal strict set relations', () => {
  const model = build();
  assert.deepEqual(
    model.broader('cal').map((c) => c.head.code),
    ['scol'],
    'Calidris connects to its minimal broader published class'
  );
  assert.deepEqual(
    model.narrower('scol').map((c) => c.head.code).sort(),
    ['cal', 'trin'],
    'the family exposes its two minimal narrower genera'
  );
});

test('search finds both spuh labels and concrete species', () => {
  const model = build();
  assert.equal(model.searchSpuh('peep', 1)[0].code, 'peep');
  assert.equal(model.searchSpecies('semipalmated', 1)[0].code, 'sem');
});
