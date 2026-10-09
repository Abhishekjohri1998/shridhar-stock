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
  eq('a whole trip fits on the trail (500 points)', C.TRACK_MAX, 500);
  check('0,0 is not a position', !C.validLatLng(0, 0) && C.validLatLng(12.9, 77.6));
  // the door code, nearby, the timeline
  check('a code is 4 digits', /^\d{4}$/.test(C.makeOtp()) && C.makeOtp(() => 0) === '0000' && C.makeOtp(() => 0.0471) === '0471');
  eq('nearby is 300 m', C.NEARBY_M, 300);
  check('250 m away is nearby', C.isNearby({ lat: 15.35, lng: 75.13 }, { lat: 15.35225, lng: 75.13 }));
  check('500 m away is not', !C.isNearby({ lat: 15.35, lng: 75.13 }, { lat: 15.3545, lng: 75.13 }));
  check('no pin is never nearby', !C.isNearby({ lat: 15.35, lng: 75.13 }, {}));
  const steps = (d) => C.deliverySteps(d).map((x) => (x.done ? 'D' : x.active ? 'A' : '-')).join('');
  eq('assigned: packing is the step now', steps({ status: 'pending', times: { pending: 'a' } }), 'A----');
  eq('on the way', steps({ status: 'out', times: { pending: 'a', out: 'b' } }), 'DDA--');
  eq('nearby', steps({ status: 'out', times: { pending: 'a', out: 'b' }, nearbyAt: 'c' }), 'DDDA-');
  eq('delivered: every step lit', steps({ status: 'delivered', times: { pending: 'a', out: 'b', delivered: 'd' } }), 'DDDDD');
  eq('the payment kinds', C.PAID_BY.join(), 'cash,upi,paid,credit');
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

// ---------------------------------------------------------------- the road route, with a pretend OSRM
async function routeTests() {
  const { createRouter, downsample, routeKey } = require(path.join(out, 'route.js'));
  let clock = 5_000_000;
  const calls = [];
  const line = Array.from({ length: 1000 }, (_, i) => [75.13 - i * 0.00001, 15.35 + i * 0.00002]);
  const r = createRouter({
    baseUrl: 'https://osrm.example/',
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetch: async (url) => {
      calls.push({ url, at: clock });
      if (url.includes('75.5')) return { ok: false, status: 500, json: async () => ({}) };
      if (url.includes('75.6')) throw new Error('down');
      return { ok: true, status: 200, json: async () => ({ code: 'Ok', routes: [{ distance: 3456, duration: 610, geometry: { coordinates: line } }] }) };
    },
  });
  const a = await r.route({ lat: 15.35, lng: 75.13 }, { lat: 15.37, lng: 75.12 });
  check('a road comes back with km and minutes', a && a.km === 3.5 && a.minutes === 10, JSON.stringify(a && { km: a.km, minutes: a.minutes }));
  check('its points are cut down to 300, keeping both ends', a.points.length === 300 && a.points[0].lng === 75.13 && a.points[299].lat === line[999][1], a.points.length);
  check('OSRM is asked lng,lat;lng,lat with the full geometry', calls[0].url === 'https://osrm.example/route/v1/driving/75.13,15.35;75.12,15.37?overview=full&geometries=geojson', calls[0].url);
  await r.route({ lat: 15.35004, lng: 75.13004 }, { lat: 15.37, lng: 75.12 });
  eq('a few metres away is answered from the cache', calls.length, 1);
  eq('the cache key rounds to about 100 m', routeKey({ lat: 15.35004, lng: 75.13 }, { lat: 1, lng: 2 }), '15.350,75.130,1.000,2.000');
  await Promise.all([r.route({ lat: 15.4, lng: 75.2 }, { lat: 15.37, lng: 75.12 }), r.route({ lat: 15.41, lng: 75.2 }, { lat: 15.37, lng: 75.12 })]);
  check('each request is at least a second after the one before', calls.every((c, i) => i === 0 || c.at - calls[i - 1].at >= 1000), JSON.stringify(calls.map((c) => c.at)));
  eq('a router error is no road', await r.route({ lat: 15.35, lng: 75.5 }, { lat: 15.37, lng: 75.12 }), null);
  eq('a router that throws is no road', await r.route({ lat: 15.35, lng: 75.6 }, { lat: 15.37, lng: 75.12 }), null);
  eq('a short line is left alone', downsample([1, 2, 3], 300).length, 3);
}

