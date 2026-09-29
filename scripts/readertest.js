/*
 * The handwriting reader, without spending anything: the decision rules, the image it sends, and
 * a whole read run on a file store with a stand-in for Claude that records what it was given.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');
const { execSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, '.test-build');
execSync('npx tsc -p server/tsconfig.json --outDir ' + JSON.stringify(out), { cwd: root, stdio: 'inherit' });
const { decide } = require(path.join(out, 'reader', 'decide.js'));
const { inkToPng, inkHash } = require(path.join(out, 'reader', 'render.js'));
const { catalogueText, costRupees } = require(path.join(out, 'reader', 'claude.js'));
const { readPending } = require(path.join(out, 'reader', 'index.js'));
const { createFileRepo } = require(path.join(out, 'store', 'file.js'));

let failed = 0;
let passed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail !== undefined ? '  -> ' + detail : ''));
  }
}
const eq = (name, got, want) => check(name, got === want, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));

const masala = { id: 'it_m', nameEn: 'Shahi Biriyani Masala', nameKn: 'ಶಾಹಿ ಬಿರಿಯಾನಿ ಮಸಾಲ', units: [{ code: 'pc', label: 'Pack', labelKn: '', perBase: 1, price: 90, cost: 75 }], aliases: [], racks: {}, reorderAt: {}, active: true, updatedAt: 'a' };
const parle = { id: 'it_p', nameEn: 'Parle-G', nameKn: 'ಪಾರ್ಲೆ', units: [{ code: 'pc', label: 'pc', labelKn: '', perBase: 1, price: 5 }, { code: 'pack', label: 'Pack', labelKn: '', perBase: 24, price: 110 }], aliases: [{ text: 'parle pack', unit: 'pack' }], racks: {}, reorderAt: {}, active: true, updatedAt: 'a' };
const R = (x) => ({ readText: 'x', confidence: 0.95, alternatives: [], by: 'reader', at: '', ...x });

// ---------------------------------------------------------------- decide
{
  const ok = decide(R({ itemId: 'it_m', unit: 'pc', qty: 1 }), { qty: 1, rate: 90 }, masala);
  check('sure, right price: moves stock by itself', ok.auto === true && ok.baseQty === 1);
  eq('sure but ₹1000 for a ₹90 pack: asks', decide(R({ itemId: 'it_m', unit: 'pc', qty: 1 }), { qty: 1, rate: 1000 }, masala).reason, 'price');
  check('within 15% of the price is fine (bargaining)', decide(R({ itemId: 'it_m', unit: 'pc' }), { qty: 1, rate: 80 }, masala).auto === true);
  eq('not sure enough: asks', decide(R({ itemId: 'it_m', confidence: 0.84 }), { qty: 1, rate: 90 }, masala).reason, 'unsure');
  eq('no item: asks', decide(R({}), { qty: 1, rate: 90 }, undefined).reason, 'no-item');
  eq('a stopped item: asks', decide(R({ itemId: 'it_m' }), { qty: 1, rate: 90 }, { ...masala, active: false }).reason, 'inactive');
  eq('a unit the item does not have: asks', decide(R({ itemId: 'it_p', unit: 'box' }), { qty: 1, rate: 5 }, parle).reason, 'unit');
  eq('read 3, billed 2: asks', decide(R({ itemId: 'it_m', qty: 3 }), { qty: 2, rate: 90 }, masala).reason, 'qty');
  const pk = decide(R({ itemId: 'it_p', unit: 'pack', qty: 2 }), { qty: 2, rate: 110 }, parle);
  check('2 packs read and priced as packs: 48 pieces', pk.auto === true && pk.baseQty === 48 && pk.unit === 'pack');
  eq('read as a pack but priced as pieces: asks', decide(R({ itemId: 'it_p', unit: 'pack', qty: 2 }), { qty: 2, rate: 5 }, parle).reason, 'price');
}

// ---------------------------------------------------------------- the image
{
  const ink = { w: 300, h: 80, strokes: [[10, 10, 200, 60, 280, 20], [50, 50]] };
  const { png, width, height } = inkToPng(ink);
  check('a PNG', png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));
  eq('96 dots tall', height, 96);
  eq('the header says so', png.readUInt32BE(20), 96);
  check('as wide as the writing, in proportion', width > 250 && width < 500, String(width));
  const idatAt = png.indexOf('IDAT');
  const len = png.readUInt32BE(idatAt - 4);
  const raw = zlib.inflateSync(png.subarray(idatAt + 4, idatAt + 4 + len));
  eq('decodes to every row', raw.length, (width + 1) * height);
  const black = [...raw].filter((v, i) => i % (width + 1) !== 0 && v === 0).length;
  check('with ink on it, and mostly paper', black > 200 && black < width * height * 0.3, String(black));
  eq('the same writing has the same hash', inkHash(ink), inkHash(JSON.parse(JSON.stringify(ink))));
  check('different writing, a different hash', inkHash(ink) !== inkHash({ ...ink, strokes: [[1, 2, 3, 4]] }));
  const cat = catalogueText([masala, parle, { ...parle, id: 'gone', active: false }]);
  check('the catalogue has both scripts and units', cat.includes('ಶಾಹಿ ಬಿರಿಯಾನಿ ಮಸಾಲ') && cat.includes('pack=24pc ₹110'));
  check('but never costs', !cat.includes('75'));
  check('and not stopped items', !cat.includes('gone'));
  eq('cost: 1000 in + 100 out at ₹86', costRupees({ inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0 }, 86), 0.52);
}

// ---------------------------------------------------------------- a read run
async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-reader-'));
  try {
    const repo = await createFileRepo(dir);
    await repo.saveLocation({ id: 'shop', name: 'Shop', nameKn: '', kind: 'shop', active: true });
    await repo.saveItem(masala);
    await repo.saveItem(parle);
    const ink = (n) => ({ w: 100, h: 50, strokes: [[n, 1, n + 5, 9]] });
    const line = (i, x) => ({ i, name: '', qty: 1, rate: 90, amount: 90, state: 'to-confirm', ...x });
    await repo.putDoc('bills', {
      id: '7', no: 7, at: new Date().toISOString(), customer: { key: '9876543210', name: 'Secret Customer', phone: '9876543210' }, total: 9999, paid: 0, balance: 9999,
      lines: [
        line(0, { ink: ink(1) }), // sure, right price
        line(1, { ink: ink(2), rate: 1000, amount: 1000 }), // sure, wrong price
        line(2, { ink: ink(3), qty: 2, rate: 110, amount: 220 }), // parle pack
        line(3, { ink: ink(4) }), // reader throws
        line(4, { name: 'typed thing' }), // no ink: not the reader's
      ],
    });
    const seen = [];
    const answers = {
      1: { readText: '1 shahi biriyani masala', itemId: 'it_m', unit: 'pc', qty: 1, confidence: 0.93, alternatives: [] },
      2: { readText: 'shahi masala', itemId: 'it_m', unit: 'pc', qty: 1, confidence: 0.95, alternatives: [{ itemId: 'it_p', confidence: 0.02 }, { itemId: 'nope', confidence: 0.01 }] },
      3: { readText: 'parle pack 2', itemId: 'it_p', unit: 'pack', qty: 2, confidence: 0.9, alternatives: [] },
    };
    const fn = async (ink, ctx) => {
      seen.push(JSON.stringify(ctx));
      const n = ink.strokes[0][0];
      if (n === 4) throw new Error('network');
      return { reading: answers[n], inputTokens: 2000, outputTokens: 150, cacheReadTokens: 0, refused: false };
    };
    const r = await readPending(repo, fn);
    eq('three lines read (one failed and waits)', r.read, 3);
    eq('two moved stock by themselves', r.auto, 2);
    eq('one asks a person', r.queued, 1);
    const b = await repo.getDoc('bills', '7');
    eq('the sure one is read-auto', b.lines[0].state, 'read-auto');
    eq('the ₹1000 one waits', b.lines[1].state, 'to-confirm');
    check('with its reading kept, for the one-tap confirm', b.lines[1].reading.readText === 'shahi masala');
    check('alternatives that are not items are dropped', b.lines[1].reading.alternatives.length === 1);
    eq('parle pack 2 is 48 pieces', b.lines[2].baseQty, 48);
    check('the line that failed waits, unread, to be tried again', b.lines[3].state === 'to-confirm' && !b.lines[3].reading);
    const levels = await repo.listStock();
    eq('masala down by 1', levels.find((s) => s.itemId === 'it_m').qty, -1);
    eq('parle down by 48', levels.find((s) => s.itemId === 'it_p').qty, -48);
    check('nothing about the customer reaches the reader', seen.every((s) => !s.includes('Secret') && !s.includes('9876543210') && !s.includes('9999')));

    const again = await readPending(repo, fn);
    eq('a second run reads only what is left (the failed line)', again.read, 0);
    const meta = (await repo.getDoc('meta', 'status')).reader;
    eq('lines counted for the month', meta.monthLines, 3);
    check('and their cost', meta.monthCostRupees > 0, String(meta.monthCostRupees));

    // The monthly limit.
    await repo.putDoc('meta', { id: 'status', reader: { ...meta, monthCostRupees: 10_000 } });
    const b2 = await repo.getDoc('bills', '7');
    b2.lines[3].ink = ink(1); // readable now
    await repo.putDoc('bills', b2);
    const capped = await readPending(repo, fn);
    eq('over the limit, nothing is read', capped.skipped, 'cap');
    eq('and nothing sent', capped.read, 0);

    // No reader at all.
    const none = await readPending(repo, null);
    eq('without a key, lines wait for a person', none.skipped, 'no-reader');
    check('and the admin is told why', /No reader key/.test((await repo.getDoc('meta', 'status')).reader.message));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

run()
  .catch((err) => {
    failed++;
    console.log('FAIL threw: ' + err.stack);
  })
  .finally(() => {
    console.log('readertest: ' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
