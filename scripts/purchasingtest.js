/*
 * Purchasing (agent B), end to end against a real server on the JSON file store in a temp
 * folder: supplier details and the item <-> supplier link, carriers and trips, the landed cost on
 * receive, expiry lots used first-expiring-first through sales and transfers, Home's expiring
 * list and the product list's facts; vendor history (delivery, checklists, payments). Never a database.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, execSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, '.test-build', 'purchasing');
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

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-purchasing-'));
  // A spare range, clear of 4100/4200 (running servers) and apitest's 4600-4900.
  // Mirrored bills for the price-volatility fact: two changes in 90 days, one older change left out.
  const ago = (d) => new Date(Date.now() - d * 86400_000).toISOString();
  const vb = (id, at, rate) => ({ id, no: Number(id.slice(2)), at, lines: [{ i: 0, name: 'Vol', qty: 1, rate, amount: rate, state: 'typed-match', itemId: 'itm_vol', unit: 'pc' }], total: rate, paid: rate, balance: 0 });
  fs.writeFileSync(path.join(dir, 'inventory.json'), JSON.stringify({ docs: { bills: Object.fromEntries([vb('b_1', ago(200), 5), vb('b_2', ago(20), 10), vb('b_3', ago(10), 12), vb('b_4', ago(5), 10)].map((b) => [b.id, b])) } }));
  const port = 5300 + Math.floor(Math.random() * 300);
  const base = 'http://localhost:' + port;
  const proc = spawn(process.execPath, [path.join(out, 'index.js')], {
    env: { ...process.env, MONGO_URI: '', PORT: String(port), DATA_DIR: dir, JWT_SECRET: 'purchasingtest-secret', SEED_ADMIN_PHONE: ADMIN_PHONE, SEED_ADMIN_PIN: ADMIN_PIN },
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
    let token = '';
    const call = async (p, { method = 'GET', body } = {}) => {
      const r = await fetch(base + '/api' + p, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      let json = null;
      try {
        json = await r.json();
      } catch {
        /* none */
      }
      return { status: r.status, body: json };
    };
    token = (await call('/auth/login', { method: 'POST', body: { phone: ADMIN_PHONE, pin: ADMIN_PIN } })).body.token;
    const shop = (await call('/locations')).body[0].id;
    const godown = (await call('/locations', { method: 'POST', body: { name: 'Godown', nameKn: 'ಗೋದಾಮು' } })).body.id;

    const atta = (
      await call('/items', {
        method: 'POST',
        body: {
          nameEn: 'Atta',
          nameKn: 'ಆಟ್ಟಾ',
          units: [
            { code: 'g', label: 'g', labelKn: '', perBase: 1, price: 0.06 },
            { code: 'kg', label: 'Kg', labelKn: '', perBase: 1000, price: 60 },
            { code: 'bag', label: 'Bag', labelKn: '', perBase: 50000, price: 2900 },
          ],
          aliases: [],
          racks: {},
        },
      })
    ).body;
    const soap = (await call('/items', { method: 'POST', body: { nameEn: 'Wheel', nameKn: 'ವೀಲ್', units: [{ code: 'pc', label: 'pc', labelKn: '', perBase: 1, price: 10 }, { code: 'box', label: 'Box', labelKn: '', perBase: 60, price: 580 }], aliases: [], racks: {} } })).body;
    check('B: two items made', !!atta.id && !!soap.id, JSON.stringify([atta, soap]));

    // ------------------------------------------------ suppliers: details, contacts, items supplied
    const sup = await call('/admin/suppliers', {
      method: 'POST',
      body: { name: 'Mysore Traders', phone: '', gst: '29abcde1234f1z5', contacts: [{ name: 'Ravi', role: 'Owner', phone: '9811111111' }, { name: 'Manju', role: 'Son' }], itemIds: [atta.id] },
    });
    eq('B: a supplier with no company phone is fine', sup.status, 201);
    check('B: GST kept, in capitals', sup.body.gst === '29ABCDE1234F1Z5', JSON.stringify(sup.body));
    check('B: contacts kept, a missing phone left out', sup.body.contacts.length === 2 && sup.body.contacts[1].phone === undefined && sup.body.contacts[0].role === 'Owner');
    const supId = sup.body.id;
    const item = async (id) => (await call('/items?all=1')).body.find((i) => i.id === id);
    check('B: items supplied are written onto the item', (await item(atta.id)).suppliers?.includes(supId));
    eq('B: and read back from the supplier', (await call('/admin/suppliers/' + supId + '/items')).body.map((i) => i.id).join(), atta.id);
    await call('/admin/suppliers/' + supId, { method: 'PUT', body: { name: 'Mysore Traders', phone: '0821 222', itemIds: [soap.id] } });
    check('B: changing the list takes the supplier off one item and onto the other', !(await item(atta.id)).suppliers?.includes(supId) && (await item(soap.id)).suppliers?.includes(supId));
    const listed = (await call('/admin/suppliers')).body.find((s) => s.id === supId);
    check('B: an edit without contacts keeps them', listed.contacts.length === 2 && listed.gst === '29ABCDE1234F1Z5' && listed.phone === '0821 222', JSON.stringify(listed));
    await call('/admin/suppliers/' + supId, { method: 'PUT', body: { name: 'Mysore Traders', phone: '0821 222', contacts: [], itemIds: [atta.id, soap.id] } });
    check('B: contacts can be cleared', !(await call('/admin/suppliers')).body.find((s) => s.id === supId).contacts);
    eq('B: a contact needs a name', (await call('/admin/suppliers', { method: 'POST', body: { name: 'X', contacts: [{ name: ' ' }] } })).status, 400);

    // ------------------------------------------------ carriers and trips
    eq('B: a carrier needs a name', (await call('/admin/carriers', { method: 'POST', body: { name: '' } })).status, 400);
    const car = (await call('/admin/carriers', { method: 'POST', body: { name: 'Shivu', phone: '9822222222', vehicleNo: 'ka 09 ab 1234' } })).body;
    eq('B: vehicle number in capitals', car.vehicleNo, 'KA 09 AB 1234');
    await call('/admin/carriers/' + car.id, { method: 'PUT', body: { name: 'Shivu', phone: '9822222222', vehicleNo: 'KA 09 AB 1234', notes: 'Mon, Thu' } });
    const trip = await call('/admin/trips', { method: 'POST', body: { date: '2026-10-16', carrierId: car.id, supplierId: supId, lines: [{ itemId: atta.id, unit: 'bag', qty: 1 }, { itemId: soap.id, unit: 'box', qty: 2 }], charge: 160 } });
    eq('B: a trip is saved', trip.status, 201);
    eq('B: a trip for an unknown carrier is refused', (await call('/admin/trips', { method: 'POST', body: { date: '2026-10-16', carrierId: 'nope', charge: 1 } })).status, 404);
    eq('B: a unit the item does not have is refused', (await call('/admin/trips', { method: 'POST', body: { date: '2026-10-16', carrierId: car.id, lines: [{ itemId: soap.id, unit: 'tin', qty: 1 }], charge: 1 } })).status, 400);
    const cars = (await call('/admin/carriers')).body;
    check('B: carriers come with their trips', cars.carriers[0].notes === 'Mon, Thu' && cars.trips.length === 1 && cars.trips[0].charge === 160);
    eq('B: the trip is open for linking', (await call('/admin/trips/open')).body.length, 1);

    // ------------------------------------------------ receive with the trip: landed cost and lots
    const po = (await call('/admin/pos', { method: 'POST', body: { supplierId: supId, to: godown, lines: [{ itemId: atta.id, unit: 'bag', qty: 1, cost: 2700 }, { itemId: soap.id, unit: 'box', qty: 2, cost: 540 }] } })).body;
    const rec = await call('/admin/pos/' + po.id + '/receive', { method: 'POST', body: { updateCost: true, tripId: trip.body.id, expiry: { [soap.id]: '2026-10-25', [atta.id]: 'soon' } } });
    eq('B: an expiry that is not a date is refused', rec.status, 400);
    const ok = await call('/admin/pos/' + po.id + '/receive', { method: 'POST', body: { updateCost: true, tripId: trip.body.id, expiry: { [soap.id]: '2026-10-25' } } });
    eq('B: received with the trip linked', ok.status, 200);
    // Values 2700 and 1080: the ₹160 shares 114.29 and 45.71.
    const a2 = await item(atta.id);
    const s2 = await item(soap.id);
    const cost = (it, code) => it.units.find((u) => u.code === code).cost;
    eq('B: bag landed cost (2700 + 114.29) / 1', cost(a2, 'bag'), 2814.29);
    check('B: kg and g costs worked out from the bag', cost(a2, 'kg') === 56.29 && cost(a2, 'g') === 0.0563, JSON.stringify(a2.units));
    eq('B: box landed cost (1080 + 45.71) / 2', cost(s2, 'box'), 562.86);
    eq('B: piece cost from the box', cost(s2, 'pc'), 9.3809);
    const poAfter = (await call('/admin/pos?limit=5')).body.orders.find((x) => x.id === po.id);
    const r = poAfter.received.find((x) => x.itemId === soap.id);
    check('B: the receipt keeps the share, the landed cost and the expiry', r.delivery === 45.71 && r.landed === 562.855 && r.expiry === '2026-10-25', JSON.stringify(poAfter.received));
    check('B: the trip is linked to the receipt', (await call('/admin/carriers')).body.trips[0].poId === po.id && (await call('/admin/trips/open')).body.length === 0);
    eq('B: a linked trip keeps its charge', (await call('/admin/trips/' + trip.body.id, { method: 'PUT', body: { date: '2026-10-16', carrierId: car.id, charge: 1 } })).status, 409);
    eq('B: and cannot be removed', (await call('/admin/trips/' + trip.body.id, { method: 'DELETE' })).status, 409);
    const po2 = (await call('/admin/pos', { method: 'POST', body: { supplierId: supId, to: godown, lines: [{ itemId: soap.id, unit: 'box', qty: 1, cost: 540 }] } })).body;
    eq('B: one trip cannot go into two receipts', (await call('/admin/pos/' + po2.id + '/receive', { method: 'POST', body: { tripId: trip.body.id } })).status, 409);
    const typed = await call('/admin/pos/' + po2.id + '/receive', { method: 'POST', body: { updateCost: true, delivery: 30, expiry: { [soap.id]: '2026-11-30' } } });
    eq('B: a delivery charge can be typed in instead', typed.status, 200);
    eq('B: box cost is now (540 + 30) / 1', cost(await item(soap.id), 'box'), 570);

    let lots = (await call('/admin/items/' + soap.id + '/lots')).body;
    check('B: two lots of soap at the godown, in pieces, soonest first', lots.length === 2 && lots[0].qty === 120 && lots[0].expiry === '2026-10-25' && lots[1].qty === 60 && lots.every((l) => l.placeId === godown), JSON.stringify(lots));

    // ------------------------------------------------ FEFO: a correction down, then a transfer
    await call('/stock/adjust', { method: 'POST', body: { itemId: soap.id, locationId: godown, actual: 150, reason: 'damaged', requestId: 'b1' } });
    lots = (await call('/admin/items/' + soap.id + '/lots')).body;
    check('B: 30 out of the godown come off the October lot', lots[0].qty === 90 && lots[1].qty === 60, JSON.stringify(lots));
    const tr = (await call('/admin/transfers', { method: 'POST', body: { from: godown, to: shop, lines: [{ itemId: soap.id, qty: 100 }] } })).body;
    await call('/transfers/' + tr.id + '/send', { method: 'POST', body: {} });
    lots = (await call('/admin/items/' + soap.id + '/lots')).body;
    const at = (place) => lots.filter((l) => l.placeId === place).reduce((s, l) => s + l.qty, 0);
    check('B: sending takes October first: 90 + 10 of November go in transit', at(godown) === 50 && at('transit:transfer ' + tr.no) === 100, JSON.stringify(lots));
    await call('/transfers/' + tr.id + '/receive', { method: 'POST', body: { received: { [soap.id]: 95 } } });
    lots = (await call('/admin/items/' + soap.id + '/lots')).body;
    const shopLots = lots.filter((l) => l.placeId === shop);
    check('B: received short: 95 land at the shop, October first, nothing left in transit', shopLots.reduce((s, l) => s + l.qty, 0) === 95 && shopLots.find((l) => l.expiry === '2026-10-25').qty === 90 && !lots.some((l) => l.placeId.startsWith('transit:')), JSON.stringify(lots));
    // A sale-like move out of the shop (a correction) takes the October lot first, and never fails past the lots.
    const adj = await call('/stock/adjust', { method: 'POST', body: { itemId: soap.id, locationId: shop, actual: 0, reason: 'counted', requestId: 'b2' } });
    eq('B: taking more than the lots hold is not refused', adj.status, 200);
    lots = (await call('/admin/items/' + soap.id + '/lots')).body;
    check('B: the shop’s lots are used up', !lots.some((l) => l.placeId === shop), JSON.stringify(lots));

    // ------------------------------------------------ Home and the list
    const expiring = (await call('/admin/expiring?days=400')).body;
    check('B: expiring lists lots with names, soonest first', expiring.length >= 1 && expiring[0].nameEn === 'Wheel' && expiring.every((l, i) => i === 0 || expiring[i - 1].expiry <= l.expiry), JSON.stringify(expiring));
    const facts = (await call('/admin/list-facts')).body;
    check('B: list facts give the soonest expiry per item', facts.expiry[soap.id] === '2026-11-30', JSON.stringify(facts));
    check('B: and sold quantities (none yet)', facts.sold && Object.keys(facts.sold).length === 0);
    // 10 -> 12 -> 10 in 90 days (the older 5 left out): 2 changes, spread (12-10)/10.667.
    check('B: and price changes in 90 days from mirrored bills', facts.volatility?.itm_vol?.changes === 2 && facts.volatility.itm_vol.spread === 0.188, JSON.stringify(facts.volatility));

    // ------------------------------------------------ split receiving: a qty per place
    const dal = (await call('/items', { method: 'POST', body: { nameEn: 'Toor dal', nameKn: 'ತೊಗರಿ', units: [{ code: 'kg', label: 'Kg', labelKn: '', perBase: 1, price: 120 }, { code: 'bag', label: 'Bag', labelKn: '', perBase: 25, price: 2900 }], aliases: [], racks: {} } })).body;
    const po3 = (await call('/admin/pos', { method: 'POST', body: { supplierId: supId, to: shop, lines: [{ itemId: dal.id, unit: 'bag', qty: 10, cost: 2500 }] } })).body;
    eq('B: a split that does not add up is refused', (await call('/admin/pos/' + po3.id + '/receive', { method: 'POST', body: { got: { [dal.id]: { qty: 10, places: [{ placeId: shop, qty: 5 }, { placeId: godown, qty: 4 }] } } } })).status, 400);
    eq('B: a split to an unknown place is refused', (await call('/admin/pos/' + po3.id + '/receive', { method: 'POST', body: { got: { [dal.id]: { qty: 10, places: [{ placeId: shop, qty: 5 }, { placeId: 'loc_none', qty: 5 }] } } } })).status, 400);
    const sr = await call('/admin/pos/' + po3.id + '/receive', { method: 'POST', body: { delivery: 100, got: { [dal.id]: { qty: 10, cost: 2500, places: [{ placeId: shop, qty: 5 }, { placeId: godown, qty: 5 }] } }, expiry: { [dal.id]: '2027-01-31' } } });
    eq('B: Shop 5 bag, Godown 5 bag is received', sr.status, 200);
    const lvl = (await call('/stock')).body.filter((s) => s.itemId === dal.id);
    const lvAt = (pl) => lvl.find((s) => s.locationId === pl)?.qty ?? 0;
    check('B: 125 kg went to each place', lvAt(shop) === 125 && lvAt(godown) === 125, JSON.stringify(lvl));
    const dalLots = (await call('/admin/items/' + dal.id + '/lots')).body;
    check('B: a lot per place with the expiry', dalLots.length === 2 && dalLots.every((l) => l.qty === 125 && l.expiry === '2027-01-31') && new Set(dalLots.map((l) => l.placeId)).size === 2, JSON.stringify(dalLots));
    const r3 = (await call('/admin/pos?view=all')).body;
    const po3After = (r3.orders ?? r3).find((x) => x.id === po3.id);
    const rc3 = po3After && po3After.received[0];
    check('B: the receipt keeps the split and the landed cost as before', rc3 && rc3.places.length === 2 && rc3.landed === 2510 && rc3.delivery === 100, JSON.stringify(po3After));
    // The old single-place body still works.
    const po4 = (await call('/admin/pos', { method: 'POST', body: { supplierId: supId, to: shop, lines: [{ itemId: dal.id, unit: 'kg', qty: 3, cost: 100 }] } })).body;
    eq('B: a receive with only "to" still works', (await call('/admin/pos/' + po4.id + '/receive', { method: 'POST', body: { to: godown } })).status, 200);
    check('B: all of it at that place', (await call('/stock')).body.find((s) => s.itemId === dal.id && s.locationId === godown).qty === 128);

    // ------------------------------------------------ expiry for stock already on hand
    eq('B: more than the undated stock is refused', (await call('/admin/lots', { method: 'POST', body: { itemId: dal.id, placeId: godown, qty: 4, expiry: '2027-03-01' } })).status, 400);
    const ml = await call('/admin/lots', { method: 'POST', body: { itemId: dal.id, placeId: godown, qty: 3, unit: 'kg', expiry: '2027-03-01' } });
    check('B: a date put on 3 kg on the shelf', ml.status === 201 && ml.body.ref === 'manual' && ml.body.qty === 3, JSON.stringify(ml.body));
    eq('B: a bad date is refused', (await call('/admin/lots', { method: 'POST', body: { itemId: dal.id, placeId: godown, qty: 1, expiry: 'soon' } })).status, 400);
    eq('B: the lot can be changed', (await call('/admin/lots/' + ml.body.id, { method: 'PUT', body: { placeId: godown, qty: 2, expiry: '2027-04-01' } })).status, 200);
    let ml2 = (await call('/admin/items/' + dal.id + '/lots')).body.find((l) => l.id === ml.body.id);
    check('B: with its new date and qty', ml2.qty === 2 && ml2.expiry === '2027-04-01', JSON.stringify(ml2));
    eq('B: and removed', (await call('/admin/lots/' + ml.body.id, { method: 'DELETE' })).status, 200);
    check('B: gone', !(await call('/admin/items/' + dal.id + '/lots')).body.some((l) => l.id === ml.body.id));
    eq('B: an unknown lot is 404', (await call('/admin/lots/lot_none', { method: 'DELETE' })).status, 404);

    // ------------------------------------------------ vendor history: delivery, checklists, payments
    const v = (await call('/admin/suppliers', { method: 'POST', body: { name: 'Hubli Oils', phone: '9833333333' } })).body.id;
    const oil = (await call('/items', { method: 'POST', body: { nameEn: 'Oil', nameKn: 'ಎಣ್ಣೆ', units: [{ code: 'ltr', label: 'Ltr', labelKn: '', perBase: 1, price: 150 }, { code: 'tin', label: 'Tin', labelKn: '', perBase: 15, price: 2100 }], aliases: [], racks: {} } })).body;
    eq('V: an unknown carrier is refused', (await call('/admin/pos', { method: 'POST', body: { supplierId: v, to: godown, lines: [{ itemId: oil.id, unit: 'tin', qty: 1, cost: 1 }], delivery: { mode: 'carrier', carrierId: 'nope' } } })).status, 404);
    // Self delivery: 10 tins at 1800 and 5 kg dal at 100.
    const vs = await call('/admin/pos', { method: 'POST', body: { supplierId: v, to: godown, lines: [{ itemId: oil.id, unit: 'tin', qty: 10, cost: 1800 }, { itemId: dal.id, unit: 'kg', qty: 5, cost: 100 }], delivery: { mode: 'self', expectedOn: '2026-10-25' } } });
    check('V: an order keeps how it comes', vs.status === 201 && vs.body.delivery.mode === 'self' && vs.body.delivery.expectedOn === '2026-10-25', JSON.stringify(vs.body));
    const selfPo = vs.body.id;
    const ow = await call('/admin/purchases/' + selfPo + '/delivery', { method: 'POST', body: { mode: 'self', expectedOn: '2026-10-25', onWay: true } });
    check('V: marked on the way', ow.status === 200 && ow.body.progress === 'on_way' && !!ow.body.delivery.onWayAt, JSON.stringify(ow.body));
    // Before anything arrives the bill is what was ordered: 18000 + 500.
    const pay0 = await call('/admin/purchases/' + selfPo + '/payments', { method: 'POST', body: { amount: 2000, method: 'upi', note: 'advance' } });
    check('V: an advance paid: paid 2000, pending 16500', pay0.status === 201 && pay0.body.paid === 2000 && pay0.body.pending === 16500 && pay0.body.billTotal === 18500, JSON.stringify(pay0.body));
    eq('V: a payment method must be known', (await call('/admin/purchases/' + selfPo + '/payments', { method: 'POST', body: { amount: 1, method: 'cheque' } })).status, 400);
    // Partial: 6 tins ok, 1 damaged in those, dal short (0). Stock 6 tins = 90 ltr.
    eq('V: a checklist with nothing arrived is refused', (await call('/admin/purchases/' + selfPo + '/checklist', { method: 'POST', body: { lines: [{ itemId: oil.id, arrived: 0 }] } })).status, 400);
    eq('V: a checklist line not on the order is refused', (await call('/admin/purchases/' + selfPo + '/checklist', { method: 'POST', body: { lines: [{ itemId: soap.id, arrived: 1 }] } })).status, 400);
    eq('V: more than ordered is refused', (await call('/admin/purchases/' + selfPo + '/checklist', { method: 'POST', body: { lines: [{ itemId: oil.id, arrived: 11 }] } })).status, 400);
    const c1 = await call('/admin/purchases/' + selfPo + '/checklist', { method: 'POST', body: { lines: [{ itemId: oil.id, arrived: 6, ok: true, condition: 'damaged', note: '1 tin dented' }, { itemId: dal.id, arrived: 0, ok: false, condition: 'short' }] } });
    check('V: a partial delivery leaves the order part received', c1.status === 200 && c1.body.progress === 'part' && c1.body.status === 'ordered', JSON.stringify(c1.body));
    const cl1 = c1.body.checklists[0];
    check('V: the self checklist is stored with its lines', cl1.mode === 'self' && !cl1.carrierId && cl1.receipt === 1 && cl1.lines[0].ordered === 10 && cl1.lines[0].arrived === 6 && cl1.lines[0].condition === 'damaged' && cl1.lines[1].ok === false && cl1.lines[1].ordered === 5, JSON.stringify(cl1));
    const oilAt = async () => (await call('/stock')).body.find((s) => s.itemId === oil.id && s.locationId === godown)?.qty ?? 0;
    eq('V: 6 tins posted, 90 ltr', await oilAt(), 90);
    check('V: the bill is now what arrived (6 x 1800)', c1.body.billTotal === 10800 && c1.body.pending === 8800, JSON.stringify(c1.body));
    // The rest: 4 tins and 5 kg dal, with carrier confirmed this time (the shop sent its carrier).
    const c2 = await call('/admin/purchases/' + selfPo + '/checklist', { method: 'POST', body: { mode: 'carrier', carrierId: car.id, carrierConfirmed: true, delivery: 50, lines: [{ itemId: oil.id, arrived: 4, ok: true }, { itemId: dal.id, arrived: 5, ok: true }] } });
    check('V: the next checklist continues it, and it is received', c2.status === 200 && c2.body.progress === 'received' && c2.body.checklists.length === 2 && c2.body.checklists[1].lines[0].ordered === 4 && c2.body.checklists[1].receipt === 2, JSON.stringify(c2.body));
    check('V: the carrier checklist takes the carrier’s vehicle', c2.body.checklists[1].carrierId === car.id && c2.body.checklists[1].vehicleNo === 'KA 09 AB 1234' && c2.body.checklists[1].carrierConfirmed === true, JSON.stringify(c2.body.checklists[1]));
    eq('V: 10 tins in all, 150 ltr', await oilAt(), 150);
    // 10 x 1800 + 5 x 100 + 50 delivery.
    eq('V: bill: received costs plus the delivery charge', c2.body.billTotal, 18550);
    eq('V: a received order takes no more checklists', (await call('/admin/purchases/' + selfPo + '/checklist', { method: 'POST', body: { lines: [{ itemId: oil.id, arrived: 1 }] } })).status, 409);
    eq('V: overpay is refused', (await call('/admin/purchases/' + selfPo + '/payments', { method: 'POST', body: { amount: 16551, method: 'cash' } })).status, 400);
    const pay1 = await call('/admin/purchases/' + selfPo + '/payments', { method: 'POST', body: { amount: 6550, method: 'cash', at: '2026-10-20' } });
    check('V: a payment: paid 8550, pending 10000', pay1.body.paid === 8550 && pay1.body.pending === 10000 && pay1.body.payments.length === 2, JSON.stringify(pay1.body));
    eq('V: the invoice total cannot go under what is paid', (await call('/admin/purchases/' + selfPo + '/bill', { method: 'POST', body: { billTotal: 8000 } })).status, 400);
    eq('V: the invoice total can be typed in', (await call('/admin/purchases/' + selfPo + '/bill', { method: 'POST', body: { billTotal: 18600 } })).body.pending, 10050);

    // A carrier order, ticked in one go.
    const vc = (await call('/admin/pos', { method: 'POST', body: { supplierId: v, to: godown, lines: [{ itemId: oil.id, unit: 'tin', qty: 2, cost: 1900 }], delivery: { mode: 'carrier', carrierId: car.id, driverName: 'Shivu' } } })).body;
    check('V: a carrier order fills in the vehicle', vc.delivery.carrierId === car.id && vc.delivery.vehicleNo === 'KA 09 AB 1234', JSON.stringify(vc));
    const c3 = await call('/admin/purchases/' + vc.id + '/checklist', { method: 'POST', body: { carrierConfirmed: true, lines: [{ itemId: oil.id, arrived: 2, ok: true }] } });
    check('V: a carrier checklist from the order', c3.status === 200 && c3.body.progress === 'received' && c3.body.checklists[0].mode === 'carrier' && c3.body.checklists[0].driverName === 'Shivu', JSON.stringify(c3.body));
    // Closed short: the rest will not come.
    const vx = (await call('/admin/pos', { method: 'POST', body: { supplierId: v, to: godown, lines: [{ itemId: oil.id, unit: 'tin', qty: 3, cost: 2000 }] } })).body;
    const c4 = await call('/admin/purchases/' + vx.id + '/checklist', { method: 'POST', body: { close: true, lines: [{ itemId: oil.id, arrived: 1, condition: 'short' }] } });
    check('V: closed with what arrived', c4.body.progress === 'received' && c4.body.billTotal === 2000, JSON.stringify(c4.body));

    // History: 18600 + 3800 + 2000 bought, 8550 paid.
    const h = (await call('/admin/suppliers/' + v + '/history')).body;
    check('V: history totals', h.summary.bought === 24400 && h.summary.paid === 8550 && h.summary.pending === 15850 && h.summary.orders === 3 && h.summary.lastPurchase === vx.at, JSON.stringify(h.summary));
    check('V: purchases newest first with bill and status', h.purchases.length === 3 && h.purchases[0].id === vx.id && h.purchases[2].pending === 10050 && h.purchases[2].progress === 'received', JSON.stringify(h.purchases.map((p) => [p.id, p.pending, p.progress])));
    check('V: every delivery checklist, newest first, with its order', h.deliveries.length === 4 && h.deliveries[0].poId === vx.id && h.deliveries.every((d, i) => i === 0 || h.deliveries[i - 1].at >= d.at) && h.deliveries.some((d) => d.poNo === vs.body.no && d.lines[0].condition === 'damaged'), JSON.stringify(h.deliveries));
    eq('V: an unknown supplier has no history', (await call('/admin/suppliers/sup_none/history')).status, 404);

    // Pay pending, oldest first: 11000 pays the first order's 10050, then 950 of the next.
    eq('V: paying more than is pending in all is refused', (await call('/admin/suppliers/' + v + '/pay', { method: 'POST', body: { amount: 15851, method: 'bank' } })).status, 400);
    const pp = await call('/admin/suppliers/' + v + '/pay', { method: 'POST', body: { amount: 11000, method: 'bank' } });
    check('V: shared oldest first', pp.status === 201 && pp.body.paid.length === 2 && pp.body.paid[0].id === selfPo && pp.body.paid[0].amount === 10050 && pp.body.paid[1].id === vc.id && pp.body.paid[1].amount === 950, JSON.stringify(pp.body));
    const h2 = (await call('/admin/suppliers/' + v + '/history')).body;
    check('V: pending after', h2.summary.pending === 4850 && h2.purchases.find((p) => p.id === selfPo).pending === 0 && h2.purchases.find((p) => p.id === vc.id).pending === 2850, JSON.stringify(h2.summary));

    // The carrier shows what it brought.
    const cd = (await call('/admin/carriers')).body.deliveries;
    check('V: the carrier shows its deliveries', cd.length === 2 && cd.every((d) => d.carrierId === car.id && d.supplierId === v) && cd.some((d) => d.poId === vc.id) && cd.some((d) => d.poId === selfPo && d.receipt === 2), JSON.stringify(cd));

    // Back-compat: the old receive on a part-received order posts only what is still due, with new keys.
    const vb2 = (await call('/admin/pos', { method: 'POST', body: { supplierId: v, to: godown, lines: [{ itemId: oil.id, unit: 'tin', qty: 4, cost: 1000 }] } })).body;
    await call('/admin/purchases/' + vb2.id + '/checklist', { method: 'POST', body: { lines: [{ itemId: oil.id, arrived: 1 }] } });
    const before = await oilAt();
    eq('V: the old receive still works after a checklist', (await call('/admin/pos/' + vb2.id + '/receive', { method: 'POST', body: {} })).status, 200);
    eq('V: and posts the 3 tins still due', (await oilAt()) - before, 45);
    const vb2After = (await call('/admin/suppliers/' + v + '/history')).body.purchases.find((p) => p.id === vb2.id);
    check('V: two receipts recorded, received, bill 4000', vb2After.received.length === 2 && vb2After.receipts === 2 && vb2After.progress === 'received' && vb2After.billTotal === 4000, JSON.stringify(vb2After));
    // Old orders (one receive, no checklist or payments) read as before: po3 is received, nothing paid.
    const old = (await call('/admin/suppliers/' + supId + '/history')).body;
    const old3 = old.purchases.find((p) => p.id === po3.id);
    check('V: an old order reads with its bill and no payments', old3.progress === 'received' && old3.paid === 0 && old3.billTotal === 25100 && old.deliveries.length === 0, JSON.stringify(old3));

    // W: no destination on the order; a place per line at arrival; deletes.
    const oilIn = async (loc) => (await call('/stock')).body.find((s) => s.itemId === oil.id && s.locationId === loc)?.qty ?? 0;
    const w1 = await call('/admin/pos', { method: 'POST', body: { supplierId: v, lines: [{ itemId: oil.id, unit: 'tin', qty: 3, cost: 1000 }] } });
    eq('W: an order without a destination is made', w1.status, 201);
    check('W: and has no place on it', w1.body.to === undefined, JSON.stringify(w1.body));
    eq('W: a bad destination is still refused', (await call('/admin/pos', { method: 'POST', body: { supplierId: v, to: 'nope', lines: [{ itemId: oil.id, unit: 'tin', qty: 1 }] } })).status, 400);
    eq('W: arrival with no place for a line is refused', (await call('/admin/purchases/' + w1.body.id + '/checklist', { method: 'POST', body: { lines: [{ itemId: oil.id, arrived: 1 }] } })).status, 400);
    const [s0, g0] = [await oilIn(shop), await oilIn(godown)];
    eq('W: arrival with a place per line', (await call('/admin/purchases/' + w1.body.id + '/checklist', { method: 'POST', body: { lines: [{ itemId: oil.id, arrived: 1, placeId: shop }] } })).status, 200);
    eq('W: it went to that place', (await oilIn(shop)) - s0, 15);
    eq('W: and not elsewhere', (await oilIn(godown)) - g0, 0);
    eq('W: a split, with no order-level place', (await call('/admin/purchases/' + w1.body.id + '/checklist', { method: 'POST', body: { lines: [{ itemId: oil.id, arrived: 2, places: [{ placeId: shop, qty: 1 }, { placeId: godown, qty: 1 }] }] } })).status, 200);
    check('W: the split posted to both places', (await oilIn(shop)) - s0 === 30 && (await oilIn(godown)) - g0 === 15);
    // Back-compat: an old-style order with `to`, received with the old `to` on the checklist.
    const w2 = (await call('/admin/pos', { method: 'POST', body: { supplierId: v, to: godown, lines: [{ itemId: oil.id, unit: 'tin', qty: 1, cost: 1000 }] } })).body;
    eq('W: the old `to` is still kept', w2.to, godown);
    const g1 = await oilIn(godown);
    eq('W: the old checklist with `to` still works', (await call('/admin/purchases/' + w2.id + '/checklist', { method: 'POST', body: { to: godown, lines: [{ itemId: oil.id, arrived: 1 }] } })).status, 200);
    eq('W: and goes to it', (await oilIn(godown)) - g1, 15);

    // A worker may not delete.
    eq('W: a worker is added', (await call('/people', { method: 'POST', body: { name: 'Ravi', phone: '9000000099', role: 'worker', pin: '2580' } })).status, 201);
    const adminToken = token;
    token = (await call('/auth/login', { method: 'POST', body: { phone: '9000000099', pin: '2580' } })).body.token;
    eq('W: a worker cannot delete an order', (await call('/admin/purchases/' + w2.id, { method: 'DELETE' })).status, 403);
    eq('W: nor a checklist', (await call('/admin/purchases/' + w2.id + '/checklists/x', { method: 'DELETE' })).status, 403);
    token = adminToken;

    // Deleting an unreceived order: gone outright.
    const w3 = (await call('/admin/pos', { method: 'POST', body: { supplierId: v, lines: [{ itemId: oil.id, unit: 'tin', qty: 2, cost: 500 }] } })).body;
    eq('W: an unreceived order is deleted', (await call('/admin/purchases/' + w3.id, { method: 'DELETE' })).status, 200);
    check('W: and is gone from the history', !(await call('/admin/suppliers/' + v + '/history')).body.purchases.some((p) => p.id === w3.id));

    // A received order: refused unless "record only"; then stock stays, payments go, totals update.
    await call('/admin/purchases/' + w2.id + '/payments', { method: 'POST', body: { amount: 400, method: 'cash' } });
    const h0 = (await call('/admin/suppliers/' + v + '/history')).body.summary;
    eq('W: a received order is not deleted without "record only"', (await call('/admin/purchases/' + w2.id, { method: 'DELETE' })).status, 409);
    const g2 = await oilIn(godown);
    const del = await call('/admin/purchases/' + w2.id + '?recordOnly=1', { method: 'DELETE' });
    eq('W: the record only is deleted', del.status, 200);
    eq('W: stock stays as it is', (await oilIn(godown)) - g2, 0);
    const h1 = (await call('/admin/suppliers/' + v + '/history')).body;
    check('W: supplier totals update', h1.summary.orders === h0.orders - 1 && Math.abs(h0.bought - h1.summary.bought - 1000) < 1e-6 && Math.abs(h0.paid - h1.summary.paid - 400) < 1e-6, JSON.stringify([h0, h1.summary]));
    check('W: its deliveries are gone too', !h1.deliveries.some((d) => d.poId === w2.id));
    eq('W: a deleted order is not found', (await call('/admin/purchases/' + w2.id, { method: 'DELETE' })).status, 404);

    // Deleting one checklist: the record only, stock unchanged, the carrier list follows.
    const w1h = h1.purchases.find((p) => p.id === w1.body.id);
    const cid = w1h.checklists[0].id;
    const [s3, g3] = [await oilIn(shop), await oilIn(godown)];
    const dc = await call('/admin/purchases/' + w1.body.id + '/checklists/' + cid, { method: 'DELETE' });
    eq('W: a checklist is deleted', dc.status, 200);
    check('W: one checklist left, receipts kept', dc.body.checklists.length === 1 && dc.body.received.length === 2, JSON.stringify(dc.body));
    check('W: stock unchanged after a checklist delete', (await oilIn(shop)) === s3 && (await oilIn(godown)) === g3);
    check('W: gone from the delivery history', !(await call('/admin/suppliers/' + v + '/history')).body.deliveries.some((d) => d.id === cid));
    check('W: and from the carriers\' deliveries', !(await call('/admin/carriers')).body.deliveries.some((d) => d.id === cid));
    eq('W: an unknown checklist is 404', (await call('/admin/purchases/' + w1.body.id + '/checklists/nope', { method: 'DELETE' })).status, 404);

    // ------------------------------------------------ carrier loads: per-item rates, tick to receive, moves
    {
      const { loadTotal } = require(path.join(root, 'core'));
      const vA = (await call('/admin/suppliers', { method: 'POST', body: { name: 'Sugar Mills', phone: '', address: 'APMC Yard, Hubli' } })).body;
      eq('K: the vendor address is saved', vA.address, 'APMC Yard, Hubli');
      const vA2 = (await call('/admin/suppliers/' + vA.id, { method: 'PUT', body: { name: 'Sugar Mills', phone: '', address: 'Gate 2, APMC Yard' } })).body;
      eq('K: and can be changed', (await call('/admin/suppliers')).body.find((s) => s.id === vA.id).address, 'Gate 2, APMC Yard');
      check('K: the put returns it', vA2.address === 'Gate 2, APMC Yard');
      const vB = (await call('/admin/suppliers', { method: 'POST', body: { name: 'Poha Traders', phone: '' } })).body.id;
      const mk = async (nameEn) => (await call('/items', { method: 'POST', body: { nameEn, nameKn: 'ಕ', units: [{ code: 'kg', label: 'Kg', labelKn: '', perBase: 1, price: 50 }, { code: 'bag', label: 'Bag', labelKn: '', perBase: 50, price: 2500 }], aliases: [], racks: {} } })).body;
      const sugar = await mk('K Sugar');
      const poha = await mk('K Poha');
      const salt = await mk('K Salt');
      const at = async (item) => (await call('/stock')).body.find((s) => s.itemId === item.id && s.locationId === godown)?.qty ?? 0;
      const kA = await call('/admin/pos', { method: 'POST', body: { supplierId: vA.id, to: godown, lines: [{ itemId: sugar.id, unit: 'bag', qty: 30, cost: 2000 }], delivery: { mode: 'carrier' } } });
      check('K: a carrier order without a carrier or vehicle', kA.status === 201 && kA.body.delivery.mode === 'carrier' && !kA.body.delivery.carrierId && !kA.body.delivery.vehicleNo, JSON.stringify(kA.body));
      const kB = (await call('/admin/pos', { method: 'POST', body: { supplierId: vB, to: godown, lines: [{ itemId: poha.id, unit: 'bag', qty: 30, cost: 1000 }, { itemId: salt.id, unit: 'bag', qty: 4, cost: 500 }], delivery: { mode: 'carrier' } } })).body;
      const carK = (await call('/admin/carriers', { method: 'POST', body: { name: 'Ramu', vehicleNo: 'KA 25 X 1' } })).body;
      const carK2 = (await call('/admin/carriers', { method: 'POST', body: { name: 'Basu', vehicleNo: 'KA 25 Y 2' } })).body;
      eq('K: a move needs a carrier', (await call('/admin/loads/move', { method: 'POST', body: { lines: [{ poId: kA.body.id, itemId: sugar.id }] } })).status, 400);
      const ld = await call('/admin/loads/move', { method: 'POST', body: { carrierId: carK.id, date: '2026-10-25', lines: [{ poId: kA.body.id, itemId: sugar.id, ratePerUnit: 50 }, { poId: kB.id, itemId: poha.id, ratePerUnit: 30 }] } });
      check('K: two vendors\' lines on one load', ld.status === 201 && ld.body.lines.length === 2 && ld.body.vehicleNo === 'KA 25 X 1' && new Set(ld.body.lines.map((l) => l.poId)).size === 2, JSON.stringify(ld.body));
      eq('K: per-item rates: 30 x 50 + 30 x 30', loadTotal(ld.body.lines), 2400);
      // Salt on the second carrier, then to the first: moved, with history on both.
      const ld2 = (await call('/admin/loads/move', { method: 'POST', body: { carrierId: carK2.id, lines: [{ poId: kB.id, itemId: salt.id, ratePerUnit: 20 }] } })).body;
      const mv = await call('/admin/loads/move', { method: 'POST', body: { loadId: ld.body.id, lines: [{ poId: kB.id, itemId: salt.id }] } });
      const ld2After = (await call('/admin/loads/' + ld2.id)).body;
      check('K: lines move between carriers, keeping their rate', mv.status === 200 && mv.body.lines.length === 3 && mv.body.lines.find((l) => l.itemId === salt.id).ratePerUnit === 20 && ld2After.lines.length === 0, JSON.stringify(mv.body));
      check('K: the move is in both histories, with who', ld2After.history.some((h) => h.action === 'move-out' && h.loadId === ld.body.id && h.by) && mv.body.history.some((h) => h.action === 'move-in' && h.fromCarrierId === carK2.id), JSON.stringify([ld2After.history, mv.body.history]));
      // The carrier backs out: the whole load goes to Basu, then back to Ramu.
      const bo = await call('/admin/loads/' + ld.body.id + '/carrier', { method: 'POST', body: { carrierId: carK2.id } });
      check('K: a load moves to another carrier', bo.status === 200 && bo.body.id === ld.body.id && bo.body.carrierId === carK2.id && bo.body.vehicleNo === 'KA 25 Y 2' && bo.body.history.some((h) => h.action === 'carrier' && h.fromCarrierId === carK.id), JSON.stringify(bo.body));
      await call('/admin/loads/' + ld.body.id + '/carrier', { method: 'POST', body: { carrierId: carK.id } });
      // Sugar's checklist: ticked, 30 bags with ₹50/bag delivery -> landed 2050/bag.
      const s0 = await at(sugar);
      const cs = await call('/admin/purchases/' + kA.body.id + '/checklist', { method: 'POST', body: { updateCost: true, lines: [{ itemId: sugar.id, arrived: 30, ok: true }] } });
      const rs = cs.body.received?.[0];
      check('K: the load rate goes into the landed cost', cs.status === 200 && rs.delivery === 1500 && rs.landed === 2050 && rs.ratePerUnit === 50 && rs.loadId === ld.body.id, JSON.stringify(cs.body));
      check('K: the checklist takes the load\'s carrier', cs.body.checklists[0].mode === 'carrier' && cs.body.checklists[0].carrierId === carK.id && cs.body.checklists[0].vehicleNo === 'KA 25 X 1', JSON.stringify(cs.body.checklists[0]));
      eq('K: sugar posted', (await at(sugar)) - s0, 1500);
      const sugarCost = async () => (await call('/items')).body.find((i) => i.id === sugar.id).units.find((u) => u.code === 'bag').cost;
      eq('K: the item cost is the landed cost', await sugarCost(), 2050);
      // Poha's order: poha ticked, salt not -> salt is not posted, stays due, stays on the load.
      const cp = await call('/admin/purchases/' + kB.id + '/checklist', { method: 'POST', body: { lines: [{ itemId: poha.id, arrived: 30, ok: true }, { itemId: salt.id, arrived: 4, ok: false }] } });
      check('K: unticked lines stay due: part received', cp.status === 200 && cp.body.status === 'ordered' && cp.body.progress === 'part' && !cp.body.received.some((r) => r.itemId === salt.id && r.qty > 0), JSON.stringify(cp.body));
      eq('K: the unticked line is not posted', await at(salt), 0);
      eq('K: poha landed 1030', cp.body.received.find((r) => r.itemId === poha.id).landed, 1030);
      let L = (await call('/admin/loads/' + ld.body.id)).body;
      check('K: on the load, ticked ones received, the unticked one still waiting', L.lines.find((l) => l.itemId === poha.id).received?.qty === 30 && !L.lines.find((l) => l.itemId === salt.id).received, JSON.stringify(L.lines));
      eq('K: the total of what came', loadTotal(L.lines), 30 * 50 + 30 * 30 + 4 * 20);
      // Editing a rate after receiving: sugar 50 -> 60 per bag.
      const re = await call('/admin/loads/' + ld.body.id + '/rates', { method: 'PUT', body: { lines: [{ poId: kA.body.id, itemId: sugar.id, ratePerUnit: 60 }] } });
      const kA2 = (await call('/admin/suppliers/' + vA.id + '/history')).body;
      const poA = (kA2.orders ?? kA2.purchases ?? []).find((p) => p.id === kA.body.id);
      const rs2 = poA?.received?.[0];
      check('K: a rate edited after receiving recalculates the receipt', re.status === 200 && rs2 && rs2.delivery === 1800 && rs2.landed === 2060 && rs2.ratePerUnit === 60, JSON.stringify(poA ?? kA2));
      eq('K: and the item cost (still its latest receipt)', await sugarCost(), 2060);
      check('K: the rate change is in the history', re.body.history.some((h) => h.action === 'rate' && h.lines[0].from === 50 && h.lines[0].to === 60 && h.by), JSON.stringify(re.body.history));
      // Salt left for next time: off the load, back to unassigned; then put on a load and received.
      const lf = await call('/admin/purchases/' + kB.id + '/checklist', { method: 'POST', body: { leaveForNextTime: true, lines: [{ itemId: salt.id, arrived: 1, ok: true }] } });
      eq('K: one bag of salt came', lf.status, 200);
      L = (await call('/admin/loads/' + ld.body.id)).body;
      check('K: received salt stays on the load as received', L.lines.find((l) => l.itemId === salt.id).received?.qty === 1, JSON.stringify(L.lines));
      // 3 bags still due, unassigned: put on Basu's new load, then "Leave for next time".
      const ld3 = (await call('/admin/loads/move', { method: 'POST', body: { carrierId: carK2.id, lines: [{ poId: kB.id, itemId: salt.id, ratePerUnit: 10 }] } })).body;
      eq('K: the rest due goes on the load', ld3.lines[0].qty, 3);
      const un = await call('/admin/loads/' + ld3.id + '/unassign', { method: 'POST', body: { lines: [{ poId: kB.id, itemId: salt.id }] } });
      check('K: "Leave for next time" unassigns it', un.status === 200 && un.body.lines.length === 0 && un.body.history.some((h) => h.action === 'unassign'), JSON.stringify(un.body));
      eq('K: a load with nothing received can be deleted', (await call('/admin/loads/' + ld3.id, { method: 'DELETE' })).status, 200);
      eq('K: one with receipts cannot', (await call('/admin/loads/' + ld.body.id, { method: 'DELETE' })).status, 409);
      // On a checklist, unticked load lines with leaveForNextTime go back to unassigned.
      const ld4 = (await call('/admin/loads/move', { method: 'POST', body: { carrierId: carK.id, lines: [{ poId: kB.id, itemId: salt.id, ratePerUnit: 10 }] } })).body;
      const kC = (await call('/admin/pos', { method: 'POST', body: { supplierId: vB, to: godown, lines: [{ itemId: poha.id, unit: 'bag', qty: 2, cost: 1000 }, { itemId: sugar.id, unit: 'bag', qty: 2, cost: 2000 }] } })).body;
      await call('/admin/loads/move', { method: 'POST', body: { loadId: ld4.id, lines: [{ poId: kC.id, itemId: poha.id }, { poId: kC.id, itemId: sugar.id }] } });
      const cc = await call('/admin/purchases/' + kC.id + '/checklist', { method: 'POST', body: { leaveForNextTime: true, lines: [{ itemId: poha.id, arrived: 2, ok: true }, { itemId: sugar.id, arrived: 0, ok: false }] } });
      const L4 = (await call('/admin/loads/' + ld4.id)).body;
      check('K: leave for next time on the checklist', cc.status === 200 && cc.body.progress === 'part' && !L4.lines.some((l) => l.poId === kC.id && l.itemId === sugar.id) && L4.lines.some((l) => l.poId === kB.id && l.itemId === salt.id && !l.received), JSON.stringify(L4.lines));
      eq('K: a move of a received order is refused', (await call('/admin/loads/move', { method: 'POST', body: { carrierId: carK.id, lines: [{ poId: kA.body.id, itemId: sugar.id }] } })).status, 409);
      check('K: the loads list', (await call('/admin/loads')).body.some((x) => x.id === ld.body.id));
    }

    // ------------------------------------------------ the paper flow: Allot (partial, per carrier) and Arriving
    {
      const { unallottedQty } = require(path.join(root, 'core'));
      const vY = (await call('/admin/suppliers', { method: 'POST', body: { name: 'Yuva Distributors', phone: '' } })).body.id;
      const mkB = async (nameEn) => (await call('/items', { method: 'POST', body: { nameEn, nameKn: 'ಕ', units: [{ code: 'pc', label: 'pc', labelKn: '', perBase: 1, price: 10 }, { code: 'box', label: 'Box', labelKn: '', perBase: 10, price: 100 }], aliases: [], racks: {} } })).body;
      const parle = await mkB('A Parle');
      const twenty = await mkB('A 20-20');
      const at = async (item) => (await call('/stock')).body.find((s) => s.itemId === item.id && s.locationId === godown)?.qty ?? 0;
      const po = (await call('/admin/pos', { method: 'POST', body: { supplierId: vY, to: godown, lines: [{ itemId: parle.id, unit: 'box', qty: 6, cost: 100 }, { itemId: twenty.id, unit: 'box', qty: 10, cost: 50 }] } })).body;
      const raju = (await call('/admin/carriers', { method: 'POST', body: { name: 'Raju', vehicleNo: 'KA 25 R 4' } })).body;
      const shanti = (await call('/admin/carriers', { method: 'POST', body: { name: 'Shantinath' } })).body;
      const allotLine = async (itemId) => (await call('/admin/allot')).body.vendors.find((v) => v.supplierId === vY).lines.find((l) => l.poId === po.id && l.itemId === itemId);
      eq('A: nothing allotted yet', (await allotLine(parle.id)).unallotted, 6);
      check('A: carriers in the allot view', (await call('/admin/allot')).body.carriers.some((c) => c.id === raju.id));
      const a1 = await call('/admin/loads/allot', { method: 'POST', body: { carrierId: raju.id, lines: [{ poId: po.id, itemId: parle.id, qty: 4 }] } });
      check('A: Parle 4 of 6 on Raju', a1.status === 201 && a1.body.load.lines[0].qty === 4 && a1.body.load.vehicleNo === 'KA 25 R 4', JSON.stringify(a1.body));
      const l1 = await allotLine(parle.id);
      check('A: 2 left unallotted, "on Raju 4"', l1.unallotted === 2 && l1.on.length === 1 && l1.on[0].carrierName === 'Raju' && l1.on[0].qty === 4, JSON.stringify(l1));
      const a2 = await call('/admin/loads/allot', { method: 'POST', body: { carrierId: shanti.id, lines: [{ poId: po.id, itemId: parle.id, qty: 5 }] } });
      check('A: the rest to Shantinath, capped at the 2 unallotted', a2.status === 201 && a2.body.added[0].qty === 2 && a2.body.capped === true, JSON.stringify(a2.body));
      eq('A: nothing left of Parle', (await allotLine(parle.id)).unallotted, 0);
      eq('A: allotting more is refused', (await call('/admin/loads/allot', { method: 'POST', body: { carrierId: raju.id, lines: [{ poId: po.id, itemId: parle.id, qty: 1 }] } })).status, 400);
      const a3 = await call('/admin/loads/allot', { method: 'POST', body: { carrierId: raju.id, lines: [{ poId: po.id, itemId: twenty.id, qty: 3 }] } });
      check('A: a second allot to Raju adds to his waiting load', a3.status === 200 && a3.body.load.id === a1.body.load.id && a3.body.load.lines.length === 2, JSON.stringify(a3.body));
      const av = await call('/admin/loads/allot', { method: 'POST', body: { carrierId: 'vendor', lines: [{ poId: po.id, itemId: twenty.id, qty: 7 }] } });
      check('A: "Vendor brings it" is a load', av.status === 201 && av.body.load.carrierId === 'vendor' && av.body.load.lines[0].qty === 7, JSON.stringify(av.body));
      eq('A: unallotted maths (core)', unallottedQty(10, [a3.body.load, av.body.load], po.id, twenty.id), 0);
      eq('A: an unknown carrier is 404', (await call('/admin/loads/allot', { method: 'POST', body: { carrierId: 'nope', lines: [{ poId: po.id, itemId: twenty.id, qty: 1 }] } })).status, 404);

      // Arriving: grouped carrier -> vendor -> item, with rates for the admin.
      const arr = (await call('/arriving')).body;
      const rj = arr.loads.find((l) => l.id === a1.body.load.id);
      check('A: arriving groups by carrier then vendor', rj && rj.carrierName === 'Raju' && rj.vendors[0].supplierId === vY && rj.vendors[0].lines.length === 2 && rj.vendors[0].lines.every((l) => 'ratePerUnit' in l) && arr.canRate === true, JSON.stringify(rj));
      check('A: the vendor load is shown as "Vendor brings it"', arr.loads.some((l) => l.carrierId === 'vendor' && l.carrierName === 'Vendor brings it'));
      // Raju: 3 of 4 Parle arrive at ₹5/box delivery; 20-20 removed (Del); notes.
      const p0 = await at(parle);
      const sv = await call('/arriving/' + a1.body.load.id + '/save', { method: 'POST', body: { notes: 'Two boxes wet', lines: [{ poId: po.id, itemId: parle.id, arrived: 3, ratePerUnit: 5 }, { poId: po.id, itemId: twenty.id, arrived: 0, remove: true }] } });
      check('A: arriving save', sv.status === 200 && sv.body.posted === 3 && sv.body.waiting === 1 && sv.body.removed === 1, JSON.stringify(sv.body));
      eq('A: only the 3 ticked boxes are in stock', (await at(parle)) - p0, 30);
      const L = (await call('/admin/loads/' + a1.body.load.id)).body;
      check('A: 3 received, 1 still waiting on the load', L.lines.some((l) => l.itemId === parle.id && l.received?.qty === 3) && L.lines.some((l) => l.itemId === parle.id && !l.received && l.qty === 1 && l.ratePerUnit === 5), JSON.stringify(L.lines));
      check('A: notes saved, in the history', L.notes === 'Two boxes wet' && L.history.some((h) => h.action === 'notes'), JSON.stringify(L));
      eq('A: Del sends 20-20 back to unallotted', (await allotLine(twenty.id)).unallotted, 3);
      const hist = (await call('/admin/suppliers/' + vY + '/history')).body.purchases.find((p) => p.id === po.id);
      const rc = hist.received.find((r) => r.itemId === parle.id && r.qty === 3);
      check('A: delivery ₹/unit x arrived in the landed cost', rc && rc.delivery === 15 && rc.landed === 105 && rc.loadId === a1.body.load.id, JSON.stringify(hist.received));
      eq('A: more than on the load is refused', (await call('/arriving/' + a1.body.load.id + '/save', { method: 'POST', body: { lines: [{ poId: po.id, itemId: parle.id, arrived: 2 }] } })).status, 400);

      // A worker: opens Arriving and saves, without rates; 403 on Allot.
      const adminTok = token;
      token = (await call('/auth/login', { method: 'POST', body: { phone: '9000000099', pin: '2580' } })).body.token;
      const wa = await call('/arriving');
      check('A: a worker opens Arriving, with no rates', wa.status === 200 && wa.body.canRate === false && wa.body.loads.length > 0 && wa.body.loads.every((l) => l.vendors.every((v) => v.lines.every((x) => !('ratePerUnit' in x)))), JSON.stringify(wa.body));
      eq('A: a worker cannot see Allot', (await call('/admin/allot')).status, 403);
      eq('A: nor allot', (await call('/admin/loads/allot', { method: 'POST', body: { carrierId: raju.id, lines: [{ poId: po.id, itemId: twenty.id, qty: 1 }] } })).status, 403);
      const ws = await call('/arriving/' + a1.body.load.id + '/save', { method: 'POST', body: { lines: [{ poId: po.id, itemId: parle.id, arrived: 1, ratePerUnit: 99 }] } });
      eq('A: a worker saves arriving', ws.status, 200);
      token = adminTok;
      const L2 = (await call('/admin/loads/' + a1.body.load.id)).body;
      check('A: the worker\'s rate is ignored: the existing rate is kept', L2.lines.filter((l) => l.itemId === parle.id).every((l) => l.ratePerUnit === 5), JSON.stringify(L2.lines));
      // The vendor brings the 7 boxes of 20-20: a "self" delivery on the order.
      const vs = await call('/arriving/' + av.body.load.id + '/save', { method: 'POST', body: { lines: [{ poId: po.id, itemId: twenty.id, arrived: 7 }] } });
      eq('A: the vendor-brings load is received', vs.status, 200);
      const hist2 = (await call('/admin/suppliers/' + vY + '/history')).body.purchases.find((p) => p.id === po.id);
      check('A: as a vendor (self) delivery', hist2.checklists.some((c) => c.mode === 'self' && !c.carrierId), JSON.stringify(hist2.checklists));
      // The old routes still work alongside: move the 20-20 still due onto Shantinath, checklist it.
      const om = await call('/admin/loads/move', { method: 'POST', body: { loadId: a2.body.load.id, lines: [{ poId: po.id, itemId: twenty.id, ratePerUnit: 2 }] } });
      check('A: the old move still works', om.status === 200 && om.body.lines.some((l) => l.itemId === twenty.id && l.qty === 3), JSON.stringify(om.body));
      const oc = await call('/admin/purchases/' + po.id + '/checklist', { method: 'POST', body: { loadId: a2.body.load.id, lines: [{ itemId: twenty.id, arrived: 3, ok: true }, { itemId: parle.id, arrived: 2, ok: true }] } });
      check('A: the old checklist still works, and closes the order', oc.status === 200 && oc.body.status === 'received', JSON.stringify(oc.body));
      check('A: a received order leaves Arriving', !(await call('/arriving')).body.loads.some((l) => l.vendors.some((v) => v.lines.some((x) => x.poId === po.id))));
    }

    // ------------------------------------------------ running low, for the new order form
    const lowA = (await call('/items', { method: 'POST', body: { nameEn: 'Zz Low Soap', nameKn: 'ಸೋಪು', units: [{ code: 'pc', label: 'pc', labelKn: '', perBase: 1, price: 10 }, { code: 'box', label: 'Box', labelKn: '', perBase: 60, price: 580 }], lowAt: { qty: 2, unit: 'box' }, aliases: [], racks: {} } })).body;
    const lowB = (await call('/items', { method: 'POST', body: { nameEn: 'Aa Low Salt', nameKn: 'ಉಪ್ಪು', units: [{ code: 'pc', label: 'pc', labelKn: '', perBase: 1, price: 20 }], lowAt: { qty: 10, unit: 'pc' }, aliases: [], racks: {} } })).body;
    const lowSup = (await call('/admin/suppliers', { method: 'POST', body: { name: 'Low Supplier', phone: '', itemIds: [lowA.id] } })).body.id;
    const lows = (await call('/admin/low?supplier=' + lowSup)).body;
    const ia = lows.findIndex((x) => x.itemId === lowA.id);
    const ib = lows.findIndex((x) => x.itemId === lowB.id);
    check('L: both running-low items listed', ia >= 0 && ib >= 0, JSON.stringify(lows));
    check('L: the picked supplier item comes first', ia === 0 && ia < ib, JSON.stringify(lows.map((x) => x.name)));
    check('L: suggested qty reaches twice the level in the buying unit', lows[ia].suggestQty === 4 && lows[ia].unit === 'box' && lows[ia].level === 120 && lows[ia].have === 0 && lows[ia].supplierIds.includes(lowSup), JSON.stringify(lows[ia]));
    check('L: without a supplier, by name', (await call('/admin/low')).body.findIndex((x) => x.itemId === lowB.id) < (await call('/admin/low')).body.findIndex((x) => x.itemId === lowA.id));
  } catch (err) {
    failed++;
    console.log('FAIL threw: ' + err.stack);
    console.log(log);
  } finally {
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('purchasingtest: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main();
