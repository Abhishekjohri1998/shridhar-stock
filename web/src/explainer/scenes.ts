/**
 * The explainer's eight chapters: each a title card, then a mock screen where the cursor does the
 * steps, with a caption line in English or Kannada. Labels on the mock screens are the website's
 * own words (Places, People, To digitise, Bring from godown, …), so what you see in the video is
 * what you will find in the app.
 *
 * Times are in seconds from the end of the chapter's title card.
 */
import { bi, cursorAt, H, lerp, Pen, prog, typed, vis, W, type Bi, type Key, type Rect } from './draw';

export interface Cue {
  at: number;
  text: Bi;
}

export interface Chapter {
  id: string;
  title: Bi;
  sub: Bi;
  /** The real screen "Try it now" opens, and the tour it starts there. */
  route: string;
  tour: string;
  /** Length of the whole chapter, title card included. */
  dur: number;
  cues: Cue[];
  draw: (p: Pen, s: number) => void;
}

/** How long each chapter's title card stays. */
export const TITLE = 2.6;

const cue = (at: number, en: string, kn: string): Cue => ({ at, text: bi(en, kn) });

// The words of the website, in both languages.
const L = {
  places: bi('Places', 'ಸ್ಥಳಗಳು'),
  people: bi('People', 'ಜನರು'),
  vehicles: bi('Vehicles', 'ವಾಹನಗಳು'),
  excel: bi('Excel', 'ಎಕ್ಸೆಲ್'),
  settings: bi('Settings', 'ಸೆಟ್ಟಿಂಗ್ಸ್'),
  newGodown: bi('+ New godown', '+ ಹೊಸ ಗೋದಾಮು'),
  newPerson: bi('+ New person', '+ ಹೊಸ ವ್ಯಕ್ತಿ'),
  name: bi('Name', 'ಹೆಸರು'),
  nameKn: bi('Name in Kannada', 'ಕನ್ನಡ ಹೆಸರು'),
  address: bi('Address', 'ವಿಳಾಸ'),
  save: bi('Save', 'ಉಳಿಸಿ'),
  cancel: bi('Cancel', 'ರದ್ದು'),
  shop: bi('Shop', 'ಅಂಗಡಿ'),
  godown: bi('Godown', 'ಗೋದಾಮು'),
  mainGodown: bi('Main godown', 'ಮುಖ್ಯ ಗೋದಾಮು'),
  phone: bi('Phone', 'ಫೋನ್'),
  role: bi('Role', 'ಕೆಲಸ'),
  pin: bi('PIN (4 to 6 digits)', 'ಪಿನ್ (4 ರಿಂದ 6 ಅಂಕೆ)'),
  newPin: bi('Set a new PIN', 'ಹೊಸ ಪಿನ್ ಕೊಡಿ'),
  admin: bi('Admin', 'ಆಡ್ಮಿನ್'),
  worker: bi('Shop worker', 'ಅಂಗಡಿ ಕೆಲಸಗಾರ'),
  you: bi('You', 'ನೀವು'),
  bills: bi('Bills', 'ಬಿಲ್‌ಗಳು'),
  toConfirm: bi('To digitise', 'ಡಿಜಿಟೈಸ್ ಮಾಡಿ'),
  items: bi('Items & stock', 'ಸಾಮಾನು ಮತ್ತು ಸ್ಟಾಕ್'),
  bring: bi('Bring from godown', 'ಗೋದಾಮಿನಿಂದ ತರಿಸಿ'),
  purchases: bi('Purchases', 'ಖರೀದಿ'),
  transfers: bi('Transfers', 'ಸಾಗಣೆ'),
  today: bi('Today', 'ಇಂದು'),
  reports: bi('Reports', 'ವರದಿ'),
  toSend: bi('To send', 'ಕಳುಹಿಸಬೇಕು'),
  comingIn: bi('Coming in', 'ಬರುತ್ತಿದೆ'),
  myStock: bi('My stock', 'ನನ್ನ ಸ್ಟಾಕ್'),
  markReceived: bi('Mark received', 'ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಿ'),
  pack: bi('Pack', 'ಪ್ಯಾಕ್'),
  // The tablet's sign-in (the billing app's own words).
  signIn: bi('Sign in', 'ಪ್ರವೇಶಿಸಿ'),
  phoneNo: bi('Phone number', 'ಫೋನ್ ಸಂಖ್ಯೆ'),
  pinShort: bi('PIN', 'ಪಿನ್'),
  shopPin: bi('Sign in with shop PIN', 'ಅಂಗಡಿಯ ಪಿನ್‌ನಿಂದ ಸೈನ್ ಇನ್'),
  switchUser: bi('Switch user', 'ಬಳಕೆದಾರ ಬದಲಿಸಿ'),
};

const SETUP_TABS = (on: number) => [L.places, L.people, L.vehicles, L.excel, L.settings].map((label, i) => ({ label, on: i === on }));

/** A cursor that follows `keys`, shown from `from` until `to`. */
function pointer(p: Pen, keys: Key[], s: number, from = -1, to = Infinity) {
  const a = vis(s, from, to, 0.3);
  if (a <= 0) return;
  const c = cursorAt(keys, s);
  p.alpha(a, () => p.cursor(c.x, c.y, c.click));
}

/** A row in a list: name, a muted second word, and a pill on the right. */
function listRow(p: Pen, x: number, y: number, w: number, name: Bi | string, muted: Bi | string, pill: Bi | string, tone: 'plain' | 'ok' | 'warn' | 'brand' = 'plain') {
  p.card(x, y, w, 58);
  const nw = p.text(name, x + 20, y + 29, { size: 19, weight: 600, color: p.c.ink900 });
  if (p.tx(muted)) p.text('· ' + p.tx(muted), x + 30 + nw, y + 29, { size: 17, color: p.c.ink500 });
  const pw = p.measure(pill, 14, 600) + 22;
  p.pill(x + w - pw - 20, y + 29, pill, tone);
}

// ---- 1. The big picture ------------------------------------------------------------------------
function bigPicture(p: Pen, s: number) {
  const c = p.c;
  const tab = p.tablet(90, 70, 560, 420);
  p.tabletTop(tab, 'stock', null, prog(s, 2.2, 2.9));
  // Billing on the left half of the time, Stock after the switch.
  const toStock = prog(s, 2.4, 3.0);
  p.alpha(1 - toStock, () => {
    p.text(bi('Bill #75', 'ಬಿಲ್ #75'), tab.x + 24, tab.y + 90, { size: 22, weight: 600, display: true, color: c.ink900 });
    ['Parle-G · 1', 'Sugar · 1 kg', 'Tea · 250 g'].forEach((l, i) => {
      p.box(tab.x + 24, tab.y + 120 + i * 56, tab.w - 48, 46, { fill: c.paper1, r: 12 });
      p.text(l, tab.x + 40, tab.y + 143 + i * 56, { size: 17, color: c.ink700 });
    });
  });
  p.alpha(toStock, () => {
    p.text(bi('Stock', 'ಸ್ಟಾಕ್'), tab.x + 24, tab.y + 90, { size: 22, weight: 600, display: true, color: c.ink900 });
    [
      ['Parle-G', '43'],
      ['Sugar', '39 kg'],
      ['Tea', '12'],
    ].forEach(([n, q], i) => {
      p.box(tab.x + 24, tab.y + 120 + i * 56, tab.w - 48, 46, { fill: c.paper1, r: 12 });
      p.text(n!, tab.x + 40, tab.y + 143 + i * 56, { size: 17, color: c.ink700 });
      p.text(q!, tab.x + tab.w - 40, tab.y + 143 + i * 56, { size: 17, weight: 700, align: 'right', color: c.ok700 });
    });
  });
  p.ring(tab.x + 14, tab.y + 11, 210, 34, s, vis(s, 0.6, 4.2));

  const people: { role: Bi; does: Bi; icon: 'user' | 'receipt' | 'truck' }[] = [
    { role: L.admin, does: bi('Sees everything: Billing and Stock', 'ಎಲ್ಲವೂ ಕಾಣುತ್ತದೆ: ಬಿಲ್ಲಿಂಗ್ ಮತ್ತು ಸ್ಟಾಕ್'), icon: 'user' },
    { role: L.worker, does: bi('Picks the goods for each bill', 'ಪ್ರತಿ ಬಿಲ್‌ನ ಸಾಮಾನು ತರುತ್ತಾರೆ'), icon: 'receipt' },
    { role: L.godown, does: bi('Sends goods to the shop', 'ಅಂಗಡಿಗೆ ಸಾಮಾನು ಕಳುಹಿಸುತ್ತಾರೆ'), icon: 'truck' },
  ];
  people.forEach((x, i) => {
    const a = prog(s, 4.2 + i * 0.7, 4.9 + i * 0.7);
    const hi = s > 8.4 ? vis(s, 8.6 + i * 1.3, 9.9 + i * 1.3, 0.3) : 0;
    p.slide(a, 40, 0, () => {
      const y = 92 + i * 132;
      p.box(700, y, 490, 112, { fill: hi > 0.5 ? c.brandWash : c.paper1, stroke: hi > 0.5 ? c.brandEdge : c.line, r: 20, shadow: 2 });
      p.box(724, y + 28, 56, 56, { fill: c.brandWash, stroke: 'none', r: 999 });
      p.icon(x.icon, 738, y + 42, 28, c.brand700);
      p.text(x.role, 802, y + 40, { size: 26, weight: 600, display: true, color: c.ink900 });
      p.text(x.does, 802, y + 78, { size: 18, color: c.ink500, maxW: 370 });
    });
  });
}

