/*
 * The API end to end, against a real server process on the JSON file store in a temp folder.
 * Never a database: nothing here can reach the shop's data.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, execSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, '.test-build');
execSync('npx tsc -p server/tsconfig.json --outDir ' + JSON.stringify(out), { cwd: root, stdio: 'inherit' });

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

const ADMIN_PHONE = '9000000001';
const ADMIN_PIN = '4821';

function start(dataDir, port, extraEnv = {}) {
  const proc = spawn(process.execPath, [path.join(out, 'index.js')], {
    env: {
      ...process.env,
      MONGO_URI: '',
      PORT: String(port),
      DATA_DIR: dataDir,
      JWT_SECRET: 'apitest-secret',
      SEED_ADMIN_PHONE: ADMIN_PHONE,
      SEED_ADMIN_PIN: ADMIN_PIN,
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  proc.logs = () => log;
  return proc;
}

async function waitUp(base) {
  // Up to 30 s: a busy laptop (an APK build alongside) can take well over 10 to start node.
  for (let i = 0; i < 300; i++) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-api-'));
  const port = 4600 + Math.floor(Math.random() * 300);
  const base = 'http://localhost:' + port;
  let proc = start(dir, port);
  try {
    await waitUp(base);

    const call = async (p, { method = 'GET', body, token } = {}) => {
      const r = await fetch(base + '/api' + p, {
        method,
        headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      // Decoded by hand so a byte-order mark is kept, not silently eaten as fetch does.
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await r.arrayBuffer());
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* csv */
      }
      return { status: r.status, body: json, text };
    };
    const login = (phone, pin) => call('/auth/login', { method: 'POST', body: { phone, pin } });

    // ------------------------------------------------ signing in
    eq('health', (await call('/health')).body.storage, 'file');
    eq('a wrong PIN is refused', (await login(ADMIN_PHONE, '0000')).status, 401);
    const unknown = await login('9999999999', ADMIN_PIN);
    eq('an unknown phone gets the same answer', unknown.body.error, 'Wrong phone number or PIN');
    const ok = await login('+91 90000 00001', ADMIN_PIN);
    eq('the seeded admin signs in, with the phone written any way', ok.status, 200);
    const admin = ok.body.token;
    check('no PIN hash ever comes back', !JSON.stringify(ok.body).includes('scrypt'));
    eq('who am I', (await call('/me', { token: admin })).body.role, 'admin');
    eq('no token, no way in', (await call('/items')).status, 401);
    eq('a forged token is refused', (await call('/items', { token: admin.slice(0, -3) + 'abc' })).status, 401);

    for (let i = 0; i < 5; i++) await login('9111111111', '0000');
    eq('five wrong PINs lock that phone', (await login('9111111111', '0000')).status, 429);
    eq('but not someone else', (await login(ADMIN_PHONE, ADMIN_PIN)).status, 200);

    // ------------------------------------------------ places
    const locs = (await call('/locations', { token: admin })).body;
    check('the shop exists from the start', locs.length === 1 && locs[0].kind === 'shop');
    const shop = locs[0].id;
    const g = await call('/locations', { method: 'POST', token: admin, body: { name: 'Godown A', nameKn: 'ಗೋದಾಮು ಎ' } });
    eq('a godown is added', g.status, 201);
    const godown = g.body.id;
    eq('the shop cannot be switched off', (await call('/locations/' + shop, { method: 'PUT', token: admin, body: { name: 'Shop', active: false } })).status, 400);

    // ------------------------------------------------ people and roles
    const addP = (body) => call('/people', { method: 'POST', token: admin, body });
    const w = await addP({ name: 'Ravi', phone: '9222222222', role: 'worker', pin: '1111' });
    eq('a worker is added', w.status, 201);
    eq('the same phone twice is refused', (await addP({ name: 'X', phone: '09222222222', role: 'worker', pin: '1111' })).status, 409);
    eq('a short PIN is refused', (await addP({ name: 'X', phone: '9333333333', role: 'worker', pin: '11' })).status, 400);
    // The godown job is part of Worker: nobody new is given the old godown role.
    eq('the godown role is not offered any more', (await addP({ name: 'G', phone: '9444444444', role: 'godown', pin: '2222', linkedId: godown })).status, 400);
    eq('a second worker is fine', (await addP({ name: 'G', phone: '9444444444', role: 'worker', pin: '2222' })).status, 201);

    let worker = (await login('9222222222', '1111')).body.token;
    eq('a worker cannot remove a bill from To digitise', (await call('/admin/confirm/1/dismiss', { method: 'POST', token: worker, body: {} })).status, 403);
    eq('a worker can sign in', (await call('/me', { token: worker })).body.name, 'Ravi');
    eq('a worker cannot see the item list', (await call('/items', { token: worker })).status, 403);
    eq('or add people', (await call('/people', { method: 'POST', token: worker, body: {} })).status, 403);
    eq('or change stock', (await call('/stock/recount', { method: 'POST', token: worker })).status, 403);

    await call('/people/' + w.body.id + '/pin', { method: 'POST', token: admin, body: { pin: '3333' } });
    eq('a new PIN signs the worker out at once', (await call('/me', { token: worker })).status, 401);
    worker = (await login('9222222222', '3333')).body.token;
    await call('/people/' + w.body.id, { method: 'PUT', token: admin, body: { active: false } });
    eq('switching someone off signs them out', (await call('/me', { token: worker })).status, 401);
    eq('and they cannot sign in again', (await login('9222222222', '3333')).status, 401);

    const me = (await call('/me', { token: admin })).body;
    eq('the only admin cannot be switched off', (await call('/people/' + me.id, { method: 'PUT', token: admin, body: { active: false } })).status, 400);
    eq('or made something else', (await call('/people/' + me.id, { method: 'PUT', token: admin, body: { role: 'owner' } })).status, 400);

    // ------------------------------------------------ items
    const parle = {
      nameEn: 'Parle-G',
      nameKn: 'ಪಾರ್ಲೆ ಜಿ',
      units: [
        { code: 'pc', label: 'Piece', labelKn: 'ಪೀಸ್', perBase: 1, price: 5, min: 5, max: 5.5 },
        { code: 'pack', label: 'Pack', labelKn: 'ಪ್ಯಾಕ್', perBase: 24, price: 110 },
        { code: 'box', label: 'Box', labelKn: 'ಬಾಕ್ಸ್', perBase: 144, price: 640 },
      ],
      aliases: [{ text: 'parle pack', unit: 'pack' }],
      racks: { [shop]: 'Rack 3', loc_nowhere: 'X' },
      reorderAt: { [shop]: 48 },
    };
    const made = await call('/items', { method: 'POST', token: admin, body: parle });
    eq('an item is added', made.status, 201);
    const parleId = made.body.id;
    check('an old level for the shop becomes one level in pieces', made.body.lowAt && made.body.lowAt.qty === 48 && made.body.lowAt.unit === 'pc', JSON.stringify(made.body.lowAt));
    check('a rack for a place that does not exist is dropped', !('loc_nowhere' in made.body.racks) && made.body.racks[shop] === 'Rack 3');
    eq('a bad item is refused with a reason', (await call('/items', { method: 'POST', token: admin, body: { ...parle, units: [] } })).status, 400);
    await call('/items', {
      method: 'POST',
      token: admin,
      body: { nameEn: 'Rice', nameKn: 'ಅಕ್ಕಿ', units: [{ code: 'kg', label: 'Kg', labelKn: 'ಕೆಜಿ', perBase: 1, price: 55 }], aliases: [], racks: {}, reorderAt: {} },
    });
    const found = (await call('/items?q=akki', { token: admin })).body;
    check('search finds ಅಕ್ಕಿ from "akki"', found.length === 1 && found[0].nameEn === 'Rice');
    const upd = await call('/items/' + parleId, { method: 'PUT', token: admin, body: { ...parle, nameEn: 'Parle-G Gold', active: false } });
    eq('an item is changed', upd.body.nameEn, 'Parle-G Gold');
    check('a stopped item leaves the list', !(await call('/items', { token: admin })).body.some((i) => i.id === parleId));
    check('but not the full list', (await call('/items?all=1', { token: admin })).body.some((i) => i.id === parleId));
    await call('/items/' + parleId, { method: 'PUT', token: admin, body: { ...parle, active: true } });

    // ------------------------------------------------ stock
    const open = (loc, qty) => call('/stock/open', { method: 'POST', token: admin, body: { itemId: parleId, locationId: loc, qty } });
    eq('opening stock in the shop', (await open(shop, 100)).status, 201);
    eq('opening stock in the godown', (await open(godown, 288)).status, 201);
    eq('opening a second time is refused', (await open(shop, 5)).status, 409);
    const adj = (body) => call('/stock/adjust', { method: 'POST', token: admin, body: { itemId: parleId, locationId: shop, ...body } });
    eq('a correction is posted', (await adj({ actual: 90, reason: 'damaged', note: 'wet', requestId: 'r1' })).body.posted, 1);
    eq('the same correction sent twice is posted once', (await adj({ actual: 80, reason: 'damaged', requestId: 'r1' })).body.posted, 0);
    eq('a correction to the same count posts nothing', (await adj({ actual: 90, reason: 'counted', requestId: 'r2' })).body.posted, 0);
    eq('an unknown reason is refused', (await adj({ actual: 1, reason: 'lost', requestId: 'r3' })).status, 400);
    const levels = (await call('/stock', { token: admin })).body;
    const qty = (loc) => levels.find((s) => s.itemId === parleId && s.locationId === loc)?.qty;
    eq('the shop has 90', qty(shop), 90);
    eq('the godown has 288', qty(godown), 288);
    const moves = (await call('/items/' + parleId + '/moves', { token: admin })).body;
    check('the ledger has three moves, newest first', moves.length === 3 && moves[0].kind === 'adjust' && moves[0].from === shop && moves[0].qty === 10);
    check('the correction keeps its reason and note', moves[0].ref === 'damaged' && moves[0].note === 'wet');
    eq('recount finds nothing wrong', (await call('/stock/recount', { method: 'POST', token: admin })).body.fixed.length, 0);

    // ------------------------------------------------ stock value breakdown and sales series
    const home = (await call('/admin/home', { token: admin })).body;
    const sv = (await call('/admin/stock-value', { token: admin })).body;
    check('stock value rows add up to the Home tile', Math.abs(sv.total - home.stockValue) < 0.005 && Math.abs(sv.rows.reduce((a, r) => a + r.value, 0) - home.stockValue) < 0.01, sv.total + ' vs ' + home.stockValue);
    check('stock value lists what is held, per place too', sv.rows.some((r) => r.itemId === parleId && r.baseQty === 378) && (await call('/admin/stock-value?place=' + shop, { token: admin })).body.rows.find((r) => r.itemId === parleId)?.baseQty === 90);
    const ss = (await call('/admin/sales-series?by=month&itemId=' + parleId, { token: admin })).body;
    check('sales series: 12 months', ss.points.length === 12 && ss.by === 'month', JSON.stringify(ss).slice(0, 200));
    eq('sales series: 30 days by default', (await call('/admin/sales-series', { token: admin })).body.points.length, 30);
    eq('sales series needs a sign-in', (await call('/admin/sales-series')).status, 401);
    const svCsv = (await call('/reports/stock-value-items.csv', { token: admin })).text;
    check('stock value file: BOM, header, Kannada', svCsv.charCodeAt(0) === 0xfeff && svCsv.includes('value_at_cost') && svCsv.includes('ಪಾರ್ಲೆ'), svCsv.slice(0, 300));
    const seCsv = (await call('/reports/sales-series.csv?by=day&itemId=' + parleId, { token: admin })).text;
    check('item sales file: BOM and 30 days', seCsv.charCodeAt(0) === 0xfeff && seCsv.trim().split('\r\n').length === 31, seCsv.slice(0, 200));
    const win = (await call('/admin/sales-series?by=day&start=2026-01-01', { token: admin })).body;
    check('sales series window from a start date', win.start === '2026-01-01' && win.points[29].key === '2026-01-30' && win.latest > win.start, JSON.stringify(win).slice(0, 200));
    const istNow = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const det = await call('/admin/sales-details?by=day&keys=' + istNow + ',2026-01-01', { token: admin });
    check('sales details for picked days', det.status === 200 && det.body.keys.length === 2 && Array.isArray(det.body.items) && typeof det.body.amount === 'number', JSON.stringify(det.body).slice(0, 200));
    eq('sales details needs a day', (await call('/admin/sales-details?by=day', { token: admin })).status, 400);
    check('sales details file has a BOM', (await call('/reports/sales-details.csv?by=month&keys=2026-11&itemId=' + parleId, { token: admin })).text.charCodeAt(0) === 0xfeff);
    eq('an unknown item has no sales file', (await call('/reports/sales-series.csv?itemId=nope', { token: admin })).status, 404);

    // ------------------------------------------------ files
    const itemsCsv = await call('/export/items.csv', { token: admin });
    check('the items file starts with the Excel byte-order mark', itemsCsv.text.charCodeAt(0) === 0xfeff);
    check('and carries the Kannada', itemsCsv.text.includes('ಪಾರ್ಲೆ ಜಿ'));
    const stockCsv = (await call('/export/stock.csv', { token: admin })).text;
    check('the stock file says 90 pc is 3 pack 18 pc', stockCsv.includes('3 pack 18 pc'), stockCsv);
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const ledgerToday = (await call('/export/ledger.csv?from=' + today + '&to=' + today, { token: admin })).text;
    eq('today\'s ledger has the three moves', ledgerToday.trim().split('\r\n').length, 4);
    const ledgerOld = (await call('/export/ledger.csv?from=2001-01-01&to=2001-01-02', { token: admin })).text;
    eq('a day long ago has none', ledgerOld.trim().split('\r\n').length, 1);
    eq('a bad date is refused', (await call('/export/ledger.csv?from=yesterday', { token: admin })).status, 400);

    const changedCsv = itemsCsv.text.replace(',Pack,ಪ್ಯಾಕ್,24,110,', ',Pack,ಪ್ಯಾಕ್,24,112,');
    check('(the test edited the price)', changedCsv !== itemsCsv.text);
    const withNew = changedCsv + ',Sugar,ಸಕ್ಕರೆ,,kg,Kg,,1,48,,,,,,,,\r\n';
    const dry = (await call('/import/items', { method: 'POST', token: admin, body: { csv: withNew, dry: true } })).body;
    check('a dry run counts one new, one changed, one unchanged', dry.added === 1 && dry.changed === 1 && dry.unchanged === 1, JSON.stringify(dry));
    check('and changes nothing', (await call('/items/' + parleId, { token: admin })).body.units[1].price === 110);
    const broken = withNew + 'it_nope,Ghost,,,pc,,,1,5,,,,,,,,\r\n';
    const bad = (await call('/import/items', { method: 'POST', token: admin, body: { csv: broken, dry: false } })).body;
    check('an unknown item id stops the whole file', !bad.applied && bad.errors.length === 1 && bad.errors[0].row > 1, JSON.stringify(bad));
    check('so nothing came in', (await call('/items', { token: admin })).body.length === 2);
    const done = (await call('/import/items', { method: 'POST', token: admin, body: { csv: withNew, dry: false } })).body;
    check('a good file comes in', done.applied);
    eq('with the new pack price', (await call('/items/' + parleId, { token: admin })).body.units[1].price, 112);
    check('and the new item', (await call('/items?q=sakkare', { token: admin })).body.length === 1);
    check('the godown rack survived the shop-only file', (await call('/items/' + parleId, { token: admin })).body.racks[shop] === 'Rack 3');

    // Barcodes in the items file: written out, kept when a file has no column, never on two items.
    {
      const p0 = (await call('/items/' + parleId, { token: admin })).body;
      const withCode = { ...p0, units: p0.units.map((u, i) => (i === 0 ? { ...u, barcodes: ['8901063010017'] } : u)) };
      eq('a barcode is saved on the piece', (await call('/items/' + parleId, { method: 'PUT', token: admin, body: withCode })).status, 200);
      const out = (await call('/export/items.csv', { token: admin })).text;
      check('the items file carries it', out.includes('barcodes') && out.includes('8901063010017'));
      const plain = 'item_id,name_en,unit_code,per_base,price' + String.fromCharCode(10) + parleId + ',Parle G,pc,1,5' + String.fromCharCode(10) + parleId + ',,pack,24,113';
      const kept = (await call('/import/items', { method: 'POST', token: admin, body: { csv: plain, dry: false } })).body;
      check('a file without the column comes in', kept.applied, JSON.stringify(kept));
      check('and the code stays on the piece', ((await call('/items/' + parleId, { token: admin })).body.units[0].barcodes || []).includes('8901063010017'));
      const twice = 'name_en,unit_code,price,barcodes' + String.fromCharCode(10) + 'Copy biscuit,pc,5,8901063010017';
      const clash = (await call('/import/items', { method: 'POST', token: admin, body: { csv: twice, dry: true } })).body;
      check('a file giving the code to a second item is refused', clash.errors.some((e) => /8901063010017/.test(e.message) && e.row === 2), JSON.stringify(clash));
    }


    // Other names: the item form's own path (chips -> form -> input), on add and on edit.
    {
      const F = require('../core/dist/cjs');
      let f = { ...F.blankItemForm(), nameEn: 'Sugar', nameKn: 'ಸಕ್ಕರೆ' };
      f.units = [{ ...f.units[0], code: 'g', label: 'Gram', labelKn: 'ಗ್ರಾಂ', price: '0.08' }];
      let chips = [];
      for (const n of ['shakkare', 'ಸಕ್ಕರೆ ಪುಡಿ']) chips = F.addAliasChip(chips, n);
      f = { ...f, aliases: F.aliasesFromChips(chips) };
      // The third is typed but + Add is not tapped: Save still takes it.
      const add = await call('/items', { method: 'POST', token: admin, body: F.formToInput(F.withPendingAlias(f, { text: 'cheeni', unit: '' })) });
      eq('an item with 3 other names is added', add.status, 201);
      const got = (await call('/items?all=1', { token: admin })).body.find((i) => i.id === add.body.id);
      eq('3 other names read back', got && got.aliases.length, 3);
      let e = F.itemToForm(got);
      e = { ...e, aliases: F.aliasesFromChips(F.addAliasChip(F.aliasChips(e.aliases), 'ಚೀನಿ')) };
      const put = await call('/items/' + got.id, { method: 'PUT', token: admin, body: F.formToInput(F.withPendingAlias(e, { text: 'sakkre', unit: '' })) });
      eq('other names are changed', put.status, 200);
      const back = (await call('/items?all=1', { token: admin })).body.find((i) => i.id === got.id);
      check('5 other names read back after the edit', back && JSON.stringify(back.aliases.map((x) => x.text)) === JSON.stringify(['shakkare', 'ಸಕ್ಕರೆ ಪುಡಿ', 'cheeni', 'ಚೀನಿ', 'sakkre']), JSON.stringify(back && back.aliases));
      const three = await call('/items/' + got.id, { method: 'PUT', token: admin, body: { ...F.formToInput(F.itemToForm(back)), aliases: [{ text: 'a1' }, { text: 'ಎರಡು' }, { text: 'a3' }] } });
      eq('PUT with 3 other names', three.status, 200);
      eq('GET reads 3 back', (await call('/items?all=1', { token: admin })).body.find((i) => i.id === got.id).aliases.length, 3);
    }

    // ------------------------------------------------ a place's items, now and before
    const placeItems = async (loc) => (await call('/admin/places/' + loc + '/items', { token: admin })).body;
    let gItems = await placeItems(godown);
    check('the godown has Parle now', gItems.now.some((r) => r.itemId === parleId && r.qty === 288) && !gItems.before.some((r) => r.itemId === parleId), JSON.stringify(gItems));
    eq('emptying the godown is posted', (await adj({ locationId: godown, actual: 0, reason: 'counted', requestId: 'pl1' })).body.posted, 1);
    gItems = await placeItems(godown);
    check('then Parle was there before, with a date', !gItems.now.some((r) => r.itemId === parleId) && gItems.before.some((r) => r.itemId === parleId && !Number.isNaN(Date.parse(r.lastAt))), JSON.stringify(gItems));
    check('the shop still has it now', (await placeItems(shop)).now.some((r) => r.itemId === parleId && r.qty === 90));
    eq('an unknown place is 404', (await call('/admin/places/nope/items', { token: admin })).status, 404);
    eq('signed out cannot see a place', (await call('/admin/places/' + godown + '/items')).status, 401);

    // ------------------------------------------------ quick edit: Add puts stock in on top of the ledger
    {
      const qs = (await call('/items', { method: 'POST', token: admin, body: { nameEn: 'Quick sugar', nameKn: 'ಸಕ್ಕರೆ', units: [{ code: 'kg', label: 'Kg', labelKn: 'ಕೆಜಿ', perBase: 1, price: 58 }], aliases: [], racks: {} } })).body;
      eq('quick: opening stock in the godown', (await call('/stock/open', { method: 'POST', token: admin, body: { itemId: qs.id, locationId: godown, qty: 10 } })).status, 201);
      const add = (body) => call('/stock/adjust', { method: 'POST', token: admin, body: { itemId: qs.id, locationId: godown, reason: 'added', ...body } });
      const a1 = await add({ add: 5, requestId: 'qa1' });
      check('quick: Add 5 to 10 makes 15', a1.status === 200 && a1.body.posted === 1 && a1.body.qty === 15, JSON.stringify(a1.body));
      eq('quick: the same Add sent twice is posted once', (await add({ add: 5, requestId: 'qa1' })).body.posted, 0);
      eq('quick: Add 0 is refused', (await add({ add: 0, requestId: 'qa2' })).status, 400);
      eq('quick: Add below 0 is refused', (await add({ add: -3, requestId: 'qa3' })).status, 400);
      eq('quick: a count and an Add together are refused', (await add({ add: 1, actual: 20, requestId: 'qa4' })).status, 400);
      eq('quick: neither a count nor an Add is refused', (await add({ requestId: 'qa5' })).status, 400);
      const lv = (await call('/stock', { token: admin })).body.find((s) => s.itemId === qs.id && s.locationId === godown);
      eq('quick: the godown has 15 kg', lv && lv.qty, 15);
      const mv = (await call('/items/' + qs.id + '/moves', { token: admin })).body;
      check('quick: the Add is a move in, reason added', mv.length === 2 && mv[0].kind === 'adjust' && mv[0].to === godown && mv[0].qty === 5 && mv[0].ref === 'added', JSON.stringify(mv));
      eq('quick: a count still works beside it', (await add({ actual: 12, reason: 'counted', requestId: 'qa6' })).body.qty, 12);
      // Taking some out, with the reason: Damaged, Expired, Other.
      const r1 = await add({ remove: 2, reason: 'damaged', requestId: 'qr1' });
      check('quick: 2 damaged out of 12 leaves 10', r1.status === 200 && r1.body.qty === 10, JSON.stringify(r1.body));
      const mv2 = (await call('/items/' + qs.id + '/moves', { token: admin })).body;
      check('quick: a move out of the godown, reason damaged', mv2[0].kind === 'adjust' && mv2[0].from === godown && mv2[0].qty === 2 && mv2[0].ref === 'damaged', JSON.stringify(mv2[0]));
      eq('quick: the same removal sent twice is posted once', (await add({ remove: 2, reason: 'damaged', requestId: 'qr1' })).body.posted, 0);
      eq('quick: expired works too', (await add({ remove: 1, reason: 'expired', requestId: 'qr2' })).body.qty, 9);
      eq('quick: remove 0 is refused', (await add({ remove: 0, reason: 'other', requestId: 'qr3' })).status, 400);
      eq('quick: an Add and a remove together are refused', (await add({ add: 1, remove: 1, requestId: 'qr4' })).status, 400);
      eq('quick: recount agrees with the ledger', (await call('/stock/recount', { method: 'POST', token: admin })).body.fixed.length, 0);
      await call('/items/' + qs.id, { method: 'PUT', token: admin, body: { ...qs, active: false } });
    }

    // ------------------------------------------------ own PIN
    eq('changing my PIN needs the current one', (await call('/auth/pin', { method: 'POST', token: admin, body: { oldPin: '0000', newPin: '5555' } })).status, 400);
    eq('with it, it changes', (await call('/auth/pin', { method: 'POST', token: admin, body: { oldPin: ADMIN_PIN, newPin: '5555' } })).status, 200);
    eq('which signs this device out too', (await call('/me', { token: admin })).status, 401);
    eq('the new PIN works', (await login(ADMIN_PHONE, '5555')).status, 200);

    // ------------------------------------------------ restart
    proc.kill();
    await new Promise((r) => proc.once('exit', r));
    proc = start(dir, port, { SEED_ADMIN_PIN: '9999' });
    await waitUp(base);
    eq('a seed left in the environment cannot reset the admin', (await login(ADMIN_PHONE, '9999')).status, 401);
    const again = (await login(ADMIN_PHONE, '5555')).body.token;
    const after = (await call('/stock', { token: again })).body;
    eq('stock survives a restart', after.find((s) => s.itemId === parleId && s.locationId === shop)?.qty, 90);
  } catch (err) {
    failed++;
    console.log('FAIL threw: ' + err.stack);
    console.log(proc.logs());
  } finally {
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('apitest: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main();
