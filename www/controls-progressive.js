/* Shared in-place Show-more navigation for long lists. */
(function (global) {
  'use strict';

  var nextId = 1;

  function classNames(base, extra) {
    return [base, extra || ''].join(' ').trim().replace(/\s+/g, ' ');
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
    var batchSize = Math.max(1, Number(spec.batchSize) || 25);
    var noun = String(spec.noun || 'items');
    var id = spec.id || ('progressive-list-' + nextId++);
    var shown = 0;

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

    function current() {
      return typeof spec.isCurrent !== 'function' || spec.isCurrent();
    }

    function update() {
      var remaining = items.length - shown;
      status.textContent = 'Showing ' + shown + ' of ' + items.length + ' ' + noun + '.';
      if (remaining <= 0) {
        if (button.parentNode) button.parentNode.removeChild(button);
        return;
      }
      var next = Math.min(batchSize, remaining);
      button.textContent = typeof spec.moreLabel === 'function'
        ? spec.moreLabel(next, remaining, shown, items.length)
        : 'Show ' + next + ' more of ' + items.length + ' ' + noun;
      button.setAttribute('aria-label', button.textContent);
    }

    function append() {
      if (!current()) return false;
      var end = Math.min(items.length, shown + batchSize);
      var html = '';
      for (var i = shown; i < end; i++) {
        html += spec.renderItem(items[i], i);
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
    '.progressive-more { min-height: calc(44px * var(--s)); border: 0;',
    '  padding: 7px 0; background: transparent; color: var(--link);',
    '  font: 800 calc(14px * var(--s))/1.25 system-ui, sans-serif;',
    '  text-decoration: underline; text-underline-offset: 2px; cursor: pointer; }',
    '.progressive-more:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }'
  ].join('\n');

  if (typeof document !== 'undefined'
      && !document.querySelector('style[data-controls="progressive"]')) {
    var style = document.createElement('style');
    style.setAttribute('data-controls', 'progressive');
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  var api = { mount: mount, css: css };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ProgressiveList = api;
})(typeof window !== 'undefined' ? window : globalThis);
