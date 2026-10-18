import { useState } from 'react';
import { describeQty, pickName, type Item, type Location, type Lot, type StockLevel } from '@stock/core';
import { http } from '../lib/api';
import { useLive } from '../lib/live';
import { useLoad, useSession } from '../lib/session';
import { Select } from './Select';
import { useBi } from './ui';

/** Today in India, YYYY-MM-DD. */
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

interface LotForm {
  /** The lot being changed; none for a new one. */
  id?: string;
  placeId: string;
  qty: string;
  unit: string;
  expiry: string;
}

/**
 * An item's expiry lots: how much of it expires when, at which place, soonest first. Sales take
 * from the soonest one first. The admin can also put a date on stock already on the shelf (a lot
 * with ref "manual"), and change or remove a lot. With no lots yet it is just the add button.
 */
export function ItemLots({ item, locs, stock = [], readOnly = false }: { item: Pick<Item, 'id' | 'units'>; locs: Location[]; stock?: StockLevel[]; readOnly?: boolean }) {
  const bi = useBi();
  const { lang } = useSession();
  const live = useLive('stock', 'pos');
  const { value, reload } = useLoad(() => http.get<Lot[]>('/admin/items/' + item.id + '/lots'), [item.id, live]);
  const [form, setForm] = useState<LotForm | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (!value) return null;
  const lots = value;
  if (lots.length === 0 && readOnly) return null;
  const now = today();
  const soon = new Date(Date.parse(now + 'T00:00:00Z') + 15 * 86400_000).toISOString().slice(0, 10);
  const place = (id: string) => {
    if (id.startsWith('transit:')) return bi('on the way', 'ದಾರಿಯಲ್ಲಿ');
    const l = locs.find((x) => x.id === id);
    return l ? pickName(l.name, l.nameKn, lang) : id;
  };
  const base = item.units[0];
  /** On hand at a place with no date yet, in the base unit; the lot being changed counts as free. */
  const freeAt = (placeId: string, skip?: string) => {
    const onHand = stock.find((s) => s.locationId === placeId)?.qty ?? 0;
    const inLots = lots.filter((l) => l.placeId === placeId && l.id !== skip).reduce((n, l) => n + l.qty, 0);
    return Math.max(0, onHand - inLots);
  };
  const places = locs.filter((l) => (stock.find((s) => s.locationId === l.id)?.qty ?? 0) > 0);
  const perBase = (code: string) => item.units.find((u) => u.code === code)?.perBase ?? 1;
  const free = form ? freeAt(form.placeId, form.id) : 0;
  const asked = form ? Number(form.qty) * perBase(form.unit) : 0;
  const tooMuch = !!form && asked > free + 1e-9;
  const openNew = () => {
    setError('');
    setForm({ placeId: places[0]?.id ?? '', qty: '', unit: base?.code ?? '', expiry: '' });
  };
  const openEdit = (l: Lot) => {
    setError('');
    setForm({ id: l.id, placeId: l.placeId, qty: String(l.qty), unit: base?.code ?? '', expiry: l.expiry });
  };
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setForm(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    if (!form) return;
    const body = { itemId: item.id, placeId: form.placeId, qty: Number(form.qty), unit: form.unit, expiry: form.expiry };
    run(() => (form.id ? http.put('/admin/lots/' + form.id, body) : http.post('/admin/lots', body)));
  };
  return (
    <div className="card item-lots" data-tour="item-lots">
      {lots.length > 0 && (
        <>
          <div className="subtitle mt-0">{bi('Expiry dates', 'ಅವಧಿ ಮುಗಿಯುವ ದಿನಗಳು')}</div>
          <ul className="lot-list">
            {lots.map((l) => (
              <li key={l.id} className={l.expiry < now ? 'lot-expired' : l.expiry <= soon ? 'lot-soon' : ''}>
                <b>{l.expiry}</b>
                <span>{describeQty(item, l.qty, lang)}</span>
                <span className="muted">{place(l.placeId)}</span>
                {l.expiry < now && <span className="pill bad">{bi('expired', 'ಅವಧಿ ಮುಗಿದಿದೆ')}</span>}
                {!readOnly && !l.placeId.startsWith('transit:') && (
                  <>
                    <button type="button" className="btn ghost small" onClick={() => openEdit(l)}>
                      {bi('Edit', 'ಬದಲಿಸಿ')}
                    </button>
                    <button type="button" className="btn ghost small" disabled={busy} onClick={() => run(() => http.del('/admin/lots/' + l.id))}>
                      {bi('Remove', 'ತೆಗೆಯಿರಿ')}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
          <div className="muted">{bi('Sales take from the soonest date first.', 'ಮಾರಾಟ ಬೇಗ ಮುಗಿಯುವುದರಿಂದ ಮೊದಲು ತೆಗೆಯುತ್ತದೆ.')}</div>
        </>
      )}
      {error && <div className="msg err">{error}</div>}
      {!readOnly && !form && (
        <div className="bar mb-0">
          <button type="button" className="btn" onClick={openNew} disabled={places.length === 0} data-tour="item-lots-add">
            + {bi('Add expiry to stock on hand', 'ಇರುವ ಸ್ಟಾಕ್‌ಗೆ ಅವಧಿ ಸೇರಿಸಿ')}
          </button>
          {places.length === 0 && <span className="muted">{bi('No stock on hand yet.', 'ಇನ್ನೂ ಸ್ಟಾಕ್ ಇಲ್ಲ.')}</span>}
        </div>
      )}
      {!readOnly && form && (
        <div>
          <div className="subtitle">{form.id ? bi('Change expiry', 'ಅವಧಿ ಬದಲಿಸಿ') : bi('Add expiry to stock on hand', 'ಇರುವ ಸ್ಟಾಕ್‌ಗೆ ಅವಧಿ ಸೇರಿಸಿ')}</div>
          <div className="grid2">
            <label className="field">
              <span>{bi('Place', 'ಸ್ಥಳ')}</span>
              <Select value={form.placeId} onChange={(v) => setForm({ ...form, placeId: v })} options={(form.id ? locs.filter((l) => l.id === form.placeId || places.includes(l)) : places).map((l) => ({ value: l.id, label: pickName(l.name, l.nameKn, lang) }))} />
            </label>
            <label className="field">
              <span>{bi('Expiry date', 'ಅವಧಿ ದಿನ')}</span>
              <input type="date" value={form.expiry} onChange={(e) => setForm({ ...form, expiry: e.target.value })} />
            </label>
            <label className="field">
              <span>{bi('Quantity', 'ಪ್ರಮಾಣ')}</span>
              <div className="bar mb-0">
                <input inputMode="decimal" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
                {item.units.length > 1 && <Select className="w-auto" value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} options={item.units.map((u) => ({ value: u.code, label: u.code }))} />}
              </div>
            </label>
          </div>
          <p className={tooMuch ? 'msg err' : 'muted'}>
            {bi('Without a date here', 'ಇಲ್ಲಿ ದಿನ ಇಲ್ಲದ್ದು')}: {describeQty(item, free, lang)}
          </p>
          <div className="bar mb-0">
            <button type="button" className="btn primary" disabled={busy || !form.placeId || !form.expiry || !(Number(form.qty) > 0) || tooMuch} onClick={save}>
              {bi('Save expiry', 'ಅವಧಿ ಉಳಿಸಿ')}
            </button>
            <button type="button" className="btn ghost" onClick={() => setForm(null)}>
              {bi('Cancel', 'ರದ್ದು')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
