import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { inkBounds, type Ink } from '@stock/core';

/**
 * Pen strokes drawn as a black-on-white PNG, for the handwriting reader to look at.
 *
 * Cropped to the writing, scaled to a fixed height, with a pen thick enough to read at that size.
 * Written with zlib only: a grey image is a few lines of PNG, no image library needed.
 */
export function inkToPng(ink: Ink, height = 96): { png: Buffer; width: number; height: number } {
  const b = inkBounds(ink);
  const pad = 10;
  const srcH = Math.max(1, b.maxY - b.minY);
  const srcW = Math.max(1, b.maxX - b.minX);
  const scale = (height - pad * 2) / srcH;
  const width = Math.min(2400, Math.max(32, Math.round(srcW * scale + pad * 2)));
  const px = new Uint8Array(width * height).fill(255);
  const r = Math.max(1.4, height / 44);

  const dot = (cx: number, cy: number) => {
    const x0 = Math.floor(cx - r);
    const x1 = Math.ceil(cx + r);
    const y0 = Math.floor(cy - r);
    const y1 = Math.ceil(cy + r);
    for (let y = Math.max(0, y0); y <= Math.min(height - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(width - 1, x1); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) px[y * width + x] = 0;
      }
    }
  };
  const map = (x: number, y: number): [number, number] => [(x - b.minX) * scale + pad, (y - b.minY) * scale + pad];

  for (const s of ink.strokes) {
    if (s.length < 2) continue;
    let [px0, py0] = map(s[0]!, s[1]!);
    dot(px0, py0);
    for (let i = 2; i + 1 < s.length; i += 2) {
      const [x1, y1] = map(s[i]!, s[i + 1]!);
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - px0, y1 - py0) / (r * 0.6)));
      for (let k = 1; k <= steps; k++) dot(px0 + ((x1 - px0) * k) / steps, py0 + ((y1 - py0) * k) / steps);
      px0 = x1;
      py0 = y1;
    }
  }

  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0;
    raw.set(px.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { png, width, height };
}

/** The same writing always has the same hash, so it is never read (or paid for) twice. */
export function inkHash(ink: Ink): string {
  return crypto.createHash('sha256').update(JSON.stringify(ink.strokes)).digest('hex').slice(0, 24);
}
