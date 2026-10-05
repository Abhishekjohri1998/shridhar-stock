/** Words in both languages. */
export interface Bi {
  en: string;
  kn: string;
}

/**
 * One step of a guided tour. `target` is a `data-tour="…"` name on the screen; with no target,
 * or when that part is not shown right now, the card sits in the middle.
 *
 * Every step says three things: what it is, what it does, and what happens if you tap it.
 */
export interface TourStep {
  target?: string;
  title: Bi;
  what: Bi;
  does: Bi;
  tap: Bi;
}

export interface TourDef {
  id: string;
  title: Bi;
  steps: TourStep[];
}

type Pair = [en: string, kn: string];
const bi = ([en, kn]: Pair): Bi => ({ en, kn });

/** A step, written short: target, then title, what it is, what it does, what a tap does. */
export function step(target: string | undefined, title: Pair, what: Pair, does: Pair, tap: Pair): TourStep {
  return { ...(target ? { target } : {}), title: bi(title), what: bi(what), does: bi(does), tap: bi(tap) };
}

export function tour(id: string, title: Pair, steps: TourStep[]): TourDef {
  return { id, title: bi(title), steps };
}
