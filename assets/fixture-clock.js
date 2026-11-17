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

module.exports = { withFixtureClock };
