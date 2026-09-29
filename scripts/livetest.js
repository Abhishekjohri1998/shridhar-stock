/*
 * The live stream: each person hears about changes that concern them, and nobody else's.
 * Runs the demo data on a throwaway file store, with real streams for several roles at once.
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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-live-'));
  const port = 4600 + Math.floor(Math.random() * 300);
  const base = 'http://localhost:' + port;
  const proc = spawn(process.execPath, [path.join(out, 'index.js')], {
    env: { ...process.env, MONGO_URI: '', DEMO: '1', PORT: String(port), DATA_DIR: dir, JWT_SECRET: 'livetest', BILLING_URL: '', BILLING_PIN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const streams = [];
  try {
    for (let i = 0; i < 300; i++) {
      try {
        if ((await fetch(base + '/api/health')).ok) break;
      } catch {
        /* not yet */
      }
      await wait(100);
    }
    const call = async (p, token, body) => {
      const r = await fetch(base + '/api' + p, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const as = async (role) => (await call('/demo/login-as', null, { role })).body.token;

    /** Opens a stream for a role and collects the kinds it hears. */
    async function listen(role) {
      const token = await as(role);
      const { ticket } = (await call('/events/ticket', token, {})).body;
      const ctrl = new AbortController();
      const res = await fetch(base + '/api/events?ticket=' + ticket, { signal: ctrl.signal });
      const heard = [];
      const s = { role, token, heard, ctrl, hello: false, ticket };
      (async () => {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let at;
            while ((at = buf.indexOf('\n\n')) >= 0) {
              const block = buf.slice(0, at);
              buf = buf.slice(at + 2);
              if (block.includes('event: hello')) s.hello = true;
              const m = /data: (.*)/.exec(block);
              if (block.includes('event: change') && m) heard.push(JSON.parse(m[1]).kind);
            }
          }
        } catch {
          /* aborted */
        }
        s.closed = true;
      })();
      streams.push(s);
      return s;
    }

    const admin = await listen('admin');
    const worker = await listen('worker');
    const godown = await listen('godown'); // main godown
    const vendor = await listen('vendor'); // sup_1
    const delivery = await listen('delivery');
    const customer = await listen('customer');
    await wait(300);
    check('every stream opens', [admin, worker, godown, vendor, delivery, customer].every((s) => s.hello));
    const reset = () => streams.forEach((s) => (s.heard.length = 0));

    eq('a used ticket cannot open a second stream', (await fetch(base + '/api/events?ticket=' + admin.ticket)).status, 401);
    eq('a made-up ticket neither', (await fetch(base + '/api/events?ticket=nope')).status, 401);

    // A worker ticks a line: the other workers' and the admin's screens hear it.
    reset();
    await call('/worker/bills/54/lines/2/fetched', worker.token, { fetched: true });
    await wait(300);
    check('the admin hears a tick', admin.heard.includes('bills'));
    check('the worker hears it', worker.heard.includes('bills'));
    check('a vendor does not', !vendor.heard.includes('bills'));
    check('a godown does not', !godown.heard.includes('bills'));

    // A transfer from the main godown: that godown hears it, the vendor does not.
    reset();
    await call('/transfers/tr_3/send', godown.token, { vehicle: 'KA' });
    await wait(300);
    check('the godown hears its transfer', godown.heard.includes('transfers'));
    check('and its stock changing', godown.heard.includes('stock'));
    check('the admin hears it', admin.heard.includes('transfers'));
    check('the vendor does not', vendor.heard.length === 0, vendor.heard.join());
    check('the worker does not hear transfers', !worker.heard.includes('transfers'));

    // A transfer to another godown's stock: the main godown hears nothing.
    reset();
    await call('/transfers/tr_2/receive', admin.token, {});
    await wait(300);
    check('the shop receiving from another godown is not the main godown\'s business', !godown.heard.includes('transfers'), godown.heard.join());

    // Purchase orders: only their own vendor.
    reset();
    await call('/pos/po_4/confirm', admin.token, {}); // the dairy's order, not sup_1's
    await wait(300);
    check('a vendor does not hear another supplier\'s order', !vendor.heard.includes('pos'));
    await call('/pos/po_3/confirm', vendor.token, {});
    await wait(300);
    check('but hears their own', vendor.heard.includes('pos'));

    // Deliveries: only the person it is assigned to.
    reset();
    await call('/deliveries/dl_3/status', delivery.token, { status: 'out' });
    await wait(300);
    check('the delivery person hears their drop', delivery.heard.includes('deliveries'));
    check('the customer does not hear deliveries', !customer.heard.includes('deliveries'));

    // A customer's request: that customer and the admin.
    reset();
    await call('/customer/orders', customer.token, { lines: [{ itemId: 'it_sugar', unit: 'kg', qty: 1 }] });
    await wait(300);
    check('the customer hears their request', customer.heard.includes('orders'));
    check('the admin hears it', admin.heard.includes('orders'));
    check('the worker does not', !worker.heard.includes('orders'));

    // Confirming a handwritten line reaches the worker's pick list.
    reset();
    await call('/admin/confirm', admin.token, { billNo: 54, i: 1, itemId: 'it_coffee', unit: 'pc', qty: 1 });
    await wait(300);
    check('a confirmed line reaches the worker', worker.heard.includes('bills'));
    check('and teaches an item name, which the worker hears', worker.heard.includes('items'));

    // Switching someone off ends their stream at once.
    const workerId = (await call('/me', worker.token)).body.id;
    await call('/people/' + workerId, admin.token, { active: false }).then(() => undefined);
    const put = await fetch(base + '/api/people/' + workerId, { method: 'PUT', headers: { Authorization: 'Bearer ' + admin.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ active: false }) });
    eq('the admin switches the worker off', put.status, 200);
    await wait(300);
    check('their stream is closed', worker.closed === true);
  } catch (err) {
    failed++;
    console.log('FAIL threw: ' + err.stack);
  } finally {
    streams.forEach((s) => s.ctrl.abort());
    proc.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('livetest: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main();
