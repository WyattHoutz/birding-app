(function (global, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.EbirdEvents = api;
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_MS = 86400000;
  var CALENDAR_UPDATED = '2026-09-10';
  var CALENDAR = [
    {
      id: 'gbbc-2026',
      name: 'Great Backyard Bird Count',
      shortName: 'GBBC',
      start: '2026-02-13',
      end: '2026-02-16',
      url: 'https://www.birdcount.org/'
    },
    {
      id: 'global-big-day-2026',
      name: 'Global Big Day',
      shortName: 'Global Big Day',
      start: '2026-05-09',
      end: '2026-05-09',
      url: 'https://ebird.org/news/global-big-day-2026'
    },
    {
      id: 'october-big-day-2026',
      name: 'October Big Day',
      shortName: 'October Big Day',
      start: '2026-10-10',
      end: '2026-10-10',
      url: 'https://ebird.org/octoberbigday'
    },
    {
      id: 'gbbc-2027',
      name: 'Great Backyard Bird Count',
      shortName: 'GBBC',
      start: '2027-02-12',
      end: '2027-02-15',
      url: 'https://www.birdcount.org/'
    }
  ].map(Object.freeze);
  Object.freeze(CALENDAR);

  function parseYmd(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) throw new Error('Invalid event date: ' + value);
    var year = +match[1], month = +match[2], day = +match[3];
    var ms = Date.UTC(year, month - 1, day);
    var check = new Date(ms);
    if (check.getUTCFullYear() !== year
        || check.getUTCMonth() !== month - 1
        || check.getUTCDate() !== day) {
      throw new Error('Invalid event date: ' + value);
    }
    return { year: year, month: month, day: day, ms: ms };
  }

  function nextEvent(localYmd, calendar) {
    var today = parseYmd(localYmd).ms;
    var events = calendar || CALENDAR;
    for (var i = 0; i < events.length; i++) {
      var event = events[i];
      var start = parseYmd(event.start).ms;
      var end = parseYmd(event.end).ms;
      if (today > end) continue;
      if (today < start) {
        return {
          event: event,
          phase: 'upcoming',
          daysUntil: Math.round((start - today) / DAY_MS),
          dayNumber: 0,
          totalDays: Math.round((end - start) / DAY_MS) + 1
        };
      }
      return {
        event: event,
        phase: 'active',
        daysUntil: 0,
        dayNumber: Math.round((today - start) / DAY_MS) + 1,
        totalDays: Math.round((end - start) / DAY_MS) + 1
      };
    }
    return null;
  }

  function monthName(month) {
    return [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ][month - 1];
  }

  function formatDate(value) {
    var date = parseYmd(value);
    return monthName(date.month) + ' ' + date.day + ', ' + date.year;
  }

  function formatRange(event) {
    var start = parseYmd(event.start);
    var end = parseYmd(event.end);
    if (start.ms === end.ms) return formatDate(event.start);
    if (start.year === end.year && start.month === end.month) {
      return monthName(start.month) + ' ' + start.day + '\u2013'
        + end.day + ', ' + end.year;
    }
    return formatDate(event.start) + '\u2013' + formatDate(event.end);
  }

  return {
    CALENDAR_UPDATED: CALENDAR_UPDATED,
    CALENDAR: CALENDAR,
    nextEvent: nextEvent,
    formatDate: formatDate,
    formatRange: formatRange
  };
}));
