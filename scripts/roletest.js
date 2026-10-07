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
  // The demo, plus a supplier who signed in back when vendors could: seeded here, before the
  // server starts, as it would be in a shop's data from then.
  {
    const { hashPin } = require(path.join(out, 'pin.js'));
    const repo = await require(path.join(out, 'store', 'file.js')).createFileRepo(dir);
    await require(path.join(out, 'demo', 'seed.js')).seedDemo(repo);
    // And the logins that were removed (owner, delivery, customer): kept as records, never signed in.
    for (const [id, role, phone] of [['p_oldowner', 'owner', '9111100011'], ['p_olddelivery', 'delivery', '9111100012'], ['p_oldcustomer', 'customer', '9111100013']]) {
      await repo.createPerson({ id, name: 'Old ' + role + ' login', phone, role, active: true, pinHash: hashPin('2468'), tv: 1, createdAt: new Date().toISOString() });
    }
    await repo.createPerson({ id: 'p_oldvendor', name: 'Old vendor login', phone: '9111100009', role: 'vendor', linkedId: 'sup_1', active: true, pinHash: hashPin('2468'), tv: 1, createdAt: new Date().toISOString() });
    await repo.close();
  }
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
    const send = async (method, p, token, body) => {
      const r = await fetch(base + '/api' + p, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const as = async (role) => (await call('/demo/login-as', null, { role })).body.token;
    const T = {};
    for (const r of ['admin', 'worker']) T[r] = await as(r);
    check('every role that signs in has a demo person', Object.values(T).every(Boolean));
    eq('suppliers have no demo login', (await call('/demo/login-as', null, { role: 'vendor' })).status, 404);
    eq('a vendor from before cannot sign in', (await call('/auth/login', null, { phone: '9111100009', pin: '2468' })).status, 403);
    check('but is kept, as a contact', (await call('/people', T.admin)).body.some((p) => p.id === 'p_oldvendor' && p.role === 'vendor'));
    eq('the vendor screen is gone', (await call('/vendor/pos', T.admin)).status, 404);
    eq('and so are the vendor\'s steps', (await call('/pos/po_3/confirm', T.admin, {})).status, 404);
    eq('a new vendor login is refused', (await call('/people', T.admin, { name: 'V', phone: '9111100001', role: 'vendor', pin: '2222', linkedId: 'sup_1' })).status, 400);
    // ---- removed roles: the data stays, the login is refused with a clear message
    for (const [role, phone] of [['owner', '9111100011'], ['delivery', '9111100012'], ['customer', '9111100013']]) {
      const r = await call('/auth/login', null, { phone, pin: '2468' });
      eq('an old ' + role + ' login is refused', r.status, 403);
      check('with a clear message in English', /no longer used/.test(r.body && r.body.error), JSON.stringify(r.body));
      check('and in Kannada', /ಈ ಲಾಗಿನ್ ಈಗ ಬಳಕೆಯಲ್ಲಿಲ್ಲ/.test(r.body && r.body.error), JSON.stringify(r.body));
      eq('there is no demo ' + role + ' login', (await call('/demo/login-as', null, { role })).status, 404);
    }
    check('the old logins are kept, for the admin to move', (await call('/people', T.admin)).body.filter((p) => /^p_old/.test(p.id)).length === 4);
    eq('a new delivery login is refused', (await call('/people', T.admin, { name: 'D', phone: '9111100021', role: 'delivery', pin: '2222' })).status, 400);
    eq('a new customer login is refused', (await call('/people', T.admin, { name: 'C', phone: '9111100022', role: 'customer', pin: '2222' })).status, 400);
    eq('a new owner login is refused', (await call('/people', T.admin, { name: 'O', phone: '9111100023', role: 'owner', pin: '2222' })).status, 400);
    eq('an old delivery login is moved to shop worker', (await send('PUT', '/people/p_olddelivery', T.admin, { role: 'worker' })).status, 200);
    eq('and then signs in', (await call('/auth/login', null, { phone: '9111100012', pin: '2468' })).status, 200);
    eq('nobody can be moved to a removed role', (await send('PUT', '/people/p_worker', T.admin, { role: 'customer' })).status, 400);
    for (const p of ['/delivery/mine', '/customer/bills', '/customer/catalogue', '/customer/orders', '/admin/deliveries', '/admin/orders']) {
      eq(p + ' is gone', (await call(p, T.admin)).status, 404);
    }
    eq('demo PIN works like a real login', (await call('/auth/login', null, { phone: '9000000003', pin: '1111' })).status, 200);
    eq('the demo has no godown login: two roles', (await call('/demo/login-as', null, { role: 'godown' })).status, 404);

    // ---- who sees what
    const summary = (await call('/admin/summary', T.admin)).body;
    check('the admin sees lines to confirm', summary.toConfirm >= 3, JSON.stringify(summary));
    for (const r of ['worker']) {
      eq(r + ' cannot read the admin summary', (await call('/admin/summary', T[r])).status, 403);
    }



    const worker = (await call('/worker/bills', T.worker)).body;
    check('the worker sees today\'s bills, newest first', worker.length === 4 && worker[0].no === 54);
    check('lines carry their rack', worker.some((b) => b.lines.some((l) => l.rack === 'Rack 1')), JSON.stringify(worker.map((b) => b.lines.map((l) => l.rack))));

    // ---- reports
    const rep = await call('/reports', T.admin);
    eq('the admin reads reports', rep.status, 200);
    eq('a worker cannot', (await call('/reports', T.worker)).status, 403);
    const S = rep.body.sales;
    const billsNow = (await call('/admin/bills', T.admin)).body;
    const takings = Math.round(billsNow.filter((b) => !b.cancelled).reduce((a, b) => a + b.total, 0) * 100) / 100;
    eq('takings add up to the bills', S.total, takings);
    eq('linked + not linked + not stock = takings', Math.round((S.linked + S.unlinked + S.notStock) * 100) / 100, S.total);
    check('handwriting still to confirm shows as not linked', S.unlinked > 0 && S.unlinkedLines === 4, JSON.stringify({ u: S.unlinked, n: S.unlinkedLines }));
    const rice = S.rows.find((r) => r.itemId === 'it_rice');
    const riceLedger = (await call('/items/it_rice/moves?limit=200', T.admin)).body.filter((m) => m.kind === 'sale').reduce((a, m) => a + m.qty, 0);
    eq('rice sold agrees with the ledger', rice.baseQty, riceLedger);
    check('best sellers first', S.rows.every((r, i) => i === 0 || S.rows[i - 1].amount >= r.amount));
    check('stock value adds up across places', Math.abs(rep.body.value.places.reduce((a, p) => a + p.value, 0) - rep.body.value.total) < 0.01);
    check('fast movers have sold something', rep.body.movers.fast.every((x) => x.sold > 0));
    check('a quiet day is a bad date range', (await call('/reports?from=2026-01-10&to=2026-01-01', T.admin)).status === 400);
    const csvRes = await fetch(base + '/api/reports/sales.csv', { headers: { Authorization: 'Bearer ' + T.admin } });
    const csvText = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await csvRes.arrayBuffer());
    check('the sales report downloads for Excel', csvRes.status === 200 && csvText.charCodeAt(0) === 0xfeff && csvText.includes('Not yet linked'));

    // ---- confirming a handwritten line moves stock once and learns the name
    const shopQty = async (itemId) => ((await call('/stock', T.admin)).body.find((s) => s.itemId === itemId && s.locationId === 'loc_shop') ?? { qty: 0 }).qty;
    const coffee0 = await shopQty('it_coffee');
    const c1 = await call('/admin/confirm', T.admin, { billNo: 54, i: 1, itemId: 'it_coffee', unit: 'pc', qty: 1 });
    eq('confirming a line works', c1.status, 200);
    eq('stock drops by one pack', await shopQty('it_coffee'), coffee0 - 1);
    eq('a handwritten line with no reading teaches no name', c1.body.learnt || '', '');
    eq('confirming again is refused', (await call('/admin/confirm', T.admin, { billNo: 54, i: 1, itemId: 'it_coffee', unit: 'pc', qty: 1 })).status, 409);
    eq('stock did not move twice', await shopQty('it_coffee'), coffee0 - 1);
    eq('"not stock" leaves stock alone', (await call('/admin/confirm', T.admin, { billNo: 54, i: 3, notItem: true })).status, 200);
    eq('a unit the item does not have is refused', (await call('/admin/confirm', T.admin, { billNo: 53, i: 2, itemId: 'it_ghee', unit: 'tin', qty: 2 })).status, 400);

    // ---- confirm all on one bill
    const pending = (await call('/admin/confirm', T.admin)).body;
    check('lines to confirm come in bill order', pending.every((p, i) => i === 0 || pending[i - 1].billNo <= p.billNo));
    const ghee0 = await shopQty('it_ghee');
    const all53 = await call('/admin/confirm/bill', T.admin, { billNo: 53, lines: [{ i: 2, itemId: 'it_ghee', unit: 'pc', qty: 2 }, { i: 0, itemId: 'it_onion', unit: 'kg', qty: 10 }, { i: 9, notItem: true }] });
    eq('a bill confirms in one go', all53.status, 200);
    check('the good line is done', all53.body.done.length === 1 && all53.body.done[0].i === 2, JSON.stringify(all53.body));
    check('a line already done and a missing line are reported, not fatal', all53.body.failed.map((x) => x.i).join() === '0,9', JSON.stringify(all53.body.failed));
    eq('the ghee left the shop once', await shopQty('it_ghee'), ghee0 - 2);
    eq('again changes nothing', (await call('/admin/confirm/bill', T.admin, { billNo: 53, lines: [{ i: 2, itemId: 'it_ghee', unit: 'pc', qty: 2 }] })).body.done.length, 0);
    eq('and stock stays put', await shopQty('it_ghee'), ghee0 - 2);
    eq('a bill that does not exist', (await call('/admin/confirm/bill', T.admin, { billNo: 999, lines: [{ i: 0, notItem: true }] })).status, 404);
    check('bill 53 has nothing left to confirm', !(await call('/admin/confirm', T.admin)).body.some((p) => p.billNo === 53));

    // ---- running low: one level, all places together
    const put = async (p, token, body) => {
      const r = await fetch(base + '/api' + p, { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, body: await r.json() };
    };
    const levels = (await call('/stock', T.admin)).body.filter((x) => x.itemId === 'it_parle');
    const total = levels.reduce((a, x) => a + x.qty, 0);
    const parleNow = (await call('/items/it_parle', T.admin)).body;
    eq('the demo level is in packs', JSON.stringify(parleNow.lowAt), JSON.stringify({ qty: 2, unit: 'pack' }));
    const low0 = (await call('/admin/summary', T.admin)).body;
    check('toor dal is low in all places together', (await call('/admin/refill', T.admin)).body.buy.some((b) => b.itemId === 'it_toor'));
    const set = await put('/items/it_parle', T.admin, { ...parleNow, lowAt: { qty: total, unit: 'pc' } });
    eq('a level is set in pieces', set.status, 200);
    eq('a level in a unit the item does not have is refused', (await put('/items/it_parle', T.admin, { ...parleNow, lowAt: { qty: 1, unit: 'crate' } })).status, 400);
    eq('exactly the level is not low', (await call('/admin/summary', T.admin)).body.low, low0.low);
    const shopParle = levels.find((x) => x.locationId === 'loc_shop').qty;
    await call('/stock/adjust', T.admin, { itemId: 'it_parle', locationId: 'loc_shop', actual: shopParle - 1, reason: 'damaged' });
    const s1 = (await call('/admin/summary', T.admin)).body;
    eq('one piece less in the shop makes it low', s1.low, low0.low + 1);
    check('and it shows as just gone low', s1.justLow.some((a) => a.itemId === 'it_parle' && a.nameEn === 'Parle-G'), JSON.stringify(s1.justLow));
    const stockCsv = await (await fetch(base + '/api/export/stock.csv', { headers: { Authorization: 'Bearer ' + T.admin } })).text();
    check('stock.csv says so, with the total and the level', stockCsv.split('\n').some((l) => l.includes('it_parle') && l.includes(total - 1 + ',' + total + ' pc,running low')), stockCsv.split('\n').find((l) => l.includes('it_parle')));
    await put('/items/it_parle', T.admin, { ...parleNow, lowAt: undefined });
    eq('a cleared level is never low', (await call('/admin/summary', T.admin)).body.low, low0.low);

    // ---- a trip: requested, sent short by the godown, received at the shop
    const g0 = await (async () => ((await call('/stock', T.admin)).body.find((s) => s.itemId === 'it_clinic' && s.locationId === 'loc_g1')).qty)();
    const s0 = await shopQty('it_clinic');
    const gp = (await call('/godown/places', T.worker)).body;
    check('a worker gets the godowns for the picker', gp.length === 2 && gp.some((g) => g.id === 'loc_g1'), JSON.stringify(gp));
    const gt = (await call('/godown/transfers?g=loc_g1', T.worker)).body;
    check('and a godown\'s transfers', gt.some((t) => t.id === 'tr_3') && gt.every((t) => t.from === 'loc_g1' || t.to === 'loc_g1'));
    eq('a worker sends transfer 3, 8 Clinic Plus short', (await call('/transfers/tr_3/send', T.worker, { vehicle: 'KA-17', sent: { it_clinic: 120 } })).status, 200);
    eq('sending twice is refused', (await call('/transfers/tr_3/send', T.worker, {})).status, 409);
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
    eq('a worker cannot ask for transfers', (await call('/admin/transfers', T.worker, { from: 'loc_g1', to: 'loc_shop', lines: [{ itemId: 'it_rice', qty: 1 }] })).status, 403);
    const id = g2g.body.id;
    eq('sending more than was asked for is refused', (await call('/transfers/' + id + '/send', T.worker, { sent: { it_rice: 30 } })).status, 400);
    eq('sending nothing is refused (cancel instead)', (await call('/transfers/' + id + '/send', T.worker, { sent: { it_rice: 0 } })).status, 400);
    const r0g1 = await gq('it_rice', 'loc_g1');
    const r0g2 = await gq('it_rice', 'loc_g2');
    eq('the main godown sends 20 of the 25', (await call('/transfers/' + id + '/send', T.worker, { sent: { it_rice: 20 }, vehicle: 'Tempo' })).status, 200);
    eq('it cannot be cancelled once on the way', (await call('/transfers/' + id + '/cancel', T.admin, {})).status, 409);
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
    eq('and then cannot be sent', (await call('/transfers/' + c.body.id + '/send', T.worker, {})).status, 409);

    // ---- purchase
    const cof = async () => ((await call('/stock', T.admin)).body.find((s) => s.itemId === 'it_coffee' && s.locationId === 'loc_g2') ?? { qty: 0 }).qty;
    const c0 = await cof();
    eq('the admin receives it', (await call('/admin/pos/po_3/receive', T.admin, {})).status, 200);
    eq('the godown\'s coffee goes up by 40', await cof(), c0 + 40);
    eq('receiving twice is refused', (await call('/admin/pos/po_3/receive', T.admin, {})).status, 409);

    // ---- suppliers and purchase orders
    const sup = await call('/admin/suppliers', T.admin, { name: 'Ganesh Oils', phone: '9000000099' });
    eq('a supplier is added', sup.status, 201);
    const noted = await put('/admin/suppliers/' + sup.body.id, T.admin, { name: 'Ganesh Oils', phone: '9000000099', notes: 'Oil tins, cash only' });
    eq('a supplier keeps notes', noted.body.notes, 'Oil tins, cash only');
    eq('a unit the item does not have is refused', (await call('/admin/pos', T.admin, { supplierId: sup.body.id, to: 'loc_g1', lines: [{ itemId: 'it_goil', unit: 'drum', qty: 1, cost: 1 }] })).status, 400);
    eq('a place that does not exist is refused', (await call('/admin/pos', T.admin, { supplierId: sup.body.id, to: 'loc_moon', lines: [{ itemId: 'it_goil', unit: 'tin', qty: 1, cost: 1 }] })).status, 400);
    const po = await call('/admin/pos', T.admin, { supplierId: sup.body.id, to: 'loc_g1', lines: [{ itemId: 'it_goil', unit: 'tin', qty: 4, cost: 2500 }] });
    eq('an order for 4 tins of groundnut oil', po.status, 201);
    eq('it is ordered', po.body.status, 'ordered');
    eq('an item twice is refused', (await call('/admin/pos', T.admin, { supplierId: sup.body.id, to: 'loc_g1', lines: [{ itemId: 'it_goil', unit: 'tin', qty: 1 }, { itemId: 'it_goil', unit: 'l', qty: 1 }] })).status, 400);
    eq('an item that does not exist is refused', (await call('/admin/pos', T.admin, { supplierId: sup.body.id, to: 'loc_g1', lines: [{ itemId: 'it_nope', unit: 'pc', qty: 1 }] })).status, 400);
    eq('the cost may be left out', (await call('/admin/pos', T.admin, { supplierId: sup.body.id, to: 'loc_g1', lines: [{ itemId: 'it_rava', unit: 'kg', qty: 5 }] })).body.lines[0].cost, 0);
    const page = (await call('/admin/pos?limit=2', T.admin)).body;
    check('orders come a page at a time, open first', page.orders.length === 2 && page.next === 2 && page.orders.every((o) => o.status !== 'received' && o.status !== 'cancelled'), JSON.stringify(page));
    const everything = (await call('/admin/pos?limit=100', T.admin)).body;
    check('then the rest', everything.next === null && everything.orders.length === everything.total && everything.orders.findIndex((o) => o.status === 'received') >= everything.open);
    check('old confirmed and dispatched orders are open', everything.orders.slice(0, everything.open).some((o) => o.status === 'dispatched') && everything.orders.slice(0, everything.open).some((o) => o.status === 'confirmed'));
    eq('receiving more than ordered is refused', (await call('/admin/pos/' + po.body.id + '/receive', T.admin, { got: { it_goil: { qty: 5 } } })).status, 400);
    const oil0 = await gq('it_goil', 'loc_g1');
    eq('3 tins arrive, at ₹2520', (await call('/admin/pos/' + po.body.id + '/receive', T.admin, { got: { it_goil: { qty: 3, cost: 2520 } }, updateCost: true })).status, 200);
    eq('the godown gains 45 litres (3 × 15)', await gq('it_goil', 'loc_g1'), oil0 + 45);
    eq('the tin\'s cost becomes what was paid', (await call('/items/it_goil', T.admin)).body.units.find((u) => u.code === 'tin').cost, 2520);
    const recd = (await call('/admin/pos?limit=100', T.admin)).body.orders.find((p) => p.id === po.body.id);
    check('what arrived is on record', recd.received[0].qty === 3 && recd.received[0].cost === 2520);
    const oilMove = (await call('/items/it_goil/moves', T.admin)).body.find((m) => m.ref === 'order ' + recd.no);
    eq('and the short tin in the ledger', oilMove && oilMove.note, '1 tin short');
    const po2 = await call('/admin/pos', T.admin, { supplierId: sup.body.id, to: 'loc_g1', lines: [{ itemId: 'it_goil', unit: 'tin', qty: 1, cost: 2500 }] });
    eq('an order can be cancelled', (await call('/admin/pos/' + po2.body.id + '/cancel', T.admin, {})).status, 200);
    eq('but not received after', (await call('/admin/pos/' + po2.body.id + '/receive', T.admin, {})).status, 409);
    const mus0 = await gq('it_mustard', 'loc_shop');
    eq('an old dispatched order is received, into another place', (await call('/admin/pos/po_2/receive', T.admin, { to: 'loc_shop' })).status, 200);
    eq('and its goods arrive there', await gq('it_mustard', 'loc_shop'), mus0 + 60);
    eq('a confirmed one can still be cancelled', (await call('/admin/pos/po_4/cancel', T.admin, {})).status, 200);

    // ---- customer addresses: the landmark is kept on the stock side
    const lak = (await call('/admin/customers', T.admin)).body.find((c) => c.key === '9000000017');
    eq('a landmark is kept on the stock side', (await call('/admin/customers/' + lak.id, T.admin, { landmark: 'Blue gate, next to the well' })).status, 200);

    // ---- rounding off, the worker's walk, select all
    eq('the demo rounds bills to ₹5', (await call('/admin/settings', T.admin)).body.roundTo, 5);
    eq('a worker cannot change it', (await send('PUT', '/admin/settings', T.worker, { roundTo: 1 })).status, 403);
    eq('only none, 1, 5 or 10', (await send('PUT', '/admin/settings', T.admin, { roundTo: 3 })).status, 400);
    const wb = (await call('/worker/bills', T.worker)).body;
    check('every worker bill has its rounded total and round-off line', wb.every((b) => b.rounded % 5 === 0 && Math.abs(b.rounded - b.total - b.roundOff) < 0.001), JSON.stringify(wb.map((b) => [b.total, b.rounded, b.roundOff])));
    const ab = (await call('/admin/bills', T.admin)).body;
    check('so does the bills list', ab.every((b) => b.rounded % 5 === 0 && Math.abs(b.rounded - b.total - b.roundOff) < 0.001));
    eq('the admin switches to the rupee', (await send('PUT', '/admin/settings', T.admin, { roundTo: 1 })).status, 200);
    check('and totals follow', (await call('/worker/bills', T.worker)).body.every((b) => Number.isInteger(b.rounded)));
    const rp = (await call('/reports', T.admin)).body;
    check('reports carry the round-off for the period', rp.sales.roundTo === 1 && typeof rp.sales.roundOff === 'number');
    const shopLine = wb[0].lines.find((l) => l.rack);
    check('a line on a shop rack says it is in the shop', shopLine && shopLine.place === 'Shop' && shopLine.placeOrder === 0, JSON.stringify(shopLine));

    const b54 = wb.find((b) => b.no === 54);
    eq('the worker selects all', (await call('/worker/bills/54/fetched', T.worker, { fetched: true })).body.lines, b54.lines.length);
    check('every line is ticked', (await call('/worker/bills', T.worker)).body.find((b) => b.no === 54).lines.every((l) => l.fetched));
    eq('and selects none', (await call('/worker/bills/54/fetched', T.worker, { fetched: false })).status, 200);
    check('every line is unticked', (await call('/worker/bills', T.worker)).body.find((b) => b.no === 54).lines.every((l) => !l.fetched));
    eq('no such bill', (await call('/worker/bills/9999/fetched', T.worker, { fetched: true })).status, 404);

    // ---- vehicles
    const vlist = (await call('/admin/vehicles', T.admin)).body;
    eq('the demo has two vehicles', vlist.length, 2);
    for (const r of ['worker']) {
      eq(r + ' cannot manage vehicles', (await call('/admin/vehicles', T[r])).status, 403);
    }
    eq('a worker cannot add one', (await call('/admin/vehicles', T.worker, { number: 'KA-01 X 1' })).status, 403);
    const pick = await call('/vehicles', T.worker);
    check('a worker gets the pick list, for the Godown tab', pick.status === 200 && pick.body.length === 2);
    check('without drivers\' phones', !JSON.stringify(pick.body).includes('9000000011'));
    const nv = await call('/admin/vehicles', T.admin, { number: 'KA-17 Z 99', type: 'Auto', driverName: 'Raju', driverPhone: '98450 12345' });
    check('the admin adds a vehicle', nv.status === 201 && nv.body.driverPhone === '9845012345', JSON.stringify(nv.body));
    eq('the same number again is refused', (await call('/admin/vehicles', T.admin, { number: 'ka17z99' })).status, 409);
    eq('a number is needed', (await call('/admin/vehicles', T.admin, { number: ' ' })).status, 400);
    eq('a bad phone is refused', (await call('/admin/vehicles', T.admin, { number: 'KA-1', driverPhone: '123' })).status, 400);
    const ed = await send('PUT', '/admin/vehicles/' + nv.body.id, T.admin, { number: 'KA-17 Z 99', type: 'Auto', driverName: 'Raju', active: false });
    check('the admin switches it off', ed.status === 200 && ed.body.active === false);
    check('and it leaves the pick list', !(await call('/vehicles', T.worker)).body.some((v) => v.number === 'KA-17 Z 99'));
    eq('the admin removes it', (await send('DELETE', '/admin/vehicles/' + nv.body.id, T.admin)).status, 200);
    eq('it is gone', (await call('/admin/vehicles', T.admin)).body.length, 2);
    eq('removing it twice', (await send('DELETE', '/admin/vehicles/' + nv.body.id, T.admin)).status, 404);
    const trips = (await call('/reports', T.admin)).body.trips;
    const tempo = trips.find((t) => t.vehicle === 'KA-17 AB 1234');
    check('trips by vehicle counts the tempo\'s transfers, however its number was typed', tempo && tempo.transfers >= 1, JSON.stringify(trips));
    const tripsCsv = await fetch(base + '/api/reports/trips.csv', { headers: { Authorization: 'Bearer ' + T.admin } });
    check('trips download for Excel', tripsCsv.status === 200 && (await tripsCsv.text()).includes('KA-17 AB 1234'));

    // ---- Excel files
    for (const [p, sheets] of [['/export/items.xlsx', 1], ['/export/stock.xlsx', 3]]) {
      const x = await fetch(base + '/api' + p, { headers: { Authorization: 'Bearer ' + T.admin } });
      const buf = Buffer.from(await x.arrayBuffer());
      check(p + ' downloads as a ZIP', x.status === 200 && buf.readUInt32LE(0) === 0x04034b50 && /spreadsheetml/.test(x.headers.get('content-type') || ''));
      eq(p + ' has a sheet per ' + (sheets > 1 ? 'place' : 'file'), buf.readUInt16LE(buf.length - 12), 4 + sheets);
      check(p + ' has Parle-G in it', buf.includes(Buffer.from('Parle-G')));
      eq(p + ' is not for a worker', (await fetch(base + '/api' + p, { headers: { Authorization: 'Bearer ' + T.worker } })).status, 403);
    }

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
