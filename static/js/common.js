(function(){
  'use strict';

  // ── i18n ──────────────────────────────────────────────
  window.tr = function(key) {
    return window.StudioI18n ? window.StudioI18n.t(key) : key;
  };

  window.trf = function(key, values) {
    if (!values) return window.tr(key);
    return Object.entries(values).reduce(function(text, pair) {
      return text.replaceAll('{' + pair[0] + '}', String(pair[1]));
    }, window.tr(key));
  };

  // 别名：comfyui-settings 使用 tf
  window.tf = window.trf;

  window.langIsEn = function() {
    return !!(window.StudioI18n && window.StudioI18n.lang && window.StudioI18n.lang() === 'en');
  };

  window.currentLang = function() {
    return window.langIsEn() ? 'en' : 'zh';
  };

  // ── HTML 转义 ────────────────────────────────────────
  var ESCAPE_MAP = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };

  window.escapeHtml = function(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return ESCAPE_MAP[c]; });
  };

  window.escapeAttr = function(s) {
    return window.escapeHtml(s).replace(/`/g, '&#96;');
  };

})();
