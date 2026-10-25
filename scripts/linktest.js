/*
 * The link to billing, against a fake billing server: typed lines move stock once, handwriting
 * waits for a person, a cancelled bill gives stock back. The only writes to billing are a line's
 * given tick and a customer's address; a live draft hands its ticks to the saved bill.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const http = require('node:http');
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

// ---- a fake billing server
const PIN = '246810';
const ink = { w: 300, h: 80, strokes: [[10, 10, 50, 60, 90, 20]] };
const billing = {
  bills: [
    { no: 1, at: new Date().toISOString(), customer: { id: 'c1', name: 'Ramesh', phone: '9000000007' }, total: 0, paid: 0, balance: 0, lines: [
      // Billing copies a name typed once into both fields, as the real server does.
      { nameEn: 'Sugar 2kg', nameKn: 'Sugar 2kg', qty: 2, rate: 46 },
      { nameEn: '', nameKn: '', ink, qty: 1, rate: 90, lastMode: 'ink' },
      { nameEn: 'Mystery thing', nameKn: '', qty: 1, rate: 10 },
      { nameEn: '', nameKn: '', qty: 1, rate: 30 },
    ] },
    { no: 2, at: new Date().toISOString(), total: 0, paid: 0, balance: 0, lines: [{ nameEn: '', nameKn: 'ಸಕ್ಕರೆ', qty: 1, rate: 46 }, { nameEn: 'parle pack', nameKn: '', qty: 2, rate: 110 }] },
  ],
  customers: [{ id: 'c1', name: 'Ramesh', phone: '9000000007', address: 'Temple street', balance: 120 }],
  writes: 0,
  gets: 0,
  /** The two writes stock may make, as billing received them. */
  given: [],
  addresses: [],
};
const fake = http.createServer((req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method === 'POST' && req.url === '/api/auth/login') {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => (JSON.parse(body).pin === PIN ? send(200, { token: 'fake-token' }) : send(401, { error: 'bad pin' })));
    return;
  }
  const authed = req.headers.authorization === 'Bearer fake-token';
  const given = req.method === 'PATCH' && req.url.match(/^\/api\/bills\/(\d+)\/lines\/(\d+)\/given$/);
  const address = req.method === 'PUT' && req.url.match(/^\/api\/customers\/([^/]+)$/);
  if (given || address) {
    if (!authed) return send(401, { error: 'sign in' });
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const b = JSON.parse(body);
      if (given) billing.given.push({ no: Number(given[1]), i: Number(given[2]), given: b.given });
      else billing.addresses.push({ id: decodeURIComponent(address[1]), ...b });
      send(200, { ok: true });
    });
    return;
  }
  if (req.method !== 'GET') {
    billing.writes++;
    return send(405, { error: 'no writes' });
  }
  if (!authed) return send(401, { error: 'sign in' });
  billing.gets++;
  if (req.url.startsWith('/api/bills')) return send(200, billing.bills);
  if (req.url === '/api/customers') return send(200, billing.customers);
  send(404, { error: 'no' });
});


