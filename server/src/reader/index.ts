import fs from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import type { BillMirror, Ink, Item, Reading, StockMove } from '@stock/core';
import { env } from '../env';
import { post } from '../posting';
import type { InvRepo } from '../store/types';
import { catalogueText, costRupees, readWithClaude, type RawReading, type ReadResult } from './claude';
import { decide } from './decide';
import { inkHash, inkToPng } from './render';

/** Something that reads a line of ink. The real one is Claude; the tests use a fixture. */
export type ReadFn = (ink: Ink, ctx: { items: Item[]; qty: number; rate: number; examples: string }) => Promise<ReadResult>;

interface ReaderMeta {
  enabled: boolean;
  month: string;
  monthLines: number;
  monthCostRupees: number;
  capRupees: number;
  message: string;
  demo?: boolean;
}

/**
 * Which reader to use:
 * - READER_FAKE=<file>: a JSON map of ink hash -> reading, for the tests (no API calls, no cost);
 * - ANTHROPIC_API_KEY set: Claude;
 * - neither: none, and every handwritten line waits for a person.
 */
export function pickReader(): { fn: ReadFn | null; kind: 'fake' | 'claude' | 'none' } {
  if (env.readerFake) {
    const file = env.readerFake;
    return {
      kind: 'fake',
      // Read the file each time, so a test can change the answers while the server runs.
      fn: async (ink) => ({ reading: (JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, RawReading>)[inkHash(ink)] ?? null, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, refused: false }),
    };
  }
  if (env.anthropicKey) {
    const client = new Anthropic({ apiKey: env.anthropicKey, maxRetries: 2, timeout: 60_000 });
    let cache = { key: '', text: '' };
    return {
      kind: 'claude',
      fn: async (ink, ctx) => {
        // The catalogue text only changes when items do; keeping it byte-identical is what lets
        // the prompt cache work.
        const key = ctx.items.map((i) => i.id + i.updatedAt).join();
        if (cache.key !== key) cache = { key, text: catalogueText(ctx.items) };
        return readWithClaude(client, { png: inkToPng(ink).png, catalogue: cache.text, qty: ctx.qty, rate: ctx.rate, examples: ctx.examples });
      },
    };
  }
  return { kind: 'none', fn: null };
}

const thisMonth = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 7);

async function loadMeta(repo: InvRepo): Promise<{ doc: { id: string; reader?: ReaderMeta } & Record<string, unknown>; reader: ReaderMeta }> {
  const doc = ((await repo.getDoc('meta', 'status')) ?? { id: 'status' }) as { id: string; reader?: ReaderMeta } & Record<string, unknown>;
  const r = doc.reader;
  const reader: ReaderMeta =
    r && r.month === thisMonth()
      ? { ...r, capRupees: env.readerCapRupees }
      : { enabled: true, month: thisMonth(), monthLines: 0, monthCostRupees: 0, capRupees: env.readerCapRupees, message: '' };
  return { doc, reader };
}

/** The last confirmed readings, as examples of this shop's hand. Text only, no customer data. */
function examplesFrom(bills: BillMirror[], items: Map<string, Item>): string {
  return bills
    .flatMap((b) => b.lines)
    .filter((l) => l.state === 'confirmed' && l.reading?.readText && l.itemId)
    .slice(-20)
    .map((l) => '"' + l.reading!.readText + '" = ' + l.itemId + ' (' + (items.get(l.itemId!)?.nameEn ?? '') + ') ' + l.unit)
    .join('\n');
}

export interface ReadRun {
  read: number;
  auto: number;
  queued: number;
  skipped: 'no-reader' | 'cap' | null;
}

/**
 * Reads every handwritten line still waiting and not read yet. A sure reading that the price
 * agrees with moves stock by itself; anything else stays in To confirm with the reading and
 * alternatives filled in, so a person only has to tap.
 */
