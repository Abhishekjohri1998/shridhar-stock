/*
 * The door billing's server uses, /api/billing-link: item search in either script, the rate for a
 * quantity, the round-off step, and live drafts with ticks both ways. Only with the right key, and
 * not there at all when stock has no key set.
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

const KEY = 'billing-link-test-key';

/** A stock server of its own, on its own port and data folder. Never a database. */
async function start(extra, seed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-blink-'));
  if (seed) {
    const repo = await require(path.join(out, 'store', 'file.js')).createFileRepo(dir);
    await seed(repo, require(path.join(out, 'pin.js')).hashPin);
    await repo.close();
  }
  const port = 4900 + Math.floor(Math.random() * 300);
  const base = 'http://localhost:' + port;
  const proc = spawn(process.execPath, [path.join(out, 'index.js')], {
    env: { ...process.env, MONGO_URI: '', DEMO: '', BILLING_URL: '', BILLING_PIN: '', LINK_KEY: '', PORT: String(port), DATA_DIR: dir, JWT_SECRET: 'blinktest', SEED_ADMIN_PHONE: '9000000001', SEED_ADMIN_PIN: '4821', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) break;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return { base, log: () => log, stop: async () => {
      // Waits for the server to go before removing its folder and exiting: Windows asserts otherwise.
      const gone = new Promise((r) => proc.once('exit', r));
      proc.kill();
      await gone;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function main() {
  // A shop worker, a godown person and a login that was removed, for billing's sign-in by person.
  const on = await start({ LINK_KEY: KEY }, async (repo, hashPin) => {
    const at = new Date().toISOString();
    // People already there means SEED_ADMIN_* is ignored, so the admin is seeded here too.
    await repo.createPerson({ id: 'p_a', name: 'Test admin', phone: '9000000001', role: 'admin', active: true, pinHash: hashPin('4821'), tv: 1, createdAt: at });
    for (const [id, role, phone, extra] of [['p_w', 'worker', '9111100021', {}], ['p_g', 'godown', '9111100022', { linkedId: 'loc_g' }], ['p_v', 'vendor', '9111100023', {}]]) {
      await repo.createPerson({ id, name: 'Test ' + role, phone, role, ...extra, active: true, pinHash: hashPin('2468'), tv: 1, createdAt: at });
    }
  });
  const off = await start({});
  try {
    const login = await fetch(on.base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '9000000001', pin: '4821' }) });
    const token = (await login.json()).token;
    const call = async (p, body) => {
      const r = await fetch(on.base + '/api' + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const link = async (p, body, key = KEY, base = on.base) => {
      const r = await fetch(base + '/api/billing-link' + p, { method: body ? 'POST' : 'GET', headers: { ...(key != null ? { 'X-Link-Key': key } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };

    const rice = (await call('/items', { nameEn: 'Sona Masoori rice', nameKn: 'ಅಕ್ಕಿ', units: [{ code: 'kg', label: 'Kg', labelKn: 'ಕೆಜಿ', perBase: 1, price: 60, min: 55, max: 65, slabs: [{ minQty: 25, rate: 56 }] }], aliases: [], racks: {}, reorderAt: {} })).body;
    const parle = (await call('/items', { nameEn: 'Parle-G', nameKn: 'ಪಾರ್ಲೆ-ಜಿ', units: [{ code: 'pc', label: 'pc', labelKn: 'ಪೀಸ್', perBase: 1, price: 5, min: 4, max: 6 }, { code: 'pack', label: 'Pack', labelKn: 'ಪ್ಯಾಕ್', perBase: 24, price: 110 }], aliases: [{ text: 'biscuit' }], racks: {}, reorderAt: {} })).body;
    check('items made', rice && rice.id && parle && parle.id, JSON.stringify(rice));

    // ---- the key
    eq('no key: refused', (await link('/settings', null, null)).status, 401);
    eq('a wrong key: refused', (await link('/settings', null, 'nope')).status, 401);
    eq('a key of another length: refused', (await link('/settings', null, KEY + 'x')).status, 401);
    eq('with no key set on stock, the door is not there', (await link('/settings', null, KEY, off.base)).status, 404);
    eq('not even for items', (await link('/items?q=rice', null, KEY, off.base)).status, 404);

    // ---- search
    const names = async (q) => (await link('/items?q=' + encodeURIComponent(q))).body.items.map((i) => i.id);
    check('English finds it', (await names('rice')).includes(rice.id));
    check('Kannada finds it', (await names('ಅಕ್ಕಿ')).includes(rice.id));
    check('Kannada typed in English finds it', (await names('akki')).includes(rice.id));
    check('an alias finds it', (await names('biscuit')).includes(parle.id));
    eq('nothing typed, nothing found', (await names('')).length, 0);
    const p = (await link('/items?q=parle')).body.items[0];
    check('with its units, prices and range, and no cost', p.units.length === 2 && p.units[0].price === 5 && p.units[0].min === 4 && p.units[0].max === 6 && p.units[1].code === 'pack' && p.units[1].price === 110 && p.units[1].min === undefined && !('cost' in p.units[0]) && p.nameKn === 'ಪಾರ್ಲೆ-ಜಿ', JSON.stringify(p));
    eq('limit is kept', (await link('/items?q=p&limit=1')).body.items.length, 1);
    const put = (id, body) => fetch(on.base + '/api/items/' + id, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const parleBody = { nameEn: parle.nameEn, nameKn: parle.nameKn, units: parle.units, aliases: parle.aliases, racks: {}, reorderAt: {} };
    eq('switching an item off', (await put(parle.id, { ...parleBody, active: false })).status, 200);
    check('a switched-off item is not offered', !(await names('parle')).includes(parle.id));
    await put(parle.id, { ...parleBody, active: true });
    // The default unit comes first, so billing's chips lead with it; an older item keeps its order.
    eq('a pack default is saved', (await put(parle.id, { ...parleBody, defaultUnit: 'PACK' })).status, 200);
    const pd = (await link('/items?q=parle')).body.items[0];
    check('the default unit comes first, the rest after', pd.units.map((u) => u.code).join() === 'pack,pc', JSON.stringify(pd.units));
    await put(parle.id, parleBody);
    eq('with no default, the first unit leads again', (await link('/items?q=parle')).body.items[0].units[0].code, 'pc');

    // ---- quote
    const q1 = (await link('/quote?item=' + rice.id + '&unit=kg&qty=2')).body;
    check('the plain rate', q1.rate === 60 && q1.amount === 120 && q1.unit === 'kg' && q1.slab === false && q1.warn === null, JSON.stringify(q1));
    const q2 = (await link('/quote?item=' + rice.id + '&unit=KG&qty=25')).body;
    check('a slab lowers it from 25 kg, and 56 is inside the range', q2.rate === 56 && q2.amount === 1400 && q2.slab === true && q2.warn === null, JSON.stringify(q2));
    const q3 = (await link('/quote?item=' + parle.id + '&unit=pack&qty=2')).body;
    check('a pack is its own price', q3.rate === 110 && q3.amount === 220, JSON.stringify(q3));
    eq('an unknown unit is 404', (await link('/quote?item=' + rice.id + '&unit=box&qty=1')).status, 404);
    eq('an unknown item is 404', (await link('/quote?item=it_none&unit=kg&qty=1')).status, 404);
    eq('no quantity is 400', (await link('/quote?item=' + rice.id + '&unit=kg')).status, 400);
    // A slab below the shop's own minimum shows as a warning, never a refusal.
    await put(rice.id, ({ nameEn: 'Sona Masoori rice', nameKn: 'ಅಕ್ಕಿ', units: [{ code: 'kg', label: 'Kg', labelKn: 'ಕೆಜಿ', perBase: 1, price: 60, min: 58, max: 65, slabs: [{ minQty: 25, rate: 56 }] }], aliases: [], racks: {}, reorderAt: {} }));
    eq('below the range warns', (await link('/quote?item=' + rice.id + '&unit=kg&qty=30')).body.warn, 'below');

    // ---- settings
    eq('round-off is none until set', (await link('/settings')).body.roundTo, 0);
    const set = await fetch(on.base + '/api/admin/settings', { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ roundTo: 5 }) });
    eq('the shop sets round to 5', set.status, 200);
    eq('and billing reads it', (await link('/settings')).body.roundTo, 5);

    // ---- sign-in by person, for billing
    const auth = (phone, pin, key = KEY) => link('/auth', { phone, pin }, key);
    const a1 = await auth('9000000001', '4821');
    check('admin signs in through the link', a1.status === 200 && a1.body.role === 'admin' && typeof a1.body.name === 'string' && typeof a1.body.token === 'string', JSON.stringify(a1));
    const me = await fetch(on.base + '/api/me', { headers: { Authorization: 'Bearer ' + a1.body.token } });
    check('and the token is a normal stock session', me.status === 200 && (await me.json()).role === 'admin');
    const a2 = await auth('9111100021', '2468');
    check('a shop worker', a2.status === 200 && a2.body.role === 'worker' && a2.body.name === 'Test worker' && a2.body.token, JSON.stringify(a2));
    const wb = await fetch(on.base + '/api/worker/bills', { headers: { Authorization: 'Bearer ' + a2.body.token } });
    eq('whose session opens the worker screen', wb.status, 200);
    const a3 = await auth('+91 91111 00022', '2468');
    check('a godown person, phone written any way', a3.status === 200 && a3.body.role === 'godown', JSON.stringify(a3));
    const a4 = await auth('9111100021', '0000');
    check('a wrong PIN is 401 with a message', a4.status === 401 && a4.body.error && !a4.body.token, JSON.stringify(a4));
    eq('an unknown phone is 401', (await auth('9999999999', '2468')).status, 401);
    const a5 = await auth('9111100023', '2468');
    check('a removed login is 403 with its message', a5.status === 403 && /no longer/i.test(a5.body.error) && !a5.body.token, JSON.stringify(a5));
    eq('no key, no sign-in', (await auth('9000000001', '4821', null)).status, 401);
    eq('a wrong key, no sign-in', (await auth('9000000001', '4821', 'nope')).status, 401);
    eq('no door when stock has no key', (await link('/auth', { phone: '9000000001', pin: '4821' }, KEY, off.base)).status, 404);
    for (let i = 0; i < 5; i++) await auth('9111100022', '0000');
    eq('five wrong PINs lock it, as the login does', (await auth('9111100022', '2468')).status, 429);

    // ---- a live draft, ticks both ways
    const lines = [
      { key: 'a', nameEn: 'Parle-G', nameKn: 'ಪಾರ್ಲೆ-ಜಿ', qty: 2, unit: 'pack', rate: 110, stockItemId: parle.id },
      { key: 'b', nameEn: '', nameKn: '', qty: 1, rate: 60, ink: true },
    ];
    const d1 = await link('/draft', { draftId: 'd_x', customerName: 'Ramesh', lines });
    eq('a draft is taken', d1.status, 200);
    check('with no ticks yet', d1.body.ticks.a.fetched === false && d1.body.ticks.b.fetched === false, JSON.stringify(d1.body));
    const w1 = (await call('/worker/bills')).body;
    check('the worker sees it as being written', w1.length === 1 && w1[0].draftId === 'd_x' && w1[0].no === 0 && w1[0].customer === 'Ramesh' && w1[0].total === 280, JSON.stringify(w1));
    check('its picked line knows the item', w1[0].lines[0].itemId === parle.id && w1[0].lines[0].unit === 'pack');
    eq('a worker ticks line 1', (await call('/worker/drafts/d_x/lines/0/fetched', { fetched: true })).status, 200);
    eq('a line that is not there is 404', (await call('/worker/drafts/d_x/lines/9/fetched', { fetched: true })).status, 404);
    eq('a draft that is not there is 404', (await call('/worker/drafts/d_none/fetched', { fetched: true })).status, 404);
    const d2 = (await link('/draft', { draftId: 'd_x', customerName: 'Ramesh', lines: [...lines, { key: 'c', nameEn: 'Rice', qty: 1, rate: 60 }] })).body;
    check('the tick comes back, and survives a new line', d2.ticks.a.fetched === true && d2.ticks.a.at > 0 && d2.ticks.c.fetched === false, JSON.stringify(d2));
    // The counter unticks given later than the worker's tick: the later change wins.
    const later = d2.ticks.a.at + 1000;
    const d3 = (await link('/draft', { draftId: 'd_x', lines: [{ ...lines[0], given: false, givenAt: later }, { ...lines[1], given: true, givenAt: later }] })).body;
    check('billing\'s later change wins', d3.ticks.a.fetched === false && d3.ticks.b.fetched === true, JSON.stringify(d3));
    const d4 = (await link('/draft', { draftId: 'd_x', lines: [{ ...lines[0], given: true, givenAt: 1 }, { ...lines[1], given: true, givenAt: later }] })).body;
    eq('an older given does not undo a newer tick', d4.ticks.a.fetched, false);
    eq('select all on a draft', (await call('/worker/drafts/d_x/fetched', { fetched: true })).status, 200);
    check('ticks every line', Object.values((await link('/draft', { draftId: 'd_x', lines })).body.ticks).every((t) => t.fetched));
    // Real strokes on a draft line reach the worker, a bad or huge one falls back to the flag.
    const ink = { w: 300, h: 60, strokes: [[10, 10, 50, 40, 90, 20]] };
    await link('/draft', { draftId: 'd_ink', lines: [{ key: 'h', qty: 1, rate: 5, ink }, { key: 'j', qty: 1, rate: 5, ink: { w: 'x' } }, { key: 'k', qty: 1, rate: 5, ink: { w: 300, h: 60, strokes: Array.from({ length: 300 }, () => Array(40).fill(1)) } }] });
    const wi = (await call('/worker/bills')).body.find((b) => b.draftId === 'd_ink');
    check("a draft line's handwriting reaches the pick list", wi && JSON.stringify(wi.lines[0].ink) === JSON.stringify(ink) && !wi.lines[1].ink && !wi.lines[2].ink, JSON.stringify(wi && wi.lines));
    await link('/draft', { draftId: 'd_ink', closed: true, lines: [] });
    eq('a bad draft is 400', (await link('/draft', { lines: [] })).status, 400);
    eq('a closed draft goes', (await link('/draft', { draftId: 'd_x', closed: true, lines: [] })).status, 200);
    eq('from the worker screen too', (await call('/worker/bills')).body.length, 0);
  } catch (err) {
    failed++;
    console.log('FAIL threw: ' + err.stack + '\n' + on.log());
  } finally {
    await Promise.all([on.stop(), off.stop()]);
  }
  console.log('billinglinktest: ' + passed + ' passed, ' + failed + ' failed');
  // Let open sockets close by themselves: process.exit() here trips a libuv assert on Windows.
  process.exitCode = failed ? 1 : 0;
}

main();
