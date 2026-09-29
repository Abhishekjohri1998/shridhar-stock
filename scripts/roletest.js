/*
 * Every role, end to end, against the demo data on a throwaway file store: what each may see,
 * what each may do, and that stock moves exactly once for each thing done.
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

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-roles-'));
  const port = 4600 + Math.floor(Math.random() * 300);
  const base = 'http://localhost:' + port;
  const proc = spawn(process.execPath, [path.join(out, 'index.js')], {
    env: { ...process.env, MONGO_URI: '', DEMO: '1', PORT: String(port), DATA_DIR: dir, JWT_SECRET: 'roletest' },
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
    const call = async (p, token, body) => {
      const r = await fetch(base + '/api' + p, {
        method: body ? 'POST' : 'GET',
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      let json = null;
      try {
        json = await r.json();
      } catch {
        /* none */
      }
      return { status: r.status, body: json };
    };
    const as = async (role) => (await call('/demo/login-as', null, { role })).body.token;
    const T = {};
    for (const r of ['admin', 'owner', 'worker', 'godown', 'vendor', 'delivery', 'customer']) T[r] = await as(r);
    check('every role has a demo person', Object.values(T).every(Boolean));
    eq('demo PIN works like a real login', (await call('/auth/login', null, { phone: '9000000004', pin: '1111' })).status, 200);

    // ---- who sees what
    const summary = (await call('/admin/summary', T.admin)).body;
    check('the admin sees lines to confirm', summary.toConfirm >= 3, JSON.stringify(summary));
    for (const r of ['worker', 'godown', 'vendor', 'delivery', 'customer']) {
      eq(r + ' cannot read the admin summary', (await call('/admin/summary', T[r])).status, 403);
    }
    eq('the owner can read it', (await call('/admin/summary', T.owner)).status, 200);
    eq('the owner cannot change items', (await call('/items', T.owner, {})).status, 403);
    eq('the owner cannot confirm lines', (await call('/admin/confirm', T.owner, { billNo: 54, i: 0 })).status, 403);

    const vendor = (await call('/vendor/pos', T.vendor)).body;
    check('a vendor sees only their own orders', vendor.orders.length === 3 && vendor.orders.every((o) => o.no !== 4), vendor.orders.map((o) => o.no).join());
    check('a vendor never sees sale prices', !JSON.stringify(vendor).includes('"price"'));
    eq('a vendor cannot act on another supplier\'s order', (await call('/pos/po_4/confirm', T.vendor, {})).status, 403);

    const cat = (await call('/customer/catalogue', T.customer)).body;
    check('the customer catalogue has prices', cat.length > 30 && cat[0].units[0].price > 0);
    check('but no costs and no counts', !/"cost"|"qty"/.test(JSON.stringify(cat)));
    const cb = (await call('/customer/bills', T.customer)).body;
    check('a customer sees only their own bills', cb.bills.length === 2 && cb.bills.every((b) => b.no === 52 || b.no === 54), cb.bills.map((b) => b.no).join());
    check('handwriting reaches the customer\'s slip', cb.bills.some((b) => b.lines.some((l) => l.ink && l.ink.strokes.length)));

    const mine = (await call('/delivery/mine', T.delivery)).body;
    eq('the delivery person sees their drops', mine.length, 3);
    eq('a godown cannot see deliveries', (await call('/delivery/mine', T.godown)).status, 403);

    const worker = (await call('/worker/bills', T.worker)).body;
    check('the worker sees today\'s bills, newest first', worker.length === 4 && worker[0].no === 54);
    check('lines carry their rack', worker[0].lines.some((l) => l.rack === 'Rack 5'));

    // ---- confirming a handwritten line moves stock once and learns the name
    const shopQty = async (itemId) => ((await call('/stock', T.admin)).body.find((s) => s.itemId === itemId && s.locationId === 'loc_shop') ?? { qty: 0 }).qty;
    const coffee0 = await shopQty('it_coffee');
    const c1 = await call('/admin/confirm', T.admin, { billNo: 54, i: 1, itemId: 'it_coffee', unit: 'pc', qty: 1 });
    eq('confirming a line works', c1.status, 200);
    eq('stock drops by one pack', await shopQty('it_coffee'), coffee0 - 1);
    eq('and the handwriting becomes a name for the item', c1.body.learnt, 'coffee powder');
    eq('confirming again is refused', (await call('/admin/confirm', T.admin, { billNo: 54, i: 1, itemId: 'it_coffee', unit: 'pc', qty: 1 })).status, 409);
    eq('stock did not move twice', await shopQty('it_coffee'), coffee0 - 1);
    eq('"not stock" leaves stock alone', (await call('/admin/confirm', T.admin, { billNo: 54, i: 3, notItem: true })).status, 200);
    eq('a unit the item does not have is refused', (await call('/admin/confirm', T.admin, { billNo: 53, i: 2, itemId: 'it_ghee', unit: 'tin', qty: 2 })).status, 400);

    // ---- a trip: requested, sent short by the godown, received at the shop
    const g0 = await (async () => ((await call('/stock', T.admin)).body.find((s) => s.itemId === 'it_clinic' && s.locationId === 'loc_g1')).qty)();
    const s0 = await shopQty('it_clinic');
    eq('a godown cannot send another godown\'s transfer', (await call('/transfers/tr_2/send', T.godown, {})).status, 403);
    eq('the godown sends transfer 3, 8 Clinic Plus short', (await call('/transfers/tr_3/send', T.godown, { vehicle: 'KA-17', sent: { it_clinic: 120 } })).status, 200);
    eq('sending twice is refused', (await call('/transfers/tr_3/send', T.godown, {})).status, 409);
    const g1 = ((await call('/stock', T.admin)).body.find((s) => s.itemId === 'it_clinic' && s.locationId === 'loc_g1')).qty;
    eq('the godown loses what it sent', g1, g0 - 120);
    eq('the shop receives it', (await call('/transfers/tr_3/receive', T.admin, {})).status, 200);
    eq('the shop gains what arrived', await shopQty('it_clinic'), s0 + 120);
    const t3 = (await call('/admin/transfers', T.admin)).body.find((t) => t.id === 'tr_3');
    check('the transfer records asked, sent and received', t3.lines.find((l) => l.itemId === 'it_clinic').qty === 128 && t3.lines.find((l) => l.itemId === 'it_clinic').sent === 120);

    // ---- transfer rules
    const gq = async (itemId, loc) => ((await call('/stock', T.admin)).body.find((x) => x.itemId === itemId && x.locationId === loc) ?? { qty: 0 }).qty;
    const g2g = await call('/admin/transfers', T.admin, { from: 'loc_g1', to: 'loc_g2', lines: [{ itemId: 'it_rice', qty: 25 }] });
    eq('a transfer between two godowns can be asked for', g2g.status, 201);
    eq('the same place twice is refused', (await call('/admin/transfers', T.admin, { from: 'loc_g1', to: 'loc_g1', lines: [{ itemId: 'it_rice', qty: 1 }] })).status, 400);
    eq('an item that does not exist is refused', (await call('/admin/transfers', T.admin, { from: 'loc_g1', to: 'loc_shop', lines: [{ itemId: 'it_nope', qty: 1 }] })).status, 400);
    eq('an item twice is refused', (await call('/admin/transfers', T.admin, { from: 'loc_g1', to: 'loc_shop', lines: [{ itemId: 'it_rice', qty: 1 }, { itemId: 'it_rice', qty: 2 }] })).status, 400);
    eq('a godown cannot ask for transfers', (await call('/admin/transfers', T.godown, { from: 'loc_g1', to: 'loc_shop', lines: [{ itemId: 'it_rice', qty: 1 }] })).status, 403);
    const id = g2g.body.id;
    eq('sending more than was asked for is refused', (await call('/transfers/' + id + '/send', T.godown, { sent: { it_rice: 30 } })).status, 400);
    eq('sending nothing is refused (cancel instead)', (await call('/transfers/' + id + '/send', T.godown, { sent: { it_rice: 0 } })).status, 400);
    const r0g1 = await gq('it_rice', 'loc_g1');
    const r0g2 = await gq('it_rice', 'loc_g2');
    eq('the main godown sends 20 of the 25', (await call('/transfers/' + id + '/send', T.godown, { sent: { it_rice: 20 }, vehicle: 'Tempo' })).status, 200);
    eq('it cannot be cancelled once on the way', (await call('/transfers/' + id + '/cancel', T.admin, {})).status, 409);
    eq('the main godown cannot receive at the other godown', (await call('/transfers/' + id + '/receive', T.godown, {})).status, 403);
    eq('receiving more than was sent is refused', (await call('/transfers/' + id + '/receive', T.admin, { received: { it_rice: 21 } })).status, 400);
    eq('19 arrive at the other godown', (await call('/transfers/' + id + '/receive', T.admin, { received: { it_rice: 19 } })).status, 200);
    eq('the main godown lost 20', await gq('it_rice', 'loc_g1'), r0g1 - 20);
    eq('the other gained 19', await gq('it_rice', 'loc_g2'), r0g2 + 19);
    const done = (await call('/admin/transfers', T.admin)).body.find((t) => t.id === id);
    check('the 1 kg short is on record', done.lines[0].qty === 25 && done.lines[0].sent === 20 && done.lines[0].received === 19);
    const shortMove = (await call('/items/it_rice/moves', T.admin)).body.find((m) => m.kind === 'transfer_in' && m.ref === 'transfer ' + done.no);
    eq('and in the ledger', shortMove && shortMove.note, '1 short');
    const c = await call('/admin/transfers', T.admin, { from: 'loc_g1', to: 'loc_shop', lines: [{ itemId: 'it_rice', qty: 5 }] });
    eq('a request can be cancelled before it leaves', (await call('/transfers/' + c.body.id + '/cancel', T.admin, {})).status, 200);
    eq('and then cannot be sent', (await call('/transfers/' + c.body.id + '/send', T.godown, {})).status, 409);

    // ---- vendor, purchase, delivery, customer order
    eq('the vendor confirms order 3', (await call('/pos/po_3/confirm', T.vendor, {})).status, 200);
    eq('and dispatches it', (await call('/pos/po_3/dispatch', T.vendor, { invoiceNo: 'SLT/1', vehicle: 'KA-02' })).status, 200);
    const cof = async () => ((await call('/stock', T.admin)).body.find((s) => s.itemId === 'it_coffee' && s.locationId === 'loc_g2') ?? { qty: 0 }).qty;
    const c0 = await cof();
    eq('the admin receives it', (await call('/admin/pos/po_3/receive', T.admin, {})).status, 200);
    eq('the godown\'s coffee goes up by 40', await cof(), c0 + 40);
    eq('receiving twice is refused', (await call('/admin/pos/po_3/receive', T.admin, {})).status, 409);
    eq('a delivery goes out', (await call('/deliveries/dl_3/status', T.delivery, { status: 'out' })).status, 200);
    eq('it cannot jump back to pending', (await call('/deliveries/dl_3/status', T.delivery, { status: 'out' })).status, 409);
    eq('and is delivered', (await call('/deliveries/dl_3/status', T.delivery, { status: 'delivered' })).status, 200);
    const order = await call('/customer/orders', T.customer, { lines: [{ itemId: 'it_sugar', unit: 'kg', qty: 2 }, { text: '2 surf excel', ink: { w: 100, h: 50, strokes: [[1, 2, 3, 4]] } }] });
    eq('a customer places a request, typed and written', order.status, 201);
    check('the admin sees it', (await call('/admin/orders', T.admin)).body.some((o) => o.id === order.body.id));

    // ---- suppliers and purchase orders
    const sup = await call('/admin/suppliers', T.admin, { name: 'Ganesh Oils', phone: '9000000099' });
    eq('a supplier is added', sup.status, 201);
    eq('a vendor login needs a supplier', (await call('/people', T.admin, { name: 'V', phone: '9111100001', role: 'vendor', pin: '2222' })).status, 400);
    eq('and gets one', (await call('/people', T.admin, { name: 'V', phone: '9111100001', role: 'vendor', pin: '2222', linkedId: sup.body.id })).status, 201);
    eq('a unit the item does not have is refused', (await call('/admin/pos', T.admin, { supplierId: sup.body.id, to: 'loc_g1', lines: [{ itemId: 'it_goil', unit: 'drum', qty: 1, cost: 1 }] })).status, 400);
    eq('a place that does not exist is refused', (await call('/admin/pos', T.admin, { supplierId: sup.body.id, to: 'loc_moon', lines: [{ itemId: 'it_goil', unit: 'tin', qty: 1, cost: 1 }] })).status, 400);
    const po = await call('/admin/pos', T.admin, { supplierId: sup.body.id, to: 'loc_g1', lines: [{ itemId: 'it_goil', unit: 'tin', qty: 4, cost: 2500 }] });
    eq('an order for 4 tins of groundnut oil', po.status, 201);
    const vt = (await call('/auth/login', null, { phone: '9111100001', pin: '2222' })).body.token;
    check('the new vendor sees it', (await call('/vendor/pos', vt)).body.orders.some((o) => o.id === po.body.id));
    check('the demo vendor does not', !(await call('/vendor/pos', T.vendor)).body.orders.some((o) => o.id === po.body.id));
    eq('receiving more than ordered is refused', (await call('/admin/pos/' + po.body.id + '/receive', T.admin, { got: { it_goil: { qty: 5 } } })).status, 400);
    const oil0 = await gq('it_goil', 'loc_g1');
    eq('3 tins arrive, at ₹2520', (await call('/admin/pos/' + po.body.id + '/receive', T.admin, { got: { it_goil: { qty: 3, cost: 2520 } }, updateCost: true })).status, 200);
    eq('the godown gains 45 litres (3 × 15)', await gq('it_goil', 'loc_g1'), oil0 + 45);
    eq('the tin\'s cost becomes what was paid', (await call('/items/it_goil', T.admin)).body.units.find((u) => u.code === 'tin').cost, 2520);
    const recd = (await call('/admin/pos', T.admin)).body.find((p) => p.id === po.body.id);
    check('what arrived is on record', recd.received[0].qty === 3 && recd.received[0].cost === 2520);
    const oilMove = (await call('/items/it_goil/moves', T.admin)).body.find((m) => m.ref === 'order ' + recd.no);
    eq('and the short tin in the ledger', oilMove && oilMove.note, '1 tin short');
    const po2 = await call('/admin/pos', T.admin, { supplierId: sup.body.id, to: 'loc_g1', lines: [{ itemId: 'it_goil', unit: 'tin', qty: 1, cost: 2500 }] });
    eq('an order can be cancelled before dispatch', (await call('/admin/pos/' + po2.body.id + '/cancel', T.admin, {})).status, 200);
    eq('a dispatched one cannot', (await call('/admin/pos/po_2/cancel', T.admin, {})).status, 409);
    eq('a vendor cannot cancel', (await call('/admin/pos/' + po2.body.id + '/cancel', vt, {})).status, 403);

    // ---- deliveries from bills
    const lak = (await call('/admin/customers', T.admin)).body.find((c) => c.key === '9000000017');
    eq('a landmark is kept on the stock side', (await call('/admin/customers/' + lak.id, T.admin, { landmark: 'Blue gate, next to the well' })).status, 200);
    const dl = await call('/admin/deliveries', T.admin, { billNo: 51, personId: 'p_delivery', vehicle: 'Scooter' });
    eq('bill 51 goes out for delivery', dl.status, 201);
    check('with the customer\'s address from billing and the landmark from here', dl.body.address === 'Near water tank, 5th ward' && dl.body.landmark === 'Blue gate, next to the well', JSON.stringify(dl.body));
    eq('the amount to collect is the bill\'s balance (paid)', dl.body.amountDue, 0);
    eq('the same bill twice is refused', (await call('/admin/deliveries', T.admin, { billNo: 51, personId: 'p_delivery' })).status, 409);
    eq('only a delivery person can take it', (await call('/admin/deliveries', T.admin, { billNo: 52, personId: 'p_worker' })).status, 400);
    eq('a bill that does not exist is refused', (await call('/admin/deliveries', T.admin, { billNo: 999, personId: 'p_delivery' })).status, 404);
    eq('a delivery person cannot hand out deliveries', (await call('/admin/deliveries', T.delivery, { billNo: 52, personId: 'p_delivery' })).status, 403);
    check('Kiran sees the new drop', (await call('/delivery/mine', T.delivery)).body.some((d) => d.id === dl.body.id));
    const second = await call('/people', T.admin, { name: 'Suma (delivery)', phone: '9111100002', role: 'delivery', pin: '3333' });
    eq('a second delivery person', second.status, 201);
    eq('the drop is given to Suma', (await call('/admin/deliveries/' + dl.body.id + '/assign', T.admin, { personId: second.body.id })).status, 200);
    check('Kiran no longer has it', !(await call('/delivery/mine', T.delivery)).body.some((d) => d.id === dl.body.id));
    const suma = (await call('/auth/login', null, { phone: '9111100002', pin: '3333' })).body.token;
    check('Suma does', (await call('/delivery/mine', suma)).body.some((d) => d.id === dl.body.id));
    eq('Kiran cannot mark it any more', (await call('/deliveries/' + dl.body.id + '/status', T.delivery, { status: 'out' })).status, 403);
    eq('Suma delivers it', (await call('/deliveries/' + dl.body.id + '/status', suma, { status: 'out' })).status, 200);
    eq('', (await call('/deliveries/' + dl.body.id + '/status', suma, { status: 'delivered' })).status, 200);
    eq('a delivered drop cannot be reassigned', (await call('/admin/deliveries/' + dl.body.id + '/assign', T.admin, { personId: 'p_delivery' })).status, 409);
    eq('once delivered, the bill can go out again (a second trip)', (await call('/admin/deliveries', T.admin, { billNo: 51, personId: 'p_delivery' })).status, 201);

    // ---- reset brings it all back
    eq('the demo resets', (await call('/demo/reset', null, {})).status, 200);
    const again = await as('admin');
    eq('with the lines to confirm back', (await call('/admin/summary', again)).body.toConfirm, summary.toConfirm);
  } catch (err) {
    failed++;
    console.log('FAIL threw: ' + err.stack + '\n' + log);
  } finally {
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('roletest: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main();
