import zlib from 'node:zlib';
import type { RequestHandler, Response } from 'express';

/** Worth compressing: text, JSON, scripts, SVG. Images, fonts and zips are compressed already. */
const COMPRESSIBLE = /^(text\/(?!event-stream)|application\/(json|javascript|xml|manifest\+json)|image\/svg\+xml)/i;
/** Below this a gzip header costs more than it saves. Only known when the whole body comes at once. */
const MIN_BYTES = 1024;

type Chunk = string | Buffer | Uint8Array;
const toBuf = (c: Chunk, enc?: BufferEncoding) => (typeof c === 'string' ? Buffer.from(c, enc) : Buffer.from(c));

/**
 * Gzip for answers and the website, from Node's own zlib: no package. The live stream is never
 * touched (it must reach the screen event by event; Caddy passes it straight on), nor anything
 * already encoded, nor a type that is compressed already.
 */
export function gzip(): RequestHandler {
  return (req, res, next) => {
    const accepts = /\bgzip\b/i.test(String(req.headers['accept-encoding'] ?? ''));
    if (req.method === 'HEAD' || !accepts || req.path === '/api/events') return next();
    appendVary(res);

    const write = res.write.bind(res) as (c: Chunk, enc?: BufferEncoding) => boolean;
    const writeRaw = res.write.bind(res) as (c: Chunk, enc?: BufferEncoding, cb?: () => void) => boolean;
    const end = res.end.bind(res) as (c?: Chunk, enc?: BufferEncoding) => Response;
    let decided = false;
    let gz: zlib.Gzip | null = null;

    const decide = (first: Chunk | undefined, enc: BufferEncoding | undefined, ending: boolean) => {
      if (decided) return;
      decided = true;
      if (res.headersSent) return;
      const type = String(res.getHeader('Content-Type') ?? '');
      if (res.getHeader('Content-Encoding') || res.statusCode < 200 || res.statusCode === 204 || res.statusCode === 304 || !COMPRESSIBLE.test(type)) return;
      const len = Number(res.getHeader('Content-Length')) || (ending ? (first ? toBuf(first, enc).length : 0) : NaN);
      if (len < MIN_BYTES) return;
      res.setHeader('Content-Encoding', 'gzip');
      res.removeHeader('Content-Length');
      gz = zlib.createGzip();
      gz.on('data', (c: Buffer) => write(c));
      gz.on('end', () => end());
    };

    res.write = ((chunk: Chunk, a?: unknown, b?: unknown) => {
      const enc = typeof a === 'string' ? (a as BufferEncoding) : undefined;
      const cb = (typeof a === 'function' ? a : b) as (() => void) | undefined;
      decide(chunk, enc, false);
      if (!gz) return writeRaw(chunk, enc, cb);
      gz.write(toBuf(chunk, enc), () => cb?.());
      // Always ready for more: the body is held in zlib, so a piping file never waits on a drain
      // that would never come.
      return true;
    }) as Response['write'];

    res.end = ((chunk?: unknown, a?: unknown, b?: unknown) => {
      if (typeof chunk === 'function') return (res.end as (c: undefined, e: undefined, cb: () => void) => Response)(undefined, undefined, chunk as () => void);
      const enc = typeof a === 'string' ? (a as BufferEncoding) : undefined;
      const cb = (typeof a === 'function' ? a : b) as (() => void) | undefined;
      const body = chunk == null ? undefined : (chunk as Chunk);
      decide(body, enc, true);
      if (!gz) {
        if (cb) res.once('finish', cb);
        return end(body, enc);
      }
      if (cb) res.once('finish', cb);
      if (body != null) gz.end(toBuf(body, enc));
      else gz.end();
      return res;
    }) as Response['end'];

    next();
  };
}

function appendVary(res: Response): void {
  const cur = String(res.getHeader('Vary') ?? '');
  if (!/accept-encoding/i.test(cur)) res.setHeader('Vary', cur ? cur + ', Accept-Encoding' : 'Accept-Encoding');
}