// ---- 2. Add a godown --------------------------------------------------------------------------
function addGodown(p: Pen, s: number) {
  const c = p.c;
  const r = p.appFrame(4, SETUP_TABS(0), L.places);
  const formA = vis(s, 1.4, 7.4);
  p.button(r.x, r.y, 200, L.newGodown, { primary: true, press: s - 1.2 });
  let ry = 256;
  p.slide(formA, 0, -10, () => {
    p.card(r.x, 256, 884, 244);
    p.input(r.x + 20, 272, 410, L.name, typed('Main godown', s, 2.5, 4.2), { focus: s > 2.3 && s < 4.6, caret: s > 2.3 && s < 4.6, t: s });
    p.input(r.x + 454, 272, 410, L.nameKn, typed('ಮುಖ್ಯ ಗೋದಾಮು', s, 4.8, 6.2), { focus: s > 4.6 && s < 6.6, caret: s > 4.6 && s < 6.6, t: s });
    p.input(r.x + 20, 352, 844, L.address, '');
    p.button(r.x + 20, 432, 110, L.save, { primary: true, press: s - 7 });
    p.button(r.x + 142, 432, 110, L.cancel);
  });
  ry = lerp(256, 512, formA);
  listRow(p, r.x, ry, 884, bi('Shridhar', 'ಶ್ರೀಧರ್'), '', L.shop);
  const rowA = prog(s, 7.5, 8.2);
  p.slide(rowA, 0, 16, () => listRow(p, r.x, ry + 70, 884, 'Main godown', 'ಮುಖ್ಯ ಗೋದಾಮು', L.godown, 'brand'));
  p.ring(r.x, ry + 70, 884, 58, s, vis(s, 8.4, 13));
  pointer(
    p,
    [
      [0, 700, 470],
      [1.2, r.x + 100, r.y + 22, true],
      [2.3, r.x + 225, 318, true],
      [4.6, r.x + 659, 318, true],
      [7.0, r.x + 75, 454, true],
      [9.2, 980, 560],
    ],
    s,
  );
}

// ---- 3. Add people and their roles ------------------------------------------------------------
function addPeople(p: Pen, s: number) {
  const c = p.c;
  const r = p.appFrame(4, SETUP_TABS(1), L.people);
  p.button(r.x, r.y, 210, L.newPerson, { primary: true, press: Math.max(s - 1.0, s >= 8.2 ? s - 8.2 : -1) });
  const A = vis(s, 1.2, 7.4);
  const B = vis(s, 8.4, 16.0);
  // The worker.
  p.slide(A, 0, -10, () => {
    p.card(r.x, 256, 884, 244);
    p.input(r.x + 20, 272, 410, L.name, typed('Ravi', s, 1.8, 2.5), { focus: s > 1.6 && s < 2.9, caret: s > 1.6 && s < 2.9, t: s });
    p.input(r.x + 454, 272, 410, L.phone, typed('98450 12345', s, 3.0, 4.1), { focus: s > 2.9 && s < 4.3, caret: s > 2.9 && s < 4.3, t: s });
    p.select(r.x + 20, 352, 410, L.role, L.worker, { focus: s > 4.3 && s < 5.4 });
    p.input(r.x + 454, 352, 410, L.pin, typed('4821', s, 5.7, 6.4), { focus: s > 5.5 && s < 6.8, caret: s > 5.5 && s < 6.8, t: s });
    p.button(r.x + 20, 432, 110, L.save, { primary: true, press: s - 7 });
    p.button(r.x + 142, 432, 110, L.cancel);
  });
  p.ring(r.x + 20, 376, 410, 44, s, vis(s, 4.3, 5.5, 0.2));
  // The godown person: Godown appears once the role is Godown.
  const picked = s > 11.9;
  const g = prog(s, 12.0, 12.5);
  p.slide(B, 0, -10, () => {
    p.card(r.x, 256, 884, lerp(244, 324, g));
    p.input(r.x + 20, 272, 410, L.name, typed('Manju', s, 8.9, 9.6), { focus: s > 8.8 && s < 9.9, caret: s > 8.8 && s < 9.9, t: s });
    p.input(r.x + 454, 272, 410, L.phone, typed('99001 54321', s, 10.0, 10.9), { focus: s > 9.9 && s < 11, caret: s > 9.9 && s < 11, t: s });
    const pinX = lerp(r.x + 454, r.x + 20, g);
    const pinY = lerp(352, 432, g);
    p.input(pinX, pinY, 410, L.pin, typed('5307', s, 14.3, 15.0), { focus: s > 14.1 && s < 15.3, caret: s > 14.1 && s < 15.3, t: s });
    p.alpha(g, () => p.select(r.x + 454, 352, 410, L.godown, L.mainGodown, { focus: s > 12.8 && s < 14.1 }));
    const by = lerp(432, 512, g);
    p.button(r.x + 20, by, 110, L.save, { primary: true, press: s - 15.6 });
    p.button(r.x + 142, by, 110, L.cancel);
    p.select(r.x + 20, 352, 410, L.role, picked ? L.godown : L.worker, { open: vis(s, 11.0, 12.0, 0.2), options: [L.admin, L.worker, L.godown], hi: s > 11.5 ? 2 : 1 });
  });
  p.ring(r.x + 454, 376, 410, 44, s, vis(s, 12.8, 14.1, 0.2));
  // The list, when no form is open.
  const listA = 1 - Math.max(A, B);
  p.alpha(listA, () => {
    listRow(p, r.x, 256, 884, 'Shridhar', '98860 00001', L.admin, 'plain');
    p.slide(prog(s, 7.4, 8.0), 0, 12, () => listRow(p, r.x, 324, 884, 'Ravi', '98450 12345', L.worker, 'plain'));
    p.slide(prog(s, 16.0, 16.6), 0, 12, () => listRow(p, r.x, 392, 884, 'Manju', '99001 54321', L.godown, 'brand'));
  });
  // The PIN note.
  const n = vis(s, 16.6, 99);
  p.slide(n, 0, 20, () => {
    p.box(r.x, 470, 884, 104, { fill: c.goldWash, stroke: 'none', r: 18 });
    p.icon('lock', r.x + 24, 500, 40, c.gold600);
    p.text(bi('The PIN is theirs. Tell them privately.', 'ಪಿನ್ ಅವರದ್ದು. ಅವರಿಗೆ ಖಾಸಗಿಯಾಗಿ ತಿಳಿಸಿ.'), r.x + 84, 504, { size: 21, weight: 600, color: c.ink900, maxW: 560 });
    p.text(bi('Open the person to change it any time.', 'ಯಾವಾಗ ಬೇಕಾದರೂ ಬದಲಿಸಲು ವ್ಯಕ್ತಿಯನ್ನು ತೆರೆಯಿರಿ.'), r.x + 84, 540, { size: 18, color: c.ink500, maxW: 560 });
    p.button(r.x + 680, 500, 184, L.newPin, { size: 16 });
  });
  pointer(
    p,
    [
      [0, 700, 480],
      [1.0, r.x + 105, r.y + 22, true],
      [1.6, r.x + 225, 318, true],
      [2.9, r.x + 659, 318, true],
      [4.4, r.x + 225, 398],
      [5.5, r.x + 659, 398, true],
      [7.0, r.x + 75, 454, true],
      [8.2, r.x + 105, r.y + 22, true],
      [8.8, r.x + 225, 318, true],
      [9.9, r.x + 659, 318, true],
      [11.0, r.x + 225, 398, true],
      [11.8, r.x + 225, 536, true],
      [13.0, r.x + 659, 398],
      [14.1, r.x + 225, 478, true],
      [15.6, r.x + 75, 534, true],
      [17.0, r.x + 772, 522],
    ],
    s,
  );
}

