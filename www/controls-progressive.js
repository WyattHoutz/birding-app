/* Shared in-place load-more navigation for long lists. */
(function (global) {
  'use strict';

  var nextId = 1;

  function classNames(base, extra) {
    return [base, extra || ''].join(' ').trim().replace(/\s+/g, ' ');
  }

  function moreLabel(next, remaining) {
    next = Math.min(10, Math.max(1, Number(next) || 10), remaining);
    return remaining <= next
      ? 'Load ' + remaining + ' more'
      : 'Load ' + next + ' more of ' + remaining;
  }

  function mount(spec) {
    spec = spec || {};
    var host = spec.host;
    if (!host || !host.ownerDocument) {
      throw new Error('ProgressiveList.mount needs a host element');
    }
    if (typeof spec.renderItem !== 'function') {
      throw new Error('ProgressiveList.mount needs renderItem');
    }
    var doc = host.ownerDocument;
    var items = Array.isArray(spec.items) ? spec.items.slice() : [];
    var requestedBatchSize = Math.max(1, Number(spec.batchSize) || 25);
    var batchSize = Math.min(10, requestedBatchSize);
    var noun = String(spec.noun || 'items');
    var id = spec.id || ('progressive-list-' + nextId++);
    var shown = 0;
    var initialCount = Math.max(0, Number(spec.initialCount) || requestedBatchSize);

    host.innerHTML = '';
    var list = doc.createElement('ul');
    list.id = id;
    list.className = classNames('progressive-list', spec.listClass);
    host.appendChild(list);

    var status = doc.createElement('span');
    status.className = 'progressive-status sr-only';
    status.setAttribute('aria-live', 'polite');
    host.appendChild(status);

    var button = doc.createElement('button');
    button.type = 'button';
    button.className = classNames('progressive-more', spec.buttonClass);
    button.setAttribute('aria-controls', id);
    host.appendChild(button);
    var autoObserver = null;
    var autoBusy = false;

    function current() {
      return typeof spec.isCurrent !== 'function' || spec.isCurrent();
    }

    function stopAuto() {
      if (autoObserver) {
        autoObserver.disconnect();
        autoObserver = null;
      }
    }

    function startAuto() {
      stopAuto();
      if (spec.autoLoad === false || !button.parentNode) return;
      var win = doc.defaultView || global;
      var Obs = win && win.IntersectionObserver;
      if (typeof Obs !== 'function') return;
      autoObserver = new Obs(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          if (!entries[i].isIntersecting) continue;
          if (autoBusy) return;
          autoBusy = true;
          stopAuto();
          setTimeout(function () {
            try { append(); }
            finally { autoBusy = false; }
          }, 0);
          return;
        }
      }, { rootMargin: '350px 0px' });
      autoObserver.observe(button);
    }

    function update() {
      var remaining = items.length - shown;
      status.textContent = 'Showing ' + shown + ' of ' + items.length + ' ' + noun + '.';
      if (remaining <= 0) {
        stopAuto();
        if (button.parentNode) button.parentNode.removeChild(button);
        return;
      }
      var next = Math.min(batchSize, remaining);
      var label = typeof spec.moreLabel === 'function'
        ? spec.moreLabel(next, remaining, noun)
        : moreLabel(next, remaining);
      button.textContent = '';
      if (!spec.hideIcon) {
        var icon = doc.createElement('span');
        icon.className = 'progressive-more-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = '↓';
        button.appendChild(icon);
      }
      var text = doc.createElement('span');
      text.className = 'progressive-more-text';
      text.textContent = label;
      button.appendChild(text);
      button.setAttribute('aria-label', label);
      button.title = label;
      startAuto();
    }

    function append() {
      if (!current()) return false;
      var count = shown === 0 && initialCount ? initialCount : batchSize;
      var end = Math.min(items.length, shown + count);
      var html = '';
      for (var i = shown; i < end; i++) {
        var rendered = spec.renderItem(items[i], i);
        if (rendered && rendered.nodeType) {
          if (html) {
            list.insertAdjacentHTML('beforeend', html);
            html = '';
          }
          list.appendChild(rendered);
        } else {
          html += rendered || '';
        }
      }
      if (html) list.insertAdjacentHTML('beforeend', html);
      var start = shown;
      shown = end;
      if (typeof spec.afterAppend === 'function') {
        spec.afterAppend(list, start, shown);
      }
      update();
      return true;
    }

    button.addEventListener('click', append);
    append();
    return {
      list: list,
      button: button,
      status: status,
      append: append,
      shown: function () { return shown; }
    };
  }

  var css = [
    '.progressive-status { position: absolute; width: 1px; height: 1px;',
    '  padding: 0; margin: -1px; overflow: hidden;',
    '  clip: rect(0 0 0 0); white-space: nowrap; border: 0; }',
    '.progressive-more { min-height: calc(44px * var(--s)); min-width: calc(44px * var(--s));',
    '  border: 1px solid var(--link); border-radius: 999px;',
    '  padding: calc(8px * var(--s)) calc(13px * var(--s));',
    '  background: transparent; color: var(--link); cursor: pointer;',
    '  display: inline-flex; align-items: center; justify-content: center;',
    '  gap: calc(7px * var(--s)); font: 800 calc(14px * var(--s))/1.2 system-ui, sans-serif; }',
    '.progressive-more-icon { font-size: calc(19px * var(--s)); line-height: 1; }',
    '.progressive-more-text { position: static; width: auto; height: auto;',
    '  padding: 0; margin: 0; overflow: visible; clip: auto;',
    '  white-space: normal; border: 0; }',
    '.progressive-more:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }'
  ].join('\n');

  if (typeof document !== 'undefined'
      && !document.querySelector('style[data-controls="progressive"]')) {
    var style = document.createElement('style');
    style.setAttribute('data-controls', 'progressive');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  var api = { mount: mount, moreLabel: moreLabel, css: css };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ProgressiveList = api;
})(typeof window !== 'undefined' ? window : globalThis);
