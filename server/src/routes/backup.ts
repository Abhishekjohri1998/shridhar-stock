import fs from 'node:fs';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireRole } from '../auth';
import { ERASE_CURSOR_ID, ERASE_MODES, erasedData, listSafetyBackups, makeBackup, safetyPath, saveSafetyBackup, validateBackup, type EraseCursor } from '../backup';
import { billingNewestNo, withLinkPaused } from '../billing/link';
import { verifyPin } from '../pin';
import { lockedFor, recordFailure, recordSuccess } from '../ratelimit';
import { emit } from '../events';
import { handler, HttpError } from '../http';
import { getRepo } from '../store';

/**
 * Download a backup of everything, restore one, and erase. Admin only.
 *
 * A backup can be far bigger than the usual 3 MB request limit (the bills mirror carries
 * handwriting), so the restore address alone gets a large limit, mounted in index.ts before the
 * general JSON parser, after the admin check, so nobody else can make the server read a big body.
 */
export const backupRoutes = Router();

const admin = requireRole('admin');

export const RESTORE_PATH = '/api/admin/restore';
export const RESTORE_LIMIT = '300mb';

/** The admin check, then the large body parser, then plain words for a file that is not JSON. */
export const restoreBody = [
  admin,
  express.json({ limit: RESTORE_LIMIT }),
  (err: { type?: string } | undefined, _req: Request, _res: Response, next: NextFunction) => {
    if (err?.type === 'entity.parse.failed') return next(new HttpError(400, 'This backup file cannot be restored: it is damaged (not readable JSON). Nothing was changed.'));
    if (err?.type === 'entity.too.large') return next(new HttpError(413, 'This backup file is too big to restore (over ' + RESTORE_LIMIT + '). Nothing was changed.'));
    next(err);
  },
];

const stamp = (iso: string) => iso.slice(0, 16).replace('T', '-').replace(':', '');

backupRoutes.get(
  '/admin/backup',
  admin,
  handler(async (_req, res) => {
    const b = await makeBackup(getRepo());
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="stock-backup-' + stamp(b.exportedAt) + '.json"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(JSON.stringify(b));
  }),
);

let restoring = false;

backupRoutes.post(
  '/admin/restore',
  admin,
  handler(async (req, res) => {
    const body = (req.body ?? {}) as { confirm?: unknown; backup?: unknown };
    if (body.confirm !== 'RESTORE') throw new HttpError(400, 'Type RESTORE to confirm. Nothing was changed.');
    const data = validateBackup(body.backup);
    if (restoring) throw new HttpError(409, 'A restore is already running. Wait for it to finish.');
    restoring = true;
    try {
      const repo = getRepo();
      // What is there now, saved on the server first: if this fails, nothing is replaced.
      const safety = await saveSafetyBackup(await makeBackup(repo));
      await repo.restoreAll(data);
      for (const kind of ['items', 'stock', 'bills', 'transfers', 'pos', 'delivery', 'low'] as const) emit(kind);
      res.json({ ok: true, safety, counts: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])) });
    } finally {
      restoring = false;
    }
  }),
);

backupRoutes.get(
  '/admin/backups',
  admin,
  handler(async (_req, res) => {
    res.json(await listSafetyBackups());
  }),
);

backupRoutes.get(
  '/admin/backups/:name',
  admin,
  handler(async (req, res) => {
    const file = safetyPath(String(req.params.name));
    if (!file || !fs.existsSync(file)) throw new HttpError(404, 'No such backup');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="' + req.params.name + '"');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(res);
  }),
);

/**
 * Setup → Settings → "Erasing everything": empties the shop's stock data in one of two ways
 * (ERASE_KEEPS in backup.ts says exactly what each keeps). Admin only, with the admin's own PIN
 * and ERASE typed. What is there now is always saved on the server first, and the erase is the
 * same one-swap write as a restore, so a failure part way leaves everything as it was.
 *
 * The billing link is held still meanwhile, and the bills made before the erase are never read
 * again (meta.eraseCursor): their sales belong to the stock that was erased.
 */
const eraseBody = z.object({ mode: z.enum(ERASE_MODES), pin: z.string().max(12), confirm: z.string().max(20) });

backupRoutes.post(
  '/admin/erase',
  admin,
  handler(async (req, res) => {
    const parsed = eraseBody.safeParse(req.body ?? {});
    if (!parsed.success) throw new HttpError(400, 'Choose what to erase, enter your PIN and type ERASE. Nothing was changed.');
    const { mode, pin, confirm } = parsed.data;
    if (confirm.trim() !== 'ERASE') throw new HttpError(400, 'Type ERASE to confirm. Nothing was changed.');
    // The admin signed in, not a worker they are working as: it is their PIN that is asked for.
    const me = req.person!;
    const ip = req.ip ?? '';
    const key = 'erase:' + me.id;
    const wait = lockedFor(ip, key);
    if (wait > 0) throw new HttpError(429, 'Too many wrong PINs. Try again in ' + Math.ceil(wait / 60000) + ' minutes. Nothing was changed.');
    if (!verifyPin(pin, me.pinHash)) {
      recordFailure(ip, key);
      throw new HttpError(400, 'That is not your PIN. Nothing was changed.');
    }
    recordSuccess(ip, key);
    if (restoring) throw new HttpError(409, 'A restore or erase is already running. Wait for it to finish.');
    restoring = true;
    try {
      const out = await withLinkPaused(async () => {
        const repo = getRepo();
        const before = await makeBackup(repo);
        // What is there now, saved on the server first: if this fails, nothing is erased.
        const safety = await saveSafetyBackup(before);
        const mirrored = before.collections.bills.reduce((m, b) => Math.max(m, Number(b.no) || 0), 0);
        const cursor: EraseCursor = {
          id: ERASE_CURSOR_ID,
          billNo: Math.max(mirrored, await billingNewestNo()),
          at: new Date().toISOString(),
          mode,
          by: me.id,
        };
        const next = erasedData(before.collections, mode, cursor);
        await repo.restoreAll(next);
        return { safety, cursor, counts: Object.fromEntries(Object.entries(next).map(([k, v]) => [k, v.length])) };
      });
      for (const kind of ['items', 'stock', 'bills', 'transfers', 'pos', 'delivery', 'low'] as const) emit(kind);
      res.json({ ok: true, mode, safety: out.safety, download: '/admin/backups/' + out.safety, billsFrom: out.cursor.billNo + 1, counts: out.counts });
    } finally {
      restoring = false;
    }
  }),
);