// ---- 4. Signing in on the tablet --------------------------------------------------------------
function signInScreen(p: Pen, sc: Rect, s: number, phone: string, pins: number, press: number) {
  const c = p.c;
  const cx = sc.x + sc.w / 2;
  p.text(L.signIn, cx, sc.y + 110, { size: 34, weight: 500, display: true, align: 'center', color: c.ink900 });
  p.input(cx - 220, sc.y + 140, 440, L.phoneNo, phone, { focus: pins === 0 && !!phone, t: s });
  p.input(cx - 220, sc.y + 222, 440, L.pinShort, '●'.repeat(pins), { focus: pins > 0 && pins < 4, t: s });
  p.button(cx - 220, sc.y + 308, 440, L.signIn, { primary: true, press, h: 50 });
  const lw = p.text(L.shopPin, cx, sc.y + 400, { size: 18, weight: 600, align: 'center', color: c.brand700 });
  p.ctx.fillStyle = c.brand700;
  p.ctx.fillRect(cx - lw / 2, sc.y + 413, lw, 1.5);
}

function signingIn(p: Pen, s: number) {
  const c = p.c;
  const sc = p.tablet(70, 40, 620, 540);
  const phase = s < 4.2 ? 0 : s < 7.2 ? 1 : s < 10.2 ? 2 : s < 13.2 ? 5 : s < 14.4 ? 3 : 4;
  p.ctx.save();
  p.rr(sc.x, sc.y, sc.w, sc.h, 20);
  p.ctx.clip();
  if (phase === 0 || phase === 4) {
    p.tabletTop(sc, null, null);
    signInScreen(p, sc, s, phase === 0 ? typed('98450 12345', s, 0.6, 2.0) : '', phase === 0 ? Math.round(prog(s, 2.3, 3.1) * 4) : 0, s - 3.5);
  } else if (phase === 1 || phase === 3) {
    p.tabletTop(sc, 'stock', phase === 3 ? null : 'Shridhar · ' + p.tx(L.admin), 1);
    p.text(bi('Needs you now', 'ಈಗ ನಿಮ್ಮ ಗಮನ ಬೇಕು'), sc.x + 24, sc.y + 96, { size: 22, weight: 600, display: true, color: c.ink900 });
    [bi('Bill lines to digitise', 'ಡಿಜಿಟೈಸ್ ಮಾಡಬೇಕಾದ ಸಾಲುಗಳು'), bi('Running low, all places together', 'ಮುಗಿಯುತ್ತಿದೆ, ಎಲ್ಲಾ ಕಡೆ ಸೇರಿ'), bi('Transfers on the way', 'ದಾರಿಯಲ್ಲಿರುವ ಸಾಗಣೆ')].forEach((l, i) => {
      p.box(sc.x + 24, sc.y + 126 + i * 66, sc.w - 48, 54, { fill: c.paper1, r: 14 });
      p.text(String([2, 1, 0][i]), sc.x + 46, sc.y + 153 + i * 66, { size: 24, weight: 600, display: true, color: c.gold600 });
      p.text(l, sc.x + 80, sc.y + 153 + i * 66, { size: 17, color: c.ink700, maxW: sc.w - 130 });
    });
    if (phase === 3) {
      p.button(sc.x + sc.w - 196, sc.y + 10, 180, L.switchUser, { size: 15, h: 36, press: s - 13.6 });
    }
  } else if (phase === 2) {
    p.tabletTop(sc, null, 'Ravi · ' + p.tx(L.worker));
    p.text(bi('Being written', 'ಬರೆಯಲಾಗುತ್ತಿದೆ'), sc.x + 24, sc.y + 96, { size: 24, weight: 600, display: true, color: c.ink900 });
    p.card(sc.x + 24, sc.y + 124, sc.w - 48, 190);
    p.icon('pin', sc.x + 40, sc.y + 138, 20, c.brand700);
    p.text(p.tx(L.shop) + ' · Rack 1', sc.x + 68, sc.y + 149, { size: 17, weight: 700, color: c.brand700 });
    ['Parle-G', 'Sugar'].forEach((n, i) => {
      p.text(n, sc.x + 44, sc.y + 196 + i * 60, { size: 19, weight: 600, color: c.ink900 });
      p.button(sc.x + sc.w - 170, sc.y + 174 + i * 60, 120, bi('Fetched', 'ತಂದೆ'), { h: 42, size: 16 });
    });
  }
  if (phase === 5) {
    p.tabletTop(sc, null, 'Manju · ' + p.tx(L.godown));
    p.ctx.fillStyle = c.paper0;
    p.ctx.fillRect(sc.x, sc.y + 58, sc.w, sc.h - 58);
    p.text(bi('My godown', 'ನನ್ನ ಗೋದಾಮು'), sc.x + 24, sc.y + 96, { size: 24, weight: 600, display: true, color: c.ink900 });
    let tx = sc.x + 24;
    [L.toSend, L.comingIn, L.myStock].forEach((t, i) => {
      const tw = p.measure(t, 16, 600) + 30;
      p.box(tx, sc.y + 124, tw, 36, { fill: i === 0 ? c.ink900 : c.paper2, stroke: 'none', r: 999 });
      p.text(t, tx + 15, sc.y + 143, { size: 16, weight: 600, color: i === 0 ? c.paper1 : c.ink500 });
      tx += tw + 8;
    });
    p.card(sc.x + 24, sc.y + 180, sc.w - 48, 120);
    p.text(bi('for the shop', 'ಅಂಗಡಿಗೆ'), sc.x + 44, sc.y + 210, { size: 16, weight: 600, color: c.ink500 });
    p.text('Parle-G · 20 ' + p.tx(L.pack), sc.x + 44, sc.y + 250, { size: 20, weight: 600, color: c.ink900 });
  }
  p.ctx.restore();
  if (phase === 5) p.ring(sc.x + 24, sc.y + 124, 360, 36, s, vis(s, 10.6, 13.0));
  if (phase === 3) p.ring(sc.x + sc.w - 196, sc.y + 10, 180, 36, s, vis(s, 13.3, 14.4, 0.2));
  if (phase === 4) p.ring(sc.x + sc.w / 2 - 170, sc.y + 386, 340, 30, s, vis(s, 14.8, 99));

  // On the right: who gets what.
  const roles: { role: Bi; gets: Bi; from: number }[] = [
    { role: L.admin, gets: bi('Billing + Stock', 'ಬಿಲ್ಲಿಂಗ್ + ಸ್ಟಾಕ್'), from: 4.2 },
    { role: L.worker, gets: bi('Only the pick list', 'ಪಟ್ಟಿ ಮಾತ್ರ'), from: 7.2 },
    { role: L.godown, gets: bi('Only To send / Coming in', 'ಕಳುಹಿಸಬೇಕು / ಬರುತ್ತಿದೆ ಮಾತ್ರ'), from: 10.2 },
  ];
  roles.forEach((x, i) => {
    const a = prog(s, x.from, x.from + 0.5);
    const on = s >= x.from && s < x.from + 3;
    p.slide(Math.max(a, 0.35), 30, 0, () => {
      const y = 70 + i * 128;
      p.box(740, y, 460, 108, { fill: on ? c.brandWash : c.paper1, stroke: on ? c.brandEdge : c.line, r: 20, shadow: on ? 2 : 0 });
      p.text(x.role, 768, y + 38, { size: 26, weight: 600, display: true, color: c.ink900 });
      p.text(x.gets, 768, y + 76, { size: 19, color: on ? c.brand700 : c.ink500, weight: 600, maxW: 410 });
    });
  });
  p.slide(prog(s, 13.4, 14), 30, 0, () => {
    p.box(740, 470, 460, 96, { fill: c.paper2, stroke: 'none', r: 20 });
    p.text(L.switchUser, 768, 500, { size: 19, weight: 700, color: c.ink900 });
    p.text(p.tx(bi('Backup: ', 'ಬದಲಿ: ')) + p.tx(L.shopPin), 768, 538, { size: 17, color: c.ink500, maxW: 410 });
  });
  pointer(
    p,
    [
      [0, 560, 420],
      [0.5, sc.x + sc.w / 2, sc.y + 186, true],
      [2.2, sc.x + sc.w / 2, sc.y + 268, true],
      [3.5, sc.x + sc.w / 2, sc.y + 333, true],
      [5.0, 600, 470],
      [13.6, sc.x + sc.w - 106, sc.y + 28, true],
      [15.4, sc.x + sc.w / 2 + 40, sc.y + 400],
    ],
    s,
  );
}

