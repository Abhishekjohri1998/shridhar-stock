import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  blankItemForm,
  blankUnit,
  formToInput,
  itemToForm,
  pickName,
  type Item,
  type ItemForm,
  type Location,
  type UnitForm,
} from '@stock/core';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';

export function ItemEditor() {
  const { id } = useParams();
  const { t, lang } = useSession();
  const nav = useNavigate();
  const [form, setForm] = useState<ItemForm>(blankItemForm);
  const [item, setItem] = useState<Item | null>(null);
  const [locs, setLocs] = useState<Location[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.locations().then(setLocs).catch((e: Error) => setError(e.message));
    if (id) {
      api
        .item(id)
        .then((it) => {
          setItem(it);
          setForm(itemToForm(it));
        })
        .catch((e: Error) => setError(e.message));
    }
  }, [id]);

  const set = (patch: Partial<ItemForm>) => setForm((f) => ({ ...f, ...patch }));
  const setUnit = (i: number, patch: Partial<UnitForm>) =>
    setForm((f) => ({ ...f, units: f.units.map((u, j) => (j === i ? { ...u, ...patch } : u)) }));

  const save = async (e: FormEvent | null, active?: boolean) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const input = formToInput(form, active);
      if (item) await api.saveItem(item.id, input);
      else await api.addItem(input);
      nav('/admin/items');
    } catch (err) {
      setError((err as Error).message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setBusy(false);
    }
  };

  const base = form.units[0]?.code || 'pc';
  return (
    <form onSubmit={(e) => save(e)}>
      <h1 className="title">{item ? pickName(item.nameEn, item.nameKn, lang) : t('items.new')}</h1>
      {error && <div className="msg err">{error}</div>}

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
        <h2 className="subtitle" style={{ marginTop: 0 }}>{t('items.units')}</h2>
        <p className="muted">{t('items.unitHint')}</p>
        {form.units.map((u, i) => (
          <div className="unit" key={i}>
            <div className="unit-head">
              <b>{i === 0 ? u.code || '—' : (u.code || '?') + ' = ' + (u.perBase || '?') + ' ' + base}</b>
              {i > 0 && (
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
            {u.slabs.length > 0 && <div className="muted" style={{ marginBottom: 4 }}>{t('items.slabs')}</div>}
            {u.slabs.map((sl, k) => (
              <div className="slab" key={k}>
                <label className="field">
                  <span>{t('items.slabFrom')} ({u.code})</span>
                  <input
                    inputMode="decimal"
                    value={sl.minQty}
                    onChange={(e) => setUnit(i, { slabs: u.slabs.map((x, j) => (j === k ? { ...x, minQty: e.target.value } : x)) })}
                  />
                </label>
                <label className="field">
                  <span>{t('items.slabRate')} ₹</span>
                  <input
                    inputMode="decimal"
                    value={sl.rate}
                    onChange={(e) => setUnit(i, { slabs: u.slabs.map((x, j) => (j === k ? { ...x, rate: e.target.value } : x)) })}
                  />
                </label>
                <button type="button" className="btn ghost small field" onClick={() => setUnit(i, { slabs: u.slabs.filter((_, j) => j !== k) })}>
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="btn ghost small" onClick={() => setUnit(i, { slabs: [...u.slabs, { minQty: '', rate: '' }] })}>
              + {t('items.addSlab')}
            </button>
          </div>
        ))}
        <button type="button" className="btn" onClick={() => set({ units: [...form.units, blankUnit(false)] })}>
          + {t('items.addUnit')}
        </button>
      </div>

      <div className="card">
        <label className="field">
          <span>{t('items.otherNames')}</span>
          <textarea value={form.aliases} onChange={(e) => set({ aliases: e.target.value })} />
        </label>
        <p className="muted">{t('items.otherNamesHint')}</p>
      </div>

      <div className="card">
        {locs.map((l) => (
          <div className="grid2" key={l.id}>
            <label className="field">
              <span>{t('items.rack', { place: pickName(l.name, l.nameKn, lang) })}</span>
              <input value={form.racks[l.id] ?? ''} onChange={(e) => set({ racks: { ...form.racks, [l.id]: e.target.value } })} />
            </label>
            <label className="field">
              <span>{t('items.reorder', { place: pickName(l.name, l.nameKn, lang) })}</span>
              <input
                inputMode="decimal"
                value={form.reorderAt[l.id] ?? ''}
                onChange={(e) => set({ reorderAt: { ...form.reorderAt, [l.id]: e.target.value } })}
              />
            </label>
          </div>
        ))}
      </div>

      <div className="bar">
        <button className="btn primary" disabled={busy}>
          {t('common.save')}
        </button>
        <button type="button" className="btn" onClick={() => nav('/admin/items')}>
          {t('common.cancel')}
        </button>
        {item && (
          <button type="button" className={item.active ? 'btn danger' : 'btn'} disabled={busy} onClick={() => save(null, !item.active)}>
            {item.active ? t('items.deactivate') : t('items.activate')}
          </button>
        )}
      </div>
    </form>
  );
}
