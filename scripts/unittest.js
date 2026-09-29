/*
 * The pure rules: prices, units, CSV, item checks, search, the stock posting and reconcile.
 * Run after `npm run build:core` (npm test does that).
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execSync } = require('node:child_process');

const C = require('../core/dist/cjs');

let failed = 0;
let passed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail !== undefined ? '  -> ' + detail : ''));
  }
}

// ---------------------------------------------------------------- the shop's own examples
const parle = {
  units: [
    { code: 'pc', label: 'Piece', labelKn: 'ಪೀಸ್', perBase: 1, price: 5, min: 5, max: 5.5 },
    { code: 'pack', label: 'Pack', labelKn: 'ಪ್ಯಾಕ್', perBase: 24, price: 110 },
    { code: 'box', label: 'Box', labelKn: 'ಬಾಕ್ಸ್', perBase: 144, price: 640 },
  ],
};
const clinic = {
  units: [
    { code: 'pc', label: 'Piece', labelKn: '', perBase: 1, price: 2 },
    { code: 'line', label: 'Line', labelKn: 'ಲೈನ್', perBase: 16, price: 30, slabs: [{ minQty: 5, rate: 28 }, { minQty: 10, rate: 26 }] },
  ],
};
const rice = { units: [{ code: 'kg', label: 'Kg', labelKn: '', perBase: 1, price: 55, slabs: [{ minQty: 10, rate: 52 }] }, { code: 'bag', label: 'Bag', labelKn: '', perBase: 25, price: 1250 }] };

{
  const p = C.priceFor(parle, 'pack', 1);
  check('a pack of Parle-G is ₹110, not 24 × ₹5', p.amount === 110 && p.baseQty === 24, JSON.stringify(p));
  const two = C.priceFor(parle, 'pack', 2);
  check('2 packs are 48 pieces and ₹220', two.baseQty === 48 && two.amount === 220);
  check('a box is 144 pieces', C.toBase(parle, 'box', 1) === 144);
  check('a box is 6 packs', C.fromBase(parle, 'pack', C.toBase(parle, 'box', 1)) === 6);
  check('unit codes ignore case', C.toBase(parle, 'BOX', 1) === 144);
  check('150 pieces read as a box and 6 pieces', C.describeQty(parle, 150) === '1 box 6 pc', C.describeQty(parle, 150));
  check('30 pieces read as a pack and 6', C.describeQty(parle, 30) === '1 pack 6 pc');
  check('in Kannada the labels are Kannada', C.describeQty(parle, 24, 'kn') === '1 ಪ್ಯಾಕ್');
  check('below zero keeps its sign', C.describeQty(parle, -30) === '-1 pack 6 pc');
  check('nothing is 0 of the base', C.describeQty(parle, 0) === '0 pc');
  check('a half kilo stays a half kilo', C.describeQty(rice, 12.5) === '12.5 kg', C.describeQty(rice, 12.5));
  check('26 kg of rice is a bag and a kilo', C.describeQty(rice, 26) === '1 bag 1 kg');
}
{
  check('4 lines of Clinic Plus at the line price', C.priceFor(clinic, 'line', 4).rate === 30);
  check('5 lines reach the 28 slab', C.priceFor(clinic, 'line', 5).rate === 28);
  check('6 lines are ₹168', C.priceFor(clinic, 'line', 6).amount === 168);
  check('10 lines reach the 26 slab, the highest one reached', C.priceFor(clinic, 'line', 10).rate === 26);
  check('a piece has no slab', C.priceFor(clinic, 'pc', 50).rate === 2);
  check('12 kg of rice is ₹624', C.priceFor(rice, 'kg', 12).amount === 624);
  check('9 kg is still the plain price', C.priceFor(rice, 'kg', 9).rate === 55);
  let threw = false;
  try {
    C.priceFor(parle, 'crate', 1);
  } catch {
    threw = true;
  }
  check('a unit the item does not have is refused', threw);
}
{
  const pc = parle.units[0];
  check('a rate under the lowest is flagged low', C.rateRange(pc, 4.5) === 'low');
  check('a rate over the highest is flagged high', C.rateRange(pc, 6) === 'high');
  check('a rate in the range is fine', C.rateRange(pc, 5.25) === null);
  check('no range, no flag', C.rateRange(parle.units[1], 1) === null);
  check('rupees without float dust', C.round2(0.1 + 0.2) === 0.3 && C.formatRupees(110) === '₹110' && C.formatRupees(5.5) === '₹5.50');
}

// ---------------------------------------------------------------- item checks
{
  const good = {
    nameEn: ' Parle-G ',
    nameKn: 'ಪಾರ್ಲೆ ಜಿ',
    units: [
      { code: 'pc', label: '', labelKn: '', perBase: 1, price: '5' },
      { code: 'pack', label: 'Pack', labelKn: '', perBase: '24', price: '110', slabs: [{ minQty: 10, rate: 105 }, { minQty: 5, rate: 108 }] },
    ],
    aliases: [{ text: 'parle' }, { text: 'parle pack', unit: 'pack' }, { text: 'Parle' }],
    racks: { loc_shop: ' Rack 3 ', loc_x: '' },
    reorderAt: { loc_shop: '48' },
  };
  const r = C.checkItem(good);
  check('a good item passes', r.ok, r.ok ? '' : r.error);
  if (r.ok) {
    check('names are trimmed', r.value.nameEn === 'Parle-G');
    check('a blank unit label falls back to the code', r.value.units[0].label === 'pc');
    check('numbers typed as text become numbers', r.value.units[1].perBase === 24 && r.value.units[1].price === 110);
    check('slabs come out in order', r.value.units[1].slabs[0].minQty === 5);
    check('a repeated other name is kept once', r.value.aliases.length === 2);
    check('empty racks are dropped and full ones trimmed', r.value.racks.loc_shop === 'Rack 3' && !('loc_x' in r.value.racks));
    check('levels become numbers', r.value.reorderAt.loc_shop === 48);
  }
  const bad = (patch, name) => {
    const res = C.checkItem({ ...good, ...patch });
    check(name, !res.ok, res.ok ? 'passed' : '');
  };
  bad({ nameEn: '', nameKn: '' }, 'an item with no name is refused');
  bad({ units: [] }, 'an item with no unit is refused');
  bad({ units: [good.units[0], { ...good.units[1], code: 'PC' }] }, 'the same unit code twice is refused, whatever the case');
  bad({ units: [good.units[0], { ...good.units[1], perBase: 2.5 }] }, 'a unit holding 2.5 base units is refused');
  bad({ units: [good.units[0], { ...good.units[1], perBase: 0 }] }, 'a unit holding 0 is refused');
  bad({ units: [{ ...good.units[0], perBase: 24 }] }, 'a base unit that is not 1 of itself is refused');
  bad({ units: [{ ...good.units[0], price: '' }] }, 'a unit with no price is refused');
  bad({ units: [{ ...good.units[0], price: -1 }] }, 'a negative price is refused');
  bad({ units: [{ ...good.units[0], min: 6, max: 5 }] }, 'a lowest rate above the highest is refused');
  bad({ units: [{ ...good.units[0], slabs: [{ minQty: 5, rate: 4 }, { minQty: 5, rate: 3 }] }] }, 'two slabs from the same quantity are refused');
  bad({ aliases: [{ text: 'parle crate', unit: 'crate' }] }, 'an other name pointing at a missing unit is refused');
  bad({ reorderAt: { loc_shop: -1 } }, 'a negative running-out level is refused');
}

// ---------------------------------------------------------------- search, both scripts
{
  const item = { nameEn: 'Sona Masoori Rice', nameKn: 'ಅಕ್ಕಿ', aliases: [{ text: 'ಸೋನಾ' }] };
  check('English start of a word finds it', C.itemMatches(item, 'masoo'));
  check('Kannada typed in English finds it', C.itemMatches(item, 'akki'));
  check('Kannada finds it', C.itemMatches(item, 'ಅಕ್ಕಿ'));
  check('an other name finds it', C.itemMatches(item, 'sona'));
  check('the middle of a word does not', !C.itemMatches(item, 'soori'));
  check('an empty search finds nothing', !C.itemMatches(item, '  '));
}

// ---------------------------------------------------------------- CSV
{
  const csv = C.toCsv(['a', 'b', 'c'], [['=SUM(A1)', -5, 'x, "y"'], ['ಅಕ್ಕಿ', 2.5, null]]);
  check('a CSV starts with a byte-order mark for Excel', csv.charCodeAt(0) === 0xfeff);
  check('lines end CRLF', csv.includes('\r\n'));
  check('a formula is shown as text', csv.includes("'=SUM(A1)"));
  check('a negative number is left alone', csv.includes(',-5,'));
  check('commas and quotes are quoted', csv.includes('"x, ""y"""'));
  const back = C.parseCsv(csv);
  check('it reads back', back.length === 3 && back[1][2] === 'x, "y"' && back[2][0] === 'ಅಕ್ಕಿ', JSON.stringify(back));
  check('and the guard comes off on the way in', C.unguard(back[1][0]) === '=SUM(A1)');
  check('quoted newlines survive', C.parseCsv('a,b\r\n"one\ntwo",3\r\n')[1][0] === 'one\ntwo');
  check('blank spreadsheet rows are dropped', C.parseCsv('a\r\n\r\n,\r\nb\r\n').length === 2);
}
{
  const items = [
    {
      id: 'it_1',
      nameEn: 'Parle-G',
      nameKn: 'ಪಾರ್ಲೆ ಜಿ',
      category: 'Biscuits',
      units: [
        { code: 'pc', label: 'Piece', labelKn: 'ಪೀಸ್', perBase: 1, price: 5, min: 5, max: 5.5, cost: 4.2 },
        { code: 'pack', label: 'Pack', labelKn: 'ಪ್ಯಾಕ್', perBase: 24, price: 110, slabs: [{ minQty: 5, rate: 108 }, { minQty: 10, rate: 105 }] },
      ],
      aliases: [{ text: 'parle' }, { text: 'parle pack', unit: 'pack' }],
      racks: { loc_shop: 'Rack 3' },
      reorderAt: { loc_shop: 48 },
      active: true,
      updatedAt: '',
    },
  ];
  const text = C.itemsToCsv(items, 'loc_shop');
  const back = C.itemsFromCsv(text, 'loc_shop');
  check('the items file reads back with no errors', back.errors.length === 0, JSON.stringify(back.errors));
  const it = back.items[0];
  check('one item with both units', back.items.length === 1 && it.units.length === 2);
  check('Kannada survives the round trip', it.nameKn === 'ಪಾರ್ಲೆ ಜಿ' && it.units[1].labelKn === 'ಪ್ಯಾಕ್');
  check('slabs survive', JSON.stringify(it.units[1].slabs) === JSON.stringify(items[0].units[1].slabs));
  check('range and cost survive', it.units[0].min === 5 && it.units[0].max === 5.5 && it.units[0].cost === 4.2);
  check('other names keep their unit', JSON.stringify(it.aliases) === JSON.stringify(items[0].aliases), JSON.stringify(it.aliases));
  check('the shop rack and level survive', it.racks.loc_shop === 'Rack 3' && it.reorderAt.loc_shop === 48);
  check('the row of each item is known', back.rows[0] === 2);

  const typed = [
    'name_en,name_kn,unit_code,per_base,price,slabs',
    'Clinic Plus,,pc,,2,',
    ',,line,16,30,5:28',
    'Rice,ಅಕ್ಕಿ,kg,,55,10:52',
    'Broken,,box,,,',
    'Sugar,,kg,,x,1-2',
  ].join('\n');
  const r = C.itemsFromCsv(typed, 'loc_shop');
  check('a spreadsheet typed by hand groups units under the item above', r.items[0].units.length === 2 && r.items[0].units[1].perBase === 16);
  check('a bad slab is reported with its row', r.errors.some((e) => e.row === 6), JSON.stringify(r.errors));
  const broken = C.checkItem(r.items[2]);
  check('a row with no price is caught by the item check', !broken.ok);
  check('a file with no price column is refused', C.itemsFromCsv('name_en,unit_code\nA,pc', 'x').errors[0].row === 1);
}

// ---------------------------------------------------------------- roles
check('a PIN is 4 to 6 digits', C.checkPin('1234') === null && C.checkPin('123456') === null && C.checkPin('123') && C.checkPin('12a4') && C.checkPin('1234567'));
check('every role has a home screen', C.ROLES.every((r) => typeof C.ROLE_HOME[r] === 'string'));

// ---------------------------------------------------------------- Kannada strings
{
  const { STRINGS } = C;
  const en = Object.keys(STRINGS.en);
  const kn = STRINGS.kn;
  const missing = en.filter((k) => !kn[k] || !kn[k].trim());
  check('every string has Kannada', missing.length === 0, missing.join(', '));
  const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
  const mismatched = en.filter((k) => vars(STRINGS.en[k]) !== vars(kn[k]));
  check('Kannada keeps every {placeholder}', mismatched.length === 0, mismatched.join(', '));
}

// ---------------------------------------------------------------- refill trips
{
  const L = (id, kind) => ({ id, name: id, nameKn: '', kind, active: true });
  const locs = [L('shop', 'shop'), L('g1', 'godown'), L('g2', 'godown')];
  const it = (id, reorder) => ({ id, nameEn: id, nameKn: '', units: [{ code: 'pc', label: 'pc', labelKn: '', perBase: 1, price: 1 }], aliases: [], racks: {}, reorderAt: { shop: reorder }, active: true, updatedAt: '' });
  const items = [it('a', 10), it('b', 10), it('c', 10), it('d', 10), it('e', 10)];
  const st = (itemId, locationId, qty) => ({ itemId, locationId, qty });
  const stock = [
    st('a', 'shop', 4), st('a', 'g1', 100), st('a', 'g2', 5),
    st('b', 'shop', 2), st('b', 'g1', 3),
    st('c', 'shop', 50), st('c', 'g1', 100),
    st('d', 'shop', -2),
    st('e', 'shop', 1), st('e', 'g2', 40),
  ];
  const r = C.proposeRefill(items, stock, locs);
  const trip = (g) => r.trips.find((t) => t.from === g);
  check('low items from one godown make one trip', trip('g1') && trip('g1').lines.map((l) => l.itemId).join() === 'a,b', JSON.stringify(r.trips));
  check('the godown with the most is chosen', trip('g1').lines[0].itemId === 'a' && !trip('g2').lines.some((l) => l.itemId === 'a'));
  check('topped up to twice the level', trip('g1').lines[0].qty === 16);
  check('never more than the godown has', trip('g1').lines[1].qty === 3);
  check('what is still short is to buy', r.buy.some((b) => b.itemId === 'b' && b.qty === 15));
  check('an item no godown has is to buy, from below zero', r.buy.some((b) => b.itemId === 'd' && b.qty === 22));
  check('an item that is not low is left alone', !r.trips.some((t) => t.lines.some((l) => l.itemId === 'c')));
  check('the busiest trip comes first', r.trips[0].from === 'g1');
  check('no shop, no trips', C.proposeRefill(items, stock, [L('g1', 'godown')]).trips.length === 0);
}

// ---------------------------------------------------------------- handwriting drawn on screen
{
  const ink = { w: 100, h: 40, strokes: [[10, 10, 20, 30, 40, 20], [50, 5], []] };
  const d = C.inkPath(ink);
  check('a stroke becomes a path', d.startsWith('M10 10L20 30L40 20'), d);
  check('a single tap is still a visible dot', d.includes('M50 5l0.01 0'));
  const b = C.inkBounds(ink);
  check('the writing\'s box is found', b.minX === 10 && b.maxX === 50 && b.minY === 5 && b.maxY === 30, JSON.stringify(b));
  check('empty ink is not writing', !C.hasInk({ w: 1, h: 1, strokes: [[]] }) && C.hasInk(ink));
}

// ---------------------------------------------------------------- posting and reconcile (server code, file store)
async function ledger() {
  const out = path.join(__dirname, '..', '.test-build');
  execSync('npx tsc -p server/tsconfig.json --outDir ' + JSON.stringify(out), { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  const { createFileRepo } = require(path.join(out, 'store', 'file.js'));
  const { post, reconcile } = require(path.join(out, 'posting.js'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-unit-'));
  try {
    const repo = await createFileRepo(dir);
    const mv = (key, kind, qty, extra) => ({ id: key, key, at: new Date().toISOString(), kind, itemId: 'it_1', qty, ref: '', by: 'p', ...extra });
    await post(repo, [mv('open:1', 'open', 100, { to: 'shop' })]);
    const again = await post(repo, [mv('open:1', 'open', 100, { to: 'shop' })]);
    check('the same key posted twice moves stock once', again.length === 0);
    await post(repo, [mv('x:1', 'transfer_out', 30, { from: 'shop', to: 'godown' })]);
    await post(repo, [mv('s:1', 'sale', 90, { from: 'shop' })]);
    const levels = await repo.listStock();
    const q = (loc) => levels.find((l) => l.locationId === loc)?.qty;
    check('a transfer takes from one place and gives to another', q('godown') === 30);
    check('stock may go below zero', q('shop') === -20, String(q('shop')));
    await post(repo, [mv('z:1', 'sale', 0, { from: 'shop' })]);
    check('a move of nothing is not recorded', (await repo.listMoves({})).length === 3);

    await repo.setStock('it_1', 'shop', 999);
    await repo.setStock('it_1', 'nowhere', 5);
    const r = await reconcile(repo);
    check('reconcile finds a tampered number and a stray one', r.fixed.length === 2, JSON.stringify(r.fixed));
    const after = await repo.listStock();
    check('and puts them back to the ledger', after.find((l) => l.locationId === 'shop').qty === -20 && after.find((l) => l.locationId === 'nowhere').qty === 0);
    check('a second reconcile has nothing to fix', (await reconcile(repo)).fixed.length === 0);

    const repo2 = await createFileRepo(dir);
    check('the file store keeps it all across a restart', (await repo2.listMoves({})).length === 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

ledger()
  .catch((err) => {
    failed++;
    console.log('FAIL ledger tests threw: ' + err.stack);
  })
  .finally(() => {
    console.log('unittest: ' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed ? 1 : 0);
  });
