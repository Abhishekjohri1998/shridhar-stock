import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ADJUST_REASONS,
  blankItemForm,
  blankUnit,
  describeQty,
  formToInput,
  isLow,
  itemToForm,
  pickName,
  toBase,
  totalQty,
  type AdjustReason,
  type Item,
  type ItemForm,
  type Location,
  type MsgKey,
  type StockLevel,
  type StockMove,
  type UnitForm,
} from '@stock/core';
import { api } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { Loading, Select, Table, Tabs, useBi } from '../../components/ui';
import { lowWords } from './Inventory';

type Tab = 'details' | 'stock';

/**
 * One item: its details (names, units, prices, racks, when it is running low) on one tab, and
 * its stock (each place, correcting a count, the last changes) on the other. A new item has only
 * the details.
 */
export function InventoryItemPage({ readOnly = false }: { readOnly?: boolean }) {
  const { id } = useParams();
  const { lang } = useSession();
  const bi = useBi();
  const [tab, setTab] = useState<Tab>('stock');
  const live = useLive('stock', 'items');
  const { value, error, reload } = useLoad(async () => {
    const [locs, item, stock] = await Promise.all([api.locations(), id ? api.item(id) : Promise.resolve(null), id ? api.stock() : Promise.resolve([] as StockLevel[])]);
    return { locs: locs.filter((l) => l.active), item, stock: stock.filter((s) => s.itemId === id) };
  }, [id, live]);

  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const { item, locs, stock } = value;
  if (!item) return readOnly ? <div className="msg err">{bi('No such item', 'ಈ ಸಾಮಾನು ಇಲ್ಲ')}</div> : <ItemDetails item={null} locs={locs} />;
  const total = totalQty(item, stock);
  return (
    <>
      <h1 className="title">{pickName(item.nameEn, item.nameKn, lang)}</h1>
      <p className="muted">
        {bi('In all places', 'ಎಲ್ಲಾ ಕಡೆ ಸೇರಿ')}: <b className={total < 0 ? 'qty-neg' : isLow(item, total) ? 'qty-low' : ''}>{describeQty(item, total, lang)}</b>
        {lowWords(item, lang) && ' · ' + bi('running out below', 'ಮುಗಿಯುತ್ತಿದೆ, ಇದಕ್ಕಿಂತ ಕಡಿಮೆ:') + ' ' + lowWords(item, lang)}
        {!item.active && ' · ' + bi('not sold any more', 'ಈಗ ಮಾರುವುದಿಲ್ಲ')}
      </p>
      <div data-tour="item-tabs">
      <Tabs<Tab>
        tabs={[
          { key: 'stock', label: bi('Stock', 'ಸ್ಟಾಕ್') },
          { key: 'details', label: bi('Details', 'ವಿವರ') },
        ]}
        value={tab}
        onChange={setTab}
      />
      </div>
      {tab === 'details' ? <ItemDetails item={item} locs={locs} readOnly={readOnly} onSaved={reload} /> : <ItemStock item={item} locs={locs} stock={stock} readOnly={readOnly} onChanged={reload} />}
    </>
  );
}

