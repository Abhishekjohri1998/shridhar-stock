/*
 * Draws the Shridhar Stock icons: three crates stacked, on marigold, so it can never be mistaken
 * for the billing app's green icon sitting next to it on the tablet.
 *
 * Plain Node (zlib for the PNG), no image library. Run once; the PNGs are committed.
 *   node scripts/make-icons.js
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const GOLD = [0xa8, 0x72, 0x1a, 255]; // --gold-600
const PAPER = [0xff, 0xfe, 0xfb, 255]; // --paper-1
const LINE = [0xe4, 0xde, 0xd2, 255]; // --line
const CLEAR = [0, 0, 0, 0];

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const p = pixel(x, y);
      raw.set(p, y * (size * 4 + 1) + 1 + x * 4);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Three crates, in a unit square: two below, one on top. Returns a colour or null. */
function crates(u, v) {
  const boxes = [
    [0.08, 0.52, 0.46, 0.92],
    [0.54, 0.52, 0.92, 0.92],
    [0.31, 0.1, 0.69, 0.5],
  ];
  for (const [x0, y0, x1, y1] of boxes) {
    if (u >= x0 && u <= x1 && v >= y0 && v <= y1) {
      const w = x1 - x0;
      const band = Math.abs(v - (y0 + (y1 - y0) * 0.3)) < 0.018; // the lid line
      const slat = Math.abs(u - (x0 + w / 2)) < 0.016 && v > y0 + (y1 - y0) * 0.3; // the label strip
      const edge = u - x0 < 0.02 || x1 - u < 0.02 || v - y0 < 0.02 || y1 - v < 0.02;
      return band || slat || edge ? LINE : PAPER;
    }
  }
  return null;
}

/** A rounded-square mask, for the plain icon. */
function inRounded(u, v, r) {
  const dx = Math.max(r - u, 0, u - (1 - r));
  const dy = Math.max(r - v, 0, v - (1 - r));
  return dx * dx + dy * dy <= r * r;
}

function draw(size, { background, glyphScale, rounded }) {
  return png(size, (x, y) => {
    const u = (x + 0.5) / size;
    const v = (y + 0.5) / size;
    const pad = (1 - glyphScale) / 2;
    const g = crates((u - pad) / glyphScale, (v - pad) / glyphScale);
    if (g) return g;
    if (!background) return CLEAR;
    if (rounded && !inRounded(u, v, 0.18)) return CLEAR;
    return GOLD;
  });
}

const root = path.join(__dirname, '..');
const out = (p, buf) => {
  fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
  fs.writeFileSync(path.join(root, p), buf);
  console.log(p, buf.length, 'bytes');
};

out('app/assets/icon.png', draw(1024, { background: true, glyphScale: 0.62, rounded: false }));
// Android's adaptive icon crops to the middle two thirds, so the crates sit well inside it.
out('app/assets/adaptive-icon.png', draw(1024, { background: false, glyphScale: 0.46, rounded: false }));
out('app/assets/splash-icon.png', draw(512, { background: true, glyphScale: 0.62, rounded: true }));
out('web/public/favicon-32.png', draw(32, { background: true, glyphScale: 0.7, rounded: true }));
out('web/public/apple-touch-icon.png', draw(180, { background: true, glyphScale: 0.62, rounded: false }));