async function main() {
  await geocodeTests();
  await routeTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-deliv-'));
  {
    const repo = await require(path.join(out, 'store', 'file.js')).createFileRepo(dir);
    await require(path.join(out, 'demo', 'seed.js')).seedDemo(repo);
    await repo.close();
  }
  const port = 4600 + Math.floor(Math.random() * 300);
  const base = 'http://localhost:' + port;
  const proc = spawn(process.execPath, [path.join(out, 'index.js')], {
    env: { ...process.env, MONGO_URI: '', DEMO: '1', PORT: String(port), DATA_DIR: dir, JWT_SECRET: 'deliverytest', GEOCODE_URL: 'http://127.0.0.1:9', ROUTE_URL: 'http://127.0.0.1:9' },
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
    await new Promise((r) => setTimeout(r, 3100));
    eq('a rough fix (over 100 m) is not drawn', (await post('/worker/deliveries/' + d.id + '/position', W, { lat: 15.5, lng: 75.5, accuracy: 900 })).body.kept, false);
    const rt = await get('/admin/deliveries/' + d.id + '/route', A);
    check('the road route, with the router not answering, is empty and not an error', rt.status === 200 && Array.isArray(rt.body.points) && rt.body.points.length === 0, JSON.stringify(rt));
    eq('a worker cannot ask for the road', (await get('/admin/deliveries/' + d.id + '/route', W)).status, 403);
    eq('nor is there a road for no delivery', (await get('/admin/deliveries/nope/route', A)).status, 404);
    const live = (await get('/admin/deliveries', A)).body;
    const ld = live.deliveries.find((x) => x.id === d.id);
    check('the admin sees it moving, with the trail', ld.status === 'out' && ld.pos.lat === 15.369 && ld.track.length === 3, JSON.stringify(ld));
    check('with the worker name and the shop', ld.personName === 'Ravi (shop)' && live.shop.lat === 15.35);
    check('the worker list carries no route', !('track' in (await get('/worker/deliveries', W)).body[0]));
    eq('Delivered needs a number', (await post('/worker/deliveries/' + d.id + '/delivered', W, { collected: 'lots' })).status, 400);
    check('a door code is made', /^\d{4}$/.test(d.otp), d.otp);
    check('the worker never sees it', !('otp' in (await get('/worker/deliveries', W)).body[0]));
    const wrong = d.otp === '0000' ? '1111' : '0000';
    const bad = await post('/worker/deliveries/' + d.id + '/delivered', W, { collected: 200, otp: wrong });
    check('a wrong code is refused, with the tries left', bad.status === 400 && /4 tries left/.test(bad.body.error), JSON.stringify(bad.body));
    eq('no code is wrong too', (await post('/worker/deliveries/' + d.id + '/delivered', W, { collected: 200 })).status, 400);
    eq('a bad payment kind is refused', (await post('/worker/deliveries/' + d.id + '/delivered', W, { collected: 200, otp: d.otp, paidBy: 'cheque' })).status, 400);
    eq('a photo too big is refused', (await post('/worker/deliveries/' + d.id + '/delivered', W, { collected: 200, otp: d.otp, photo: 'data:image/jpeg;base64,' + 'A'.repeat(400_001) })).status, 400);
    eq('something not a photo is refused', (await post('/worker/deliveries/' + d.id + '/delivered', W, { collected: 200, otp: d.otp, photo: 'javascript:alert(1)' })).status, 400);
    const photo = 'data:image/jpeg;base64,' + Buffer.from('pretend jpeg').toString('base64');
    const done = await post('/worker/deliveries/' + d.id + '/delivered', W, { collected: 200, otp: d.otp, paidBy: 'upi', photo });
    check('the right code delivers it', done.status === 200, JSON.stringify(done.body));
    eq('with how it was paid', done.body.paidBy, 'upi');
    check('and a photo kept on its own', !!done.body.photoId && !('data' in done.body));
    eq('the admin sees the photo', (await get('/admin/deliveries/' + d.id + '/photo', A)).body.data, photo);
    eq('the worker sees their own', (await get('/worker/deliveries/' + d.id + '/photo', W)).body.data, photo);
    eq('another worker cannot', (await get('/worker/deliveries/' + d.id + '/photo', W2)).status, 404);
    eq('nor through the admin address', (await get('/admin/deliveries/' + d.id + '/photo', W2)).status, 403);
    check('the list stays light: no photo in it', !JSON.stringify((await get('/admin/deliveries', A)).body).includes('pretend'));
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

    // ---- the customer's links
    const plain = async (method, p, b) => {
      const r = await fetch(base + '/api' + p, { method, headers: b ? { 'Content-Type': 'application/json' } : {}, ...(b ? { body: JSON.stringify(b) } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const noPin = await post('/admin/deliveries', A, { ...body, customerKey: 'cust-y', phone: '9876500000', lat: undefined, lng: undefined });
    eq('a delivery can be sent before the pin', noPin.status, 201);
    const np = noPin.body;
    check('with its two links', /^\/t\/dl_/.test(np.links.track) && /^\/l\/dl_/.test(np.links.locate), JSON.stringify(np.links));
    eq('Start is refused with no pin', (await post('/worker/deliveries/' + np.id + '/start', W)).status, 409);
    const tok = (u) => u.split('/').pop();
    eq('a wrong token is not found', (await plain('GET', '/t/' + np.id + '/AAAAAAAAAAAAAAAA')).status, 404);
    eq('the location token does not open tracking', (await plain('GET', '/t/' + np.id + '/' + tok(np.links.locate))).status, 404);
    eq('nor the tracking token send a location', (await plain('POST', '/l/' + np.id + '/' + tok(np.links.track), { lat: 15.4, lng: 75.1 })).status, 404);
    eq('the location page opens', (await plain('GET', np.links.locate.replace(/^/, ''))).status, 200);
    eq('a nonsense location is refused', (await plain('POST', np.links.locate, { lat: 0, lng: 0 })).status, 400);
    eq('the customer sends their location', (await plain('POST', np.links.locate, { lat: 15.36, lng: 75.12, accuracy: 20 })).status, 200);
    const located = (await get('/admin/deliveries', A)).body.deliveries.find((x) => x.id === np.id);
    check('it sets the pin', located.lat === 15.36 && located.lng === 75.12 && !!located.locatedAt, JSON.stringify(located));
    const cy = (await get('/admin/customers', A)).body.find((c) => c.key === 'cust-y');
    check('and keeps it on the customer', cy && cy.lat === 15.36, JSON.stringify(cy));
    eq('now Start works', (await post('/worker/deliveries/' + np.id + '/start', W)).body.status, 'out');
    const far = await post('/worker/deliveries/' + np.id + '/position', W, { lat: 15.33, lng: 75.12 });
    check('a position works out the arrival time (straight line, router down)', far.body.kept && far.body.eta >= 1 && !far.body.nearby, JSON.stringify(far.body));
    const tv = await plain('GET', np.links.track);
    eq('the tracking page opens with no sign-in', tv.status, 200);
    const pub = tv.body;
    check('it shows the worker, the code, the arrival and the steps', pub.worker === 'Ravi' && pub.otp === np.otp && pub.eta.minutes === far.body.eta && pub.steps.length === 5 && pub.pos.lat === 15.33, JSON.stringify(pub));
    const txt = JSON.stringify(pub);
    check('but no phone numbers, trail, ids or amounts beyond what to pay', !txt.includes('9876500000') && !txt.includes('9000000') && !('track' in pub) && !('personId' in pub) && !('customerKey' in pub) && !('amount' in pub) && !('collected' in pub) && !('eta' in pub && 'from' in pub.eta) && !txt.includes('p_worker'), txt);
    eq('what to pay is there', pub.toPay, 200);
    await new Promise((r) => setTimeout(r, 3100));
    const near = await post('/worker/deliveries/' + np.id + '/position', W, { lat: 15.3585, lng: 75.12 });
    check('within 300 m it is Nearby', near.body.nearby === true, JSON.stringify(near.body));
    const pub2 = (await plain('GET', np.links.track)).body;
    check('and the customer sees the Nearby step', pub2.steps[3].active && pub2.steps[2].done, JSON.stringify(pub2.steps));
    // too many tries
    for (let i = 0; i < 4; i++) await post('/worker/deliveries/' + np.id + '/delivered', W, { collected: 0, otp: np.otp === '0000' ? '1111' : '0000' });
    const fifth = await post('/worker/deliveries/' + np.id + '/delivered', W, { collected: 0, otp: np.otp === '0000' ? '1111' : '0000' });
    check('the fifth wrong code: call the shop', fifth.status === 429 && /Call the shop/.test(fifth.body.error), JSON.stringify(fifth.body));
    eq('even the right code is refused after that', (await post('/worker/deliveries/' + np.id + '/delivered', W, { collected: 0, otp: np.otp })).status, 429);
    eq('the admin lets it go without the code', (await send('PUT', '/admin/deliveries/' + np.id, A, { otpSkipped: true })).body.otpSkipped, true);
    check('the customer page no longer shows a code', !('otp' in (await plain('GET', np.links.track)).body));
    eq('skipped: delivered with no code', (await post('/worker/deliveries/' + np.id + '/delivered', W, { collected: 200, paidBy: 'cash' })).body.status, 'delivered');
    const fin = await plain('GET', np.links.track);
    check('tracking shows it delivered for a while', fin.status === 200 && fin.body.status === 'delivered' && !!fin.body.deliveredAt && !fin.body.pos && !('otp' in fin.body), JSON.stringify(fin.body));
    eq('the location link has ended', (await plain('POST', np.links.locate, { lat: 15.36, lng: 75.12 })).status, 404);
    const failedLinks = (await get('/admin/deliveries', A)).body.deliveries.find((x) => x.id === other.id).links;
    eq('a delivery that could not be delivered has no tracking', (await plain('GET', failedLinks.track)).status, 404);
    eq('a wrong id is not found', (await plain('GET', '/t/dl_nope/' + tok(np.links.track))).status, 404);
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
