/* Shared segmented toggle markup for report controls. */
(function (global) {
  'use strict';

  function attrEsc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function classNames(base, extra) {
    return [base, extra || ''].join(' ').trim().replace(/\s+/g, ' ');
  }

  function dataAttrs(data) {
    var out = '';
    Object.keys(data || {}).forEach(function (key) {
      if (!/^[a-z][a-z0-9-]*$/.test(key)) return;
      out += ' data-' + key + '="' + attrEsc(data[key]) + '"';
    });
    return out;
  }

  function optionHtml(option) {
    option = option || {};
    var out = '<button type="button" class="'
      + attrEsc(classNames('sortbtn', option.cls)) + '"';
    if (option.id) out += ' id="' + attrEsc(option.id) + '"';
    out += dataAttrs(option.data)
      + ' data-label="' + attrEsc(option.label || '') + '"'
      + ' aria-pressed="' + (option.pressed ? 'true' : 'false') + '"';
    if (option.ariaLabel) {
      out += ' aria-label="' + attrEsc(option.ariaLabel) + '"';
    }
    return out + '>' + attrEsc(option.label || '') + '</button>';
  }

  function group(spec) {
    spec = spec || {};
    var options = spec.options || [];
    var base = options.length === 2 ? 'sortpick twopill' : 'sortpick';
    var out = '<span class="' + attrEsc(classNames(base, spec.cls)) + '"';
    if (spec.id) out += ' id="' + attrEsc(spec.id) + '"';
    out += ' role="group" aria-label="' + attrEsc(spec.label || 'Options') + '">';
    options.forEach(function (option) { out += optionHtml(option); });
    return out + '</span>';
  }

  function pill(spec) {
    spec = spec || {};
    if (!spec.options || spec.options.length !== 2) {
      throw new Error('ToggleControls.pill requires exactly two options');
    }
    return group(spec);
  }

  function pressed(spec) {
    spec = spec || {};
    var out = '<button type="button" class="'
      + attrEsc(classNames('pressbtn', spec.cls)) + '"';
    if (spec.id) out += ' id="' + attrEsc(spec.id) + '"';
    out += dataAttrs(spec.data)
      + ' aria-pressed="' + (spec.pressed ? 'true' : 'false') + '"'
      + ' aria-label="' + attrEsc(spec.ariaLabel || spec.label || 'Toggle') + '">'
      + '<span class="pressicon" aria-hidden="true">' + attrEsc(spec.icon || '') + '</span>'
      + '<span class="presslabel">' + attrEsc(spec.label || '') + '</span>'
      + '</button>';
    return out;
  }

  function syncPressed(button, spec) {
    if (!button) return;
    spec = spec || {};
    button.classList.add('pressbtn');
    button.setAttribute('aria-pressed', spec.pressed ? 'true' : 'false');
    button.setAttribute('aria-label', spec.ariaLabel || spec.label || 'Toggle');
    button.innerHTML = '<span class="pressicon" aria-hidden="true">'
      + attrEsc(spec.icon || '') + '</span><span class="presslabel">'
      + attrEsc(spec.label || '') + '</span>';
  }

  var api = {
    group: group,
    pill: pill,
    pressed: pressed,
    syncPressed: syncPressed
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ToggleControls = api;
})(typeof window !== 'undefined' ? window : globalThis);