// ---- 5. A bill, from counter to shelf ---------------------------------------------------------
function counterToShelf(p: Pen, s: number) {
  const c = p.c;
  const saved = s > 11.6;
  const ticked = s > 7.6;
  // The counter: billing.
  const b = p.tablet(50, 40, 600, 540);
  p.tabletTop(b, 'billing', null, 1);
  p.text(saved ? bi('Bill #76', 'ಬಿಲ್ #76') : bi('New bill', 'ಹೊಸ ಬಿಲ್'), b.x + 24, b.y + 92, { size: 22, weight: 600, display: true, color: c.ink900 });
  p.input(b.x + 24, b.y + 112, b.w - 48, null, typed('parle', s, 0.6, 1.6), { focus: s > 0.4 && s < 2.8, caret: s > 0.4 && s < 2.8, t: s, placeholder: bi('Item', 'ಸಾಮಾನು') });
  const line = prog(s, 2.7, 3.1);
  p.slide(line, 0, -10, () => {
    p.box(b.x + 24, b.y + 172, b.w - 48, 58, { fill: c.paper1, r: 14 });
    p.text('Parle-G', b.x + 44, b.y + 201, { size: 19, weight: 600, color: c.ink900 });
    p.text('1 ' + p.tx(L.pack) + '  ·  ₹110', b.x + 170, b.y + 201, { size: 18, color: c.ink500 });
    const tk = prog(s, 7.8, 8.2);
    p.box(b.x + b.w - 84, b.y + 184, 34, 34, { fill: tk > 0.5 ? c.okWash : c.paper2, stroke: tk > 0.5 ? c.okEdge : c.line, r: 999 });
    if (tk > 0) p.alpha(tk, () => p.icon('check', b.x + b.w - 78, b.y + 190, 22, c.ok700));
  });
  p.ring(b.x + b.w - 84, b.y + 184, 34, 34, s, vis(s, 8.0, 10.6));
  // The suggestion list.
  p.alpha(vis(s, 1.6, 2.9, 0.2), () => {
    p.box(b.x + 24, b.y + 162, b.w - 48, 100, { fill: c.paper1, stroke: c.line, r: 12, shadow: 3 });
    p.box(b.x + 30, b.y + 168, b.w - 60, 42, { fill: c.brandWash, stroke: 'none', r: 8 });
    p.text('Parle-G · ' + p.tx(L.pack) + ' ₹110', b.x + 44, b.y + 189, { size: 18, weight: 600, color: c.brand700 });
    p.text('Parle-G · ' + p.tx(bi('Piece', 'ತುಂಡು')) + ' ₹10', b.x + 44, b.y + 233, { size: 18, color: c.ink700 });
  });
  p.text(bi('Total', 'ಒಟ್ಟು'), b.x + 24, b.y + 440, { size: 18, color: c.ink500 });
  p.text(line > 0.5 ? '₹110' : '₹0', b.x + b.w - 24, b.y + 440, { size: 24, weight: 700, align: 'right', color: c.ink900 });
  p.button(b.x + 24, b.y + 456, b.w - 48, saved ? bi('Saved', 'ಉಳಿಸಲಾಗಿದೆ') : L.save, { primary: !saved, press: s - 11.5 });

  // The worker's pick list.
  const w = p.tablet(690, 40, 540, 540);
  p.tabletTop(w, null, 'Ravi · ' + p.tx(L.worker));
  p.text(saved ? bi('Bill #76 · walk-in', 'ಬಿಲ್ #76 · ಗ್ರಾಹಕ') : bi('Being written · walk-in', 'ಬರೆಯಲಾಗುತ್ತಿದೆ · ಗ್ರಾಹಕ'), w.x + 24, w.y + 92, { size: 22, weight: 600, display: true, color: c.ink900, maxW: w.w - 48 });
  const shown = prog(s, 3.0, 3.6);
  p.slide(shown, 30, 0, () => {
    if (!saved) {
      p.box(w.x + 24, w.y + 116, w.w - 48, 48, { fill: c.goldWash, stroke: 'none', r: 12 });
      p.text(bi('Not saved yet: lines may still change at the counter.', 'ಇನ್ನೂ ಉಳಿಸಿಲ್ಲ: ಕೌಂಟರ್‌ನಲ್ಲಿ ಸಾಲುಗಳು ಬದಲಾಗಬಹುದು.'), w.x + 38, w.y + 140, { size: 15, weight: 600, color: c.gold600, maxW: w.w - 76 });
    }
    p.card(w.x + 24, w.y + 180, w.w - 48, 130);
    p.icon('pin', w.x + 40, w.y + 194, 20, c.brand700);
    p.text(p.tx(L.shop) + ' · Rack 1', w.x + 68, w.y + 205, { size: 17, weight: 700, color: c.brand700 });
    p.text('Parle-G', w.x + 44, w.y + 250, { size: 20, weight: 600, color: c.ink900 });
    p.text('Parle-G · 1 ' + p.tx(L.pack), w.x + 44, w.y + 280, { size: 16, color: c.ink500 });
    if (ticked) p.box(w.x + w.w - 150, w.y + 242, 100, 46, { fill: c.ok700, stroke: 'none', r: 999 });
    if (ticked) p.icon('check', w.x + w.w - 112, w.y + 253, 24, c.paper1);
    else p.button(w.x + w.w - 150, w.y + 242, 100, bi('Fetched', 'ತಂದೆ'), { h: 46, size: 16, press: s - 7.5 });
  });
  p.ring(w.x + 24, w.y + 180, w.w - 48, 50, s, vis(s, 3.8, 6.8));
  p.slide(prog(s, 12.2, 12.8), 0, 16, () => p.change(w.x + 34, w.y + 400, p.tx(L.shop) + ': Parle-G', 24, 23, L.pack, prog(s, 12.8, 14)));

  pointer(
    p,
    [
      [0, 400, 470],
      [0.4, b.x + 200, b.y + 135, true],
      [2.6, b.x + 200, b.y + 190, true],
      [6.6, w.x + w.w - 100, w.y + 265],
      [7.5, w.x + w.w - 100, w.y + 265, true],
      [10.8, b.x + b.w / 2, b.y + 478],
      [11.5, b.x + b.w / 2, b.y + 478, true],
      [13.4, 640, 600],
    ],
    s,
  );
}

