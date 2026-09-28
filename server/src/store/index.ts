import path from 'node:path';
import { env } from '../env';
import { createFileRepo } from './file';
import { createMongoRepo } from './mongo';
import type { InvRepo } from './types';

let repo: InvRepo | null = null;

export async function initRepo(): Promise<InvRepo> {
  if (repo) return repo;
  repo = env.mongoUri
    ? await createMongoRepo(env.mongoUri, env.mongoDb)
    : await createFileRepo(env.dataDir || path.join(__dirname, '..', '..', '.data'));
  console.log('[store] using ' + (repo.kind === 'mongo' ? 'MongoDB database "' + env.mongoDb + '"' : 'the local JSON file'));
  return repo;
}

export function getRepo(): InvRepo {
  if (!repo) throw new Error('Storage is not ready yet');
  return repo;
}

export type { InvRepo };
