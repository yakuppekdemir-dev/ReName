'use strict';
const assert = require('assert');
const C = require('../src/core.js');

let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n      ' + e.message); process.exitCode = 1; }
}

// Yardimci: dosya nesnesi uret
const F = (nameNoExt, ext) => ({ nameNoExt, ext, base: nameNoExt + ext });

console.log('validateName');
t('gecerli ad (bosluk + tire serbest)', () => {
  assert.strictEqual(C.validateName('Tatil 001.jpg'), null);
  assert.strictEqual(C.validateName('aile-foto 2024.mp4'), null);
});
t('gecersiz yol karakterleri', () => {
  assert.ok(C.validateName('a/b.jpg'));
  assert.ok(C.validateName('a:b.jpg'));
  assert.ok(C.validateName('a*b.jpg'));
  assert.ok(C.validateName('a?b.jpg'));
});
t('bos / sonda nokta-bosluk', () => {
  assert.ok(C.validateName('   '));
  assert.ok(C.validateName('foto .jpg ')); // sonda bosluk
});

console.log('naturalCompare (dogal siralama)');
t('img2 < img10', () => {
  const arr = ['img10.jpg', 'img2.jpg', 'img1.jpg'].sort(C.naturalCompare);
  assert.deepStrictEqual(arr, ['img1.jpg', 'img2.jpg', 'img10.jpg']);
});

console.log('computeNumber');
const baseOpts = { base: 'Tatil', start: 1, step: 1, pad: 'auto', sep: ' ', position: 'after', dir: 'asc' };
t('artan + otomatik basamak (3 hane)', () => {
  const files = Array.from({ length: 12 }, (_, i) => F('x' + i, '.jpg'));
  const names = files.map((f, i) => C.computeNumber(f, i, files.length, baseOpts));
  assert.strictEqual(names[0], 'Tatil 01.jpg');   // 12 dosya -> 2 hane
  assert.strictEqual(names[11], 'Tatil 12.jpg');
});
t('azalan yon', () => {
  const files = Array.from({ length: 3 }, (_, i) => F('x' + i, '.png'));
  const o = { ...baseOpts, dir: 'desc' };
  const names = files.map((f, i) => C.computeNumber(f, i, 3, o));
  assert.deepStrictEqual(names, ['Tatil 3.png', 'Tatil 2.png', 'Tatil 1.png']);
});
t('numara basta + ayrac + sabit basamak', () => {
  const o = { ...baseOpts, position: 'before', sep: '_', pad: '3', start: 5, step: 5 };
  const f = F('orig', '.mov');
  assert.strictEqual(C.computeNumber(f, 0, 4, o), '005_Tatil.mov');
  assert.strictEqual(C.computeNumber(f, 1, 4, o), '010_Tatil.mov');
});
t('bos taban ad -> sadece numara', () => {
  const o = { ...baseOpts, base: '', pad: '2' };
  assert.strictEqual(C.computeNumber(F('a', '.jpg'), 0, 5, o), '01.jpg');
});
t('uzanti her zaman korunur', () => {
  assert.ok(C.computeNumber(F('a', '.HEIC'), 0, 1, baseOpts).endsWith('.HEIC'));
});

console.log('computeAdd');
t('on ek + son ek, uzantiya dokunmaz', () => {
  const o = { prefix: '2024_', suffix: '_edit' };
  assert.strictEqual(C.computeAdd(F('IMG1234', '.jpg'), o), '2024_IMG1234_edit.jpg');
});
t('bos ekler -> degisiklik yok', () => {
  assert.strictEqual(C.computeAdd(F('a', '.jpg'), { prefix: '', suffix: '' }), 'a.jpg');
});

console.log('computeReplace');
t('tum gecisleri degistir (duyarsiz)', () => {
  const o = { find: 'img', repWith: 'foto', repCase: false, repExt: false };
  assert.strictEqual(C.computeReplace(F('IMG_img_x', '.jpg'), o), 'foto_foto_x.jpg');
});
t('buyuk/kucuk harf duyarli', () => {
  const o = { find: 'IMG', repWith: 'F', repCase: true, repExt: false };
  assert.strictEqual(C.computeReplace(F('IMG_img', '.jpg'), o), 'F_img.jpg');
});
t('uzanti haric varsayilan (nokta uzantida kalir)', () => {
  const o = { find: '.', repWith: '-', repCase: false, repExt: false };
  assert.strictEqual(C.computeReplace(F('a.b.c', '.jpg'), o), 'a-b-c.jpg');
});
t('ozel regex karakteri literal islenir', () => {
  const o = { find: '(1)', repWith: '_1', repCase: false, repExt: false };
  assert.strictEqual(C.computeReplace(F('foto(1)', '.png'), o), 'foto_1.png');
});

console.log('\n' + pass + ' test gecti' + (process.exitCode ? ' (HATA var)' : ''));
