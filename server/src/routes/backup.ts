import fs from 'node:fs';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { requireRole } from '../auth';
import { listSafetyBackups, makeBackup, safetyPath, saveSafetyBackup, validateBackup } from '../backup';
import { emit } from '../events';
import { handler, HttpError } from '../http';
import { getRepo } from '../store';

/**
 * Download a backup of everything, and restore one. Admin only.
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
