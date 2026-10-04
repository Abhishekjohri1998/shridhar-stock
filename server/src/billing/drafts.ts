import type { Ink } from '@stock/core';
import { emit } from '../events';

/**
 * Bills still being written at the counter, as billing sends them every few seconds.
 *
 * Kept in memory only: a draft lives minutes, and a restart costs nothing but a moment until
 * billing sends it again. A draft not heard of for ten minutes, or sent closed, is dropped; one
 * that is saved becomes the bill's mirror at the next sync (see sync.ts), with its ticks.
 */
export const DRAFT_TTL_MS = 10 * 60_000;

export interface DraftLine {
  /** Billing's id for the line: ticks follow it through edits. */
  key: string;
  nameEn: string;
  nameKn: string;
  qty: number;
  unit?: string;
  rate: number;
  stockItemId?: string;
  /** The line is handwritten at the counter: there is no typed name to show. */
  ink?: boolean | Ink;
  /** Billing's given tick and when it last changed there. */
  given?: boolean;
  givenAt?: number;
  /** Stock's fetched tick, the result of both sides (the later change wins), and when. */
  fetched: boolean;
  at: number;
}

export interface Draft {
  draftId: string;
  customerName: string;
  updatedAt: number;
  lines: DraftLine[];
}

export type DraftInput = Omit<Draft, 'updatedAt' | 'lines'> & { closed?: boolean; lines: Omit<DraftLine, 'fetched' | 'at'>[] };

const drafts = new Map<string, Draft>();

/** Drops drafts gone quiet. True when any went, so the worker screens can be told. */
function prune(now = Date.now()): boolean {
  let gone = false;
  for (const [id, d] of drafts) {
    if (now - d.updatedAt > DRAFT_TTL_MS) {
      drafts.delete(id);
      gone = true;
    }
  }
  return gone;
}

setInterval(() => prune() && emit('bills'), 60_000).unref();

export type Ticks = Record<string, { fetched: boolean; at: number }>;

function ticksOf(d: Draft | undefined): Ticks {
  const out: Ticks = {};
  for (const l of d?.lines ?? []) out[l.key] = { fetched: l.fetched, at: l.at };
  return out;
}

/**
 * Takes in what billing sent. Per line, the later change wins: billing's given (givenAt) against
 * a worker's tick here (at). Answers stock's ticks, so billing can turn its given on.
 */
export function putDraft(input: DraftInput, now = Date.now()): Ticks {
  prune(now);
  const before = drafts.get(input.draftId);
  if (input.closed) {
    drafts.delete(input.draftId);
    emit('bills');
    return ticksOf(before);
  }
  const old = new Map((before?.lines ?? []).map((l) => [l.key, l]));
  const lines: DraftLine[] = input.lines.map((l) => {
    const prev = old.get(l.key);
    const givenAt = l.givenAt ?? 0;
    if (!prev) return { ...l, fetched: !!l.given, at: l.given ? givenAt || now : 0 };
    if (givenAt > prev.at) return { ...l, fetched: !!l.given, at: givenAt };
    return { ...l, fetched: prev.fetched, at: prev.at };
  });
  const d: Draft = { draftId: input.draftId, customerName: input.customerName ?? '', updatedAt: now, lines };
  drafts.set(d.draftId, d);
  emit('bills');
  return ticksOf(d);
}

export function listDrafts(now = Date.now()): Draft[] {
  prune(now);
  return [...drafts.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A worker's tick on a draft line (index, as the screen lists them), or on all of them. */
export function tickDraft(draftId: string, i: number | null, fetched: boolean, now = Date.now()): boolean {
  const d = drafts.get(draftId);
  if (!d) return false;
  const lines = i == null ? d.lines : d.lines.filter((_l, n) => n === i);
  if (!lines.length) return false;
  for (const l of lines) {
    l.fetched = fetched;
    l.at = now;
  }
  emit('bills');
  return true;
}

/** The draft a saved bill came from, removed: the bill's mirror takes its place and its ticks. */
export function takeDraft(draftId: string): Draft | undefined {
  const d = drafts.get(draftId);
  drafts.delete(draftId);
  return d;
}