function ItemDetails({ item, locs, readOnly = false, onSaved }: { item: Item | null; locs: Location[]; readOnly?: boolean; onSaved?: () => void }) {
  const { t, lang } = useSession();
  const bi = useBi();
  const nav = useNavigate();
  const [form, setForm] = useState<ItemForm>(() => (item ? itemToForm(item) : blankItemForm()));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  // A fresh read of the same item (stock moved, a live update) keeps what is being typed; only
  // a change saved to the item itself refills the form.
  useEffect(() => {
    if (item) setForm(itemToForm(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.updatedAt]);

  const set = (patch: Partial<ItemForm>) => setForm((f) => ({ ...f, ...patch }));
  const setUnit = (i: number, patch: Partial<UnitForm>) => setForm((f) => ({ ...f, units: f.units.map((u, j) => (j === i ? { ...u, ...patch } : u)) }));

  const save = async (e: FormEvent | null, active?: boolean) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const input = formToInput(form, active);
      if (item) {
        await api.saveItem(item.id, input);
        setSaved(t('common.saved'));
        onSaved?.();
      } else {
        const made = await api.addItem(input);
        nav('/admin/inventory/' + made.id, { replace: true });
      }
    } catch (err) {
      setError((err as Error).message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  const base = form.units[0]?.code || 'pc';
  const unitChoices = form.units.filter((u) => u.code.trim());
  return (
    <form onSubmit={(e) => save(e)}>
      {!item && <h1 className="title">{t('items.new')}</h1>}
      {error && <div className="msg err">{error}</div>}
      {saved && <div className="msg ok">{saved}</div>}
      <fieldset className="plain-fieldset" disabled={readOnly}>
        <div className="card">
          <div className="grid2">
            <label className="field">
              <span>{t('items.nameKn')}</span>
              <input value={form.nameKn} onChange={(e) => set({ nameKn: e.target.value })} />
            </label>
            <label className="field">
              <span>{t('items.nameEn')}</span>
              <input value={form.nameEn} onChange={(e) => set({ nameEn: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span>{t('items.category')}</span>
            <input value={form.category} onChange={(e) => set({ category: e.target.value })} />
          </label>
        </div>

        <div className="card">
          <h2 className="subtitle mt-0">{t('items.units')}</h2>
          <p className="muted">{t('items.unitHint')}</p>
          {form.units.map((u, i) => (
            <div className="unit" key={i}>
              <div className="unit-head">
                <b>{i === 0 ? u.code || '—' : (u.code || '?') + ' = ' + (u.perBase || '?') + ' ' + base}</b>
                {i > 0 && !readOnly && (
                  <button type="button" className="btn ghost small" onClick={() => set({ units: form.units.filter((_, j) => j !== i) })}>
                    {t('common.remove')}
                  </button>
                )}
              </div>
              <div className="unit-grid">
                <label className="field">
                  <span>{t('items.code')}</span>
                  <input value={u.code} onChange={(e) => setUnit(i, { code: e.target.value })} />
                </label>
                <label className="field">
                  <span>{t('items.label')}</span>
                  <input value={u.label} onChange={(e) => setUnit(i, { label: e.target.value })} />
                </label>
                <label className="field">
                  <span>{t('items.labelKn')}</span>
                  <input value={u.labelKn} onChange={(e) => setUnit(i, { labelKn: e.target.value })} />
                </label>
                {i > 0 && (
                  <label className="field">
                    <span>{t('items.perBase')}</span>
                    <input inputMode="numeric" value={u.perBase} onChange={(e) => setUnit(i, { perBase: e.target.value })} />
                  </label>
                )}
                <label className="field">
                  <span>{t('items.price')} ₹</span>
                  <input inputMode="decimal" value={u.price} onChange={(e) => setUnit(i, { price: e.target.value })} />
                </label>
                <label className="field">
                  <span>{t('items.min')} ₹</span>
                  <input inputMode="decimal" value={u.min} onChange={(e) => setUnit(i, { min: e.target.value })} />
                </label>
                <label className="field">
                  <span>{t('items.max')} ₹</span>
                  <input inputMode="decimal" value={u.max} onChange={(e) => setUnit(i, { max: e.target.value })} />
                </label>
                <label className="field">
                  <span>{t('items.cost')} ₹</span>
                  <input inputMode="decimal" value={u.cost} onChange={(e) => setUnit(i, { cost: e.target.value })} />
                </label>
              </div>
              {u.slabs.length > 0 && <div className="muted mb-4">{t('items.slabs')}</div>}
              {u.slabs.map((sl, k) => (
                <div className="slab" key={k}>
                  <label className="field">
                    <span>
                      {t('items.slabFrom')} ({u.code})
                    </span>
                    <input inputMode="decimal" value={sl.minQty} onChange={(e) => setUnit(i, { slabs: u.slabs.map((x, j) => (j === k ? { ...x, minQty: e.target.value } : x)) })} />
                  </label>
                  <label className="field">
                    <span>{t('items.slabRate')} ₹</span>
                    <input inputMode="decimal" value={sl.rate} onChange={(e) => setUnit(i, { slabs: u.slabs.map((x, j) => (j === k ? { ...x, rate: e.target.value } : x)) })} />
                  </label>
                  <button type="button" className="btn ghost small field" onClick={() => setUnit(i, { slabs: u.slabs.filter((_, j) => j !== k) })}>
                    ×
                  </button>
                </div>
              ))}
              {!readOnly && (
                <button type="button" className="btn ghost small" onClick={() => setUnit(i, { slabs: [...u.slabs, { minQty: '', rate: '' }] })}>
                  + {t('items.addSlab')}
                </button>
              )}
            </div>
          ))}
          {!readOnly && (
            <button type="button" className="btn" onClick={() => set({ units: [...form.units, blankUnit(false)] })}>
              + {t('items.addUnit')}
            </button>
          )}
        </div>

        <div className="card">
          <label className="field">
            <span>{t('items.otherNames')}</span>
            <textarea value={form.aliases} onChange={(e) => set({ aliases: e.target.value })} />
          </label>
          <p className="muted">{t('items.otherNamesHint')}</p>
        </div>

        <div className="card">
          <div className="field">
            <span>{bi('Running out below', 'ಇದಕ್ಕಿಂತ ಕಡಿಮೆಯಾದರೆ ಮುಗಿಯುತ್ತಿದೆ')}</span>
            <div className="bar mb-0">
              <input inputMode="decimal" className="in-qty" value={form.lowQty} onChange={(e) => set({ lowQty: e.target.value })} aria-label={bi('Running out below', 'ಇದಕ್ಕಿಂತ ಕಡಿಮೆಯಾದರೆ ಮುಗಿಯುತ್ತಿದೆ')} />
              <Select
                value={unitChoices.some((u) => u.code === form.lowUnit) ? form.lowUnit : base}
                onChange={(lowUnit) => set({ lowUnit })}
                className="w-auto"
                aria-label={bi('Unit', 'ಘಟಕ')}
                options={unitChoices.map((u) => ({ value: u.code, label: (lang === 'kn' && u.labelKn) || u.code }))}
              />
              <span className="muted">{bi('(all places together)', '(ಎಲ್ಲಾ ಕಡೆ ಸೇರಿ)')}</span>
            </div>
          </div>
          <p className="muted">
            {bi(
              'Running low is the shop and every godown added up. Leave it empty for an item that never needs buying ahead.',
              'ಅಂಗಡಿ ಮತ್ತು ಎಲ್ಲಾ ಗೋದಾಮು ಸೇರಿಸಿ ನೋಡಲಾಗುತ್ತದೆ. ಮೊದಲೇ ಖರೀದಿಸಬೇಕಿಲ್ಲದ ಸಾಮಾನಿಗೆ ಖಾಲಿ ಬಿಡಿ.',
            )}
          </p>
          <div className="grid2">
            {locs.map((l) => (
              <label className="field" key={l.id}>
                <span>{t('items.rack', { place: pickName(l.name, l.nameKn, lang) })}</span>
                <input value={form.racks[l.id] ?? ''} onChange={(e) => set({ racks: { ...form.racks, [l.id]: e.target.value } })} />
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      {!readOnly && (
        <div className="bar">
          <button className="btn primary" disabled={busy}>
            {t('common.save')}
          </button>
          <button type="button" className="btn" onClick={() => nav('/admin/inventory')}>
            {item ? bi('Back to the list', 'ಪಟ್ಟಿಗೆ ಹಿಂದೆ') : t('common.cancel')}
          </button>
          {item && (
            <button type="button" className={item.active ? 'btn danger' : 'btn'} disabled={busy} onClick={() => save(null, !item.active)}>
              {item.active ? t('items.deactivate') : t('items.activate')}
            </button>
          )}
        </div>
      )}
    </form>
  );
}

function ItemStock({ item, locs, stock, readOnly, onChanged }: { item: Item; locs: Location[]; stock: StockLevel[]; readOnly: boolean; onChanged: () => void }) {
  const { t, lang } = useSession();
  const bi = useBi();
  const [loc, setLoc] = useState(locs[0]?.id ?? '');
  const [actual, setActual] = useState('');
  /* Counted in whichever unit is on the shelf -- "4 box" -- and turned into the smallest unit
     here, which is what the ledger keeps. Typing pieces for a godown full of boxes was the
     shop's complaint. */
  const [countUnit, setCountUnit] = useState(item.units[0]!.code);
  const unitOk = item.units.some((u) => u.code === countUnit) ? countUnit : item.units[0]!.code;
  const counted = actual.trim() === '' || !Number.isFinite(Number(actual)) ? null : toBase(item, unitOk, Number(actual));
  const [reason, setReason] = useState<AdjustReason>('counted');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const moves = useLoad(() => api.moves(item.id), [item.id, stock]);
  const placeName = (id?: string) => {
    const l = locs.find((x) => x.id === id);
    return l ? pickName(l.name, l.nameKn, lang) : '';
  };
  const qtyAt = (id: string) => stock.find((s) => s.locationId === id)?.qty ?? 0;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setDone('');
    const before = qtyAt(loc);
    const after = counted ?? before;
    try {
      await fn();
      const diff = after - before;
      setDone(placeName(loc) + ': ' + pickName(item.nameEn, item.nameKn, lang) + ' ' + (diff === 0 ? bi('count saved, no change', 'ಎಣಿಕೆ ಉಳಿಸಲಾಗಿದೆ, ಬದಲಾವಣೆ ಇಲ್ಲ') : (diff > 0 ? '+' : '−') + describeQty(item, Math.abs(diff), lang)));
      setActual('');
      setNote('');
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (counted === null) return;
    run(() => api.adjust({ itemId: item.id, locationId: loc, actual: counted, reason, ...(note.trim() ? { note } : {}), requestId: crypto.randomUUID() }));
  };

  const isFirst = (moves.value ?? []).every((m: StockMove) => m.from !== loc && m.to !== loc);
  return (
    <>
      <div className="scroll" data-tour="item-places">
        <Table className="list">
          <thead>
            <tr>
              <th>{t('places.title')}</th>
              <th className="num">{t('stock.title')}</th>
              <th>{bi('Rack', 'ರ‍್ಯಾಕ್')}</th>
            </tr>
          </thead>
          <tbody>
            {locs.map((l) => (
              <tr key={l.id}>
                <td className="name">{pickName(l.name, l.nameKn, lang)}</td>
                <td className={'num ' + (qtyAt(l.id) < 0 ? 'qty-neg' : '')}>{describeQty(item, qtyAt(l.id), lang)}</td>
                <td className="muted">{item.racks[l.id] ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>

      {!readOnly && (
        <div className="card mt-14" data-tour="item-count">
          {error && <div className="msg err">{error}</div>}
          {done && <div className="msg ok">{done}</div>}
          <form className="grid2" onSubmit={submit}>
            <label className="field">
              <span>{t('places.title')}</span>
              <Select value={loc} onChange={setLoc} aria-label={t('places.title')} options={locs.map((l) => ({ value: l.id, label: pickName(l.name, l.nameKn, lang) }))} />
            </label>
            <label className="field">
              <span>{t('stock.actual')}</span>
              <div className="bar mb-0">
                <input inputMode="decimal" className="in-qty" data-tour="item-count-box" value={actual} onChange={(e) => setActual(e.target.value)} aria-label={t('stock.actual')} />
                {item.units.length > 1 && (
                  <Select
                    value={unitOk}
                    onChange={setCountUnit}
                    className="w-auto"
                    aria-label={bi('Unit', 'ಘಟಕ')}
                    options={item.units.map((u) => ({ value: u.code, label: (lang === 'kn' && u.labelKn) || u.code }))}
                  />
                )}
                {item.units.length === 1 && <span className="muted">{(lang === 'kn' && item.units[0]!.labelKn) || item.units[0]!.code}</span>}
                {counted !== null && unitOk !== item.units[0]!.code && <span className="muted">= {describeQty(item, counted, lang)}</span>}
              </div>
            </label>
            {!isFirst && (
              <>
                <label className="field">
                  <span>{t('stock.reason')}</span>
                  <Select<AdjustReason> value={reason} onChange={setReason} aria-label={t('stock.reason')} options={ADJUST_REASONS.map((r) => ({ value: r, label: t(('stock.reason.' + r) as MsgKey) }))} />
                </label>
                <label className="field">
                  <span>{t('stock.note')}</span>
                  <input value={note} onChange={(e) => setNote(e.target.value)} />
                </label>
              </>
            )}
            <div className="bar">
              {isFirst ? (
                <button type="button" className="btn primary" data-tour="item-save-count" disabled={busy || counted === null} onClick={() => counted !== null && run(() => api.openStock(item.id, loc, counted))}>
                  {t('stock.open')}
                </button>
              ) : (
                <button className="btn primary" data-tour="item-save-count" disabled={busy || counted === null}>
                  {t('stock.adjust')}
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      <h3 className="subtitle" data-tour="item-moves">{t('stock.moves')}</h3>
      {(moves.value ?? []).length === 0 && <p className="muted">{bi('No changes yet. Save a count above and it shows here.', 'ಇನ್ನೂ ಬದಲಾವಣೆ ಇಲ್ಲ. ಮೇಲೆ ಎಣಿಕೆ ಉಳಿಸಿದರೆ ಇಲ್ಲಿ ಕಾಣುತ್ತದೆ.')}</p>}
      {(moves.value ?? []).map((m) => (
        <div key={m.id} className="muted move-row">
          {new Date(m.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · <b>{t(('stock.kind.' + m.kind) as MsgKey)}</b> ·{' '}
          {m.from ? placeName(m.from) + ' −' : placeName(m.to) + ' +'}
          {describeQty(item, m.qty, lang)}
          {m.kind === 'adjust' && ' · ' + t(('stock.reason.' + m.ref) as MsgKey)}
          {m.note && ' · ' + m.note}
        </div>
      ))}
    </>
  );
}
