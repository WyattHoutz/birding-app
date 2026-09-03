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

  function group(spec) {
    spec = spec || {};
    var out = '<span class="' + attrEsc(classNames('sortpick', spec.cls)) + '"';
    if (spec.id) out += ' id="' + attrEsc(spec.id) + '"';
    out += ' role="group" aria-label="' + attrEsc(spec.label || 'Options') + '">';
    (spec.options || []).forEach(function (option) {
      option = option || {};
      out += '<button type="button" class="'
        + attrEsc(classNames('sortbtn', option.cls)) + '"';
      if (option.id) out += ' id="' + attrEsc(option.id) + '"';
      Object.keys(option.data || {}).forEach(function (key) {
        if (!/^[a-z][a-z0-9-]*$/.test(key)) return;
        out += ' data-' + key + '="' + attrEsc(option.data[key]) + '"';
      });
      out += ' data-label="' + attrEsc(option.label || '') + '"'
        + ' aria-pressed="' + (option.pressed ? 'true' : 'false') + '"';
      if (option.ariaLabel) {
        out += ' aria-label="' + attrEsc(option.ariaLabel) + '"';
      }
      out += '>' + attrEsc(option.label || '') + '</button>';
    });
    return out + '</span>';
  }

  var api = { group: group };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ToggleControls = api;
})(typeof window !== 'undefined' ? window : globalThis);
