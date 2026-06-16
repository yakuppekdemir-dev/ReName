'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renameBatch, checkConflicts } = require('../src/renamer.js');

let pass = 0;
async function t(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-test-'));
  try {
    await fn(dir);
    pass++;
    console.log('  ok  ' + name);
  } catch (e) {
    console.error('  FAIL ' + name + '\n      ' + (e.stack || e.message));
    process.exitCode = 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const write = (dir, name, data) => fs.writeFileSync(path.join(dir, name), data);
const read = (dir, name) => fs.readFileSync(path.join(dir, name), 'utf8');
const exists = (dir, name) => fs.existsSync(path.join(dir, name));
const op = (dir, oldName, newBase) => ({
  oldPath: path.join(dir, oldName), dir, ext: path.extname(oldName), newBase
});

(async () => {
  console.log('renameBatch');

  await t('basit toplu yeniden adlandirma', async (dir) => {
    write(dir, 'IMG_1.jpg', 'a');
    write(dir, 'IMG_2.jpg', 'b');
    const res = await renameBatch([op(dir, 'IMG_1.jpg', 'Tatil 1.jpg'), op(dir, 'IMG_2.jpg', 'Tatil 2.jpg')]);
    assert.strictEqual(res.ok, true);
    assert.ok(exists(dir, 'Tatil 1.jpg') && exists(dir, 'Tatil 2.jpg'));
    assert.ok(!exists(dir, 'IMG_1.jpg'));
    assert.strictEqual(read(dir, 'Tatil 1.jpg'), 'a'); // icerik dogru dosyada
  });

  await t('a<->b takasi (iki asama sayesinde cakismadan)', async (dir) => {
    write(dir, 'a.txt', 'AAA');
    write(dir, 'b.txt', 'BBB');
    const res = await renameBatch([op(dir, 'a.txt', 'b.txt'), op(dir, 'b.txt', 'a.txt')]);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(read(dir, 'a.txt'), 'BBB'); // icerikler yer degistirdi
    assert.strictEqual(read(dir, 'b.txt'), 'AAA');
  });

  await t('dongusel kaydirma a->b->c->a', async (dir) => {
    write(dir, 'a.txt', 'A');
    write(dir, 'b.txt', 'B');
    write(dir, 'c.txt', 'C');
    const res = await renameBatch([
      op(dir, 'a.txt', 'b.txt'), op(dir, 'b.txt', 'c.txt'), op(dir, 'c.txt', 'a.txt')
    ]);
    assert.strictEqual(res.ok, true);
    assert.strictEqual(read(dir, 'b.txt'), 'A');
    assert.strictEqual(read(dir, 'c.txt'), 'B');
    assert.strictEqual(read(dir, 'a.txt'), 'C');
  });

  await t('cakisma: hedef diskte zaten var (secimde degil)', async (dir) => {
    write(dir, 'x.jpg', 'x');
    write(dir, 'engel.jpg', 'mevcut'); // secime dahil degil
    const res = await renameBatch([op(dir, 'x.jpg', 'engel.jpg')]);
    assert.strictEqual(res.ok, false);
    assert.ok(res.conflicts && res.conflicts[0].reason === 'exists');
    assert.strictEqual(read(dir, 'engel.jpg'), 'mevcut'); // dokunulmadi
    assert.ok(exists(dir, 'x.jpg'));
  });

  await t('cakisma: iki dosya ayni hedef ada', async (dir) => {
    write(dir, '1.jpg', '1');
    write(dir, '2.jpg', '2');
    const res = await renameBatch([op(dir, '1.jpg', 'ayni.jpg'), op(dir, '2.jpg', 'ayni.jpg')]);
    assert.strictEqual(res.ok, false);
    assert.ok(res.conflicts.some((c) => c.reason === 'duplicate'));
    assert.ok(exists(dir, '1.jpg') && exists(dir, '2.jpg')); // hicbiri degismedi
  });

  await t('sadece buyuk/kucuk harf degisimi engellenmez', async (dir) => {
    write(dir, 'Foto.JPG', 'z');
    const conflicts = await checkConflicts([op(dir, 'Foto.JPG', 'foto.jpg')]);
    assert.strictEqual(conflicts.length, 0); // kendisiyle cakisma sayilmaz
  });

  await t('gecici dosya birakmaz', async (dir) => {
    write(dir, 'p.png', 'p');
    await renameBatch([op(dir, 'p.png', 'yeni.png')]);
    const leftovers = fs.readdirSync(dir).filter((n) => n.startsWith('.renametmp-'));
    assert.strictEqual(leftovers.length, 0);
  });

  console.log('\n' + pass + ' test gecti' + (process.exitCode ? ' (HATA var)' : ''));
})();
