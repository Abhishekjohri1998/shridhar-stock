/*
 * Backup and restore, end to end, against a real server on the demo file store in a temp folder:
 * backup -> erase -> restore gives back exactly the same data; a damaged file is refused and
 * changes nothing; a worker is refused; a safety backup is saved before the restore. Erasing
 * (both ways) clears exactly what it says, keeps the logins, and its safety backup puts it all back.
 * Never a database: nothing here can reach the shop's data.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, execSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, '.test-build');
execSync('npx tsc -p server/tsconfig.json --outDir ' + JSON.stringify(out), { cwd: root, stdio: 'inherit' });
const { BACKUP_COLLECTIONS } = require(path.join(out, 'store', 'types.js'));

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
const same = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), 'differs');

function start(dataDir, port) {
  const proc = spawn(process.execPath, [path.join(out, 'index.js')], {
    env: { ...process.env, MONGO_URI: '', PORT: String(port), DATA_DIR: dataDir, BACKUP_DIR: '', JWT_SECRET: 'backuptest-secret', DEMO: '1', BILLING_URL: '', BILLING_PIN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  proc.logs = () => log;
  return proc;
}

async function waitUp(base) {
  for (let i = 0; i < 300; i++) {
    try {
      if ((await fetch(base + '/api/health')).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
const stop = (p) => new Promise((r) => (p.exitCode != null ? r() : (p.once('exit', r), p.kill())));

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-backup-'));
  const port = 5300 + Math.floor(Math.random() * 300);
  const base = 'http://localhost:' + port;
  let proc = start(dir, port);
  try {
    await waitUp(base);
    const call = async (p, { method = 'GET', body, raw, token } = {}) => {
      const r = await fetch(base + '/api' + p, {
        method,
        headers: { ...(body || raw ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        ...(raw !== undefined ? { body: raw } : body ? { body: JSON.stringify(body) } : {}),
      });
      const text = await r.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* not json */
      }
      return { status: r.status, body: json, text, headers: r.headers };
    };
    const asAdmin = async () => (await call('/demo/login-as', { method: 'POST', body: { role: 'admin' } })).body.token;
    let admin = await asAdmin();

    // ------------------------------------------------ make some data of our own on top of the demo
    const w = await call('/people', { method: 'POST', token: admin, body: { name: 'Backup Worker', phone: '9555555555', role: 'worker', pin: '2468' } });
    eq('a worker with a PIN is added', w.status, 201);
    const worker = (await call('/auth/login', { method: 'POST', body: { phone: '9555555555', pin: '2468' } })).body.token;
    check('the worker signs in', !!worker);
    const items = (await call('/items?all=1', { token: admin })).body;
    const locs = (await call('/locations', { token: admin })).body;
    const adj = await call('/stock/adjust', { method: 'POST', token: admin, body: { itemId: items[0].id, locationId: locs[0].id, actual: 77, reason: 'counted', requestId: 'bk-1' } });
    eq('a stock count is posted', adj.status, 200);
    await call('/admin/translit', { method: 'PUT', token: admin, body: { backupword: 'ಬ್ಯಾಕಪ್' } });

    // ------------------------------------------------ a worker cannot back up or restore
    eq('worker: no backup download', (await call('/admin/backup', { token: worker })).status, 403);
    eq('worker: no restore', (await call('/admin/restore', { method: 'POST', token: worker, body: { confirm: 'RESTORE', backup: {} } })).status, 403);
    eq('worker: no safety backups', (await call('/admin/backups', { token: worker })).status, 403);
    eq('nobody signed in: no restore', (await call('/admin/restore', { method: 'POST', body: { confirm: 'RESTORE' } })).status, 401);

    // ------------------------------------------------ the backup
    const dl = await call('/admin/backup', { token: admin });
    eq('backup downloads', dl.status, 200);
    check('as a file', /attachment; filename="stock-backup-.*\.json"/.test(dl.headers.get('content-disposition') || ''));
    const b1 = dl.body;
    eq('format', b1.format, 'shridhar-stock-backup');
    eq('version', b1.version, 1);
    same('every collection of the store is in it', Object.keys(b1.collections).sort(), [...BACKUP_COLLECTIONS].sort());
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'inventory.json'), 'utf8'));
    for (const c of Object.keys(disk.docs)) check('the stored collection "' + c + '" is in the backup', c in b1.collections);
    eq('people with PIN hashes', b1.collections.people.every((p) => String(p.pinHash).startsWith('scrypt$')), true);
    eq('the counters are in it', b1.collections.counters.some((c) => c.series === 'po'), true);
    check('the translit words are in it', b1.collections.meta.some((m) => m.id === 'translit' && m.words && m.words.backupword));
    check('moves, POs, items are in it', b1.collections.stockmoves.length > 0 && b1.collections.pos.length > 0 && b1.collections.items.length > 0);
    for (const c of BACKUP_COLLECTIONS) eq('count of ' + c, b1.counts[c], b1.collections[c].length);
    const before = {
      items: (await call('/items?all=1', { token: admin })).body,
      stock: (await call('/stock', { token: admin })).body,
      pos: (await call('/admin/pos', { token: admin })).body,
    };

    // ------------------------------------------------ erase (the demo reset, unchanged)
    eq('erase', (await call('/demo/reset', { method: 'POST' })).status, 200);
    admin = await asAdmin();
    eq('after erase the worker is gone', (await call('/auth/login', { method: 'POST', body: { phone: '9555555555', pin: '2468' } })).status, 401);
    const erased = (await call('/admin/backup', { token: admin })).body;
    check('after erase the data differs', JSON.stringify(erased.collections) !== JSON.stringify(b1.collections));

    // ------------------------------------------------ damaged files are refused and change nothing
    const restore = (backup, confirm = 'RESTORE') => call('/admin/restore', { method: 'POST', token: admin, body: { confirm, backup } });
    const notJson = await call('/admin/restore', { method: 'POST', token: admin, raw: '{"confirm":"RESTORE","backup":{"format":"shridhar-stock-backup",' });
    eq('not JSON: refused', notJson.status, 400);
    check('not JSON: said plainly', /damaged/.test(notJson.body && notJson.body.error), notJson.text);
    const wrongFormat = await restore({ format: 'billing-backup', version: 1, collections: {} });
    eq('another app\'s file: refused', wrongFormat.status, 400);
    check('another app\'s file: said plainly', /not a stock backup/.test(wrongFormat.body.error), wrongFormat.body.error);
    eq('a newer version: refused', (await restore({ ...b1, version: 99 })).status, 400);
    const cut = JSON.parse(JSON.stringify(b1));
    cut.collections.stockmoves.pop();
    const cutRes = await restore(cut);
    eq('a cut-short file: refused', cutRes.status, 400);
    check('a cut-short file: said plainly', /cut short/.test(cutRes.body.error), cutRes.body.error);
    const noPeople = JSON.parse(JSON.stringify(b1));
    delete noPeople.collections.people;
    eq('a file with a part missing: refused', (await restore(noPeople)).status, 400);
    const broken = JSON.parse(JSON.stringify(b1));
    broken.collections.items[0] = 'junk';
    eq('a damaged record: refused', (await restore(broken)).status, 400);
    const dup = JSON.parse(JSON.stringify(b1));
    dup.collections.items.push(dup.collections.items[0]);
    dup.counts.items++;
    eq('a duplicated record: refused', (await restore(dup)).status, 400);
    const noAdmin = JSON.parse(JSON.stringify(b1));
    noAdmin.collections.people = noAdmin.collections.people.filter((p) => p.role !== 'admin');
    noAdmin.counts.people = noAdmin.collections.people.length;
    eq('a file with no admin: refused', (await restore(noAdmin)).status, 400);
    eq('without RESTORE typed: refused', (await restore(b1, 'restore please')).status, 400);
    same('nothing changed after the refusals', (await call('/admin/backup', { token: admin })).body.collections, erased.collections);
    eq('no safety backup for a refused file', (await call('/admin/backups', { token: admin })).body.length, 0);

    // ------------------------------------------------ restore
    const r = await restore(b1);
    eq('restore', r.status, 200);
    check('names its safety backup', /^safety-.*\.json$/.test(r.body.safety), JSON.stringify(r.body));
    const list = (await call('/admin/backups', { token: admin })).body;
    eq('the safety backup is listed', list.length === 1 && list[0].name, r.body.safety);
    check('the safety backup is on the server', fs.existsSync(path.join(dir, 'backups', r.body.safety)));
    const safety = await call('/admin/backups/' + r.body.safety, { token: admin });
    eq('the safety backup downloads', safety.status, 200);
    same('the safety backup is what was there before', safety.body.collections, erased.collections);
    eq('no path tricks', (await call('/admin/backups/..%2Finventory.json', { token: admin })).status, 404);

    // The admin may have to sign in again (the people were replaced), as the app's reload does.
    admin = await asAdmin();
    const b2 = (await call('/admin/backup', { token: admin })).body;
    same('restored data is identical, every collection', b2.collections, b1.collections);
    same('items identical', (await call('/items?all=1', { token: admin })).body, before.items);
    same('stock totals identical', (await call('/stock', { token: admin })).body, before.stock);
    same('purchase orders identical', (await call('/admin/pos', { token: admin })).body, before.pos);
    eq('the worker signs in again with the same PIN', (await call('/auth/login', { method: 'POST', body: { phone: '9555555555', pin: '2468' } })).status, 200);
    eq('the demo admin signs in with the PIN', (await call('/auth/login', { method: 'POST', body: { phone: '9000000001', pin: '1111' } })).status, 200);

    // ------------------------------------------------ and it is on disk: the same after a restart
    await stop(proc);
    proc = start(dir, port);
    await waitUp(base);
    admin = await asAdmin();
    const b3 = (await call('/admin/backup', { token: admin })).body;
    same('identical after a restart', b3.collections, b1.collections);

    // ------------------------------------------------ erasing (Setup -> Settings -> Erasing everything)
    const { ERASE_KEEPS } = require(path.join(out, 'backup.js'));
    same('every collection has an erase rule', Object.keys(ERASE_KEEPS).sort(), [...BACKUP_COLLECTIONS].sort());
    const erase = (body, token = admin) => call('/admin/erase', { method: 'POST', token, body });
    const backupNow = async () => (await call('/admin/backup', { token: admin })).body;
    const safetyCount = async () => (await call('/admin/backups', { token: admin })).body.length;
    const full = await backupNow();
    check('there are bills, moves, items, suppliers, carriers, vehicles to erase', ['bills', 'stockmoves', 'items', 'suppliers', 'vehicles', 'pos', 'counters'].every((c) => full.collections[c].length > 0), JSON.stringify(full.counts));
    const maxBill = full.collections.bills.reduce((m, b) => Math.max(m, b.no), 0);
    const nSafety = await safetyCount();

    eq('erase: worker refused', (await erase({ mode: 'everything', pin: '2468', confirm: 'ERASE' }, worker)).status, 403);
    eq('erase: nobody signed in refused', (await call('/admin/erase', { method: 'POST', body: { mode: 'everything', pin: '1111', confirm: 'ERASE' } })).status, 401);
    const wrongPin = await erase({ mode: 'everything', pin: '9999', confirm: 'ERASE' });
    eq('erase: wrong PIN refused', wrongPin.status, 400);
    check('erase: wrong PIN said plainly', /not your PIN/.test(wrongPin.body.error), wrongPin.text);
    eq('erase: the worker\'s PIN is not the admin\'s', (await erase({ mode: 'everything', pin: '2468', confirm: 'ERASE' })).status, 400);
    eq('erase: without ERASE typed refused', (await erase({ mode: 'everything', pin: '1111', confirm: 'erase it' })).status, 400);
    eq('erase: an unknown mode refused', (await erase({ mode: 'bills', pin: '1111', confirm: 'ERASE' })).status, 400);
    eq('erase: no PIN refused', (await erase({ mode: 'stock', confirm: 'ERASE' })).status, 400);
    same('erase: nothing changed after the refusals', (await backupNow()).collections, full.collections);
    eq('erase: no safety backup for a refusal', await safetyCount(), nSafety);

    for (const mode of ['stock', 'everything']) {
      const before = await backupNow();
      const r = await erase({ mode, pin: '1111', confirm: 'ERASE' });
      eq(mode + ': erased', r.status, 200);
      check(mode + ': names its safety backup', /^safety-.*\.json$/.test(r.body.safety || ''), r.text);
      eq(mode + ': and its download', r.body.download, '/admin/backups/' + r.body.safety);
      eq(mode + ': bills are read again only after the newest one stock had', r.body.billsFrom, maxBill + 1);
      const list = (await call('/admin/backups', { token: admin })).body;
      eq(mode + ': the safety backup is listed first', list[0] && list[0].name, r.body.safety);
      const saved = await call(r.body.download, { token: admin });
      eq(mode + ': the safety backup downloads', saved.status, 200);
      same(mode + ': the safety backup is everything that was there', saved.body.collections, before.collections);

      // The same token still works: the admin was not signed out.
      eq(mode + ': the admin stays signed in', (await call('/me', { token: admin })).status, 200);
      const after = await backupNow();
      for (const c of BACKUP_COLLECTIONS) {
        if (c === 'meta') continue;
        if (ERASE_KEEPS[c][mode]) same(mode + ': keeps ' + c, after.collections[c], before.collections[c]);
        else eq(mode + ': clears ' + c, after.collections[c].length, 0);
      }
      const metaIds = (m) => m.map((d) => d.id).sort();
      same(mode + ': keeps the settings, learned words and link status', metaIds(after.collections.meta), metaIds(before.collections.meta.filter((d) => d.id !== 'lowAlerts' && d.id !== 'eraseCursor').concat([{ id: 'eraseCursor' }])));
      for (const m of before.collections.meta.filter((d) => d.id !== 'lowAlerts' && d.id !== 'eraseCursor')) {
        same(mode + ': meta ' + m.id + ' unchanged', after.collections.meta.find((d) => d.id === m.id), m);
      }
      const cur = after.collections.meta.find((d) => d.id === 'eraseCursor');
      check(mode + ': the sync cursor is set', cur && cur.billNo === maxBill && cur.mode === mode, JSON.stringify(cur));
      check(mode + ': the learned word is still there', after.collections.meta.some((m) => m.id === 'translit' && m.words && m.words.backupword));

      // Everyone can still sign in, with the same PINs.
      eq(mode + ': the admin signs in with the PIN', (await call('/auth/login', { method: 'POST', body: { phone: '9000000001', pin: '1111' } })).status, 200);
      eq(mode + ': the worker signs in with the PIN', (await call('/auth/login', { method: 'POST', body: { phone: '9555555555', pin: '2468' } })).status, 200);
      const stockNow = (await call('/stock', { token: admin })).body;
      check(mode + ': no stock left anywhere', (Array.isArray(stockNow) ? stockNow : []).every((s) => !s.qty), JSON.stringify(stockNow).slice(0, 200));
      eq(mode + ': no purchase orders', (await call('/admin/pos', { token: admin })).body.total, 0);
      const itemsNow = (await call('/items?all=1', { token: admin })).body;
      eq(mode + ': items ' + (mode === 'stock' ? 'kept' : 'gone'), itemsNow.length, mode === 'stock' ? before.collections.items.length : 0);

      // Numbering starts again: the next purchase order is number 1.
      eq(mode + ': counters reset', after.collections.counters.length, 0);

      // And the safety backup brings everything back exactly.
      const back = await restore(saved.body);
      eq(mode + ': the safety backup restores', back.status, 200);
      admin = await asAdmin();
      same(mode + ': restored identically, every collection', (await backupNow()).collections, before.collections);
    }
    same('after both erases and restores: identical to the start', (await backupNow()).collections, full.collections);

    // ------------------------------------------------ the billing sync after an erase: old bills are not read again
    {
      const { syncOnce } = require(path.join(out, 'billing', 'sync.js'));
      const { createFileRepo } = require(path.join(out, 'store', 'file.js'));
      const { erasedData, ERASE_CURSOR_ID } = require(path.join(out, 'backup.js'));
      const sdir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-erase-sync-'));
      try {
        const repo = await createFileRepo(sdir);
        const at = new Date().toISOString();
        await repo.saveLocation({ id: 'loc_shop', name: 'Shop', nameKn: '', kind: 'shop', active: true });
        await repo.saveItem({ id: 'it_sugar', nameEn: 'Sugar', nameKn: '', units: [{ code: 'kg', label: 'Kg', labelKn: '', perBase: 1, price: 46 }], aliases: [], racks: {}, active: true, updatedAt: at });
        const bills = [
          { no: 1, at, total: 92, paid: 92, balance: 0, lines: [{ nameEn: 'Sugar', qty: 2, rate: 46 }] },
          { no: 2, at, total: 46, paid: 46, balance: 0, lines: [{ nameEn: 'Sugar', qty: 1, rate: 46 }] },
        ];
        const billing = { get: async (p) => (p === '/api/customers' ? [] : JSON.parse(JSON.stringify(bills))) };
        const r1 = await syncOnce(repo, billing, { mode: 'full', limit: 30 });
        eq('sync: before the erase both bills are read', r1.newBills, 2);
        const data = await repo.dumpAll();
        await repo.restoreAll(erasedData(data, 'stock', { id: ERASE_CURSOR_ID, billNo: 2, at, mode: 'stock', by: 'test' }));
        eq('sync: the erase cleared the bills mirror', (await repo.listDocs('bills')).length, 0);
        const r2 = await syncOnce(repo, billing, { mode: 'full', limit: 30 });
        eq('sync: after the erase the old bills are not read again', r2.newBills, 0);
        eq('sync: and no sale is taken off the fresh stock', r2.posted, 0);
        eq('sync: the ledger stays empty', (await repo.listMoves({})).length, 0);
        bills.push({ no: 3, at, total: 46, paid: 46, balance: 0, lines: [{ nameEn: 'Sugar', qty: 1, rate: 46 }] });
        const r3 = await syncOnce(repo, billing, { mode: 'full', limit: 30 });
        eq('sync: a bill made after the erase is read', r3.newBills, 1);
        eq('sync: and its sale is posted', r3.posted, 1);
        same('sync: only the new bill is in stock', (await repo.listDocs('bills')).map((b) => b.no), [3]);
        await repo.close();
      } finally {
        fs.rmSync(sdir, { recursive: true, force: true });
      }
    }
  } catch (err) {
    failed++;
    console.log('FAIL ' + err.stack);
    console.log(proc.logs());
  } finally {
    await stop(proc);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log('backuptest: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
}

main();
