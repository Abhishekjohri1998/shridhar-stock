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
