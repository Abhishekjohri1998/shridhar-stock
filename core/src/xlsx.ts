/**
 * A real Excel file (.xlsx), with no packages: the smallest workbook Excel, LibreOffice and
 * Google Sheets all open.
 *
 * An .xlsx is a ZIP of a few XML files. The entries are stored, not compressed, which only
 * needs a CRC32 of each; a stock list is small, so the size does not matter.
 *
 * - Text is an inline string, numbers are numbers, so a quantity can be summed straight away.
 * - Kannada goes in as UTF-8 and opens as Kannada; there is no CSV encoding guesswork.
 * - Text that starts with = + - @ gets a leading apostrophe, the same guard as the CSV files.
 *   Inline strings are never run as formulas anyway; the guard keeps the two files identical.
 */

import type { Cell } from './csv';

export interface Sheet {
  name: string;
  header: string[];
  rows: Cell[][];
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** The ZIP checksum (IEEE CRC-32). "123456789" gives cbf43926. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control characters other than tab and newline are not allowed in XML at all.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/** "A", "B", ... "Z", "AA": the column letters Excel uses in a cell reference. */
function col(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function cellXml(v: Cell, ref: string): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return Number.isFinite(v) ? '<c r="' + ref + '"><v>' + v + '</v></c>' : '';
  let s = typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(s) + '</t></is></c>';
}

function sheetXml(s: Sheet): string {
  const rows = [s.header as Cell[], ...s.rows].map(
    (r, ri) => '<row r="' + (ri + 1) + '">' + r.map((v, ci) => cellXml(v, col(ci) + (ri + 1))).join('') + '</row>',
  );
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
    rows.join('') +
    '</sheetData></worksheet>'
  );
}

/** Excel refuses a sheet name over 31 characters or with any of : \ / ? * [ ]. */
function sheetName(name: string, i: number): string {
  const s = name.replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31);
  return s || 'Sheet' + (i + 1);
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // local file header
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // names are UTF-8
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, 0, true); // time
    local.setUint16(12, 0x21, true); // date: 1980-01-01
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); // central directory header
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, 0, true);
    cen.setUint16(14, 0x21, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, f.data.length, true);
    cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const cenSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); // end of central directory
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cenSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A workbook with one sheet per entry, the first row of each its headers. */
export function toXlsx(sheets: Sheet[]): Uint8Array {
  const enc = new TextEncoder();
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const files = [
    {
      name: '[Content_Types].xml',
      xml:
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        sheets.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      xml:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="' + R + '/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      xml:
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="' + R + '"><sheets>' +
        sheets.map((s, i) => '<sheet name="' + xmlEscape(sheetName(s.name, i)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') +
        '</sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      xml:
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="' + R + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
        '</Relationships>',
    },
  ].map((f) => ({ name: f.name, data: enc.encode(head + f.xml) }));
  sheets.forEach((s, i) => files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: enc.encode(sheetXml(s)) }));
  return zip(files);
}
