import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { pickName, type Item, type ItemInput, type Location } from '@stock/core';
import { api } from '../../lib/api';
import { useSession } from '../../lib/session';

interface UnitForm {
  code: string;
  label: string;
  labelKn: string;
  perBase: string;
  price: string;
  min: string;
  max: string;
  cost: string;
  slabs: { minQty: string; rate: string }[];
}

const blankUnit = (base: boolean): UnitForm => ({
  code: base ? 'pc' : '',
  label: base ? 'Piece' : '',
  labelKn: base ? 'ಪೀಸ್' : '',
  perBase: base ? '1' : '',
  price: '',
  min: '',
  max: '',
  cost: '',
  slabs: [],
});

const s = (n: number | undefined) => (n == null ? '' : String(n));
const n = (v: string): number | undefined => (v.trim() === '' ? undefined : Number(v));

function toForm(item: Item) {
  return {
    nameEn: item.nameEn,
    nameKn: item.nameKn,
    category: item.category ?? '',
    units: item.units.map<UnitForm>((u) => ({
      code: u.code,
      label: u.label,
      labelKn: u.labelKn,
      perBase: String(u.perBase),
      price: String(u.price),
      min: s(u.min),
      max: s(u.max),
      cost: s(u.cost),
      slabs: (u.slabs ?? []).map((x) => ({ minQty: String(x.minQty), rate: String(x.rate) })),
    })),
    aliases: item.aliases.map((a) => (a.unit ? a.text + ', ' + a.unit : a.text)).join('\n'),
    racks: { ...item.racks } as Record<string, string>,
    reorderAt: Object.fromEntries(Object.entries(item.reorderAt).map(([k, v]) => [k, String(v)])) as Record<string, string>,
  };
}

type Form = ReturnType<typeof toForm>;

function toInput(f: Form, active?: boolean): ItemInput {
  return {
    nameEn: f.nameEn,
    nameKn: f.nameKn,
    ...(f.category.trim() ? { category: f.category } : {}),
    units: f.units.map((u, i) => ({
      code: u.code,
      label: u.label,
      labelKn: u.labelKn,
      perBase: i === 0 ? 1 : Number(u.perBase),
      price: u.price.trim() === '' ? NaN : Number(u.price),
      ...(u.slabs.length ? { slabs: u.slabs.map((x) => ({ minQty: Number(x.minQty), rate: Number(x.rate) })) } : {}),
      ...(n(u.min) != null ? { min: n(u.min) } : {}),
      ...(n(u.max) != null ? { max: n(u.max) } : {}),
      ...(n(u.cost) != null ? { cost: n(u.cost) } : {}),
    })),
    aliases: f.aliases
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [text, unit] = line.split(',').map((p) => p.trim());
        return unit ? { text: text!, unit } : { text: text! };
      }),
    racks: f.racks,
    reorderAt: Object.fromEntries(
      Object.entries(f.reorderAt)
        .filter(([, v]) => v.trim() !== '')
        .map(([k, v]) => [k, Number(v)]),
    ),
    ...(active != null ? { active } : {}),
  };
}

const empty: Form = { nameEn: '', nameKn: '', category: '', units: [blankUnit(true)], aliases: '', racks: {}, reorderAt: {} };

export function ItemEditor() {
  const { id } = useParams();
  const { t, lang } = useSession();
  const nav = useNavigate();
  const [form, setForm] = useState<Form>(empty);
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
          setForm(toForm(it));
        })
        .catch((e: Error) => setError(e.message));
    }
  }, [id]);

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const setUnit = (i: number, patch: Partial<UnitForm>) =>
    setForm((f) => ({ ...f, units: f.units.map((u, j) => (j === i ? { ...u, ...patch } : u)) }));

  const save = async (e: FormEvent | null, active?: boolean) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const input = toInput(form, active);
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
