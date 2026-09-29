import Anthropic from '@anthropic-ai/sdk';
import type { Item } from '@stock/core';

export const READER_MODEL = 'claude-opus-5-5';

/** What the reader is told about the shop's items: names in both scripts, other names, units. */
export function catalogueText(items: Item[]): string {
  return items
    .filter((i) => i.active)
    .map((i) => {
      const names = [i.nameKn, i.nameEn, ...i.aliases.map((a) => a.text + (a.unit ? ' [' + a.unit + ']' : ''))].filter(Boolean).join(' | ');
      const units = i.units.map((u) => u.code + (u.perBase > 1 ? '=' + u.perBase + i.units[0]!.code : '') + ' ₹' + u.price).join(', ');
      return i.id + ' :: ' + names + ' :: ' + units;
    })
    .join('\n');
}

const SYSTEM = `You read one handwritten line from a bill at a Kannada kirana (grocery) shop in Karnataka.
The shopkeeper writes the item, often with its quantity and unit, in Kannada, English, or a mix,
in their own hand, with a stylus. The price was typed separately and is given to you as digits.

Transcribe exactly what is written, in the script it is written in, then decide which ONE item
from the shop's list it is. Choose only an id from the list, or null when no item fits.

Rules:
- confidence is how sure you are the item is right (0 to 1). Be honest: a guess is below 0.6.
- Use the typed quantity and price to decide between similar items and between units
  (a pack of 24 is not a piece).
- unit must be one of that item's unit codes. qty is the quantity in that unit.
- Up to 3 alternatives, most likely first, only real candidates.
- A line that is not a product (a charge, a note, a service) gets itemId null.

The shop's items, one per line as  id :: names | other names [unit] :: units with prices:`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['readText', 'itemId', 'unit', 'qty', 'confidence', 'alternatives'],
  properties: {
    readText: { type: 'string', description: 'Exactly what is written, in its own script' },
    itemId: { type: ['string', 'null'] },
    unit: { type: ['string', 'null'] },
    qty: { type: ['number', 'null'] },
    confidence: { type: 'number' },
    alternatives: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['itemId', 'confidence'],
        properties: { itemId: { type: 'string' }, confidence: { type: 'number' } },
      },
    },
  },
} as const;

export interface RawReading {
  readText: string;
  itemId: string | null;
  unit: string | null;
  qty: number | null;
  confidence: number;
  alternatives: { itemId: string; confidence: number }[];
}

export interface ReadResult {
  reading: RawReading | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  refused: boolean;
}

/**
 * One line, one request. The catalogue is the cached part of the prompt, so a busy day pays for
 * it once; only the image and two numbers change per line. Only the writing is sent: never the
 * customer, the bill number or its total.
 */
export async function readWithClaude(
  client: Anthropic,
  args: { png: Buffer; catalogue: string; qty: number; rate: number; examples: string },
): Promise<ReadResult> {
  const params = {
    model: READER_MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    system: [{ type: 'text', text: SYSTEM + '\n' + args.catalogue, cache_control: { type: 'ephemeral' } }],
    messages: [
      {
        role: 'user',
        content: [
          ...(args.examples ? [{ type: 'text', text: 'Lines this shop has written before, and what they were:\n' + args.examples }] : []),
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: args.png.toString('base64') } },
          { type: 'text', text: 'Typed beside it: quantity ' + args.qty + ', price ₹' + args.rate + '. Read the line.' },
        ],
      },
    ],
  };
  // fallbacks and output_config are newer than some SDK typings; the request shape is the API's.
  const res = (await client.beta.messages.create(params as unknown as Parameters<typeof client.beta.messages.create>[0])) as unknown as {
    stop_reason: string;
    content: { type: string; text?: string }[];
    usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  };
  const usage = {
    inputTokens: (res.usage.input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0),
    outputTokens: res.usage.output_tokens ?? 0,
    cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
  };
  if (res.stop_reason === 'refusal') return { reading: null, refused: true, ...usage };
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
  try {
    return { reading: JSON.parse(text) as RawReading, refused: false, ...usage };
  } catch {
    return { reading: null, refused: false, ...usage };
  }
}

/** Rupees, from Opus 5.5 prices ($4 in, $20 out, $0.20 cache reads per million) at the given rate. */
export function costRupees(r: Pick<ReadResult, 'inputTokens' | 'outputTokens' | 'cacheReadTokens'>, rupeesPerDollar: number): number {
  const usd = (r.inputTokens * 4 + r.outputTokens * 20 + r.cacheReadTokens * 0.2) / 1_000_000;
  return Math.round(usd * rupeesPerDollar * 100) / 100;
}
