'use strict';
// Hakkinda penceresi: URL'den dil (lang) ve surum (v) okur, i18n uygular.
(function () {
  var p = new URLSearchParams(location.search);
  var lang = p.get('lang') || 'tr';
  var v = p.get('v') || '';
  var L = (window.I18N && window.I18N.STR[lang]) ? lang : 'tr';
  var dir = window.I18N ? window.I18N.STR[L].dir : 'ltr';
  document.documentElement.lang = L;
  document.documentElement.dir = dir;

  function t(k, vars) { return window.I18N ? window.I18N.t(L, k, vars) : k; }

  document.querySelectorAll('[data-i18n]').forEach(function (el) {
    el.textContent = t(el.dataset.i18n);
  });
  document.getElementById('ver').textContent = t('aboutVersion', { v: v });
  document.getElementById('close').addEventListener('click', function () { window.close(); });
})();
