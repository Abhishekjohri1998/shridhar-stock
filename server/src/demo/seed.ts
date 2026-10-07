import fs from 'node:fs';
import path from 'node:path';
import {
  priceFor,
  type BillMirror,
  type CustomerProfile,
  type Ink,
  type Item,
  type ItemUnit,
  type MirrorLine,
  type PurchaseOrder,
  type Role,
  type StockMove,
  type Supplier,
  type Transfer,
  type Vehicle,
} from '@stock/core';
import { hashPin } from '../pin';
import { post } from '../posting';
import { ensureShop } from '../setup';
import type { InvRepo } from '../store/types';
import { handwrite } from './handFont';

/**
 * Demo data for the walkthrough. Only ever written to the local file store; `index.ts` refuses
 * to run demo mode against a database.
 *
 * Everything has fixed ids so the walkthrough and the tests can point at it.
 */

export const DEMO_PIN = '1111';

export const DEMO_PEOPLE: { id: string; name: string; phone: string; role: Role; linkedId?: string }[] = [
  { id: 'p_admin', name: 'Shridhar (admin)', phone: '9000000001', role: 'admin' },
  { id: 'p_worker', name: 'Ravi (shop)', phone: '9000000003', role: 'worker' },
];

type U = [code: string, label: string, labelKn: string, perBase: number, price: number, cost?: number];
interface Spec {
  id: string;
  en: string;
  kn: string;
  cat: string;
  units: U[];
  aka?: string[];
  rack: string;
  rackG1?: string;
  reorder: number;
  shop: number;
  g1: number;
  g2: number;
  slabs?: Record<string, [number, number][]>;
  range?: Record<string, [number, number]>;
}

/*
 * Parle-G and the shampoo sachets are the shop's own examples, and the tests lean on them: a
 * piece of Parle-G is ₹5, a pack of 24 is ₹110 (not 24 × ₹5), a box is 6 packs; a "line" of
 * shampoo is a strip of 16.
 */
