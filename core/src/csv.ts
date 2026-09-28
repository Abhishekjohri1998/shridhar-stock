/**
 * CSV the way Excel on an ordinary shop PC opens it.
 *
 * - A byte-order mark first, or Excel reads the UTF-8 as Latin-1 and Kannada turns to mojibake.
 * - CRLF line ends and RFC 4180 quoting.
 * - Text that starts with = + - @ gets a leading apostrophe, so a name someone typed as
 *   "=HYPERLINK(...)" is shown as text instead of run as a formula. Numbers are never touched,
 *   which is why cells are passed as numbers where they are numbers: -5 stays -5.
 */

export const BOM = '﻿';

export type Cell = string | number | boolean | null | undefined;

export function csvCell(v: Cell): string {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return BOM + lines.join('\r\n') + '\r\n';
}

/** Parses CSV text into rows of strings. Handles quotes, doubled quotes, CRLF and a BOM. */
export function parseCsv(text: string): string[][] {
  const s = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Blank lines (all cells empty) are dropped; spreadsheets leave plenty of them.
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** Undoes the formula guard on the way back in, so a round trip gives back what went out. */
export function unguard(s: string): string {
  return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}
