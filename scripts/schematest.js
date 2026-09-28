/*
 * Checks every Mongo schema without a database: good documents validate, bad ones do not, and no
 * field is `required` with a default (a default hides the value being missing).
 */
const path = require('node:path');
const { execSync } = require('node:child_process');
const out = path.join(__dirname, '..', '.test-build');
execSync('npx tsc -p server/tsconfig.json --outDir ' + JSON.stringify(out), { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
const mongoose = require('mongoose');
const { schemas } = require(path.join(out, 'store', 'mongo.js'));

let failed = 0;
let passed = 0;
function check(name, ok, detail) {
  if (ok) passed++;
  else {
    failed++;
    console.log('FAIL ' + name + (detail ? '  -> ' + detail : ''));
  }
}

const m = new mongoose.Mongoose();
const models = Object.fromEntries(Object.entries(schemas).map(([name, s]) => [name, m.model(name, s)]));
const valid = (model, doc) => !new models[model](doc).validateSync();

for (const [name, schema] of Object.entries(schemas)) {
  const bad = [];
  schema.eachPath((p, type) => {
    if (type.isRequired && type.defaultValue !== undefined) bad.push(p);
  });
  check(name + ': nothing is both required and defaulted', bad.length === 0, bad.join(', '));
  check(name + ': no __v', schema.get('versionKey') === false);
}

const now = new Date().toISOString();
check('a person validates', valid('People', { id: 'p1', name: 'A', phone: '9000000001', role: 'admin', pinHash: 'x', createdAt: now }));
check('a person with an unknown role does not', !valid('People', { id: 'p1', name: 'A', phone: '9', role: 'boss', pinHash: 'x', createdAt: now }));
check('a person with no PIN hash does not', !valid('People', { id: 'p1', name: 'A', phone: '9', role: 'admin', createdAt: now }));
check('a place validates', valid('Locations', { id: 'l', name: 'Shop', kind: 'shop' }));
check('a place of an unknown kind does not', !valid('Locations', { id: 'l', name: 'X', kind: 'house' }));
const item = {
  id: 'it',
  nameEn: 'Parle-G',
  units: [
    { code: 'pc', perBase: 1, price: 5 },
    { code: 'pack', perBase: 24, price: 110, slabs: [{ minQty: 5, rate: 108 }] },
  ],
  racks: { loc_shop: 'Rack 3' },
  reorderAt: {},
  updatedAt: now,
};
check('an item validates', valid('Items', item));
check('an item with no units does not', !valid('Items', { ...item, units: undefined }));
check('a unit holding 0 does not', !valid('Items', { ...item, units: [{ code: 'pc', perBase: 0, price: 1 }] }));
check('a negative price does not', !valid('Items', { ...item, units: [{ code: 'pc', perBase: 1, price: -1 }] }));
check('empty rack maps are kept, not dropped', new models.Items(item).toObject().reorderAt !== undefined);
const move = { id: 'm', key: 'k', at: now, kind: 'sale', itemId: 'it', from: 'shop', qty: 2, by: 'p' };
check('a move validates', valid('StockMoves', move));
check('a move of an unknown kind does not', !valid('StockMoves', { ...move, kind: 'gift' }));
check('a negative move does not', !valid('StockMoves', { ...move, qty: -1 }));
check('a move key is unique', schemas.StockMoves.path('key').options.unique === true);
check('one stock row per item and place', schemas.Stock.indexes().some(([f, o]) => f.itemId && f.locationId && o.unique));
check('a phone belongs to one person', schemas.People.path('phone').options.unique === true);

console.log('schematest: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