const S: Spec[] = [
  { id: 'it_parle', en: 'Parle-G', kn: 'ಪಾರ್ಲೆ ಜಿ', cat: 'Biscuits', units: [['pc', 'Piece', 'ಪೀಸ್', 1, 5, 4.2], ['pack', 'Pack', 'ಪ್ಯಾಕ್', 24, 110, 98], ['box', 'Box', 'ಬಾಕ್ಸ್', 144, 640, 580]], aka: ['parle', 'parle g'], rack: 'Rack 1', rackG1: 'Bay A', reorder: 48, shop: 60, g1: 720, g2: 0, range: { pc: [5, 5.5] } },
  { id: 'it_goodday', en: 'Good Day', kn: 'ಗುಡ್ ಡೇ', cat: 'Biscuits', units: [['pc', 'Piece', 'ಪೀಸ್', 1, 10, 8.5], ['pack', 'Pack', 'ಪ್ಯಾಕ್', 12, 115, 100]], rack: 'Rack 1', reorder: 24, shop: 60, g1: 144, g2: 0 },
  { id: 'it_marie', en: 'Marie Gold', kn: 'ಮೇರಿ ಗೋಲ್ಡ್', cat: 'Biscuits', units: [['pc', 'Piece', 'ಪೀಸ್', 1, 30, 26]], rack: 'Rack 1', reorder: 10, shop: 14, g1: 60, g2: 0 },
  { id: 'it_clinic', en: 'Clinic Plus sachet', kn: 'ಕ್ಲಿನಿಕ್ ಪ್ಲಸ್', cat: 'Personal care', units: [['pc', 'Piece', 'ಪೀಸ್', 1, 2, 1.6], ['line', 'Line', 'ಲೈನ್', 16, 30, 25]], aka: ['clinic'], rack: 'Rack 4', rackG1: 'Bay C', reorder: 64, shop: 40, g1: 480, g2: 160, slabs: { line: [[5, 28], [10, 26]] } },
  { id: 'it_chik', en: 'Chik shampoo sachet', kn: 'ಚಿಕ್ ಶಾಂಪೂ', cat: 'Personal care', units: [['pc', 'Piece', 'ಪೀಸ್', 1, 1, 0.8], ['line', 'Line', 'ಲೈನ್', 16, 15, 12]], rack: 'Rack 4', reorder: 32, shop: 80, g1: 320, g2: 0 },
  { id: 'it_lifebuoy', en: 'Lifebuoy soap', kn: 'ಲೈಫ್‌ಬಾಯ್ ಸೋಪ್', cat: 'Personal care', units: [['pc', 'Piece', 'ಪೀಸ್', 1, 38, 33], ['pack', 'Pack of 4', '4ರ ಪ್ಯಾಕ್', 4, 145, 128]], rack: 'Rack 4', reorder: 12, shop: 20, g1: 96, g2: 0 },
  { id: 'it_colgate', en: 'Colgate 100g', kn: 'ಕೋಲ್ಗೇಟ್', cat: 'Personal care', units: [['pc', 'Piece', 'ಪೀಸ್', 1, 58, 50]], rack: 'Rack 4', reorder: 6, shop: 4, g1: 36, g2: 0 },
  { id: 'it_rice', en: 'Sona Masoori rice', kn: 'ಸೋನಾ ಮಸೂರಿ ಅಕ್ಕಿ', cat: 'Grains', units: [['kg', 'Kg', 'ಕೆಜಿ', 1, 58, 50], ['bag', 'Bag 25kg', '25 ಕೆಜಿ ಚೀಲ', 25, 1400, 1250]], aka: ['rice', 'akki'], rack: 'Back room', rackG1: 'Bay B', reorder: 50, shop: 60, g1: 500, g2: 250, slabs: { kg: [[10, 55]] } },
  { id: 'it_rawrice', en: 'Raw rice', kn: 'ದೋಸೆ ಅಕ್ಕಿ', cat: 'Grains', units: [['kg', 'Kg', 'ಕೆಜಿ', 1, 42, 36], ['bag', 'Bag 25kg', '25 ಕೆಜಿ ಚೀಲ', 25, 1000, 890]], rack: 'Back room', reorder: 25, shop: 40, g1: 200, g2: 0 },
  { id: 'it_toor', en: 'Toor dal', kn: 'ತೊಗರಿ ಬೇಳೆ', cat: 'Grains', units: [['kg', 'Kg', 'ಕೆಜಿ', 1, 150, 132]], aka: ['toor', 'togari'], rack: 'Rack 2', reorder: 90, shop: 8, g1: 75, g2: 0 },
  { id: 'it_moong', en: 'Moong dal', kn: 'ಹೆಸರು ಬೇಳೆ', cat: 'Grains', units: [['kg', 'Kg', 'ಕೆಜಿ', 1, 130, 115]], rack: 'Rack 2', reorder: 5, shop: 12, g1: 40, g2: 0 },
  { id: 'it_urad', en: 'Urad dal', kn: 'ಉದ್ದಿನ ಬೇಳೆ', cat: 'Grains', units: [['kg', 'Kg', 'ಕೆಜಿ', 1, 140, 124]], rack: 'Rack 2', reorder: 5, shop: 3, g1: 30, g2: 0 },
  { id: 'it_chana', en: 'Chana dal', kn: 'ಕಡಲೆ ಬೇಳೆ', cat: 'Grains', units: [['kg', 'Kg', 'ಕೆಜಿ', 1, 95, 84]], rack: 'Rack 2', reorder: 5, shop: 9, g1: 30, g2: 0 },
  { id: 'it_sugar', en: 'Sugar', kn: 'ಸಕ್ಕರೆ', cat: 'Grains', units: [['kg', 'Kg', 'ಕೆಜಿ', 1, 46, 41], ['bag', 'Bag 50kg', '50 ಕೆಜಿ ಚೀಲ', 50, 2150, 2000]], aka: ['sugar', 'sakkare'], rack: 'Back room', rackG1: 'Bay B', reorder: 20, shop: 12, g1: 200, g2: 100 },
  { id: 'it_jaggery', en: 'Jaggery', kn: 'ಬೆಲ್ಲ', cat: 'Grains', units: [['kg', 'Kg', 'ಕೆಜಿ', 1, 70, 60]], rack: 'Rack 2', reorder: 5, shop: 10, g1: 20, g2: 0 },
  { id: 'it_ragi', en: 'Ragi flour', kn: 'ರಾಗಿ ಹಿಟ್ಟು', cat: 'Grains', units: [['kg', 'Kg', 'ಕೆಜಿ', 1, 55, 47]], rack: 'Rack 2', reorder: 5, shop: 6, g1: 25, g2: 0 },
  { id: 'it_atta', en: 'Aashirvaad atta 5kg', kn: 'ಗೋಧಿ ಹಿಟ್ಟು', cat: 'Grains', units: [['pc', 'Pack 5kg', '5 ಕೆಜಿ ಪ್ಯಾಕ್', 1, 285, 255]], aka: ['atta'], rack: 'Back room', reorder: 4, shop: 7, g1: 30, g2: 0 },
  { id: 'it_rava', en: 'Bombay rava', kn: 'ರವೆ', cat: 'Grains', units: [['kg', 'Kg', 'ಕೆಜಿ', 1, 52, 45]], rack: 'Rack 2', reorder: 5, shop: 4, g1: 25, g2: 0 },
  { id: 'it_goil', en: 'Groundnut oil', kn: 'ಕಡಲೆಕಾಯಿ ಎಣ್ಣೆ', cat: 'Oil', units: [['l', 'Litre', 'ಲೀಟರ್', 1, 190, 170], ['tin', 'Tin 15L', '15 ಲೀ ಡಬ್ಬ', 15, 2700, 2450]], aka: ['groundnut oil'], rack: 'Rack 3', rackG1: 'Bay D', reorder: 10, shop: 14, g1: 90, g2: 30 },
  { id: 'it_ganaoil', en: 'Ganada enne (cold-pressed)', kn: 'ಗಾಣದ ಎಣ್ಣೆ', cat: 'Oil', units: [['l', 'Litre', 'ಲೀಟರ್', 1, 110, 95]], rack: 'Rack 3', reorder: 5, shop: 9, g1: 20, g2: 0 },
  { id: 'it_sunoil', en: 'Sunflower oil', kn: 'ಸೂರ್ಯಕಾಂತಿ ಎಣ್ಣೆ', cat: 'Oil', units: [['l', 'Litre', 'ಲೀಟರ್', 1, 150, 135]], rack: 'Rack 3', reorder: 10, shop: 6, g1: 60, g2: 0 },
  { id: 'it_ghee', en: 'Nandini ghee 500ml', kn: 'ನಂದಿನಿ ತುಪ್ಪ', cat: 'Oil', units: [['pc', 'Piece', 'ಪೀಸ್', 1, 330, 300]], rack: 'Counter', reorder: 4, shop: 5, g1: 12, g2: 0 },
  { id: 'it_biryani', en: 'Shahi Biriyani Masala', kn: 'ಶಾಹಿ ಬಿರಿಯಾನಿ ಮಸಾಲ', cat: 'Masala', units: [['pc', 'Pack', 'ಪ್ಯಾಕ್', 1, 90, 75]], aka: ['biryani masala', 'shahi'], rack: 'Rack 5', reorder: 6, shop: 10, g1: 40, g2: 0 },
  { id: 'it_chilli', en: 'Chilli powder', kn: 'ಮೆಣಸಿನ ಪುಡಿ', cat: 'Masala', units: [['pc', '100g pack', '100 ಗ್ರಾಂ', 1, 45, 38]], rack: 'Rack 5', reorder: 6, shop: 8, g1: 50, g2: 0 },
  { id: 'it_turmeric', en: 'Turmeric powder', kn: 'ಅರಿಶಿನ ಪುಡಿ', cat: 'Masala', units: [['pc', '100g pack', '100 ಗ್ರಾಂ', 1, 30, 25]], rack: 'Rack 5', reorder: 6, shop: 11, g1: 40, g2: 0 },
  { id: 'it_mustard', en: 'Mustard seeds', kn: 'ಸಾಸಿವೆ', cat: 'Masala', units: [['pc', '100g pack', '100 ಗ್ರಾಂ', 1, 20, 16]], rack: 'Rack 5', reorder: 6, shop: 3, g1: 30, g2: 0 },
  { id: 'it_jeera', en: 'Jeera', kn: 'ಜೀರಿಗೆ', cat: 'Masala', units: [['pc', '100g pack', '100 ಗ್ರಾಂ', 1, 45, 38]], rack: 'Rack 5', reorder: 6, shop: 7, g1: 25, g2: 0 },
  { id: 'it_salt', en: 'Tata salt', kn: 'ಉಪ್ಪು', cat: 'Masala', units: [['pc', '1kg pack', '1 ಕೆಜಿ', 1, 28, 24]], rack: 'Rack 2', reorder: 10, shop: 18, g1: 60, g2: 0 },
  { id: 'it_tea', en: 'Red Label tea 250g', kn: 'ಟೀ ಪುಡಿ', cat: 'Beverages', units: [['pc', 'Pack', 'ಪ್ಯಾಕ್', 1, 140, 124]], rack: 'Counter', reorder: 5, shop: 6, g1: 24, g2: 0 },
  { id: 'it_coffee', en: 'Filter coffee 200g', kn: 'ಕಾಫಿ ಪುಡಿ', cat: 'Beverages', units: [['pc', 'Pack', 'ಪ್ಯಾಕ್', 1, 150, 130]], aka: ['coffee'], rack: 'Counter', reorder: 30, shop: 2, g1: 0, g2: 20 },
  { id: 'it_bru', en: 'Bru sachet', kn: 'ಬ್ರೂ', cat: 'Beverages', units: [['pc', 'Piece', 'ಪೀಸ್', 1, 2, 1.6], ['line', 'Line', 'ಲೈನ್', 12, 22, 18]], rack: 'Counter', reorder: 24, shop: 36, g1: 144, g2: 0 },
  { id: 'it_milk', en: 'Nandini milk 500ml', kn: 'ನಂದಿನಿ ಹಾಲು', cat: 'Dairy', units: [['pc', 'Packet', 'ಪ್ಯಾಕೆಟ್', 1, 24, 22]], aka: ['milk', 'halu'], rack: 'Fridge', reorder: 20, shop: -2, g1: 0, g2: 0 },
  { id: 'it_curd', en: 'Nandini curd 500g', kn: 'ಮೊಸರು', cat: 'Dairy', units: [['pc', 'Packet', 'ಪ್ಯಾಕೆಟ್', 1, 28, 25]], rack: 'Fridge', reorder: 10, shop: 12, g1: 0, g2: 0 },
  { id: 'it_surf', en: 'Surf Excel 1kg', kn: 'ಸರ್ಫ್ ಎಕ್ಸೆಲ್', cat: 'Home care', units: [['pc', 'Pack', 'ಪ್ಯಾಕ್', 1, 150, 132]], rack: 'Rack 6', reorder: 5, shop: 7, g1: 24, g2: 0 },
  { id: 'it_vim', en: 'Vim bar', kn: 'ವಿಮ್ ಬಾರ್', cat: 'Home care', units: [['pc', 'Piece', 'ಪೀಸ್', 1, 12, 10]], rack: 'Rack 6', reorder: 12, shop: 30, g1: 96, g2: 0 },
  { id: 'it_agarbatti', en: 'Agarbatti', kn: 'ಊದುಬತ್ತಿ', cat: 'Pooja', units: [['pc', 'Pack', 'ಪ್ಯಾಕ್', 1, 20, 15]], rack: 'Counter', reorder: 10, shop: 25, g1: 60, g2: 0 },
  { id: 'it_camphor', en: 'Camphor', kn: 'ಕರ್ಪೂರ', cat: 'Pooja', units: [['pc', 'Pack', 'ಪ್ಯಾಕ್', 1, 25, 19]], rack: 'Counter', reorder: 10, shop: 6, g1: 40, g2: 0 },
  { id: 'it_maggi', en: 'Maggi', kn: 'ಮ್ಯಾಗಿ', cat: 'Snacks', units: [['pc', 'Piece', 'ಪೀಸ್', 1, 14, 12], ['pack', 'Pack of 12', '12ರ ಪ್ಯಾಕ್', 12, 160, 140]], rack: 'Rack 1', reorder: 24, shop: 50, g1: 120, g2: 0 },
  { id: 'it_egg', en: 'Eggs', kn: 'ಮೊಟ್ಟೆ', cat: 'Dairy', units: [['pc', 'Piece', 'ಪೀಸ್', 1, 7, 6], ['tray', 'Tray of 30', '30ರ ಟ್ರೇ', 30, 195, 170]], rack: 'Counter', reorder: 30, shop: 45, g1: 0, g2: 90 },
  { id: 'it_onion', en: 'Onion', kn: 'ಈರುಳ್ಳಿ', cat: 'Vegetables', units: [['kg', 'Kg', 'ಕೆಜಿ', 1, 40, 32]], rack: 'Floor', reorder: 10, shop: 25, g1: 0, g2: 100 },
];