export async function readPending(repo: InvRepo, fn: ReadFn | null, maxLines = 30): Promise<ReadRun> {
  const run: ReadRun = { read: 0, auto: 0, queued: 0, skipped: null };
  const { doc, reader } = await loadMeta(repo);
  const save = async (message: string, enabled: boolean) => {
    await repo.putDoc('meta', { ...doc, reader: { ...reader, enabled, message } });
  };
  if (!fn) {
    run.skipped = 'no-reader';
    await save('No reader key set: handwritten lines wait for a person.', false);
    return run;
  }
  const [bills, itemList, locs] = await Promise.all([repo.listDocs<BillMirror>('bills'), repo.listItems(), repo.listLocations()]);
  const items = new Map(itemList.map((i) => [i.id, i]));
  const shop = locs.find((l) => l.kind === 'shop')!;
  const examples = examplesFrom(bills, items);
  const latestItemChange = itemList.reduce((m, i) => (i.updatedAt > m ? i.updatedAt : m), '');

  for (const bill of bills.filter((b) => !b.cancelled).sort((a, b) => a.no - b.no)) {
    let changed = false;
    for (const line of bill.lines) {
      if (run.read >= maxLines) break;
      if (line.state !== 'to-confirm' || !line.ink) continue;
      // Read once. A reading that found no item is tried again only when items have changed
      // since, because the item it needed may be there now.
      if (line.reading && (line.reading.itemId || line.reading.at >= latestItemChange)) continue;
      if (reader.monthCostRupees >= reader.capRupees) {
        run.skipped = 'cap';
        break;
      }
      let result: ReadResult;
      try {
        result = await fn(line.ink, { items: itemList, qty: line.qty, rate: line.rate, examples });
      } catch (err) {
        console.error('[reader] could not read bill ' + bill.no + ' line ' + (line.i + 1) + ':', (err as Error).message);
        continue; // it stays waiting and is tried again next time
      }
      run.read++;
      reader.monthLines++;
      reader.monthCostRupees = Math.round((reader.monthCostRupees + costRupees(result, env.rupeesPerDollar)) * 100) / 100;
      const raw = result.reading;
      const reading: Reading = {
        readText: raw?.readText ?? '',
        ...(raw?.itemId && items.has(raw.itemId) ? { itemId: raw.itemId } : {}),
        ...(raw?.unit ? { unit: raw.unit } : {}),
        ...(raw?.qty != null ? { qty: raw.qty } : {}),
        confidence: Math.max(0, Math.min(1, raw?.confidence ?? 0)),
        alternatives: (raw?.alternatives ?? []).filter((a) => items.has(a.itemId)).slice(0, 3),
        by: 'reader',
        at: new Date().toISOString(),
      };
      line.reading = reading;
      changed = true;
      const d = decide(reading, line, reading.itemId ? items.get(reading.itemId) : undefined);
      if (d.auto) {
        line.state = 'read-auto';
        line.itemId = d.itemId;
        line.unit = d.unit;
        line.baseQty = d.baseQty;
        const move: StockMove = { id: 'mv_read_' + bill.no + '_' + line.i, key: 'sale:' + bill.no + ':' + line.i, at: bill.at, kind: 'sale', itemId: d.itemId, from: shop.id, qty: d.baseQty, ref: 'bill ' + bill.no + ' line ' + (line.i + 1), by: 'reader' };
        await post(repo, [move]);
        run.auto++;
      } else {
        run.queued++;
      }
    }
    if (changed) await repo.putDoc('bills', bill);
    if (run.skipped) break;
  }
  await save(
    run.skipped === 'cap'
      ? 'Monthly limit reached: handwritten lines wait for a person until next month or a higher limit.'
      : run.read
        ? 'Read ' + run.read + ' lines: ' + run.auto + ' by themselves, ' + run.queued + ' to confirm.'
        : reader.message || 'Nothing new to read.',
    true,
  );
  return run;
}