// ---- 6. Handwritten lines ---------------------------------------------------------------------
function writtenLines(p: Pen, s: number) {
  const c = p.c;
  const tabs = [
    { label: L.bills, on: false },
    { label: L.toConfirm, on: true },
  ];
  const r = p.appFrame(1, tabs, bi('Bill lines to digitise', 'ಡಿಜಿಟೈಸ್ ಮಾಡಬೇಕಾದ ಸಾಲುಗಳು'));
  const done = s > 7.3;
  const gone = prog(s, 7.3, 7.9);
  p.slide(1 - gone, 0, -10, () => {
    p.card(r.x, r.y, 884, 64);
    p.text(bi('Bill #77 · walk-in · 1 line to digitise', 'ಬಿಲ್ #77 · ಗ್ರಾಹಕ · 1 ಸಾಲು ಡಿಜಿಟೈಸ್ ಮಾಡಬೇಕು'), r.x + 20, r.y + 32, { size: 18, weight: 600, color: c.ink900, maxW: 500 });
    p.button(r.x + 884 - 330, r.y + 10, 314, bi('✓ Digitise all on this bill', '✓ ಈ ಬಿಲ್‌ನ ಎಲ್ಲಾ ಡಿಜಿಟೈಸ್ ಮಾಡಿ'), { primary: true, press: s - 7.0, size: 16 });
    p.card(r.x, r.y + 80, 884, 300);
    p.pill(r.x + 20, r.y + 112, bi('Written by hand: pick the item', 'ಕೈಯಲ್ಲಿ ಬರೆದದ್ದು: ಸಾಮಾನು ಆರಿಸಿ'), 'warn', 15);
    p.box(r.x + 20, r.y + 136, 360, 70, { fill: '#fffaf0', stroke: c.line, r: 10 });
    p.scribble(r.x + 40, r.y + 171, 300, prog(s, 0, 1.2));
    const picked = s > 4.3;
    p.input(r.x + 20, r.y + 224, 520, null, picked ? 'Sugar' : typed('sugar', s, 2.1, 3.0), { focus: s > 1.8 && s < 4.3, caret: s > 1.8 && s < 4.3, t: s, placeholder: bi('Search the item…', 'ಅಥವಾ ಬೇರೆ ಸಾಮಾನು ಹುಡುಕಿ…') });
    p.alpha(vis(s, 3.1, 4.4, 0.2), () => {
      let cx = r.x + 20;
      ['Sugar', 'Sugar candy'].forEach((n, i) => {
        const cw = p.measure(n, 16, 600) + 30;
        p.box(cx, r.y + 282, cw, 38, { fill: i === 0 && s > 3.9 ? c.brandWash : c.paper2, stroke: 'none', r: 999 });
        p.text(n, cx + 15, r.y + 302, { size: 16, weight: 600, color: c.ink700 });
        cx += cw + 8;
      });
    });
    p.alpha(prog(s, 4.3, 4.8), () => {
      p.input(r.x + 560, r.y + 200, 140, bi('Quantity', 'ಪ್ರಮಾಣ'), '1');
      p.select(r.x + 716, r.y + 200, 148, bi('Unit', 'ಘಟಕ'), 'kg');
    });
  });
  p.ring(r.x + 884 - 330, r.y + 10, 314, 44, s, vis(s, 5.4, 7.3, 0.2));
  if (done) {
    p.slide(prog(s, 7.6, 8.2), 0, 12, () => {
      p.box(r.x, r.y + 10, 884, 56, { fill: c.okWash, stroke: c.okEdge, r: 14 });
      p.text(bi('Bill #77: 1 line digitised', 'ಬಿಲ್ #77: 1 ಸಾಲು ಡಿಜಿಟೈಸ್ ಆಗಿದೆ'), r.x + 20, r.y + 38, { size: 19, weight: 600, color: c.ok700 });
    });
    p.slide(prog(s, 8.3, 8.9), 0, 16, () => p.change(r.x, r.y + 100, p.tx(L.shop) + ': Sugar', 40, 39, 'kg', prog(s, 8.9, 10)));
  }
  pointer(
    p,
    [
      [0, 900, 520],
      [1.8, r.x + 200, r.y + 246, true],
      [3.9, r.x + 60, r.y + 301, true],
      [6.4, r.x + 720, r.y + 32],
      [7.0, r.x + 720, r.y + 32, true],
      [9.5, 900, 520],
    ],
    s,
  );
}

// ---- 7. Running low → bring from the godown ---------------------------------------------------
function runningLow(p: Pen, s: number) {
  const c = p.c;
  if (s < 4.5) {
    const r = p.appFrame(0, [{ label: L.today, on: true }, { label: L.reports }], bi('Needs you now', 'ಈಗ ನಿಮ್ಮ ಗಮನ ಬೇಕು'));
    const low = s > 1.2 ? 1 : 0;
    const needs: [Bi, number, boolean][] = [
      [bi('Bill lines to digitise', 'ಡಿಜಿಟೈಸ್ ಮಾಡಬೇಕಾದ ಸಾಲುಗಳು'), 0, false],
      [bi('Running low, all places together', 'ಮುಗಿಯುತ್ತಿದೆ, ಎಲ್ಲಾ ಕಡೆ ಸೇರಿ'), low, true],
      [bi('Below zero: count these', 'ಸೊನ್ನೆಗಿಂತ ಕಡಿಮೆ: ಎಣಿಸಿ'), 0, false],
      [bi('Transfers on the way', 'ದಾರಿಯಲ್ಲಿರುವ ಸಾಗಣೆ'), 0, false],
    ];
    needs.forEach(([l, n, warn], i) => {
      const x = r.x + (i % 2) * 446;
      const y = r.y + Math.floor(i / 2) * 92;
      p.box(x, y, 436, 80, { fill: c.paper1, stroke: c.line, r: 16, shadow: 1 });
      p.box(x + 16, y + 19, 42, 42, { fill: warn && n ? c.goldWash : c.paper2, stroke: 'none', r: 12 });
      p.icon((['check', 'box', 'box', 'truck'] as const)[i]!, x + 26, y + 29, 22, warn && n ? c.gold600 : c.ink500);
      p.text(String(n), x + 74, y + 30, { size: 26, weight: 500, display: true, color: warn && n ? c.gold600 : c.ink900 });
      p.text(l, x + 74, y + 60, { size: 15, color: c.ink500, maxW: 340 });
    });
    p.ring(r.x + 446, r.y, 436, 80, s, vis(s, 1.4, 4.4));
    p.slide(prog(s, 1.8, 2.4), 0, 12, () => {
      p.card(r.x, r.y + 196, 884, 100);
      p.text(bi('Just went low', 'ಈಗಷ್ಟೇ ಕಡಿಮೆಯಾಗಿದೆ'), r.x + 20, r.y + 226, { size: 18, weight: 600, color: c.ink900 });
      p.text(p.tx(bi('Parle-G · 43 Pack left in all places, below 50 Pack', 'Parle-G · 43 ಪ್ಯಾಕ್ ಎಲ್ಲಾ ಕಡೆ ಸೇರಿ ಉಳಿದಿದೆ, ಮಿತಿ 50 ಪ್ಯಾಕ್')), r.x + 20, r.y + 264, { size: 18, color: c.ink500, maxW: 840 });
    });
    return;
  }
  if (s < 9.5) {
    const tabs = [{ label: L.items }, { label: L.bring, on: true }];
    const r = p.appFrame(2, tabs, L.bring);
    const sent = s > 7.9;
    p.card(r.x, r.y, 884, 230);
    p.text(bi('From Main godown · 1 items', 'ಮುಖ್ಯ ಗೋದಾಮಿನಿಂದ · 1 ಸಾಮಾನು'), r.x + 20, r.y + 32, { size: 19, weight: 600, color: c.ink900 });
    const cols = [bi('Item', 'ಸಾಮಾನು'), bi('Shop has', 'ಅಂಗಡಿಯಲ್ಲಿ'), bi('Godown has', 'ಗೋದಾಮಿನಲ್ಲಿ'), bi('Bring', 'ತನ್ನಿ')];
    const xs = [20, 260, 470, 680];
    p.box(r.x + 12, r.y + 58, 860, 40, { fill: c.paper2, stroke: 'none', r: 8 });
    cols.forEach((t, i) => p.text(t, r.x + xs[i]!, r.y + 78, { size: 15, weight: 700, color: c.ink500 }));
    p.text('Parle-G', r.x + 20, r.y + 128, { size: 19, weight: 600, color: c.ink900 });
    p.text('3 ' + p.tx(L.pack), r.x + 260, r.y + 128, { size: 18, color: c.danger600, weight: 600 });
    p.text('40 ' + p.tx(L.pack), r.x + 470, r.y + 128, { size: 18, color: c.ink700 });
    p.input(r.x + 680, r.y + 106, 120, null, '20');
    p.button(r.x + 20, r.y + 168, 200, bi('Send request', 'ಬೇಡಿಕೆ ಕಳುಹಿಸಿ'), { primary: true, press: s - 7.8 });
    p.ring(r.x + 20, r.y + 168, 200, 44, s, vis(s, 6.4, 7.9, 0.2));
    if (sent)
      p.slide(prog(s, 8.0, 8.5), 0, 12, () => {
        p.box(r.x, r.y + 250, 884, 56, { fill: c.okWash, stroke: c.okEdge, r: 14 });
        p.text(bi('Request sent to Main godown. The godown sees it on their screen now.', 'ಮುಖ್ಯ ಗೋದಾಮಿಗೆ ಬೇಡಿಕೆ ಕಳುಹಿಸಲಾಗಿದೆ. ಗೋದಾಮಿನವರಿಗೆ ಈಗ ಕಾಣುತ್ತದೆ.'), r.x + 20, r.y + 278, { size: 17, weight: 600, color: c.ok700, maxW: 840 });
      });
    pointer(
      p,
      [
        [4.5, 700, 500],
        [5.2, ...p.placeAt(2), true],
        [6.0, ...p.tabAt(tabs, 1), true],
        [7.8, r.x + 120, r.y + 190, true],
        [9.4, 900, 520],
      ],
      s,
    );
    return;
  }
  if (s < 14.5) {
    const sc = p.tablet(300, 30, 680, 560);
    p.tabletTop(sc, null, 'Manju · ' + p.tx(L.godown));
    p.text(bi('My godown', 'ನನ್ನ ಗೋದಾಮು'), sc.x + 24, sc.y + 92, { size: 24, weight: 600, display: true, color: c.ink900 });
    let tx = sc.x + 24;
    [L.toSend, L.comingIn, L.myStock].forEach((t, i) => {
      const tw = p.measure(t, 16, 600) + 30;
      p.box(tx, sc.y + 116, tw, 36, { fill: i === 0 ? c.ink900 : c.paper2, stroke: 'none', r: 999 });
      p.text(t, tx + 15, sc.y + 135, { size: 16, weight: 600, color: i === 0 ? c.paper1 : c.ink500 });
      tx += tw + 8;
    });
    const sent = s > 13.3;
    p.card(sc.x + 24, sc.y + 170, sc.w - 48, 330);
    p.text(bi('for the shop', 'ಅಂಗಡಿಗೆ'), sc.x + 44, sc.y + 200, { size: 16, weight: 600, color: c.ink500 });
    if (sent) p.pill(sc.x + sc.w - 140, sc.y + 200, bi('Sent', 'ಕಳುಹಿಸಲಾಗಿದೆ'), 'ok');
    p.text('Parle-G', sc.x + 44, sc.y + 240, { size: 20, weight: 600, color: c.ink900 });
    p.text('Rack G2 · 20 ' + p.tx(L.pack), sc.x + 200, sc.y + 240, { size: 18, color: c.ink500 });
    p.input(sc.x + 284, sc.y + 290, 300, bi('Driver', 'ಚಾಲಕ'), typed('Basu', s, 12.0, 12.6), { focus: s > 11.9 && s < 12.8, caret: s > 11.9 && s < 12.8, t: s });
    p.button(sc.x + 44, sc.y + 420, 220, bi('Send to shop', 'ಅಂಗಡಿಗೆ ಕಳುಹಿಸಿ'), { primary: !sent, press: s - 13.2 });
    p.select(sc.x + 44, sc.y + 290, 220, bi('Vehicle', 'ವಾಹನ'), s > 11.3 ? 'KA-25 AB 1234' : '—', { open: vis(s, 10.5, 11.4, 0.2), options: ['KA-25 AB 1234', 'KA-25 C 778'], hi: 0 });
    p.ring(sc.x + 24, sc.y + 116, 140, 36, s, vis(s, 9.7, 10.6, 0.2));
    pointer(
      p,
      [
        [9.5, 700, 520],
        [10.4, sc.x + 150, sc.y + 336, true],
        [11.2, sc.x + 150, sc.y + 390, true],
        [11.9, sc.x + 430, sc.y + 336, true],
        [13.2, sc.x + 154, sc.y + 442, true],
        [14.4, 900, 560],
      ],
      s,
    );
    return;
  }
  const tabs = [{ label: L.purchases }, { label: L.transfers, on: true }];
  const r = p.appFrame(3, tabs, bi('Transfers between places', 'ಸ್ಥಳಗಳ ನಡುವೆ ಸಾಗಣೆ'));
  const got = s > 16.1;
  p.card(r.x, r.y, 884, 170);
  p.text(p.tx(L.mainGodown) + '  →  ' + p.tx(L.shop), r.x + 20, r.y + 32, { size: 20, weight: 600, color: c.ink900 });
  p.pill(r.x + 330, r.y + 32, got ? bi('Received', 'ತಲುಪಿದ್ದು') : bi('sent', 'ಕಳುಹಿಸಲಾಗಿದೆ'), got ? 'ok' : 'warn');
  p.text('KA-25 AB 1234 · Basu', r.x + 20, r.y + 66, { size: 16, color: c.ink500 });
  p.text('Parle-G · 20 ' + p.tx(L.pack), r.x + 20, r.y + 104, { size: 18, color: c.ink700 });
  p.button(r.x + 600, r.y + 92, 264, L.markReceived, { primary: !got, press: s - 16.0, size: 16 });
  p.ring(r.x + 600, r.y + 92, 264, 44, s, vis(s, 15.0, 16.1, 0.2));
  p.slide(prog(s, 16.4, 17), 0, 16, () => p.change(r.x, r.y + 200, p.tx(L.shop) + ': Parle-G', 3, 23, L.pack, prog(s, 17, 18.2)));
  pointer(
    p,
    [
      [14.5, 700, 500],
      [15.1, ...p.placeAt(3), true],
      [15.5, ...p.tabAt(tabs, 1), true],
      [16.0, r.x + 732, r.y + 114, true],
      [18.0, 980, 560],
    ],
    s,
  );
}