/** A level in base units as the shop would say it: 48 Parle-G is "2 pack". */
function lowIn(units: ItemUnit[], base: number): { qty: number; unit: string } {
  const u = [...units].sort((a, b) => b.perBase - a.perBase).find((x) => base % x.perBase === 0) ?? units[0]!;
  return { qty: base / u.perBase, unit: u.code };
}

function toItem(s: Spec, now: string): Item {
  const units: ItemUnit[] = s.units.map(([code, label, labelKn, perBase, price, cost]) => ({
    code,
    label,
    labelKn,
    perBase,
    price,
    ...(cost != null ? { cost } : {}),
    ...(s.slabs?.[code] ? { slabs: s.slabs[code]!.map(([minQty, rate]) => ({ minQty, rate })) } : {}),
    ...(s.range?.[code] ? { min: s.range[code]![0], max: s.range[code]![1] } : {}),
  }));
  return {
    id: s.id,
    nameEn: s.en,
    nameKn: s.kn,
    category: s.cat,
    units,
    aliases: (s.aka ?? []).map((text) => ({ text })),
    racks: { loc_shop: s.rack, ...(s.rackG1 ? { loc_g1: s.rackG1 } : {}), ...(s.g2 ? { loc_g2: 'Shed' } : {}) },
    lowAt: lowIn(units, s.reorder),
    active: true,
    updatedAt: now,
  };
}

