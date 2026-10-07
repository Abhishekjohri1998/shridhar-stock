/*
 * Home deliveries, end to end on a throwaway file store: the vehicle rule, assign -> start ->
 * positions -> delivered, a worker sees only their own, the route is trimmed when it ends, and
 * the address search is cached and spaced a second apart (with a pretend Nominatim).
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, execSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, '.test-build');
execSync('npx tsc -p server/tsconfig.json --outDir ' + JSON.stringify(out), { cwd: root, stdio: 'inherit' });
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
const eq = (name, got, want) => check(name, got === want, 'got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want));

// ---------------------------------------------------------------- the pure rules
{
  const rule = { bikeMaxItems: 10, bikeMaxAmount: 3000 };
  eq('10 items and Rs 3000 go by bike', C.suggestVehicle({ itemCount: 10, amount: 3000 }, rule), 'bike');
  eq('11 items go by 4-wheeler', C.suggestVehicle({ itemCount: 11, amount: 100 }, rule), 'car');
  eq('Rs 3001 goes by 4-wheeler', C.suggestVehicle({ itemCount: 2, amount: 3001 }, rule), 'car');
  eq('the rule is the shop own', C.suggestVehicle({ itemCount: 4, amount: 500 }, { bikeMaxItems: 3, bikeMaxAmount: 9999 }), 'car');
  eq('defaults are 10 items and Rs 3000', JSON.stringify([C.DEFAULT_SETTINGS.bikeMaxItems, C.DEFAULT_SETTINGS.bikeMaxAmount]), '[10,3000]');
  const km = C.distanceKm({ lat: 12.9716, lng: 77.5946 }, { lat: 13.0827, lng: 80.2707 });
  check('Bengaluru to Chennai is about 290 km', km > 280 && km < 300, km);
  eq('distance text in metres', C.distanceText(0.8512), '850 m');
  eq('distance text in km', C.distanceText(3.44), '3.4 km');
  const pts = Array.from({ length: 8 }, (_, i) => ({ lat: i, lng: i, at: String(i) }));
  let t = [];
  for (const p of pts) t = C.addTrackPoint(t, p, 5);
  check('a long route keeps its start and the latest points', t.length === 5 && t[0].lat === 0 && t[4].lat === 7, JSON.stringify(t.map((p) => p.lat)));
  const tr = C.trimTrack(pts);
  check('an ended route keeps only start and end', tr.length === 2 && tr[0].lat === 0 && tr[1].lat === 7);
  eq('an empty route stays empty', C.trimTrack(undefined).length, 0);
  check('0,0 is not a position', !C.validLatLng(0, 0) && C.validLatLng(12.9, 77.6));
}

// ---------------------------------------------------------------- the address search, with a pretend Nominatim
async function geocodeTests() {
  const { createGeocoder, geocodeKey } = require(path.join(out, 'geocode.js'));
  let clock = 1_000_000;
  const calls = [];
  const g = createGeocoder({
    baseUrl: 'https://nominatim.example',
    userAgent: 'ShridharStock/test',
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetch: async (url, init) => {
      calls.push({ url, ua: init.headers['User-Agent'], at: clock });
      return { ok: true, status: 200, json: async () => [{ display_name: 'MG Road, Bengaluru', lat: '12.975', lon: '77.606' }, { display_name: 'bad', lat: 'x', lon: '1' }] };
    },
  });
  const a = await g.search('  MG Road,  Bengaluru ');
  check('a search answers with places', a.length === 1 && a[0].lat === 12.975 && a[0].lng === 77.606, JSON.stringify(a));
  check('it says who is asking', calls[0].ua === 'ShridharStock/test');
  check('and asks for India, as JSON', /format=jsonv2/.test(calls[0].url) && /countrycodes=in/.test(calls[0].url));
  await g.search('mg road, bengaluru');
  eq('the same search again is answered from the cache', calls.length, 1);
  eq('searches are the same when only spacing and case differ', geocodeKey('  A  b '), 'a b');
  await Promise.all([g.search('Hubli station'), g.search('Dharwad bus stand'), g.search('Hubli station')]);
  eq('two new searches ask twice (the repeat waits for the first)', calls.length, 3);
  check('each request is at least a second after the one before', calls.every((c, i) => i === 0 || c.at - calls[i - 1].at >= 1000), JSON.stringify(calls.map((c) => c.at)));
  eq('too short a search asks nothing', (await g.search('ab')).length, 0);
  clock += 25 * 3600_000;
  await g.search('MG Road,  Bengaluru');
  eq('a day later the answer is asked for again', calls.length, 4);
}

async function main() {
  await geocodeTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-deliv-'));
  {
    const repo = await require(path.join(out, 'store', 'file.js')).createFileRepo(dir);
    await require(path.join(out, 'demo', 'seed.js')).seedDemo(repo);
    await repo.close();
  }
  const port = 4600 + Math.floor(Math.random() * 300);
  const base = 'http://localhost:' + port;
  const proc = spawn(process.execPath, [path.join(out, 'index.js')], {
    env: { ...process.env, MONGO_URI: '', DEMO: '1', PORT: String(port), DATA_DIR: dir, JWT_SECRET: 'deliverytest', GEOCODE_URL: 'http://127.0.0.1:9' },
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
    const send = async (method, p, token, body) => {
      const r = await fetch(base + '/api' + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const get = (p, t) => send('GET', p, t);
    const post = (p, t, b) => send('POST', p, t, b ?? {});
    const as = async (role) => (await post('/demo/login-as', null, { role })).body.token;
    const A = await as('admin');
    const W = await as('worker');
    eq('a second worker is added', (await post('/people', A, { name: 'Suresh', phone: '9000000077', role: 'worker', pin: '2580' })).status, 201);
    const W2 = (await post('/auth/login', null, { phone: '9000000077', pin: '2580' })).body.token;
    check('and signs in', !!W2);

    // ---- settings: the rule
    const before = (await get('/admin/settings', A)).body;
    eq('the rule is in Settings', before.bikeMaxItems, 10);
    eq('a worker cannot read it', (await get('/admin/settings', W)).status, 403);
    eq('the rule can be changed', (await send('PUT', '/admin/settings', A, { bikeMaxItems: 2, bikeMaxAmount: 500, shopLat: 15.35, shopLng: 75.13 })).status, 200);
    const st = (await get('/admin/settings', A)).body;
    check('and keeps the rounding', st.bikeMaxItems === 2 && st.bikeMaxAmount === 500 && st.roundTo === before.roundTo && st.shopLat === 15.35, JSON.stringify(st));
    eq('a vehicle gets a kind', (await post('/admin/vehicles', A, { number: 'KA-25 X 1', type: 'Splendor', kind: 'bike' })).body.kind, 'bike');
    eq('the workers vehicle list carries it', (await get('/vehicles', W)).body.find((v) => v.number === 'KA-25 X 1').kind, 'bike');

    // ---- the draft from a bill
    const bills = (await get('/admin/bills', A)).body;
    const bill = bills.find((b) => b.customer) ?? bills[0];
    const dr = await get('/admin/deliveries/draft?bill=' + bill.no, A);
    eq('a draft from a bill', dr.status, 200);
    eq('with the bill number', dr.body.billNo, bill.no);
    eq('and the suggested vehicle by the rule', dr.body.vehicleKind, C.suggestVehicle({ itemCount: dr.body.itemCount, amount: dr.body.amount }, { bikeMaxItems: 2, bikeMaxAmount: 500 }));
    eq('a worker cannot make one', (await get('/admin/deliveries/draft?bill=' + bill.no, W)).status, 403);
    const workers = (await get('/admin/deliveries/workers', A)).body;
    check('the workers to pick from', workers.some((w) => w.id === 'p_worker') && !workers.some((w) => w.id === 'p_admin'), JSON.stringify(workers));
    const suresh = workers.find((w) => w.phone === '9000000077').id;

    // ---- assign
    const body = { billNo: bill.no, customerKey: 'cust-x', name: 'Meena', phone: '9876543210', address: '4th cross, Vidyanagar', lat: 15.37, lng: 75.12, itemCount: 1, amount: 200, amountDue: 200, personId: 'p_worker' };
    eq('needs a worker who signs in', (await post('/admin/deliveries', A, { ...body, personId: 'p_admin' })).status, 400);
    eq('and a pin', (await post('/admin/deliveries', A, { ...body, lat: undefined })).status, 400);
    const made = await post('/admin/deliveries', A, body);
    eq('a delivery is made', made.status, 201);
    const d = made.body;
    eq('assigned', d.status, 'pending');
    eq('small order: bike by the rule', d.vehicleKind, 'bike');
    eq('a big one: 4-wheeler', (await post('/admin/deliveries', A, { ...body, itemCount: 5, personId: suresh })).body.vehicleKind, 'car');
    eq('one tap switches it', (await send('PUT', '/admin/deliveries/' + d.id, A, { vehicleKind: 'car' })).body.vehicleKind, 'car');
    const cust = (await get('/admin/customers', A)).body.find((c) => c.key === 'cust-x');
    check('the pin is kept on the customer', cust && cust.lat === 15.37 && cust.lng === 75.12, JSON.stringify(cust));
    eq('and the next draft reuses it', (await get('/admin/deliveries/draft?customer=cust-x', A)).body.lat, 15.37);

    // ---- roles
    const mine = (await get('/worker/deliveries', W)).body;
    check('the worker sees their delivery', mine.length === 1 && mine[0].id === d.id, JSON.stringify(mine.map((x) => x.id)));
    const theirs = (await get('/worker/deliveries', W2)).body;
    check('the other worker sees only their own', theirs.length === 1 && theirs[0].id !== d.id);
    eq('nor can start someone else', (await post('/worker/deliveries/' + d.id + '/start', W2)).status, 404);
    eq('nor send a position on it', (await post('/worker/deliveries/' + d.id + '/position', W2, { lat: 1, lng: 1 })).status, 404);
    eq('a worker cannot read the admin list', (await get('/admin/deliveries', W)).status, 403);
    eq('nor search addresses', (await get('/admin/geocode?q=hubli', W)).status, 403);
    eq('the search says plainly when it is not answering', (await get('/admin/geocode?q=hubli', A)).status, 502);

    // ---- lifecycle
    eq('no position before Start', (await post('/worker/deliveries/' + d.id + '/position', W, { lat: 15.36, lng: 75.13 })).status, 409);
    eq('Start: on the way', (await post('/worker/deliveries/' + d.id + '/start', W)).body.status, 'out');
    eq('the worker cannot change once on the way', (await send('PUT', '/admin/deliveries/' + d.id, A, { personId: suresh })).status, 409);
    eq('a position is kept', (await post('/worker/deliveries/' + d.id + '/position', W, { lat: 15.351, lng: 75.131 })).body.kept, true);
    eq('another within 3 s is dropped', (await post('/worker/deliveries/' + d.id + '/position', W, { lat: 15.352, lng: 75.132 })).body.kept, false);
    eq('a nonsense position is refused', (await post('/worker/deliveries/' + d.id + '/position', W, { lat: 200, lng: 75 })).status, 400);
    await new Promise((r) => setTimeout(r, 3100));
    eq('the next is kept', (await post('/worker/deliveries/' + d.id + '/position', W, { lat: 15.36, lng: 75.125 })).body.kept, true);
    await new Promise((r) => setTimeout(r, 3100));
    await post('/worker/deliveries/' + d.id + '/position', W, { lat: 15.369, lng: 75.121 });
    const live = (await get('/admin/deliveries', A)).body;
    const ld = live.deliveries.find((x) => x.id === d.id);
    check('the admin sees it moving, with the trail', ld.status === 'out' && ld.pos.lat === 15.369 && ld.track.length === 3, JSON.stringify(ld));
    check('with the worker name and the shop', ld.personName === 'Ravi (shop)' && live.shop.lat === 15.35);
    check('the worker list carries no route', !('track' in (await get('/worker/deliveries', W)).body[0]));
    eq('Delivered needs a number', (await post('/worker/deliveries/' + d.id + '/delivered', W, { collected: 'lots' })).status, 400);
    const done = await post('/worker/deliveries/' + d.id + '/delivered', W, { collected: 200 });
    eq('Delivered', done.body.status, 'delivered');
    eq('with what was collected', done.body.collected, 200);

    // ---- cleanup
    const after = (await get('/admin/deliveries', A)).body.deliveries.find((x) => x.id === d.id);
    check('the route is trimmed to its start and end', after.track.length === 2 && after.track[0].lat === 15.351 && after.track[1].lat === 15.369, JSON.stringify(after.track));
    check('and the live position is gone', !after.pos);
    eq('no more positions once it is over', (await post('/worker/deliveries/' + d.id + '/position', W, { lat: 15.36, lng: 75.13 })).status, 409);
    eq('nor a second finish', (await post('/worker/deliveries/' + d.id + '/failed', W, { reason: 'x' })).status, 409);
    const other = theirs[0];
    eq('Could not deliver needs a reason', (await post('/worker/deliveries/' + other.id + '/failed', W2, {})).status, 400);
    const f = await post('/worker/deliveries/' + other.id + '/failed', W2, { reason: 'Door locked' });
    check('Could not deliver, with the reason', f.body.status === 'failed' && f.body.reason === 'Door locked' && f.body.track.length === 0, JSON.stringify(f.body));
  } catch (err) {
    failed++;
    console.log('FAIL threw: ' + err.stack + '\n' + log);
  } finally {
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('deliverytest: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main();