// ---- 8. Buying --------------------------------------------------------------------------------
function buying(p: Pen, s: number) {
  const c = p.c;
  const r = p.appFrame(3, [{ label: L.purchases, on: true }, { label: L.transfers }], L.purchases);
  p.button(r.x, r.y, 190, bi('+ New order', '+ ಹೊಸ ಆರ್ಡರ್'), { primary: true, press: s - 0.8 });
  const f = vis(s, 1.0, 7.9);
  const lineIn = prog(s, 2.8, 3.2);
  const usual = s > 4.7;
  p.slide(f, 0, -10, () => {
    p.card(r.x, 256, 884, 320);
    p.select(r.x + 20, 272, 410, bi('Supplier', 'ಸರಬರಾಜುದಾರ'), usual ? 'Sri Lakshmi Traders' : 'Sri Ganesh Agencies', { focus: s > 4.7 && s < 5.6 });
    p.select(r.x + 454, 272, 410, bi('Goods go to', 'ಸಾಮಾನು ಹೋಗುವುದು'), L.shop);
    p.input(r.x + 20, 356, 844, null, lineIn > 0 ? '' : typed('sugar', s, 1.5, 2.2), { focus: s > 1.3 && s < 2.8, caret: s > 1.3 && s < 2.8, t: s, placeholder: bi('Search an item to add…', 'ಸೇರಿಸಲು ಸಾಮಾನು ಹುಡುಕಿ…') });
    if (s > 2.2 && s < 2.9) {
      p.box(r.x + 20, 410, 90, 36, { fill: s > 2.6 ? c.brandWash : c.paper2, stroke: 'none', r: 999 });
      p.text('Sugar', r.x + 38, 428, { size: 16, weight: 600, color: c.ink700 });
    }
    p.alpha(lineIn, () => {
      p.text('Sugar', r.x + 20, 434, { size: 20, weight: 600, color: c.ink900 });
      p.input(r.x + 360, 412, 110, null, typed('50', s, 5.7, 6.0), { focus: s > 5.6 && s < 6.2, caret: s > 5.6 && s < 6.2, t: s });
      p.select(r.x + 484, 412, 120, null, 'kg');
      p.text('₹', r.x + 622, 434, { size: 18, color: c.ink500 });
      p.input(r.x + 640, 412, 110, null, typed('42', s, 6.5, 6.9), { focus: s > 6.4 && s < 7.1, caret: s > 6.4 && s < 7.1, t: s, placeholder: bi('cost', 'ಬೆಲೆ') });
      const lw = p.text(bi('Supplied by', 'ಕೊಡುವವರು'), r.x + 20, 488, { size: 15, color: c.ink500 });
      p.text(':', r.x + 22 + lw, 488, { size: 15, color: c.ink500 });
      const chip = 'Sri Lakshmi Traders · ₹41/kg';
      const cw = p.measure(chip, 15, 600) + 28;
      p.box(r.x + 34 + lw, 470, cw, 36, { fill: usual ? c.brandWash : c.paper2, stroke: usual ? c.brandEdge : 'none', r: 999 });
      p.text(chip, r.x + 48 + lw, 489, { size: 15, weight: 600, color: usual ? c.brand700 : c.ink700 });
      p.ring(r.x + 34 + lw, 470, cw, 36, s, vis(s, 3.3, 4.8, 0.2));
    });
    p.button(r.x + 20, 520, 170, bi('Save order', 'ಆರ್ಡರ್ ಉಳಿಸಿ'), { primary: true, press: s - 7.6 });
  });
  const order = prog(s, 7.9, 8.4);
  const got = s > 9.7;
  p.slide(order, 0, 14, () => {
    p.card(r.x, 256, 884, 130);
    p.text('Sri Lakshmi Traders', r.x + 20, 290, { size: 20, weight: 600, color: c.ink900 });
    p.pill(r.x + 240, 290, got ? bi('received', 'ಬಂದಿದೆ') : bi('Ordered', 'ಆರ್ಡರ್'), got ? 'ok' : 'warn');
    p.text('Sugar · 50 kg · ₹42', r.x + 20, 330, { size: 18, color: c.ink700 });
    p.button(r.x + 600, 316, 264, L.markReceived, { primary: !got, press: s - 9.6, size: 16 });
  });
  p.slide(prog(s, 10.0, 10.6), 0, 16, () => p.change(r.x, 410, p.tx(L.shop) + ': Sugar', 39, 89, 'kg', prog(s, 10.6, 11.6)));
  pointer(
    p,
    [
      [0, 700, 480],
      [0.8, r.x + 95, r.y + 22, true],
      [1.3, r.x + 300, 378, true],
      [2.6, r.x + 60, 428, true],
      [4.6, r.x + 260, 488, true],
      [5.6, r.x + 415, 434, true],
      [6.4, r.x + 695, 434, true],
      [7.6, r.x + 105, 542, true],
      [9.6, r.x + 732, 338, true],
      [11.6, 980, 560],
    ],
    s,
    -1,
    12.2,
  );
  // The closing card.
  const end = prog(s, 12.2, 12.9);
  p.alpha(end, () => {
    p.ctx.fillStyle = c.paper0;
    p.ctx.fillRect(0, 0, W, H);
    p.box(W / 2 - 60, 150, 120, 120, { fill: c.paper2, stroke: c.lineStrong, r: 999, shadow: 2 });
    p.text('?', W / 2, 212, { size: 64, weight: 700, align: 'center', color: c.ink900 });
    p.text(bi('Press ? on any screen', 'ಯಾವುದೇ ಪುಟದಲ್ಲಿ ? ಒತ್ತಿ'), W / 2, 340, { size: 48, weight: 500, display: true, align: 'center', color: c.ink900, maxW: 1100 });
    p.text(bi('for that screen’s tour', 'ಆ ಪುಟದ ಪರಿಚಯ ನೋಡಲು'), W / 2, 400, { size: 28, align: 'center', color: c.ink500 });
  });
}