/** The shop's own writing, when it has been copied in (scripts/demo-ink.json, never committed). */
function realInk(): Ink[] {
  try {
    const f = path.join(__dirname, '..', '..', '..', 'scripts', 'demo-ink.json');
    return JSON.parse(fs.readFileSync(f, 'utf8')) as Ink[];
  } catch {
    return [];
  }
}

export async function seedDemo(repo: InvRepo): Promise<void> {
  const now = Date.now();
  const iso = (minsAgo: number) => new Date(now - minsAgo * 60_000).toISOString();
  await ensureShop(repo);
  await repo.saveLocation({ id: 'loc_g1', name: 'Main godown', nameKn: 'ಮುಖ್ಯ ಗೋದಾಮು', kind: 'godown', address: 'Behind the bus stand', active: true });
  await repo.saveLocation({ id: 'loc_g2', name: 'Market road godown', nameKn: 'ಮಾರ್ಕೆಟ್ ರಸ್ತೆ ಗೋದಾಮು', kind: 'godown', address: 'Market road, 2nd cross', active: true });

  const pinHash = hashPin(DEMO_PIN);
  for (const p of DEMO_PEOPLE) {
    const existing = await repo.findPersonByPhone(p.phone);
    if (existing) await repo.updatePerson(existing.id, { ...p, active: true, pinHash, tv: existing.tv + 1 });
    else await repo.createPerson({ ...p, active: true, pinHash, tv: 1, createdAt: iso(60 * 24 * 30) });
  }

  const items = S.map((s) => toItem(s, iso(60 * 24 * 7)));
  for (const it of items) await repo.saveItem(it);
  const byId = new Map(items.map((i) => [i.id, i]));

  // Opening stock, a week ago.
  const moves: StockMove[] = [];
  for (const s of S) {
    const open = (loc: string, q: number) => {
      if (q > 0) moves.push({ id: 'mv_o_' + s.id + loc, key: 'open:' + s.id + ':' + loc, at: iso(60 * 24 * 7), kind: 'open', itemId: s.id, to: loc, qty: q, ref: 'opening', by: 'p_admin' });
    };
    // The shop's number is what is there after today's bills, so open with that plus what they sell.
    open('loc_shop', Math.max(0, s.shop));
    open('loc_g1', s.g1);
    open('loc_g2', s.g2);
    if (s.shop < 0) moves.push({ id: 'mv_neg_' + s.id, key: 'adj:demo-neg:' + s.id, at: iso(60 * 20), kind: 'adjust', itemId: s.id, from: 'loc_shop', qty: -s.shop, ref: 'other', by: 'p_admin', note: 'Sold more than was counted' });
  }
  await post(repo, moves);

  // Suppliers, and the customers billing knows about.
  const suppliers: Supplier[] = [
    { id: 'sup_1', name: 'Sri Lakshmi Traders', phone: '9000000005', address: 'APMC yard, shop 14', notes: 'Dal, biscuits, masala. Comes Tuesdays.', active: true },
    { id: 'sup_2', name: 'Nandini Dairy agent', phone: '9000000015', address: 'KMF depot', notes: 'Milk and curd, every morning', active: true },
  ];
  for (const s of suppliers) await repo.putDoc('suppliers', s);
  const customers: CustomerProfile[] = [
    { id: 'c_9000000007', key: '9000000007', name: 'Ramesh Gowda', nameKn: 'ರಮೇಶ್ ಗೌಡ', address: '3rd cross, Vinayaka nagar', landmark: 'Opposite the temple', balance: 1266 },
    { id: 'c_9000000017', key: '9000000017', name: 'Lakshmamma', nameKn: 'ಲಕ್ಷ್ಮಮ್ಮ', address: 'Near water tank, 5th ward', balance: 0 },
    { id: 'c_9000000027', key: '9000000027', name: 'Hotel Annapoorna', address: 'Main road', landmark: 'Next to the bank', balance: 1200 },
  ];
  for (const c of customers) await repo.putDoc('customers', c);

  // Today's bills, as they would come from billing.
  const inks = realInk();
  let inkAt = 0;
  const ink = (text: string, seed: number): Ink => (inks.length ? inks[inkAt++ % inks.length]! : handwrite(text, seed));
  const line = (i: number, l: Partial<MirrorLine> & { qty: number; rate: number }): MirrorLine => ({
    i,
    name: '',
    amount: Math.round(l.qty * l.rate * 100) / 100,
    state: 'to-confirm',
    ...l,
  });
  const matched = (i: number, itemId: string, unit: string, qty: number, extra: Partial<MirrorLine> = {}) => {
    const it = byId.get(itemId)!;
    const p = priceFor(it, unit, qty);
    return line(i, { qty, rate: p.rate, itemId, unit, baseQty: p.baseQty, state: 'typed-match', ...extra });
  };
  const cust = (c: CustomerProfile) => ({ key: c.key, name: c.name, phone: c.key });

  const bills: BillMirror[] = [
    {
      id: '51', no: 51, at: iso(170), customer: cust(customers[1]!), total: 0, paid: 0, balance: 0,
      lines: [
        matched(0, 'it_rice', 'kg', 5, { name: 'Sona masoori 5kg' }),
        matched(1, 'it_toor', 'kg', 1, { name: 'Toor dal' }),
        { ...matched(2, 'it_sugar', 'kg', 2, { ink: ink('2 kg sugar', 3) }), name: '', state: 'confirmed' },
      ],
    },
    {
      id: '52', no: 52, at: iso(120), customer: cust(customers[0]!), total: 0, paid: 0, balance: 0,
      lines: [
        { ...matched(0, 'it_parle', 'pack', 2, { ink: ink('parle pack 2', 5) }), state: 'confirmed' },
        { ...matched(1, 'it_clinic', 'line', 1, { ink: ink('clinic plus 1 line', 7) }), state: 'confirmed' },
        matched(2, 'it_goil', 'l', 1, { name: 'Groundnut oil 1L' }),
      ],
    },
    {
      id: '53', no: 53, at: iso(75), customer: cust(customers[2]!), total: 0, paid: 0, balance: 0,
      lines: [
        matched(0, 'it_onion', 'kg', 10, { name: 'Onion 10kg' }),
        matched(1, 'it_egg', 'tray', 1, { name: 'Egg tray' }),
        line(2, { ink: ink('ghee', 9), qty: 2, rate: 330 }),
        line(3, { name: 'Delivery charge', qty: 1, rate: 30, state: 'not-item' }),
      ],
    },
    {
      id: '54', no: 54, at: iso(12), customer: cust(customers[0]!), total: 0, paid: 0, balance: 0,
      lines: [
        line(0, { ink: ink('1 shahi biriyani masala', 11), qty: 1, rate: 1000 }),
        line(1, { ink: ink('coffee powder', 13), qty: 1, rate: 150 }),
        matched(2, 'it_maggi', 'pc', 4, { name: 'Maggi' }),
        line(3, { name: 'Pooja kit', qty: 1, rate: 60 }),
      ],
    },
  ];
  // Written lines (bills 53 and 54) wait in To confirm, where a person picks the item.
  for (const b of bills) {
    b.total = b.lines.reduce((s, l) => s + l.amount, 0);
    b.paid = b.no === 54 ? 0 : b.total;
    b.balance = b.total - b.paid;
    await repo.putDoc('bills', b);
    const sales: StockMove[] = b.lines
      .filter((l) => (l.state === 'typed-match' || l.state === 'confirmed') && l.itemId && l.baseQty)
      .map((l) => ({ id: 'mv_s_' + b.no + '_' + l.i, key: 'sale:' + b.no + ':' + l.i, at: b.at, kind: 'sale', itemId: l.itemId!, from: 'loc_shop', qty: l.baseQty!, ref: 'bill ' + b.no + ' line ' + (l.i + 1), by: l.state === 'confirmed' ? 'p_admin' : 'billing' }));
    await post(repo, sales);
  }

  // Transfers in every state.
  const transfers: Transfer[] = [
    { id: 'tr_1', no: 1, from: 'loc_g1', to: 'loc_shop', status: 'received', at: iso(60 * 26), times: { requested: iso(60 * 27), sent: iso(60 * 26.5), received: iso(60 * 26) }, vehicle: 'KA-17 AB 1234', driver: 'Manju', lines: [{ itemId: 'it_rice', qty: 50, sent: 50, received: 50 }, { itemId: 'it_sugar', qty: 50, sent: 50, received: 48 }] },
    { id: 'tr_2', no: 2, from: 'loc_g2', to: 'loc_shop', status: 'sent', at: iso(40), times: { requested: iso(90), sent: iso(40) }, vehicle: 'Auto', driver: 'Kiran', lines: [{ itemId: 'it_egg', qty: 60, sent: 60 }, { itemId: 'it_onion', qty: 25, sent: 25 }] },
    { id: 'tr_3', no: 3, from: 'loc_g1', to: 'loc_shop', status: 'requested', at: iso(20), times: { requested: iso(20) }, lines: [{ itemId: 'it_parle', qty: 96 }, { itemId: 'it_clinic', qty: 128 }, { itemId: 'it_toor', qty: 12 }, { itemId: 'it_mustard', qty: 9 }] },
  ];
  for (const t of transfers) await repo.putDoc('transfers', t);
  // The received and sent ones have already moved stock.
  await post(repo, [
    { id: 'mv_t1o_r', key: 'xfer:1:out:it_rice', at: iso(60 * 26.5), kind: 'transfer_out', itemId: 'it_rice', from: 'loc_g1', qty: 50, ref: 'transfer 1', by: 'p_godown' },
    { id: 'mv_t1i_r', key: 'xfer:1:in:it_rice', at: iso(60 * 26), kind: 'transfer_in', itemId: 'it_rice', to: 'loc_shop', qty: 50, ref: 'transfer 1', by: 'p_admin' },
    { id: 'mv_t1o_s', key: 'xfer:1:out:it_sugar', at: iso(60 * 26.5), kind: 'transfer_out', itemId: 'it_sugar', from: 'loc_g1', qty: 50, ref: 'transfer 1', by: 'p_godown' },
    { id: 'mv_t1i_s', key: 'xfer:1:in:it_sugar', at: iso(60 * 26), kind: 'transfer_in', itemId: 'it_sugar', to: 'loc_shop', qty: 48, ref: 'transfer 1', by: 'p_admin', note: '2 kg short' },
    { id: 'mv_t2o_e', key: 'xfer:2:out:it_egg', at: iso(40), kind: 'transfer_out', itemId: 'it_egg', from: 'loc_g2', qty: 60, ref: 'transfer 2', by: 'p_admin' },
    { id: 'mv_t2o_o', key: 'xfer:2:out:it_onion', at: iso(40), kind: 'transfer_out', itemId: 'it_onion', from: 'loc_g2', qty: 25, ref: 'transfer 2', by: 'p_admin' },
  ]);

  const pos: PurchaseOrder[] = [
    { id: 'po_1', no: 1, supplierId: 'sup_1', to: 'loc_g1', status: 'received', at: iso(60 * 24 * 3), times: { ordered: iso(60 * 24 * 4), confirmed: iso(60 * 24 * 3.8), dispatched: iso(60 * 24 * 3.2), received: iso(60 * 24 * 3) }, invoiceNo: 'SLT/2291', vehicle: 'KA-02 C 8812', lines: [{ itemId: 'it_parle', unit: 'box', qty: 5, cost: 580 }, { itemId: 'it_toor', unit: 'kg', qty: 50, cost: 132 }] },
    { id: 'po_2', no: 2, supplierId: 'sup_1', to: 'loc_g1', status: 'dispatched', at: iso(60 * 5), times: { ordered: iso(60 * 30), confirmed: iso(60 * 28), dispatched: iso(60 * 5) }, invoiceNo: 'SLT/2340', vehicle: 'KA-02 C 8812', eta: 'Today 6 pm', lines: [{ itemId: 'it_mustard', unit: 'pc', qty: 60, cost: 16 }, { itemId: 'it_urad', unit: 'kg', qty: 30, cost: 124 }, { itemId: 'it_rava', unit: 'kg', qty: 25, cost: 45 }] },
    { id: 'po_3', no: 3, supplierId: 'sup_1', to: 'loc_g2', status: 'ordered', at: iso(30), times: { ordered: iso(30) }, lines: [{ itemId: 'it_coffee', unit: 'pc', qty: 40, cost: 130 }, { itemId: 'it_sunoil', unit: 'l', qty: 60, cost: 135 }] },
    { id: 'po_4', no: 4, supplierId: 'sup_2', to: 'loc_shop', status: 'confirmed', at: iso(60 * 3), times: { ordered: iso(60 * 4), confirmed: iso(60 * 3) }, lines: [{ itemId: 'it_milk', unit: 'pc', qty: 100, cost: 22 }, { itemId: 'it_curd', unit: 'pc', qty: 40, cost: 25 }] },
  ];
  for (const p of pos) await repo.putDoc('pos', p);

  // The shop's two vehicles: the godown tempo and the scooter.
  const vehicles: Vehicle[] = [
    { id: 'veh_1', number: 'KA-17 AB 1234', type: 'Tempo', driverName: 'Manju', driverPhone: '9000000011', active: true },
    { id: 'veh_2', number: 'KA-17 EF 5678', type: 'Scooter', driverName: 'Kiran', driverPhone: '9000000006', active: true },
  ];
  for (const v of vehicles) await repo.putDoc('vehicles', v);
  // Bills rounded to the nearest ₹5, so the round-off line shows on the demo bills.
  await repo.putDoc('meta', { id: 'settings', roundTo: 5 });

  await repo.putDoc('meta', {
    id: 'status',
    link: { ok: true, demo: true, lastBillNo: 54, at: iso(0.2), message: 'Demo: bills are sample data' },
  });
  for (const series of ['transfer', 'po']) {
    while ((await repo.nextNo(series)) < (series === 'transfer' ? 3 : 4)) {
      /* bring the counters past the demo records */
    }
  }
}