// ---- the light list (lite, since) from a newer billing server, and an older one that ignores both
async function liteSyncTests() {
  const { syncOnce } = require(path.join(out, 'billing', 'sync.js'));
  const { createFileRepo } = require(path.join(out, 'store', 'file.js'));
  const { billRounding } = require(path.join(out, 'routes', 'roles.js'));
  const { roundOffTotal } = require(path.join(out, 'routes', 'reports.js'));
  const at = new Date().toISOString();
  const fresh = async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-lite-'));
    const repo = await createFileRepo(dir);
    await repo.saveLocation({ id: 'loc_shop', name: 'Shop', nameKn: '', kind: 'shop', active: true });
    await repo.saveItem({ id: 'it_sugar', nameEn: 'Sugar', nameKn: '', units: [{ code: 'kg', label: 'Kg', labelKn: '', perBase: 1, price: 46 }], aliases: [], racks: {}, active: true, updatedAt: at });
    return { repo, dir };
  };
  const full = [
    { no: 1, at, total: 92, paid: 92, balance: 0, roundOff: 3, rounded: 95, lines: [{ nameEn: 'Sugar', qty: 2, rate: 46 }] },
    { no: 2, at, total: 90.5, paid: 0, balance: 90.5, roundoff: -0.5, roundedTotal: 90, lines: [{ nameEn: '', ink, qty: 1, rate: 90.5, lastMode: 'ink' }] },
  ];
  // A newer billing server: a light list (no ink, hasInk per bill), since and limit honoured.
  const newer = (bills) => {
    const calls = [];
    const lite = (b) => ({ ...b, hasInk: b.lines.some((l) => l.ink), lines: b.lines.map(({ ink: _i, ...l }) => l) });
    return {
      calls,
      get: async (p) => {
        calls.push(p);
        if (p === '/api/customers') return [];
        const one = p.match(/^\/api\/bills\/(\d+)$/);
        if (one) return JSON.parse(JSON.stringify(bills.find((b) => b.no === Number(one[1]))));
        const u = new URL('http://x' + p);
        const since = Number(u.searchParams.get('since') || 0);
        const limit = Number(u.searchParams.get('limit') || 100);
        return bills.filter((b) => b.no > since).sort((a, b) => b.no - a.no).slice(0, limit).map(lite);
      },
    };
  };
  {
    const { repo, dir } = await fresh();
    const bills = JSON.parse(JSON.stringify(full));
    const b = newer(bills);
    const r1 = await syncOnce(repo, b, { mode: 'full', limit: 30 });
    eq('lite: a newer billing server is seen as one', r1.lite, true);
    eq('lite: both bills read', r1.newBills, 2);
    check('lite: the list is asked for light, the latest 30', b.calls.includes('/api/bills?lite=1&limit=30'), JSON.stringify(b.calls));
    check('lite: only the handwritten bill is fetched whole', b.calls.filter((c) => /^\/api\/bills\/\d+$/.test(c)).join() === '/api/bills/2', JSON.stringify(b.calls));
    const m2 = await repo.getDoc('bills', '2');
    check('lite: its handwriting is kept, marked on the bill and the line', m2.hasInk === true && m2.inkLines === 1 && m2.lines[0].inked === true && m2.lines[0].ink.w === 300, JSON.stringify(m2));
    check('lite: a bill read whole is marked inkV 2', m2.inkV === 2, JSON.stringify(m2.inkV));
    const m1 = await repo.getDoc('bills', '1');
    check('round-off: taken from the bill billing sent', m1.roundOff === 3 && m1.rounded === 95 && m1.hasInk === false, JSON.stringify(m1));
    check('round-off: either spelling is read', m2.roundOff === -0.5 && m2.rounded === 90, JSON.stringify([m2.roundOff, m2.rounded]));
    check('round-off: the stored one wins over the old setting', JSON.stringify(billRounding(m1, 10)) === '{"rounded":95,"roundOff":3}');
    check('round-off: an old bill with none falls back to the setting', JSON.stringify(billRounding({ total: 92 }, 5)) === '{"rounded":90,"roundOff":-2}');
    eq('round-off: reports add up what billing put on the bills', roundOffTotal([m1, m2, { total: 92, at, no: 9 }], 5, '', '~'), 0.5);
    const moves = await repo.listMoves({});
    eq('lite: the typed line sold stock once', moves.filter((m) => m.kind === 'sale').length, 1);

    b.calls.length = 0;
    const r2 = await syncOnce(repo, b, { mode: 'fast', since: 2 });
    check('since: the quick read asks only for bills after the newest', b.calls.join() === '/api/bills?lite=1&since=2&limit=100', JSON.stringify(b.calls));
    eq('since: nothing new, nothing read', r2.bills + r2.newBills, 0);

    bills.push({ no: 3, at, total: 46, paid: 46, balance: 0, lines: [{ nameEn: 'Sugar', qty: 1, rate: 46 }] });
    b.calls.length = 0;
    const r3 = await syncOnce(repo, b, { mode: 'fast', since: 2 });
    check('since: a new typed bill comes in the light list alone', r3.newBills === 1 && r3.posted === 1 && b.calls.length === 1, JSON.stringify([r3, b.calls]));

    // Bill 2 is cancelled at the counter: the slow full read finds it, without fetching its ink again.
    bills.find((x) => x.no === 2).cancelled = true;
    bills.find((x) => x.no === 1).cancelled = true;
    b.calls.length = 0;
    const r4 = await syncOnce(repo, b, { mode: 'full', limit: 30, customers: false });
    check('full: cancels are found, nothing fetched whole', b.calls.length === 1 && r4.reversed === 1, JSON.stringify([r4, b.calls]));
    const c2 = await repo.getDoc('bills', '2');
    check('full: a cancelled handwritten bill keeps its ink', c2.cancelled === true && c2.lines[0].ink && c2.lines[0].ink.w === 300, JSON.stringify(c2));
    const before = JSON.stringify(await repo.listDocs('bills'));
    const r5 = await syncOnce(repo, b, { mode: 'full', limit: 30, customers: false });
    check('full: an unchanged read changes nothing', JSON.stringify(await repo.listDocs('bills')) === before && r5.posted === 0 && r5.reversed === 0);
    await repo.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  {
    // An older billing server: no lite, no since, full bills with ink; stock reads as before.
    const { repo, dir } = await fresh();
    const calls = [];
    const old = { get: async (p) => (calls.push(p), p === '/api/customers' ? [] : JSON.parse(JSON.stringify(full)).map(({ roundOff: _a, roundoff: _b, rounded: _c, roundedTotal: _d, ...x }) => x)) };
    const r = await syncOnce(repo, old, { mode: 'fast', since: 1 });
    eq('older billing: seen as no light list', r.lite, false);
    eq('older billing: every bill it sends is read', r.newBills, 2);
    check('older billing: nothing is fetched one by one', !calls.some((c) => /^\/api\/bills\/\d+$/.test(c)), JSON.stringify(calls));
    const m2 = await repo.getDoc('bills', '2');
    check('older billing: handwriting is read from the list', m2.lines[0].ink && m2.hasInk === true && m2.inkLines === 1, JSON.stringify(m2));
    check('older billing: no round-off is made up', m2.roundOff === undefined && m2.rounded === undefined);
    await repo.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ---- every ink block of a line (ink, then moreInk), and the one-time read-again of older bills
async function moreInkTests() {
  const { syncOnce, backfillMoreInk } = require(path.join(out, 'billing', 'sync.js'));
  const { createFileRepo } = require(path.join(out, 'store', 'file.js'));
  const at = new Date().toISOString();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-moreink-'));
  try {
    const repo = await createFileRepo(dir);
    await repo.saveLocation({ id: 'loc_shop', name: 'Shop', nameKn: '', kind: 'shop', active: true });
    const row2 = { w: 300, h: 80, strokes: [[5, 5, 40, 40]] };
    const bills = [{ no: 7, at, total: 90, paid: 0, balance: 90, lines: [{ nameEn: '', ink, moreInk: [row2], inkRows: 1, lastMode: 'ink', qty: 1, rate: 90 }] }];
    const calls = [];
    const client = {
      get: async (p) => {
        calls.push(p);
        if (p === '/api/customers') return [];
        const one = p.match(/^\/api\/bills\/(\d+)$/);
        if (one) return JSON.parse(JSON.stringify(bills.find((b) => b.no === Number(one[1]))));
        return JSON.parse(JSON.stringify(bills));
      },
    };
    await syncOnce(repo, client, { mode: 'full', limit: 30 });
    const m = await repo.getDoc('bills', '7');
    check('moreInk: sync keeps the second written row', m.lines[0].ink.w === 300 && m.lines[0].moreInk?.length === 1 && m.lines[0].moreInk[0].strokes[0][2] === 40, JSON.stringify(m.lines[0]));
    eq('moreInk: a bill read whole is marked inkV 2', m.inkV, 2);

    // An older mirror without moreInk or the mark, as stock kept them before.
    const old = JSON.parse(JSON.stringify(m));
    delete old.lines[0].moreInk;
    delete old.inkV;
    await repo.putDoc('bills', old);
    calls.length = 0;
    eq('backfill: one bill read again', await backfillMoreInk(repo, client), 1);
    const b = await repo.getDoc('bills', '7');
    check('backfill: its second row is stored and the bill marked', b.inkV === 2 && b.lines[0].moreInk?.length === 1 && b.lines[0].ink.w === 300, JSON.stringify(b));
    check('backfill: read from billing by number', calls.join() === '/api/bills/7', JSON.stringify(calls));
    calls.length = 0;
    eq('backfill: a second run has nothing to do', await backfillMoreInk(repo, client), 0);
    eq('backfill: and asks billing nothing', calls.length, 0);
    // Billing away: nothing changes, and the bill is tried again next time.
    await repo.putDoc('bills', old);
    eq('backfill: billing away is quiet', await backfillMoreInk(repo, { get: async () => { throw new Error('down'); } }), -1);
    check('backfill: and the bill is left for next time', !(await repo.getDoc('bills', '7')).inkV);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  await liteSyncTests();
  await moreInkTests();
  await new Promise((r) => fake.listen(0, r));
  const billingUrl = 'http://localhost:' + fake.address().port;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-link-'));
  const port = 4600 + Math.floor(Math.random() * 300);
  const base = 'http://localhost:' + port;
  const proc = spawn(process.execPath, [path.join(out, 'index.js')], {
    env: { ...process.env, MONGO_URI: '', DEMO: '', PORT: String(port), DATA_DIR: dir, JWT_SECRET: 'linktest', SEED_ADMIN_PHONE: '9000000001', SEED_ADMIN_PIN: '4821', BILLING_URL: billingUrl, BILLING_PIN: PIN, BILLING_EVERY_MS: '600000', BILLING_BUSY_MS: '600000', LINK_KEY: 'link-test-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  try {
    for (let i = 0; i < 300; i++) {
      try {
        if ((await fetch(base + '/api/health')).ok) break;
      } catch {
        /* not yet */
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    const call = async (p, body) => {
      const r = await fetch(base + '/api' + p, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: '9000000001', pin: '4821' }) });
    let token = (await login.json()).token;

    // Items the bills refer to.
    const mk = (b) => call('/items', b);
    const sugar = (await mk({ nameEn: 'Sugar', nameKn: 'ಸಕ್ಕರೆ', units: [{ code: 'kg', label: 'Kg', labelKn: '', perBase: 1, price: 46 }], aliases: [], racks: {}, reorderAt: {} })).body;
    const parle = (await mk({ nameEn: 'Parle-G', nameKn: '', units: [{ code: 'pc', label: 'pc', labelKn: '', perBase: 1, price: 5 }, { code: 'pack', label: 'Pack', labelKn: '', perBase: 24, price: 110 }], aliases: [{ text: 'parle pack', unit: 'pack' }], racks: {}, reorderAt: {} })).body;
    // Changing an item, as the shop does when it adds a missing one.
    await fetch(base + '/api/items/' + sugar.id, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ nameEn: 'Sugar', nameKn: 'ಸಕ್ಕರೆ', units: [{ code: 'kg', label: 'Kg', labelKn: '', perBase: 1, price: 46 }], aliases: [], racks: {}, reorderAt: {} }) });
    await call('/stock/open', { itemId: sugar.id, locationId: 'loc_shop', qty: 100 });
    await call('/stock/open', { itemId: parle.id, locationId: 'loc_shop', qty: 480 });
    const qty = async (id) => ((await call('/stock')).body.find((s) => s.itemId === id && s.locationId === 'loc_shop') ?? { qty: 0 }).qty;

    const first = await call('/admin/link/sync', {});
    eq('a sync reads the bills', first.status, 200);
    // The server already read both bills on start, before these items existed: their typed lines
    // waited, and are matched now that the items are there.
    eq('both bills are read', first.body.bills, 2);
    eq('three typed lines matched and posted (sugar, ಸಕ್ಕರೆ, parle pack)', first.body.posted, 3);
    eq('sugar down by 2 kg + 1 kg', await qty(sugar.id), 97);
    eq('"parle pack" ×2 is 48 pieces, by its other name', await qty(parle.id), 432);

    const bills = (await call('/admin/bills')).body;
    const b1 = bills.find((b) => b.no === 1);
    // No machine reading: a written line waits in To confirm for a person to pick the item.
    eq('the handwritten line waits for a person', b1.lines[1].state, 'to-confirm');
    check('with no machine reading', !b1.lines[1].reading, JSON.stringify(b1.lines[1].reading));
    check('the list leaves the ink out, marking the line', !b1.lines[1].ink && b1.lines[1].inked === true && b1.hasInk === true, JSON.stringify(b1.lines[1]));
    const inks = (await call('/admin/bills/ink?nos=1,2')).body;
    check('with its ink fetched after', inks['1'] && inks['1']['1'] && inks['1']['1'].ink.strokes.length === 1 && !inks['1']['1'].moreInk && !inks['2'], JSON.stringify(inks));
    // To digitise: the list without the writing, a page of bills at a time; the writing comes after.
    const conf = (await call('/admin/confirm')).body;
    const cw = conf.find((p) => p.billNo === 1 && p.line.i === 1);
    check('To digitise sends no ink', conf.length > 0 && conf.every((p) => !p.line.ink && !p.line.moreInk), JSON.stringify(conf).slice(0, 300));
    check('but marks the written line', cw && cw.line.hasInk === true && conf.filter((p) => p.line.i !== 1 || p.billNo !== 1).every((p) => p.line.hasInk === false), JSON.stringify(conf));
    check('newest bill first by default', conf.length > 0 && conf[0].billNo === Math.max(...conf.map((p) => p.billNo)), JSON.stringify(conf.map((p) => p.billNo)));
    const waiting = (await call('/admin/confirm/count')).body;
    eq('the count says how many bills wait', waiting.bills, new Set(conf.map((p) => p.billNo)).size);
    const p1 = (await call('/admin/confirm?order=old&limit=1')).body;
    check('a page of one bill, oldest first when asked', p1.length > 0 && p1.every((p) => p.billNo === 1), JSON.stringify(p1));
    check('the next page starts after it', (await call('/admin/confirm?order=old&limit=1&after=1')).body.every((p) => p.billNo > 1));
    const n1 = (await call('/admin/confirm?limit=1')).body;
    check('newest first: the next page goes back from it', n1.length > 0 && (await call('/admin/confirm?limit=1&after=' + n1[0].billNo)).body.every((p) => p.billNo < n1[0].billNo));
    check('and the ink endpoint has the writing of that bill', !!(await call('/admin/bills/ink?nos=' + p1[0].billNo)).body['1']['1'].ink.strokes);
    eq('a name no item has waits too', b1.lines[2].state, 'to-confirm');
    eq('a price with nothing written is not stock', b1.lines[3].state, 'not-item');
    eq('the typed sugar line knows its unit', b1.lines[0].unit, 'kg');
    const cust = (await call('/admin/customers')).body;
    check('customers come across with their address and balance', cust.some((c) => c.key === '9000000007' && c.address === 'Temple street' && c.balance === 120));

    const again = await call('/admin/link/sync', {});
    eq('a second sync posts nothing again', again.body.posted, 0);
    eq('and finds no new bills', again.body.newBills, 0);
    eq('stock unchanged', await qty(sugar.id), 97);

    // A person confirms the handwritten line; a later sync must keep that.
    eq('confirming the written line', (await call('/admin/confirm', { billNo: 1, i: 1, itemId: sugar.id, unit: 'kg', qty: 1 })).status, 200);
    eq('stock follows', await qty(sugar.id), 96);
    await call('/admin/link/sync', {});
    const kept = (await call('/admin/bills')).body.find((b) => b.no === 1).lines[1];
    eq('a sync does not undo a person\'s answer', kept.state, 'confirmed');
    eq('nor post it twice', await qty(sugar.id), 96);

    // The admin removes bill 1 from To digitise: it leaves the list and the count, and stays removed through a sync.
    const waitingOn = async () => (await call('/admin/confirm')).body.filter((p) => p.billNo === 1).length;
    check('bill 1 still has a line to digitise', (await waitingOn()) > 0);
    const homeBefore = (await call('/admin/home')).body.toConfirm;
    eq('removing a bill from To digitise', (await call('/admin/confirm/1/dismiss', {})).status, 200);
    eq('it leaves the list', await waitingOn(), 0);
    check('and the Home count', (await call('/admin/home')).body.toConfirm < homeBefore);
    eq('no stock moves', await qty(sugar.id), 96);
    await call('/admin/link/sync', {});
    eq('a sync keeps it removed', await waitingOn(), 0);
    eq('the bill says so', (await call('/admin/bills')).body.find((b) => b.no === 1).dismissed, true);
    eq('undo', (await call('/admin/confirm/1/undismiss', {})).status, 200);
    check('undo puts it back', (await waitingOn()) > 0);
    eq('and the Home count', (await call('/admin/home')).body.toConfirm, homeBefore);
    eq('an unknown bill is 404', (await call('/admin/confirm/999/dismiss', {})).status, 404);

    // The bill is cancelled in billing.
    billing.bills[0].cancelled = true;
    const c = await call('/admin/link/sync', {});
    eq('cancelling bill 1 gives back both sugar lines', c.body.reversed, 2);
    eq('sugar back up', await qty(sugar.id), 99);
    await call('/admin/link/sync', {});
    eq('and not twice', await qty(sugar.id), 99);

    // A new bill appears.
    billing.bills.push({ no: 3, at: new Date().toISOString(), total: 0, paid: 0, balance: 0, lines: [{ nameEn: 'Parle-G', nameKn: '', qty: 10, rate: 5 }] });
    eq('a new bill is picked up', (await call('/admin/link/sync', {})).body.newBills, 1);
    eq('10 pieces by the rate', await qty(parle.id), 422);

    const summary = (await call('/admin/summary')).body;
    check('the link shows as working', summary.link && summary.link.ok === true && summary.link.lastBillNo === 3, JSON.stringify(summary.link));
    eq('nothing else was ever written to billing', billing.writes, 0);
    const home = (await call('/admin/home')).body;
    const { week, ...homeRest } = home;
    eq('Home\'s one call says the same as the full summary', JSON.stringify(homeRest), JSON.stringify(summary));
    check('and carries seven days for the chart, today last', week.length === 7 && week[6].bills >= 1, JSON.stringify(week));
    eq('a second Home read is the kept answer', JSON.stringify((await call('/admin/home')).body), JSON.stringify(home));

    const waitFor = async (fn) => {
      for (let i = 0; i < 40 && !fn(); i++) await new Promise((r) => setTimeout(r, 100));
      return fn();
    };

    // ---- a live draft, ticked by the worker, handed over to the saved bill
    const link = async (p, body) => {
      const r = await fetch(base + '/api/billing-link' + p, { method: 'POST', headers: { 'X-Link-Key': 'link-test-key', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const draftLines = [
      { key: 'k1', nameEn: 'Parle-G', nameKn: '', qty: 1, unit: 'pc', rate: 110, stockItemId: parle.id },
      { key: 'k2', nameEn: 'Sugar', nameKn: 'ಸಕ್ಕರೆ', qty: 1, rate: 46 },
    ];
    eq('billing sends a draft', (await link('/draft', { draftId: 'd_1', customerName: 'Ramesh', lines: draftLines })).status, 200);
    const w = (await call('/worker/bills')).body;
    check('the worker sees it first, as being written', w[0].draftId === 'd_1' && w[0].lines.length === 2 && w[0].lines[1].itemId === sugar.id, JSON.stringify(w[0]));
    eq('a worker ticks a draft line', (await call('/worker/drafts/d_1/lines/0/fetched', { fetched: true })).status, 200);
    const back = (await link('/draft', { draftId: 'd_1', customerName: 'Ramesh', lines: draftLines })).body;
    check('the tick goes back with the next draft', back.ticks.k1.fetched === true && back.ticks.k2.fetched === false, JSON.stringify(back));

    billing.bills.push({ no: 4, draftId: 'd_1', at: new Date().toISOString(), total: 156, paid: 156, balance: 0, lines: [
      { nameEn: 'Parle-G', nameKn: '', qty: 1, unit: 'pc', rate: 110, stockItemId: parle.id },
      { nameEn: 'Sugar', nameKn: 'ಸಕ್ಕರೆ', qty: 1, rate: 46, given: true },
    ] });
    await call('/admin/link/sync', {});
    const b4 = (await call('/admin/bills')).body.find((b) => b.no === 4);
    eq('the draft\'s tick is on the saved bill', b4.lines[0].fetched, true);
    eq('the unit billing names wins over guessing by the rate', b4.lines[0].unit, 'pc');
    eq('billing\'s given turns fetched on', b4.lines[1].fetched, true);
    check('the draft is gone from the worker screen', !(await call('/worker/bills')).body.some((b) => b.draftId === 'd_1'));

    // A saved bill whose lines come in another order: ticks follow billing's line id, not the position.
    await link('/draft', { draftId: 'd_2', lines: [{ key: 'kA', nameEn: 'Sugar', qty: 1, rate: 46 }, { key: 'kB', nameEn: 'Parle-G', qty: 1, rate: 5 }] });
    eq('a worker ticks the first draft line (sugar)', (await call('/worker/drafts/d_2/lines/0/fetched', { fetched: true })).status, 200);
    billing.bills.push({ no: 5, draftId: 'd_2', at: new Date().toISOString(), total: 51, paid: 51, balance: 0, lines: [
      { itemId: 'kB', nameEn: 'Parle-G', nameKn: '', qty: 1, rate: 5 },
      { itemId: 'kA', nameEn: 'Sugar', nameKn: '', qty: 1, rate: 46 },
    ] });
    await call('/admin/link/sync', {});
    const b5 = (await call('/admin/bills')).body.find((b) => b.no === 5);
    check('the tick lands on sugar, now the second line', b5.lines[1].fetched === true && !b5.lines[0].fetched, JSON.stringify(b5.lines.map((l) => l.fetched)));

    // A worker ticks a draft line just before Save, too late for billing's last draft exchange.
    await link('/draft', { draftId: 'd_3', lines: [{ key: 'kC', nameEn: 'Sugar', qty: 1, rate: 46 }] });
    await call('/worker/drafts/d_3/lines/0/fetched', { fetched: true });
    billing.bills.push({ no: 6, draftId: 'd_3', at: new Date().toISOString(), total: 46, paid: 46, balance: 0, lines: [{ itemId: 'kC', nameEn: 'Sugar', nameKn: '', qty: 1, rate: 46 }] });
    await call('/admin/link/sync', {});
    check('the late tick is sent to billing as given', await waitFor(() => billing.given.some((g) => g.no === 6 && g.i === 0 && g.given === true)), JSON.stringify(billing.given));
    const b6 = (await call('/admin/bills')).body.find((b) => b.no === 6).lines[0];
    check('and kept here, with the given billing taken as sent', b6.fetched === true && b6.billingGiven === true, JSON.stringify(b6));
    billing.bills[5].lines[0].given = true; // billing took it
    await call('/admin/link/sync', {});
    eq('the next sync leaves it ticked', (await call('/admin/bills')).body.find((b) => b.no === 6).lines[0].fetched, true);
    eq('and sends nothing more', billing.given.filter((g) => g.no === 6).length, 1);

    // ---- stock's tick goes to billing; billing's change comes back
    await call('/worker/bills/4/lines/1/fetched', { fetched: false });
    check('unticking sends given=false to billing', await waitFor(() => billing.given.some((g) => g.no === 4 && g.i === 1 && g.given === false)), JSON.stringify(billing.given));
    await call('/admin/link/sync', {});
    eq('billing unchanged there: stock\'s tick stands', (await call('/admin/bills')).body.find((b) => b.no === 4).lines[1].fetched, undefined);
    billing.bills[3].lines[1].given = false;
    await call('/admin/link/sync', {});
    billing.bills[3].lines[1].given = true;
    await call('/admin/link/sync', {});
    eq('the counter ticking given again turns fetched on', (await call('/admin/bills')).body.find((b) => b.no === 4).lines[1].fetched, true);

    // ---- an address set here goes to billing's customer
    eq('the admin sets an address', (await call('/admin/customers/c_9000000007', { address: 'Market road' })).status, 200);
    check('billing gets it, by its own customer id', await waitFor(() => billing.addresses.some((a) => a.id === 'c1' && a.address === 'Market road')), JSON.stringify(billing.addresses));
    eq('still nothing else written', billing.writes, 0);

    // Billing goes away: the link says so and stock carries on.
    fake.close();
    fake.closeAllConnections?.();
    eq('a failed sync is reported, not fatal', (await call('/admin/link/sync', {})).status, 502);
    const down = (await call('/admin/summary')).body.link;
    check('the link shows as down with the reason', down.ok === false && down.message && down.lastOkAt, JSON.stringify(down));
    eq('the rest of stock still works', (await call('/stock')).status, 200);

    // The handwriting reader is gone: no reading endpoint, no machine reads.
    eq('there is no reader endpoint', (await call('/read', { ink: { w: 10, h: 10, strokes: [[1, 1, 2, 2]] } })).status, 404);
    eq('nor a read-waiting button', (await call('/admin/reader/run', {})).status, 404);

    // The client module cannot write.
    const { billingClient } = require(path.join(out, 'billing', 'client.js'));
    const cl = billingClient('http://x', 'y');
    check('the billing client reads, and sends only through push', Object.keys(cl).join() === 'get,send');
  } catch (err) {
    failed++;
    console.log('FAIL threw: ' + err.stack + '\n' + log);
  } finally {
    proc.kill();
    fake.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('linktest: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main();
