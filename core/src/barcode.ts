/**
 * Barcodes on items.
 *
 * A barcode belongs to a unit, not to the item: a single Bingo packet and a carton of thirty
 * carry different codes, and scanning either one should bill the thing in the hand. Billing never
 * keeps codes of its own; it asks stock what a scanned code is (`/billing-link/barcode`).
 */

/** At most this many codes on one unit: a product reprinted with new packaging keeps its old one. */
export const MAX_BARCODES_PER_UNIT = 10;

/** What a code may look like: EAN-13, EAN-8, UPC, Code 128 labels the shop prints itself. */
export const BARCODE_RE = /^[0-9A-Za-z-]{4,32}$/;

/** A code as typed or scanned, tidied: spaces and invisible characters gone, letters upper case. */
export function cleanBarcode(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\s­​-‏⁠﻿]+/g, '')
    .toUpperCase();
}

/** Whether a tidied code is one the shop could have on a product. */
export function isBarcode(code: string): boolean {
  return BARCODE_RE.test(code);
}

type WithBarcodes = { units: { code: string; barcodes?: string[] }[] };

/** Every code on an item, with the unit each one sells. */
export function itemBarcodes(item: WithBarcodes): { code: string; unit: string }[] {
  const out: { code: string; unit: string }[] = [];
  for (const u of item.units ?? []) {
    for (const b of u.barcodes ?? []) out.push({ code: b, unit: u.code });
  }
  return out;
}

/** The unit of `item` that carries `code`, if any. `code` is compared tidied. */
export function barcodeUnit(item: WithBarcodes, code: string): string | undefined {
  const c = cleanBarcode(code);
  if (!c) return undefined;
  return itemBarcodes(item).find((b) => b.code === c)?.unit;
}

/**
 * The active item and unit a scanned code means, from a list. Inactive items are passed over, so
 * an old item switched off does not keep a code a new one has taken.
 */
export function findBarcode<T extends WithBarcodes & { active: boolean }>(
  items: T[],
  code: string,
): { item: T; unit: string } | undefined {
  const c = cleanBarcode(code);
  if (!isBarcode(c)) return undefined;
  for (const item of items) {
    if (!item.active) continue;
    const unit = barcodeUnit(item, c);
    if (unit) return { item, unit };
  }
  return undefined;
}

/** One code a scanner read that no item has yet, waiting for the admin to say what it is. */
export interface UnknownScan {
  code: string;
  /** How many times it was scanned since it was first seen. */
  count: number;
  firstAt: string;
  lastAt: string;
}

/** The newest this many unknown codes are kept; older ones fall off the end. */
export const MAX_UNKNOWN_SCANS = 200;

/** The list with one more scan of `code` at `at`: counted again when already there, newest first. */
export function withUnknownScan(list: UnknownScan[], code: string, at: string): UnknownScan[] {
  const old = list.find((s) => s.code === code);
  const next: UnknownScan = old
    ? { ...old, count: old.count + 1, lastAt: at }
    : { code, count: 1, firstAt: at, lastAt: at };
  return [next, ...list.filter((s) => s.code !== code)].slice(0, MAX_UNKNOWN_SCANS);
}

// ------------------------------------------------------------------ EAN-13: making and printing

/** The check digit of an EAN-13 from its first twelve digits. */
export function ean13Check(twelve: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** Whether a code is a whole, valid EAN-13: thirteen digits with the right check digit. */
export function isEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13Check(code.slice(0, 12)) === Number(code[12]);
}

/** The code as an EAN-13 to print: itself, or a 12-digit UPC-A with its leading 0; else null. */
export function asEan13(code: string): string | null {
  const c = cleanBarcode(code);
  if (isEan13(c)) return c;
  if (/^\d{12}$/.test(c) && isEan13('0' + c)) return '0' + c;
  return null;
}

/**
 * A new code for an item that came without one, for the shop to print and stick on. Starts 20:
 * GS1 keeps 20-29 for codes used only inside one shop, so it can never be a real product's code.
 * Ten random digits and the check digit after it; never one in `taken`.
 */
export function newShopBarcode(taken: Iterable<string> = [], random: () => number = Math.random): string {
  const used = new Set([...taken].map(cleanBarcode));
  for (;;) {
    let body = '20';
    while (body.length < 12) body += String(Math.floor(random() * 10) % 10);
    const code = body + ean13Check(body);
    if (!used.has(code)) return code;
  }
}

/* The digit patterns, seven modules each: L and G on the left half, R on the right. */
const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
/** Which left digits use G, by the first digit (which is never drawn itself). */
const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
export const EAN_TABLES = { L: EAN_L, G: EAN_G, R: EAN_R, parity: EAN_PARITY };

/**
 * An EAN-13's bars: 95 modules, '1' black and '0' white, quiet zones not included. What the
 * label on screen draws and what the billing app's receipt printer is sent.
 */
export function ean13Modules(code: string): string {
  if (!isEan13(code)) throw new Error('Not an EAN-13: ' + code);
  const d = code.split('').map(Number);
  const parity = EAN_PARITY[d[0]!]!;
  let out = '101';
  for (let i = 1; i <= 6; i++) out += (parity[i - 1] === 'L' ? EAN_L : EAN_G)[d[i]!]!;
  out += '01010';
  for (let i = 7; i <= 12; i++) out += EAN_R[d[i]!]!;
  return out + '101';
}