export const CHAPTERS: Chapter[] = [
  {
    id: 'picture',
    title: bi('The big picture', 'ಒಟ್ಟು ಚಿತ್ರಣ'),
    sub: bi('Two apps on one tablet, and three kinds of people.', 'ಒಂದು ಟ್ಯಾಬ್ಲೆಟ್‌ನಲ್ಲಿ ಎರಡು ಆ್ಯಪ್, ಮೂರು ರೀತಿಯ ಜನರು.'),
    route: '/admin',
    tour: 'home',
    dur: 16,
    cues: [
      cue(0, 'One tablet, two apps: Billing at the counter, Stock for the goods.', 'ಒಂದೇ ಟ್ಯಾಬ್ಲೆಟ್, ಎರಡು ಆ್ಯಪ್: ಕೌಂಟರ್‌ಗೆ ಬಿಲ್ಲಿಂಗ್, ಸಾಮಾನಿಗೆ ಸ್ಟಾಕ್.'),
      cue(4.2, 'Three kinds of people use it: Admin, Shop worker and Godown.', 'ಮೂರು ರೀತಿಯ ಜನರು ಬಳಸುತ್ತಾರೆ: ಆಡ್ಮಿನ್, ಅಂಗಡಿ ಕೆಲಸಗಾರ, ಗೋದಾಮು.'),
      cue(8.6, 'Each one sees only their own work.', 'ಪ್ರತಿಯೊಬ್ಬರಿಗೂ ಅವರ ಕೆಲಸ ಮಾತ್ರ ಕಾಣುತ್ತದೆ.'),
    ],
    draw: bigPicture,
  },
  {
    id: 'godown',
    title: bi('Add a godown', 'ಗೋದಾಮು ಸೇರಿಸಿ'),
    sub: bi('Setup → Places', 'ಸೆಟಪ್ → ಸ್ಥಳಗಳು'),
    route: '/admin/places',
    tour: 'setup',
    dur: 16,
    cues: [
      cue(0, 'Setup → Places. Tap “+ New godown”.', 'ಸೆಟಪ್ → ಸ್ಥಳಗಳು. “+ ಹೊಸ ಗೋದಾಮು” ಒತ್ತಿ.'),
      cue(2.3, 'Type its name, in English and in Kannada.', 'ಹೆಸರು ಬರೆಯಿರಿ, ಇಂಗ್ಲಿಷ್ ಮತ್ತು ಕನ್ನಡದಲ್ಲಿ.'),
      cue(7.0, 'Save. The godown is in the list, ready to hold stock.', 'ಉಳಿಸಿ. ಗೋದಾಮು ಪಟ್ಟಿಯಲ್ಲಿ ಬಂತು, ಸ್ಟಾಕ್ ಇಡಲು ಸಿದ್ಧ.'),
    ],
    draw: addGodown,
  },
  {
    id: 'people',
    title: bi('Add people and their roles', 'ಜನರು ಮತ್ತು ಅವರ ಕೆಲಸ'),
    sub: bi('Setup → People', 'ಸೆಟಪ್ → ಜನರು'),
    route: '/admin/people',
    tour: 'setup',
    dur: 24,
    cues: [
      cue(0, 'Setup → People → “+ New person”.', 'ಸೆಟಪ್ → ಜನರು → “+ ಹೊಸ ವ್ಯಕ್ತಿ”.'),
      cue(1.6, 'The shop worker: name, phone, role “Shop worker”, and a PIN. Save.', 'ಅಂಗಡಿ ಕೆಲಸಗಾರ: ಹೆಸರು, ಫೋನ್, ಕೆಲಸ “ಅಂಗಡಿ ಕೆಲಸಗಾರ”, ಪಿನ್. ಉಳಿಸಿ.'),
      cue(8.2, 'The godown person: role “Godown”, then pick their godown.', 'ಗೋದಾಮಿನವರು: ಕೆಲಸ “ಗೋದಾಮು”, ನಂತರ ಅವರ ಗೋದಾಮು ಆರಿಸಿ.'),
      cue(16.4, 'The PIN is theirs: tell them privately. “Set a new PIN” changes it any time.', 'ಪಿನ್ ಅವರದ್ದು: ಖಾಸಗಿಯಾಗಿ ತಿಳಿಸಿ. “ಹೊಸ ಪಿನ್ ಕೊಡಿ” ಯಾವಾಗ ಬೇಕಾದರೂ ಬದಲಿಸುತ್ತದೆ.'),
    ],
    draw: addPeople,
  },
  {
    id: 'signin',
    title: bi('Signing in on the tablet', 'ಟ್ಯಾಬ್ಲೆಟ್‌ನಲ್ಲಿ ಪ್ರವೇಶ'),
    sub: bi('Phone number and PIN', 'ಫೋನ್ ಸಂಖ್ಯೆ ಮತ್ತು ಪಿನ್'),
    route: '/admin/people',
    tour: 'setup',
    dur: 20,
    cues: [
      cue(0, 'On the tablet, each person signs in with their own phone number and PIN.', 'ಟ್ಯಾಬ್ಲೆಟ್‌ನಲ್ಲಿ ಪ್ರತಿಯೊಬ್ಬರೂ ತಮ್ಮ ಫೋನ್ ಸಂಖ್ಯೆ ಮತ್ತು ಪಿನ್‌ನಿಂದ ಪ್ರವೇಶಿಸುತ್ತಾರೆ.'),
      cue(4.2, 'The Admin gets Billing and Stock.', 'ಆಡ್ಮಿನ್‌ಗೆ ಬಿಲ್ಲಿಂಗ್ ಮತ್ತು ಸ್ಟಾಕ್ ಎರಡೂ.'),
      cue(7.2, 'A shop worker gets only the pick list.', 'ಅಂಗಡಿ ಕೆಲಸಗಾರರಿಗೆ ಪಟ್ಟಿ ಮಾತ್ರ.'),
      cue(10.2, 'A godown person gets only To send and Coming in.', 'ಗೋದಾಮಿನವರಿಗೆ “ಕಳುಹಿಸಬೇಕು” ಮತ್ತು “ಬರುತ್ತಿದೆ” ಮಾತ್ರ.'),
      cue(13.2, '“Switch user” hands the tablet over. “Sign in with shop PIN” is the backup.', '“ಬಳಕೆದಾರ ಬದಲಿಸಿ” ಟ್ಯಾಬ್ಲೆಟ್ ಬೇರೆಯವರಿಗೆ ಕೊಡುತ್ತದೆ. ಅಂಗಡಿಯ ಪಿನ್ ಬದಲಿ ದಾರಿ.'),
    ],
    draw: signingIn,
  },
  {
    id: 'bill',
    title: bi('A bill, from counter to shelf', 'ಬಿಲ್: ಕೌಂಟರ್‌ನಿಂದ ರ‍್ಯಾಕ್‌ವರೆಗೆ'),
    sub: bi('Billing, the pick list, and stock', 'ಬಿಲ್ಲಿಂಗ್, ಪಟ್ಟಿ ಮತ್ತು ಸ್ಟಾಕ್'),
    route: '/worker',
    tour: 'worker',
    dur: 21,
    cues: [
      cue(0, 'At the counter, type “parle” and pick Pack ₹110.', 'ಕೌಂಟರ್‌ನಲ್ಲಿ “parle” ಬರೆದು ಪ್ಯಾಕ್ ₹110 ಆರಿಸಿ.'),
      cue(3.2, 'At once, the worker’s pick list shows it under Shop · Rack 1.', 'ತಕ್ಷಣ ಕೆಲಸಗಾರರ ಪಟ್ಟಿಯಲ್ಲಿ ಅಂಗಡಿ · Rack 1 ಕೆಳಗೆ ಕಾಣುತ್ತದೆ.'),
      cue(7.4, 'The worker taps Fetched. The tick shows on the bill too.', 'ಕೆಲಸಗಾರರು “ತಂದೆ” ಒತ್ತುತ್ತಾರೆ. ಬಿಲ್‌ನಲ್ಲೂ ಟಿಕ್ ಬರುತ್ತದೆ.'),
      cue(11.4, 'Save the bill: stock goes down by itself.', 'ಬಿಲ್ ಉಳಿಸಿ: ಸ್ಟಾಕ್ ತಾನಾಗಿ ಕಡಿಮೆಯಾಗುತ್ತದೆ.'),
    ],
    draw: counterToShelf,
  },
  {
    id: 'confirm',
    title: bi('Handwritten lines', 'ಕೈಬರಹದ ಸಾಲುಗಳು'),
    sub: bi('Bills → To digitise', 'ಬಿಲ್‌ಗಳು → ಡಿಜಿಟೈಸ್ ಮಾಡಿ'),
    route: '/admin/confirm',
    tour: 'confirm',
    dur: 16,
    cues: [
      cue(0, 'A line written by hand waits in Bills → To digitise.', 'ಕೈಯಲ್ಲಿ ಬರೆದ ಸಾಲು ಬಿಲ್‌ಗಳು → ಡಿಜಿಟೈಸ್ ಮಾಡಿ ಯಲ್ಲಿ ಕಾಯುತ್ತದೆ.'),
      cue(1.8, 'Pick the item it means.', 'ಅದು ಯಾವ ಸಾಮಾನು ಎಂದು ಆರಿಸಿ.'),
      cue(5.4, '“Digitise all on this bill”: stock goes down, and the name is remembered.', '“ಈ ಬಿಲ್‌ನ ಎಲ್ಲಾ ಡಿಜಿಟೈಸ್ ಮಾಡಿ”: ಸ್ಟಾಕ್ ಕಡಿಮೆಯಾಗುತ್ತದೆ, ಹೆಸರು ನೆನಪಿರುತ್ತದೆ.'),
    ],
    draw: writtenLines,
  },
  {
    id: 'refill',
    title: bi('Running low? Bring from the godown', 'ಕಡಿಮೆಯಾಯಿತೇ? ಗೋದಾಮಿನಿಂದ ತರಿಸಿ'),
    sub: bi('Inventory → Bring from godown', 'ಸಾಮಾನು → ಗೋದಾಮಿನಿಂದ ತರಿಸಿ'),
    route: '/admin/refill',
    tour: 'refill',
    dur: 22,
    cues: [
      cue(0, 'When all places together drop below the level, Home shows “Running low”.', 'ಎಲ್ಲಾ ಕಡೆ ಸೇರಿ ಮಿತಿಗಿಂತ ಕಡಿಮೆಯಾದಾಗ ಮುಖಪುಟದಲ್ಲಿ “ಮುಗಿಯುತ್ತಿದೆ” ಕಾಣುತ್ತದೆ.'),
      cue(4.5, 'Inventory → Bring from godown → “Send request”.', 'ಸಾಮಾನು → ಗೋದಾಮಿನಿಂದ ತರಿಸಿ → “ಬೇಡಿಕೆ ಕಳುಹಿಸಿ”.'),
      cue(9.5, 'The godown sees it in To send: vehicle, driver, “Send to shop”.', 'ಗೋದಾಮಿನಲ್ಲಿ “ಕಳುಹಿಸಬೇಕು”: ವಾಹನ, ಚಾಲಕ, “ಅಂಗಡಿಗೆ ಕಳುಹಿಸಿ”.'),
      cue(14.5, 'When it arrives: Transfers → “Mark received”. Stock goes up.', 'ಬಂದಾಗ: ಸಾಗಣೆ → “ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಿ”. ಸ್ಟಾಕ್ ಹೆಚ್ಚುತ್ತದೆ.'),
    ],
    draw: runningLow,
  },
  {
    id: 'buy',
    title: bi('Buying', 'ಖರೀದಿ'),
    sub: bi('Buy & move → Purchases', 'ಖರೀದಿ ಮತ್ತು ಸಾಗಣೆ → ಖರೀದಿ'),
    route: '/admin/purchases',
    tour: 'purchases',
    dur: 18,
    cues: [
      cue(0, 'Buy & move → Purchases → “+ New order”, then add the item.', 'ಖರೀದಿ ಮತ್ತು ಸಾಗಣೆ → ಖರೀದಿ → “+ ಹೊಸ ಆರ್ಡರ್”, ನಂತರ ಸಾಮಾನು ಸೇರಿಸಿ.'),
      cue(3.2, 'Its usual supplier is suggested. Add quantity and cost, then “Save order”.', 'ಯಾವಾಗಲೂ ಕೊಡುವವರು ಕಾಣುತ್ತಾರೆ. ಪ್ರಮಾಣ, ಬೆಲೆ ಹಾಕಿ “ಆರ್ಡರ್ ಉಳಿಸಿ”.'),
      cue(8.4, 'When the goods come, “Mark received”: stock goes up in that place.', 'ಸಾಮಾನು ಬಂದಾಗ “ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಿ”: ಆ ಸ್ಥಳದ ಸ್ಟಾಕ್ ಹೆಚ್ಚುತ್ತದೆ.'),
      cue(12.2, 'Any time you are unsure, press ? for that screen’s tour.', 'ಗೊಂದಲವಾದರೆ, ಆ ಪುಟದ ಪರಿಚಯಕ್ಕೆ ? ಒತ್ತಿ.'),
    ],
    draw: buying,
  },
];

