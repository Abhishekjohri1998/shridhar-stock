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
// ---------------------------------------------------------------- round off
{
  const r = (t, step) => JSON.stringify(C.roundOff(t, step));
  check('no rounding leaves the total alone', r(102.4, 0) === '{"rounded":102.4,"diff":0}', r(102.4, 0));
  check('to the rupee: 102.40 is 102, off by -0.40', r(102.4, 1) === '{"rounded":102,"diff":-0.4}', r(102.4, 1));
  check('to the rupee: 102.50 goes up to 103', r(102.5, 1) === '{"rounded":103,"diff":0.5}', r(102.5, 1));
  check('to ₹5: 102.50 is 105', r(102.5, 5) === '{"rounded":105,"diff":2.5}', r(102.5, 5));
  check('to ₹5: 1266 is 1265', r(1266, 5) === '{"rounded":1265,"diff":-1}', r(1266, 5));
  check('to ₹10: 1265 goes up to 1270', r(1265, 10) === '{"rounded":1270,"diff":5}', r(1265, 10));
  check('a round total has no round-off', r(110, 10) === '{"rounded":110,"diff":0}', r(110, 10));
  check('no floating dust: 0.1 + 0.2 to the rupee', r(0.1 + 0.2, 1) === '{"rounded":0,"diff":-0.3}', r(0.1 + 0.2, 1));
}

// ---------------------------------------------------------------- the worker's walk
{
  const lines = [
    { i: 0, place: 'Main godown', placeOrder: 1, rack: 'Bay A' },
    { i: 1, place: 'Shop', placeOrder: 0, rack: 'Rack 10' },
    { i: 2, rack: '' },
    { i: 3, place: 'Shop', placeOrder: 0, rack: 'Rack 2' },
    { i: 4, place: 'Shop', placeOrder: 0, rack: 'rack 2' },
    { i: 5, place: 'Shop', placeOrder: 0, rack: 'Counter' },
    { i: 6, place: 'Annex', placeOrder: 2, rack: 'Bay A' },
  ];
  const g = C.groupPick(lines);
  const order = g.map((x) => (x.other ? 'other' : x.place + ':' + x.rack)).join(' > ');
  check('shop racks first, in natural order, then godowns in order, then other', order === 'Shop:Counter > Shop:Rack 2 > Shop:Rack 10 > Main godown:Bay A > Annex:Bay A > other', order);
  check('"Rack 2" and "rack 2" are one rack', g[1].lines.map((l) => l.i).join() === '3,4');
  check('a line with no rack anywhere is in the last group', g[g.length - 1].other && g[g.length - 1].lines[0].i === 2);
  check('every line is in exactly one group', g.reduce((a, x) => a + x.lines.length, 0) === lines.length);
}

// ---------------------------------------------------------------- Excel files
{
  const enc = new TextEncoder();
  check('CRC32 of "123456789" is cbf43926', C.crc32(enc.encode('123456789')).toString(16) === 'cbf43926', C.crc32(enc.encode('123456789')).toString(16));
  check('CRC32 of nothing is 0', C.crc32(new Uint8Array(0)) === 0);
  const sheets = [
    { name: 'Shop', header: ['name', 'qty'], rows: [['Parle-G', 60], ['ಸಕ್ಕರೆ <&> "x"', -2.5], ['=HYPERLINK("x")', null]] },
    { name: 'Main/godown?', header: ['name'], rows: [['Bay A']] },
  ];
  const z = Buffer.from(C.toXlsx(sheets));
  // Read the ZIP back the way Excel does: from the end of central directory.
  const eocd = z.length - 22;
  check('the file ends with an end-of-central-directory record', z.readUInt32LE(eocd) === 0x06054b50);
  const count = z.readUInt16LE(eocd + 10);
  const cenSize = z.readUInt32LE(eocd + 12);
  const cenAt = z.readUInt32LE(eocd + 16);
  check('it lists 6 files (4 parts and 2 sheets)', count === 6, count);
  check('the central directory sits right before the end record', cenAt + cenSize === eocd);
  const files = {};
  let at = cenAt;
  let localHeaders = 0;
  for (let n = 0; n < count; n++) {
    check('central header ' + n + ' has its signature', z.readUInt32LE(at) === 0x02014b50);
    const crc = z.readUInt32LE(at + 16);
    const size = z.readUInt32LE(at + 24);
    const nameLen = z.readUInt16LE(at + 28);
    const extraLen = z.readUInt16LE(at + 30);
    const commentLen = z.readUInt16LE(at + 32);
    const off = z.readUInt32LE(at + 42);
    const name = z.toString('utf8', at + 46, at + 46 + nameLen);
    if (z.readUInt32LE(off) === 0x04034b50) localHeaders++;
    const dataAt = off + 30 + z.readUInt16LE(off + 26) + z.readUInt16LE(off + 28);
    const data = z.subarray(dataAt, dataAt + size);
    check(name + ' is stored, not compressed', z.readUInt16LE(off + 8) === 0);
    check(name + ' has the right CRC', C.crc32(data) === crc);
    files[name] = data.toString('utf8');
    at += 46 + nameLen + extraLen + commentLen;
  }
  check('every entry has its local header', localHeaders === count, localHeaders);
  const want = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'];
  check('with the parts Excel needs', want.every((w) => w in files), Object.keys(files).join());
  const s1 = files['xl/worksheets/sheet1.xml'] || '';
  check('text is an inline string', s1.includes('<c r="A2" t="inlineStr"><is><t xml:space="preserve">Parle-G</t></is></c>'));
  check('numbers are numbers', s1.includes('<c r="B2"><v>60</v></c>') && s1.includes('<c r="B3"><v>-2.5</v></c>'));
  check('Kannada and XML characters survive, escaped', s1.includes('ಸಕ್ಕರೆ &lt;&amp;&gt; &quot;x&quot;'));
  check('a formula is kept as text', s1.includes(">'=HYPERLINK(&quot;x&quot;)</t>"));
  check('an empty cell is left out', !s1.includes('r="B4"'));
  check('a sheet name Excel would refuse is cleaned', (files['xl/workbook.xml'] || '').includes('name="Main godown"'));
}

async function ledger() {
  const out = path.join(__dirname, '..', '.test-build');
  execSync('npx tsc -p server/tsconfig.json --outDir ' + JSON.stringify(out), { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  const { createFileRepo } = require(path.join(out, 'store', 'file.js'));
  const { post, reconcile } = require(path.join(out, 'posting.js'));
  const { pollDelay, POLL_BUSY_MS, POLL_IDLE_MS } = require(path.join(out, 'billing', 'sync.js'));
  {
    const now = Date.parse('2026-10-03T10:00:00Z');
    const ago = (min) => new Date(now - min * 60_000).toISOString();
    check('billing is read every 3 s while a bill is open', pollDelay([{ at: ago(2) }], 0, now) === POLL_BUSY_MS && POLL_BUSY_MS === 3000);
    check('and every 15 s when the shop is quiet', pollDelay([{ at: ago(30) }], 0, now) === POLL_IDLE_MS && POLL_IDLE_MS === 15000);
    check('a cancelled bill does not keep it busy', pollDelay([{ at: ago(2), cancelled: true }], 0, now) === POLL_IDLE_MS);
    check('a read that brought something new keeps it busy', pollDelay([], now - 60_000, now) === POLL_BUSY_MS);
    check('no bills at all is quiet', pollDelay([], 0, now) === POLL_IDLE_MS);
  }
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
