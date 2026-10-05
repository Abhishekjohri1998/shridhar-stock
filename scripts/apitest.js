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
    eq('a godown person needs a godown', (await addP({ name: 'G', phone: '9444444444', role: 'godown', pin: '2222' })).status, 400);
    eq('with one it is fine', (await addP({ name: 'G', phone: '9444444444', role: 'godown', pin: '2222', linkedId: godown })).status, 201);

    let worker = (await login('9222222222', '1111')).body.token;
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