/** Where each chapter starts, and the whole length, in seconds. */
export const STARTS: number[] = CHAPTERS.reduce<number[]>((a, ch, i) => [...a, i === 0 ? 0 : a[i - 1]! + CHAPTERS[i - 1]!.dur], []);
export const TOTAL: number = CHAPTERS.reduce((s, ch) => s + ch.dur, 0);

export function chapterAt(time: number): number {
  let i = 0;
  while (i < CHAPTERS.length - 1 && time >= STARTS[i + 1]!) i++;
  return i;
}

/** Draws the frame at `time` seconds into the explainer. */
export function renderFrame(p: Pen, time: number) {
  const ctx = p.ctx;
  const i = chapterAt(Math.max(0, Math.min(TOTAL - 0.001, time)));
  const ch = CHAPTERS[i]!;
  const local = time - STARTS[i]!;
  const s = local - TITLE;
  ctx.fillStyle = p.c.paper0;
  ctx.fillRect(0, 0, W, H);
  if (s > -0.7) ch.draw(p, Math.max(0, s));
  // The caption for this moment.
  let k = -1;
  ch.cues.forEach((c, n) => {
    if (s >= c.at) k = n;
  });
  if (k >= 0) {
    const cu = ch.cues[k]!;
    const end = k + 1 < ch.cues.length ? TITLE + ch.cues[k + 1]!.at : ch.dur;
    p.caption(p.tx(cu.text), vis(local, TITLE + cu.at, end, 0.3));
  }
  p.titleCard(i + 1, CHAPTERS.length, p.tx(ch.title), p.tx(ch.sub), 1 - prog(local, TITLE - 0.6, TITLE));
  // A short fade between chapters.
  const out = prog(local, ch.dur - 0.35, ch.dur);
  if (out > 0 && i < CHAPTERS.length - 1) {
    p.alpha(out, () => {
      ctx.fillStyle = p.c.paper0;
      ctx.fillRect(0, 0, W, H);
    });
  }
}
