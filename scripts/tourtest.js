/*
 * The guided tours, checked against the website's source:
 *   - every step that points at a part of the screen names a `data-tour` id that exists in web/src;
 *   - every tour has 6 to 10 steps, and every step says what it is, what it does and what a tap
 *     does, in English and in Kannada;
 *   - every screen the router maps to a tour has one, and the help page's "Show me" links resolve.
 * Nothing is started: the tour files are transpiled with TypeScript and read as plain data.
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const web = path.join(root, 'web', 'src');
let failed = 0;
let passed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail !== undefined ? '  -> ' + detail : ''));
  }
}

// Transpile web/src/tours/*.ts into a temp folder and load them.
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-tours-'));
const toursDir = path.join(web, 'tours');
for (const f of fs.readdirSync(toursDir).filter((f) => f.endsWith('.ts'))) {
  const src = fs.readFileSync(path.join(toursDir, f), 'utf8');
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  fs.writeFileSync(path.join(out, f.replace(/\.ts$/, '.js')), js);
}
const tours = require(path.join(out, 'index.js'));
fs.rmSync(out, { recursive: true, force: true });

// Every data-tour id in the website's own code (and `tour="…"` on the Empty component).
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.tsx') ? [path.join(dir, d.name)] : []));
}
const ids = new Set();
for (const f of walk(web)) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\b(?:data-)?tour="([a-z0-9-]+)"/g)) ids.add(m[1]);
  // The menu's places carry their id in a field: `tour: 'nav-home'`.
  for (const m of src.matchAll(/\btour: '([a-z0-9-]+)'/g)) ids.add(m[1]);
}
check('the website has data-tour targets', ids.size > 40, ids.size);

const all = Object.values(tours.TOURS);
check('there are tours for every screen', all.length >= 13, all.length);
const filled = (b) => b && typeof b.en === 'string' && b.en.trim().length > 3 && typeof b.kn === 'string' && b.kn.trim().length > 1 && /[ಀ-೿]/.test(b.kn);
for (const t of all) {
  check(t.id + ': 6 to 10 steps', t.steps.length >= 6 && t.steps.length <= 10, t.steps.length);
  check(t.id + ': has a title in both languages', filled(t.title), JSON.stringify(t.title));
  t.steps.forEach((s, i) => {
    const where = t.id + ' step ' + (i + 1);
    if (s.target) check(where + ': target "' + s.target + '" exists in web/src', ids.has(s.target));
    for (const k of ['title', 'what', 'does', 'tap']) check(where + ': ' + k + ' in English and Kannada', filled(s[k]), JSON.stringify(s[k]));
  });
}

// The router's mapping and the help page's "Show me".
for (const p of ['/admin', '/admin/reports', '/admin/bills', '/admin/confirm', '/admin/inventory', '/admin/inventory/it_1', '/admin/refill', '/admin/purchases', '/admin/transfers', '/admin/places', '/admin/people', '/admin/vehicles', '/admin/files', '/admin/settings', '/worker', '/worker/screen', '/godown']) {
  const id = tours.tourForPath(p);
  check(p + ' has a tour', !!id && !!tours.TOURS[id], id);
}
check('the PIN page has none', tours.tourForPath('/pin') === null);
for (const [role, id] of Object.entries(tours.FIRST_TOUR)) check('first sign-in tour for ' + role + ' exists', !!tours.TOURS[id], id);
for (const id of Object.keys(tours.TOURS)) check('"Show me" knows where ' + id + ' is', typeof tours.TOUR_HOME[id] === 'string');
const help = fs.readFileSync(path.join(web, 'pages', 'Help.tsx'), 'utf8');
for (const m of help.matchAll(/tour: '([a-z]+)'/g)) check('help section ' + m[1] + ' has a tour', !!tours.TOURS[m[1]]);

// The explainer: every chapter and caption in both languages, real routes and tours, 2 to 3⅓ minutes.
{
  const exOut = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-explainer-'));
  for (const f of ['draw.ts', 'scenes.ts']) {
    const src = fs.readFileSync(path.join(web, 'explainer', f), 'utf8');
    fs.writeFileSync(path.join(exOut, f.replace(/\.ts$/, '.js')), ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText);
  }
  const ex = require(path.join(exOut, 'scenes.js'));
  fs.rmSync(exOut, { recursive: true, force: true });
  const app = fs.readFileSync(path.join(web, 'App.tsx'), 'utf8');
  check('explainer has 8 chapters', ex.CHAPTERS.length === 8, ex.CHAPTERS.length);
  check('explainer lasts 120 to 200 s', ex.TOTAL >= 120 && ex.TOTAL <= 200, ex.TOTAL);
  check('the record page has a route', app.includes('path="/explainer/record"'));
  for (const ch of ex.CHAPTERS) {
    check('explainer ' + ch.id + ': title in both languages', filled(ch.title), JSON.stringify(ch.title));
    check('explainer ' + ch.id + ': 15 to 25 s', ch.dur >= 15 && ch.dur <= 25, ch.dur);
    check('explainer ' + ch.id + ': route ' + ch.route + ' exists', app.includes('path="' + ch.route + '"'));
    check('explainer ' + ch.id + ': tour ' + ch.tour + ' exists', !!tours.TOURS[ch.tour]);
    ch.cues.forEach((c, i) => {
      check('explainer ' + ch.id + ' caption ' + (i + 1) + ' in both languages', filled(c.text), JSON.stringify(c.text));
      check('explainer ' + ch.id + ' caption ' + (i + 1) + ' inside the chapter', c.at >= 0 && c.at + ex.TITLE < ch.dur - 2, c.at);
    });
  }
}

console.log('tourtest: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
