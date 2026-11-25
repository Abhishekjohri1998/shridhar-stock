import { useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { defaultUnitOf, describeQty, pickName, quickPriceInput, toBase, type Item, type Location, type StockLevel } from '@stock/core';
import { api, ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { Select } from '../../components/Select';
import { useBi } from '../../components/ui';

export type QuickMode = 'price' | 'stock';

type Note = { kind: 'busy' | 'ok' | 'err'; text: string };

/**
 * Inventory's quick edit: one row per item, the name pinned on the left while the boxes scroll
 * sideways under it.
 *
 * - Prices: one box per unit of the item, under its code. Leaving the box (or Enter) saves that
 *   unit's price through the same save as the item editor (PUT /items/:id, checked the same way);
 *   a base slab the unit's price made follows it, its From untouched (withUnitPrice).
 * - Stock: one cell per place with the count there, a box, a unit and one dropdown (STOCK_ACTIONS):
 *   Add puts that much in on top of what the ledger holds (reason Stock added); Set count saves the
 *   box as the count (reason Counted); Damaged, Expired and Remove take that much out with that
 *   reason. All go through the ledger, never by writing the total.
 */
export function QuickEdit({ mode, items, locs, stock, onChanged }: { mode: QuickMode; items: Item[]; locs: Location[]; stock: StockLevel[]; onChanged: () => void }) {
  const { lang } = useSession();
  const bi = useBi();
  // The newest copy of each item: a save's answer can arrive before the list is read again.
  const latest = useRef(new Map<string, Item>());
  for (const i of items) {
    const had = latest.current.get(i.id);
    if (!had || i.updatedAt >= had.updatedAt) latest.current.set(i.id, i);
  }
  const cur = (i: Item) => latest.current.get(i.id) ?? i;
  // One save at a time per item, so two prices typed quickly never overwrite each other.
  const queue = useRef(new Map<string, Promise<unknown>>());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const [units, setUnits] = useState<Record<string, string>>({});
  const setDraft = (k: string, v: string | null) =>
    setDrafts((d) => {
      const next = { ...d };
      if (v == null) delete next[k];
      else next[k] = v;
      return next;
    });
  const note = (k: string, n: Note | null) =>
    setNotes((all) => {
      const next = { ...all };
      if (n == null) delete next[k];
      else next[k] = n;
      return next;
    });
  const run = (itemId: string, job: () => Promise<unknown>) => {
    const p = (queue.current.get(itemId) ?? Promise.resolve()).then(job, job);
    queue.current.set(itemId, p.catch(() => undefined));
    return p;
  };

  const savePrice = (item: Item, code: string) => {
    const k = item.id + ':' + code;
    const text = drafts[k];
    if (text == null) return;
    const n = Number(text.trim());
    if (text.trim() === '' || !Number.isFinite(n) || n < 0) {
      note(k, { kind: 'err', text: bi('Type a price', 'ಬೆಲೆ ಬರೆಯಿರಿ') });
      return;
    }
    const unit = cur(item).units.find((u) => u.code === code);
    if (unit && unit.price === n) {
      setDraft(k, null);
      note(k, null);
      return;
    }
    note(k, { kind: 'busy', text: bi('Saving…', 'ಉಳಿಸಲಾಗುತ್ತಿದೆ…') });
    void run(item.id, async () => {
      try {
        const now = cur(item);
        const idx = now.units.findIndex((u) => u.code === code);
        if (idx < 0) throw new Error(bi('This unit is no longer on the item', 'ಈ ಘಟಕ ಈಗ ಸಾಮಾನಿನಲ್ಲಿ ಇಲ್ಲ'));
        const saved = await api.saveItem(item.id, quickPriceInput(now, idx, text));
        latest.current.set(saved.id, saved);
        setDraft(k, null);
        note(k, { kind: 'ok', text: bi('Saved', 'ಉಳಿಸಲಾಗಿದೆ') });
      } catch (e) {
        note(k, { kind: 'err', text: e instanceof Error ? e.message : String(e) });
      }
    });
  };

  /** What the stock box does, picked from the dropdown: the last one used is where the next cell starts. */
  const [actions, setActions] = useState<Record<string, StockAction>>({});
  const [lastAction, setLastAction] = useState<StockAction>('add');
  const actionOf = (k: string): StockAction => actions[k] ?? lastAction;

  const saveStock = (item: Item, loc: Location, how: StockAction) => {
    const k = item.id + '@' + loc.id;
    const text = (drafts[k] ?? '').trim();
    const n = Number(text);
    const removing = how === 'damaged' || how === 'expired' || how === 'other';
    if (text === '' || !Number.isFinite(n) || n < 0 || (how !== 'counted' && n === 0)) {
      note(k, {
        kind: 'err',
        text: how === 'add' ? bi('Type how many to add', 'ಎಷ್ಟು ಸೇರಿಸಬೇಕು ಎಂದು ಬರೆಯಿರಿ')
          : removing ? bi('Type how many to take out', 'ಎಷ್ಟು ತೆಗೆಯಬೇಕು ಎಂದು ಬರೆಯಿರಿ')
          : bi('Type the count', 'ಎಣಿಕೆ ಬರೆಯಿರಿ'),
      });
      return;
    }
    const code = unitOf(item, units[k]);
    const qty = toBase(item, code, n);
    const hasRow = stock.some((s) => s.itemId === item.id && s.locationId === loc.id);
    if (removing && !hasRow) {
      note(k, { kind: 'err', text: bi('Nothing is counted here yet to take out', 'ಇಲ್ಲಿ ತೆಗೆಯಲು ಇನ್ನೂ ಸ್ಟಾಕ್ ಎಣಿಸಿಲ್ಲ') });
      return;
    }
    setLastAction(how);
    note(k, { kind: 'busy', text: bi('Saving…', 'ಉಳಿಸಲಾಗುತ್ತಿದೆ…') });
    void run(item.id, async () => {
      try {
        let done = false;
        // Nothing counted here yet: the first count (or Add) is the opening stock, as on the item's page.
        if (!hasRow) {
          try {
            await api.openStock(item.id, loc.id, qty);
            done = true;
          } catch (e) {
            if (!(e instanceof ApiError && e.status === 409)) throw e;
          }
        }
        if (!done) {
          const requestId = crypto.randomUUID();
          const base = { itemId: item.id, locationId: loc.id, requestId };
          await api.adjust(
            how === 'add' ? { ...base, add: qty, reason: 'added' }
              : how === 'counted' ? { ...base, actual: qty, reason: 'counted' }
              : { ...base, remove: qty, reason: how },
          );
        }
        setDraft(k, null);
        note(k, {
          kind: 'ok',
          text: how === 'add' ? '+' + describeQty(item, qty, lang)
            : removing ? '−' + describeQty(item, qty, lang) + ' · ' + (how === 'damaged' ? bi('Damaged', 'ಹಾಳಾಗಿದೆ') : how === 'expired' ? bi('Expired', 'ಅವಧಿ ಮುಗಿದಿದೆ') : bi('Removed', 'ತೆಗೆಯಲಾಗಿದೆ'))
            : bi('Count saved', 'ಎಣಿಕೆ ಉಳಿಸಲಾಗಿದೆ'),
        });
        onChanged();
      } catch (e) {
        note(k, { kind: 'err', text: e instanceof Error ? e.message : String(e) });
      }
    });
  };

  const nameCell = (i: Item) => (
    <td className="qe-name">
      <Link to={'/admin/inventory/' + i.id}>{pickName(i.nameEn, i.nameKn, lang)}</Link>
      {(lang === 'kn' ? i.nameEn : i.nameKn) && <div className="muted qe-other">{lang === 'kn' ? i.nameEn : i.nameKn}</div>}
    </td>
  );
  const noteLine = (k: string) => {
    const n = notes[k];
    return n ? <div className={'qe-note ' + n.kind}>{n.text}</div> : null;
  };

  if (!items.length) return <div className="card">{bi('No items here.', 'ಇಲ್ಲಿ ಸಾಮಾನು ಇಲ್ಲ.')}</div>;

  if (mode === 'price') {
    const cols = Math.max(1, ...items.map((i) => cur(i).units.length));
    return (
      <div className="qe-wrap" data-tour="inventory-quick">
        <table className="qe-table">
          <thead>
            <tr>
              <th className="qe-name">{bi('Item', 'ಸಾಮಾನು')}</th>
              <th colSpan={cols}>{bi('Price of one, each unit (₹)', 'ಪ್ರತಿ ಘಟಕದ ಒಂದರ ಬೆಲೆ (₹)')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item0) => {
              const item = cur(item0);
              return (
                <tr key={item.id}>
                  {nameCell(item)}
                  {item.units.map((u, idx) => {
                    const k = item.id + ':' + u.code;
                    const label = (lang === 'kn' && u.labelKn) || u.code;
                    return (
                      <td key={u.code} className="qe-cell">
                        <label>
                          <span className="qe-unit" title={idx > 0 ? '1 ' + u.code + ' = ' + u.perBase + ' ' + item.units[0]!.code : undefined}>
                            {label}
                          </span>
                          <input
                            className={'qe-box' + (notes[k]?.kind === 'err' ? ' bad' : '')}
                            inputMode="decimal"
                            enterKeyHint="done"
                            aria-label={pickName(item.nameEn, item.nameKn, lang) + ' · ' + label + ' · ' + bi('price', 'ಬೆಲೆ')}
                            value={drafts[k] ?? String(u.price)}
                            onChange={(e) => {
                              setDraft(k, e.target.value);
                              if (notes[k]?.kind !== 'busy') note(k, null);
                            }}
                            onBlur={() => savePrice(item, u.code)}
                            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                              // keyCode 13: some Android WebView keyboards send key "Unidentified" for Enter.
                              if (e.key === 'Enter' || e.keyCode === 13) {
                                e.preventDefault();
                                e.currentTarget.blur();
                              } else if (e.key === 'Escape') {
                                setDraft(k, null);
                                note(k, null);
                              }
                            }}
                          />
                        </label>
                        {noteLine(k)}
                      </td>
                    );
                  })}
                  {item.units.length < cols && <td colSpan={cols - item.units.length} />}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  const qtyAt = (itemId: string, locId: string) => stock.find((s) => s.itemId === itemId && s.locationId === locId)?.qty ?? 0;
  return (
    <div className="qe-wrap" data-tour="inventory-quick">
      <table className="qe-table">
        <thead>
          <tr>
            <th className="qe-name">{bi('Item', 'ಸಾಮಾನು')}</th>
            {locs.map((l) => (
              <th key={l.id}>{pickName(l.name, l.nameKn, lang)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item0) => {
            const item = cur(item0);
            return (
              <tr key={item.id}>
                {nameCell(item)}
                {locs.map((l) => {
                  const k = item.id + '@' + l.id;
                  const here = qtyAt(item.id, l.id);
                  const code = unitOf(item, units[k]);
                  const text = (drafts[k] ?? '').trim();
                  const n = Number(text);
                  const ok = text !== '' && Number.isFinite(n) && n >= 0;
                  const busy = notes[k]?.kind === 'busy';
                  const place = pickName(l.name, l.nameKn, lang);
                  return (
                    <td key={l.id} className="qe-cell qe-stock">
                      <div className={'qe-now' + (here < 0 ? ' qty-neg' : '')}>{describeQty(item, here, lang)}</div>
                      <div className="qe-row">
                        <input
                          className={'qe-box' + (notes[k]?.kind === 'err' ? ' bad' : '')}
                          inputMode="decimal"
                          enterKeyHint="done"
                          aria-label={pickName(item.nameEn, item.nameKn, lang) + ' · ' + place}
                          value={drafts[k] ?? ''}
                          onChange={(e) => {
                            setDraft(k, e.target.value);
                            if (!busy) note(k, null);
                          }}
                        />
                        {item.units.length > 1 ? (
                          <Select
                            className="w-auto qe-unit-pick"
                            value={code}
                            onChange={(v) => setUnits((all) => ({ ...all, [k]: v }))}
                            aria-label={bi('Unit', 'ಘಟಕ')}
                            options={item.units.map((u) => ({ value: u.code, label: (lang === 'kn' && u.labelKn) || u.code }))}
                          />
                        ) : (
                          <span className="muted">{(lang === 'kn' && item.units[0]!.labelKn) || item.units[0]!.code}</span>
                        )}
                      </div>
                      {/* One dropdown for every way stock changes here, and one Save. */}
                      <div className="qe-row">
                        <Select<StockAction>
                          className="w-auto qe-action"
                          value={actionOf(k)}
                          onChange={(v) => setActions((all) => ({ ...all, [k]: v }))}
                          aria-label={bi('What to do', 'ಏನು ಮಾಡಬೇಕು')}
                          options={STOCK_ACTIONS.map((a) => ({ value: a.value, label: bi(a.en, a.kn) }))}
                        />
                        <button
                          type="button"
                          className="btn small primary"
                          disabled={!ok || (actionOf(k) !== 'counted' && n === 0) || busy}
                          onClick={() => saveStock(item, l, actionOf(k))}
                        >
                          {bi('Save', 'ಉಳಿಸಿ')}
                        </button>
                      </div>
                      {noteLine(k)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every way quick edit changes the stock in a place, in one dropdown: put some in, write down
 * what was counted, or take some out with the reason the item page's count form uses.
 */
type StockAction = 'add' | 'counted' | 'damaged' | 'expired' | 'other';
const STOCK_ACTIONS: { value: StockAction; en: string; kn: string }[] = [
  { value: 'add', en: '+ Add stock', kn: '+ ಸ್ಟಾಕ್ ಸೇರಿಸಿ' },
  { value: 'counted', en: '= Set count', kn: '= ಎಣಿಕೆ ಉಳಿಸಿ' },
  { value: 'damaged', en: '− Damaged', kn: '− ಹಾಳಾಗಿದೆ' },
  { value: 'expired', en: '− Expired', kn: '− ಅವಧಿ ಮುಗಿದಿದೆ' },
  { value: 'other', en: '− Remove (other)', kn: '− ತೆಗೆಯಿರಿ (ಬೇರೆ)' },
];

/** The unit a stock cell counts in: the one picked, if the item still has it, else the counting unit. */
function unitOf(item: Item, picked: string | undefined): string {
  return picked && item.units.some((u) => u.code === picked) ? picked : defaultUnitOf(item).code;
}
