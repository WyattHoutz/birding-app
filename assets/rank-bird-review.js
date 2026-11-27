'use strict';

module.exports = async function prepareRankBirdReview(A, document, expanded, preparePersonal) {
  var W = document.defaultView, region = 'US-WA';
  var birds = [['coripl','Common Ringed Plover','CRPL'],['ruff','Ruff','RUFF'],['pacloo','Pacific Loon','PALO'],
    ['shtsan','Sharp-tailed Sandpiper','SPTS'],['margod','Marbled Godwit','MAGO'],['snobun','Snow Bunting','SNBU'],
    ['amgplo','American Golden-Plover','AMGP'],['snoowl1','Snowy Owl','SNOW']];
  if (preparePersonal) {
    W.localStorage.setItem(A.PERSONAL_PERIOD_KEY,'current');
    A.applyCapturedIdentity({status:'ok',displayName:'Sample Birder',profileId:'representative-owner'});
    await preparePersonal(A,W,{yearList:[]},birds.map(function(bird) {
      return {code:bird[0],name:bird[1],alpha:bird[2]};
    }));
  }
  var period = A.personalBoardPeriod(), name = A.getDisplayName();
  var owner = A.rankingHistoryOwner(region, period, 'spp', name), latest;
  W.localStorage.removeItem('bc_rankbirds_v1:' + owner);
  var yesterday = new W.Date(W.Date.now() - 86400000);
  var day = yesterday.getFullYear() + '-' + String(yesterday.getMonth() + 1).padStart(2, '0')
    + '-' + String(yesterday.getDate()).padStart(2, '0');
  W.localStorage.setItem('bc_board_v1:' + owner, JSON.stringify([{ d: day, r: {
    'representative-history-a': 3, 'representative-history-b': 1, 'Robin Taylor': 4
  } }]));
  W.localStorage.setItem(A.speciesCacheKey(region), JSON.stringify({
    at: W.Date.now(), expected: birds.length,
    rows: birds.map(function (bird) { return { code: bird[0], name: bird[1], alpha: bird[2] }; })
  }));
  for (var i = 0; i < birds.length; i++) {
    var at = new W.Date(W.Date.now() - (birds.length - i - 1) * 86400000);
    var date = at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    latest = { region: region, period: period, metric: 'spp', profile: A.bcProfile(),
      ownerRevision: A.identityRevision(), readAt: at.toISOString(),
      url: 'https://ebird.org/top100?locInfo.regionCode=US-WA&year=' + period + '&rankedBy=spp&maxResults=500',
      rows: [
        { rank: 1, name: 'Morgan Lee', profileId: 'representative-history-a', species: 248, checklists: 310,
          recent: birds[i][1] + ' (' + date + ')' },
        { rank: 2, name: 'Casey Chen', profileId: 'representative-history-b', species: 246, checklists: 300,
          recent: (i === 7 ? 'Ruff' : 'Common Ringed Plover') + ' (' + date + ')' },
        { rank: 3, name: 'Robin Taylor', species: 241, checklists: 280, recent: 'Snow Bunting (' + date + ')' }
      ] };
    if (!A.recordRankBirdHistory(latest, region, period, 'spp', name)) {
      throw new Error('Representative observed history was rejected');
    }
  }
  A.showSection('sec-rankBtn', { load: false });
  A.renderRankPair({ boards: { spp: latest, cl: Object.assign({}, latest, { metric: 'cl' }) },
    failures: {}, stale: {}, coverage: 'REPRESENTATIVE STUB DATA - not current standings.' }, region, period, name);
  if (expanded) document.querySelector('[data-rank-birds-more]').click();
  var section = document.getElementById('sec-rankBtn');
  section.dataset.mockAt = 'rankBtn'; section.dataset.mockReady = 'true'; section.dataset.mockData = 'true';
  return latest;
};
