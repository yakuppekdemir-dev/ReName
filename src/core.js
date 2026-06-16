/* =====================================================================
   ReName cekirdek mantik (saf fonksiyonlar) - UMD
   Hem tarayicida (window.Core) hem Node testlerinde (require) calisir.
   DOM veya dosya sistemi bagimliligi YOKTUR; bu yuzden test edilebilir.
===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  var FORBIDDEN = /[\\/:*?"<>|]/; // dosya adinda olamayan karakterler (bosluk/tire serbest)

  function naturalCompare(a, b) { return collator.compare(a, b); }

  function hasControlChar(s) {
    for (var i = 0; i < s.length; i++) if (s.charCodeAt(i) < 32) return true;
    return false;
  }

  function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  function literalReplaceAll(str, find, repl, caseSensitive) {
    if (!find) return str;
    var re = new RegExp(escapeRegExp(find), caseSensitive ? 'g' : 'gi');
    return str.replace(re, function () { return repl; });
  }

  // name: uzantili tam dosya adi (orn. "Tatil 001.jpg")
  // Dil bagimsiz hata kodu doner (arayuz i18n ile cevirir): vEmpty/vChar/vName/vTrail/vLong
  function validateName(name) {
    if (!name || !name.trim()) return 'vEmpty';
    if (FORBIDDEN.test(name) || hasControlChar(name)) return 'vChar';
    if (name === '.' || name === '..') return 'vName';
    if (/[ .]$/.test(name)) return 'vTrail';
    if (name.length > 250) return 'vLong';
    return null;
  }

  // file: { nameNoExt, ext, base }
  // o: { base, start, step, pad, sep, position('before'|'after'), dir('asc'|'desc') }
  function computeNumber(file, index, total, o) {
    var lastN = o.start + (total - 1) * o.step;
    var digits = o.pad === 'auto'
      ? String(Math.max(Math.abs(o.start), Math.abs(lastN))).length
      : parseInt(o.pad, 10);
    var n = o.dir === 'desc'
      ? o.start + (total - 1 - index) * o.step
      : o.start + index * o.step;
    var num = String(Math.abs(n)).padStart(digits, '0');
    if (n < 0) num = '-' + num;
    var base = (o.base || '').trim();
    var name;
    if (!base) name = num;
    else if (o.position === 'before') name = num + o.sep + base;
    else name = base + o.sep + num;
    return name + file.ext;
  }

  function computeAdd(file, o) {
    return (o.prefix || '') + file.nameNoExt + (o.suffix || '') + file.ext;
  }

  function computeReplace(file, o) {
    if (!o.find) return file.base;
    if (o.repExt) return literalReplaceAll(file.base, o.find, o.repWith, o.repCase);
    return literalReplaceAll(file.nameNoExt, o.find, o.repWith, o.repCase) + file.ext;
  }

  return {
    naturalCompare: naturalCompare,
    hasControlChar: hasControlChar,
    escapeRegExp: escapeRegExp,
    literalReplaceAll: literalReplaceAll,
    validateName: validateName,
    computeNumber: computeNumber,
    computeAdd: computeAdd,
    computeReplace: computeReplace
  };
});
