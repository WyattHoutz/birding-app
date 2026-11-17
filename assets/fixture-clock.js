'use strict';

function withFixtureClock(scope, at, run) {
  const RealDate = scope.Date;
  class FixtureDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [at])); }
    static now() { return at; }
  }
  scope.Date = FixtureDate;
  try { return run(); }
  finally { scope.Date = RealDate; }
}

function advancingFixtureDate(RealDate, at) {
  const offset = at - RealDate.now();
  return class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [RealDate.now() + offset])); }
    static now() { return RealDate.now() + offset; }
  };
}

module.exports = { withFixtureClock, advancingFixtureDate };
