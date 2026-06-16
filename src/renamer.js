'use strict';

/* =====================================================================
   Iki asamali toplu yeniden adlandirma (dosya sistemini degistirir).
   main.js bunu kullanir; test/renamer.test.js gercek dosyalarla dener.
===================================================================== */

const path = require('path');
const fsp = require('fs').promises;

const CASE_INSENSITIVE = process.platform === 'darwin' || process.platform === 'win32';

// Karsilastirma anahtari (mac/win buyuk-kucuk harf duyarsiz)
function ciKey(p) {
  const r = path.resolve(p);
  return CASE_INSENSITIVE ? r.toLowerCase() : r;
}

/**
 * Cakisma kontrolu.
 * ops: [{ oldPath, dir, ext, newBase }]
 * Doner: cakisma listesi (bos ise sorun yok)
 */
async function checkConflicts(ops) {
  const sourceSet = new Set(ops.map((o) => ciKey(o.oldPath)));
  const finalSet = new Set();
  const conflicts = [];

  for (const op of ops) {
    const finalPath = path.join(op.dir, op.newBase);
    const key = ciKey(finalPath);

    if (finalSet.has(key)) {
      conflicts.push({ newBase: op.newBase, reason: 'duplicate' });
      continue;
    }
    finalSet.add(key);

    // Hedef, secili kaynaklardan biri degilse ve diskte zaten varsa -> cakisma.
    // (Sadece buyuk/kucuk harf degisimi kaynak kumesinde sayilir, engellenmez.)
    if (!sourceSet.has(key)) {
      try {
        await fsp.access(finalPath);
        conflicts.push({ newBase: op.newBase, reason: 'exists' });
      } catch (_) {
        /* yok, sorun degil */
      }
    }
  }
  return conflicts;
}

/**
 * Iki asamali tasima: once herkesi gecici ada, sonra hedef ada.
 * Bu sayede a<->b takasinda bile cakisma olmaz.
 * Hata olursa yapilan tum islemler geri sarilir.
 */
async function renameBatch(ops) {
  const conflicts = await checkConflicts(ops);
  if (conflicts.length) return { ok: false, conflicts };

  const stamp = Date.now();
  const staged = []; // { op, tempPath, finalized }
  try {
    // 1. asama: gecici adlar
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const tempPath = path.join(
        op.dir,
        '.renametmp-' + process.pid + '-' + stamp + '-' + i + (op.ext || '')
      );
      await fsp.rename(op.oldPath, tempPath);
      staged.push({ op, tempPath, finalized: false });
    }
    // 2. asama: hedef adlar
    const results = [];
    for (const s of staged) {
      const finalPath = path.join(s.op.dir, s.op.newBase);
      await fsp.rename(s.tempPath, finalPath);
      s.finalized = true;
      results.push({ from: s.op.oldPath, to: finalPath, dir: s.op.dir, ext: s.op.ext });
    }
    return { ok: true, results };
  } catch (err) {
    // Geri sarma (en iyi caba)
    for (const s of staged) {
      try {
        if (s.finalized) await fsp.rename(path.join(s.op.dir, s.op.newBase), s.op.oldPath);
        else await fsp.rename(s.tempPath, s.op.oldPath);
      } catch (_) {}
    }
    return { ok: false, error: err.message };
  }
}

module.exports = { renameBatch, checkConflicts };
