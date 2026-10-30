import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ADJUST_REASONS,
  addAliasChip,
  aliasChips,
  aliasesFromChips,
  withPendingAlias,
  packRate,
  packsFromItem,
  applyPacks,
  type PackRow,
  slabsFromPacks,
  MAX_ALIASES,
  blankItemForm,
  biggestUnitIndex,
  costsFromUnit,
  toEnglish,
  toKannada,
  kannadaSuggestions,
  learnedFrom,
  blankUnit,
  defaultUnitOf,
  describeQty,
  formatRate, formatRupees,
  qtyInUnit,
  formToInput,
  isLow,
  isLowAt,
  itemToForm,
  pickName,
  toBase,
  totalQty,
  type AdjustReason,
  type Item,
  type ItemForm,
  type ItemSupplierRow,
  type StockInfo,
  type Supplier,
  type Location,
  type MsgKey,
  type StockLevel,
  type StockMove,
  type UnitForm,
  type UsedUnit,
  usedUnits,
} from '@stock/core';
import { api, http } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { Loading, Select, SuggestInput, Table, Tabs, useBi, when } from '../../components/ui';
import { ItemLots } from '../../components/ItemLots';
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
    const none = { info: null as StockInfo | null, suppliers: [] as ItemSupplierRow[] };
    const [locs, item, stock, cats, sups, about, racks] = await Promise.all([
      api.locations(),
      id ? api.item(id) : Promise.resolve(null),
      id ? api.stock() : Promise.resolve([] as StockLevel[]),
      readOnly ? Promise.resolve([] as string[]) : api.categories().catch(() => [] as string[]),
      readOnly ? Promise.resolve([] as Supplier[]) : http.get<Supplier[]>('/admin/suppliers').catch(() => [] as Supplier[]),
      id && !readOnly ? api.itemInfo(id).catch(() => none) : Promise.resolve(none),
      readOnly ? Promise.resolve({} as Record<string, string[]>) : api.racks().catch(() => ({}) as Record<string, string[]>),
    ]);
    return { locs: locs.filter((l) => l.active), item, stock: stock.filter((s) => s.itemId === id), cats, sups, about, racks };
  }, [id, live]);

  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const { item, locs, stock, cats, sups, about, racks } = value;
  if (!item) return readOnly ? <div className="msg err">{bi('No such item', 'ಈ ಸಾಮಾನು ಇಲ್ಲ')}</div> : <ItemDetails item={null} locs={locs} cats={cats} racks={racks} sups={sups} found={[]} />;
  const total = totalQty(item, stock);
  return (
    <>
      {/* The name, its stock line and the tabs stay pinned under the top bar while the page scrolls. */}
      <div className="item-head">
      <h1 className="title">{pickName(item.nameEn, item.nameKn, lang)}</h1>
      <p className="muted">
        {bi('In all places', 'ಎಲ್ಲಾ ಕಡೆ ಸೇರಿ')}: <b className={total < 0 ? 'qty-neg' : isLow(item, total) ? 'qty-low' : ''}>{qtyInUnit(item, defaultUnitOf(item).code, total, lang)}</b>
        {item.units.length > 1 && <span> ({describeQty(item, total, lang)})</span>}
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
      </div>
      {tab === 'details' ? (
        <ItemDetails item={item} locs={locs} cats={cats} racks={racks} sups={sups} found={about.suppliers} readOnly={readOnly} onSaved={reload} />
      ) : (
        <>
          {about.info && <StockSummary item={item} locs={locs} stock={stock} info={about.info} sups={sups} />}
          <ItemStock item={item} locs={locs} stock={stock} readOnly={readOnly} onChanged={reload} />
          <ItemLots item={item} locs={locs} stock={stock} readOnly={readOnly} />
        </>
      )}
    </>
  );
}

function ItemDetails({
  item,
  locs,
  cats,
  racks = {},
  sups,
  found,
  readOnly = false,
  onSaved,
}: {
  item: Item | null;
  locs: Location[];
  /** Categories other items already use, suggested as the shop types. */
  cats: string[];
  /** Racks other items already use, per place, suggested as the shop types. */
  racks?: Record<string, string[]>;
  sups: Supplier[];
  /** This item's suppliers as the server sees them: added by hand, or from purchase orders. */
  found: ItemSupplierRow[];
  readOnly?: boolean;
  onSaved?: () => void;
}) {
  const { t, lang } = useSession();
  const bi = useBi();
  const nav = useNavigate();
  const [form, setForm] = useState<ItemForm>(() => (item ? itemToForm(item) : blankItemForm()));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [busy, setBusy] = useState(false);
  // A name typed in the other-names box but not yet added with "+ Add". Save adds it too, so a name
  // is never lost because + Add was skipped (or the tablet keyboard's Enter submitted the form).
  const [pendingAlias, setPendingAlias] = useState({ text: '', unit: '' });
  // A fresh read of the same item (stock moved, a live update) keeps what is being typed; only
  // a change saved to the item itself refills the form.
  useEffect(() => {
    if (item) setForm(itemToForm(item));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id, item?.updatedAt]);

  // Spellings this shop taught the A -> ಅ button, the chips it offered, and what it last filled in
  // (a saved Kannada name that differs from that is a correction worth remembering).
  const [learned, setLearned] = useState<Record<string, string>>({});
  const [chips, setChips] = useState<string[]>([]);
  const [autoKn, setAutoKn] = useState('');
  useEffect(() => {
    if (readOnly) return;
    let gone = false;
    api.translit().then((w) => !gone && setLearned(w)).catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [readOnly]);
  const set = (patch: Partial<ItemForm>) => setForm((f) => ({ ...f, ...patch }));
  // Unit names other items already use, suggested while a unit is typed.
  const [known, setKnown] = useState<UsedUnit[]>([]);
  useEffect(() => {
    if (readOnly) return;
    let gone = false;
    api
      .items(true)
      .then((all) => !gone && setKnown(usedUnits(all)))
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [readOnly]);
  const itemsWord = (n: number) => bi('used by ' + n + (n === 1 ? ' item' : ' items'), n + ' ಸಾಮಾನುಗಳಲ್ಲಿ ಬಳಕೆ');
  const pickCode = (i: number, code: string) => {
    const u = form.units[i] ?? { label: '', labelKn: '' };
    const k = known.find((x) => x.code.toLowerCase() === code.trim().toLowerCase());
    setUnit(i, { code, ...(k && !u.label.trim() && k.label ? { label: k.label } : {}), ...(k && !u.labelKn.trim() && k.labelKn ? { labelKn: k.labelKn } : {}) });
  };
  const uniq = (vals: string[]) => [...new Map(vals.filter(Boolean).map((v) => [v.toLowerCase(), v])).values()];
  const setUnit = (i: number, patch: Partial<UnitForm>) => setForm((f) => ({ ...f, units: f.units.map((u, j) => (j === i ? { ...u, ...patch } : u)) }));

  const save = async (e: FormEvent | null, active?: boolean) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const input = formToInput(withPendingAlias(form, pendingAlias), active);
      if (autoKn && form.nameKn.trim() && form.nameKn.trim() !== autoKn) {
        const taught = learnedFrom(form.nameEn, form.nameKn, learned);
        if (Object.keys(taught).length) api.learnTranslit(taught).then(setLearned).catch(() => undefined);
      }
      setAutoKn('');
      setChips([]);
      if (item) {
        await api.saveItem(item.id, input);
        setPendingAlias({ text: '', unit: '' });
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

  const base = form.units[0]?.code || '';
  const unitChoices = form.units.filter((u) => u.code.trim());
  // Transliterate one name box from the other (same sound, other script). Asks before replacing text.
  const fillName = (key: 'nameEn' | 'nameKn', value: string) => {
    if (!value.trim()) return;
    const had = form[key].trim();
    if (had && had !== value && !window.confirm(bi('Replace "' + had + '" with "' + value + '"?', '"' + had + '" ಬದಲು "' + value + '" ಹಾಕಬೇಕೆ?'))) return;
    set({ [key]: value });
  };
  const [costFrom, setCostFrom] = useState<number | null>(null);
  const costIdx = costFrom != null && form.units[costFrom] ? costFrom : biggestUnitIndex(form);
  const costPreview = costsFromUnit(form, costIdx);
  return (
    <form onSubmit={(e) => save(e)}>
      {!item && <h1 className="title">{t('items.new')}</h1>}
      {error && <div className="msg err">{error}</div>}
      {saved && <div className="msg ok">{saved}</div>}
      <fieldset className="plain-fieldset" disabled={readOnly}>
        {/* A new item has no pinned title above, so its name card pins itself; one Save, at the bottom. */}
        <div className={'card' + (item ? '' : ' item-sticky')}>
          <div className="grid2">
            <label className="field">
              <span>{t('items.nameKn')}</span>
              <div className="bar mb-0">
                <input value={form.nameKn} onChange={(e) => set({ nameKn: e.target.value })} />
                {!readOnly && (
                  <button type="button" className="btn ghost small" disabled={!form.nameEn.trim()} title={bi('Write the English name in Kannada letters', 'ಇಂಗ್ಲಿಷ್ ಹೆಸರನ್ನು ಕನ್ನಡ ಅಕ್ಷರದಲ್ಲಿ ಬರೆಯಿರಿ')} onClick={() => {
                    const all = kannadaSuggestions(form.nameEn, learned);
                    const first = toKannada(form.nameEn, learned);
                    setChips(all.length > 1 ? all : []);
                    setAutoKn(first);
                    fillName('nameKn', first);
                  }}>
                    A → ಅ
                  </button>
                )}
              </div>
              {!readOnly && chips.length > 1 && (
                <div className="bar mb-0">
                  {chips.map((c) => (
                    <button key={c} type="button" className={'btn small ' + (form.nameKn === c ? 'primary' : 'ghost')} onClick={() => set({ nameKn: c })}>
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </label>
            <label className="field">
              <span>{t('items.nameEn')}</span>
              <div className="bar mb-0">
                <input value={form.nameEn} onChange={(e) => set({ nameEn: e.target.value })} />
                {!readOnly && (
                  <button type="button" className="btn ghost small" disabled={!form.nameKn.trim()} title={bi('Write the Kannada name in English letters', 'ಕನ್ನಡ ಹೆಸರನ್ನು ಇಂಗ್ಲಿಷ್ ಅಕ್ಷರದಲ್ಲಿ ಬರೆಯಿರಿ')} onClick={() => fillName('nameEn', toEnglish(form.nameKn))}>
                    ಅ → A
                  </button>
                )}
              </div>
            </label>
          </div>
        </div>
        <div className="card">
          <label className="field">
            <span>{t('items.category')}</span>
            <SuggestInput data-tour="item-category" value={form.category} onChange={(v) => set({ category: v })} suggestions={cats.map((c) => ({ value: c }))} />
          </label>
        </div>

        <div className="card">
          <h2 className="subtitle mt-0">{t('items.units')}</h2>
          <p className="muted">{t('items.unitHint')}</p>
          <p className="muted">
            {bi(
              'The first unit is the smallest one, the base: every other unit is a number of it. Name a unit anything the shop says: line, bundle, crate.',
              'ಮೊದಲ ಘಟಕ ಅತಿ ಚಿಕ್ಕದು, ಮೂಲ ಘಟಕ: ಉಳಿದವು ಅದರ ಎಷ್ಟು ಎಂದು. ಅಂಗಡಿಯಲ್ಲಿ ಹೇಳುವ ಯಾವ ಹೆಸರೂ ಆಗುತ್ತದೆ: ಲೈನ್, ಬಂಡಲ್, ಕ್ರೇಟ್.',
            )}
          </p>
          {unitChoices.length === 0 && <p className="muted">{bi('Type the base unit below first; then choose how stock is counted and sold.', 'ಮೊದಲು ಕೆಳಗೆ ಮೂಲ ಘಟಕ ಬರೆಯಿರಿ; ನಂತರ ಎಣಿಸುವ, ಮಾರುವ ಘಟಕ ಆರಿಸಿ.')}</p>}
          {unitChoices.length > 0 && (<>
          <label className="field" data-tour="item-default-unit">
            <span>{bi('Count stock in', 'ಸ್ಟಾಕ್ ಎಣಿಸುವ ಘಟಕ')}</span>
            <Select
              value={unitChoices.some((u) => u.code === form.defaultUnit) ? form.defaultUnit : base}
              onChange={(defaultUnit) => set({ defaultUnit, ...(form.lowQty.trim() === '' ? { lowUnit: defaultUnit } : {}) })}
              aria-label={bi('Count stock in', 'ಸ್ಟಾಕ್ ಎಣಿಸುವ ಘಟಕ')}
              options={unitChoices.map((u) => ({ value: u.code, label: (lang === 'kn' && u.labelKn) || u.label || u.code }))}
            />
          </label>
          <label className="field">
            <span>{bi('Sell in', 'ಮಾರುವ ಘಟಕ')}</span>
            <Select
              value={unitChoices.some((u) => u.code === form.sellUnit) ? form.sellUnit : ''}
              onChange={(sellUnit) => set({ sellUnit })}
              aria-label={bi('Sell in', 'ಮಾರುವ ಘಟಕ')}
              options={[
                { value: '', label: bi('Same as counting', 'ಎಣಿಸುವ ಘಟಕವೇ') },
                ...unitChoices.map((u) => ({ value: u.code, label: (lang === 'kn' && u.labelKn) || u.label || u.code })),
              ]}
            />
          </label>
          </>)}
          <p className="muted">
            {bi(
              'Stock is shown in the counting unit, and counting, moving and buying start with it. Billing starts with the selling unit: rice counted in bags and sold by the kg.',
              'ಸ್ಟಾಕ್ ಎಣಿಸುವ ಘಟಕದಲ್ಲಿ ಕಾಣುತ್ತದೆ; ಎಣಿಕೆ, ಸಾಗಣೆ, ಖರೀದಿ ಇದರಿಂದ ಶುರು. ಬಿಲ್ ಮಾರುವ ಘಟಕದಿಂದ ಶುರು: ಅಕ್ಕಿ ಚೀಲದಲ್ಲಿ ಎಣಿಕೆ, ಕೆಜಿಯಲ್ಲಿ ಮಾರಾಟ.',
            )}
          </p>
          {form.units.map((u, i) => (
            <div className="unit" key={i}>
              <div className="unit-head">
                <b>
                  {i === 0
                    ? bi('Base unit', 'ಮೂಲ ಘಟಕ') + ': ' + (u.code || '—')
                    : '1 ' + (u.code || '?') + ' = ' + (u.perBase || '?') + ' ' + base}
                  {(form.defaultUnit || base) === u.code && u.code && ' · ' + bi('default', 'ಮೊದಲ ಆಯ್ಕೆ')}
                </b>
                {i > 0 && !readOnly && (
                  <button type="button" className="btn ghost small" onClick={() => set({ units: form.units.filter((_, j) => j !== i) })}>
                    {t('common.remove')}
                  </button>
                )}
              </div>
              <div className="unit-grid">
                <label className="field">
                  <span>{t('items.code')}</span>
                  <SuggestInput limit={0} value={u.code} onChange={(v) => pickCode(i, v)} aria-label={t('items.code')} placeholder={i === 0 ? bi('e.g. gm, pc, kg', 'ಉದಾ. gm, pc, kg') : undefined} suggestions={known.map((k) => ({ value: k.code, hint: itemsWord(k.count) }))} />
                </label>
                <label className="field">
                  <span>{t('items.label')}</span>
                  <SuggestInput value={u.label} onChange={(v) => setUnit(i, { label: v })} aria-label={t('items.label')} suggestions={uniq(known.map((k) => k.label)).map((value) => ({ value }))} />
                </label>
                <label className="field">
                  <span>{t('items.labelKn')}</span>
                  <SuggestInput value={u.labelKn} onChange={(v) => setUnit(i, { labelKn: v })} aria-label={t('items.labelKn')} suggestions={uniq(known.map((k) => k.labelKn)).map((value) => ({ value }))} />
                </label>
                {i > 0 && (
                  <label className="field">
                    <span>{'1 ' + (u.code || bi('of these', 'ಇದು')) + ' = ? ' + base}</span>
                    <input inputMode="numeric" value={u.perBase} onChange={(e) => setUnit(i, { perBase: e.target.value })} aria-label={t('items.perBase')} />
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
              <div className="muted mb-4" data-tour={i === 0 ? 'item-slabs' : undefined}>
                <b>{bi('Price by quantity', 'ಪ್ರಮಾಣದ ಪ್ರಕಾರ ಬೆಲೆ')}</b>
                {' · '}
                {u.slabs.length
                  ? bi('from this many ' + (u.code || '') + ' upwards, this rate for each', 'ಇಷ್ಟು ' + (u.code || '') + ' ಅಥವಾ ಹೆಚ್ಚು ಆದರೆ, ಒಂದಕ್ಕೆ ಈ ಬೆಲೆ')
                  : bi('none: every quantity is at the price above', 'ಇಲ್ಲ: ಎಲ್ಲ ಪ್ರಮಾಣಕ್ಕೂ ಮೇಲಿನ ಬೆಲೆ')}
              </div>
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
                  + {bi('Price from a quantity', 'ಪ್ರಮಾಣದಿಂದ ಬೆಲೆ')}
                </button>
              )}
              {i === 0 && !readOnly && (
                <PackPricer
                  base={u.code || base}
                  form={form}
                  setForm={setForm}
                />
              )}
            </div>
          ))}
          {!readOnly && (
            <button type="button" className="btn" data-tour="item-add-unit" onClick={() => set({ units: [...form.units, blankUnit(false)] })}>
              + {bi('Add unit', 'ಘಟಕ ಸೇರಿಸಿ')}
            </button>
          )}
          {!readOnly && unitChoices.length > 1 && (
            <div className="unit mt-14">
              <b>{bi('Work out costs from one unit', 'ಒಂದು ಘಟಕದ ಖರೀದಿ ಬೆಲೆಯಿಂದ ಉಳಿದವು')}</b>
              <p className="muted">{bi('Type the cost of the unit you buy in (a 50 kg bag at ₹2700), choose it here, and the cost of every other unit is worked out.', 'ನೀವು ಕೊಳ್ಳುವ ಘಟಕದ ಬೆಲೆ ಬರೆಯಿರಿ (50 ಕೆಜಿ ಚೀಲ ₹2700), ಇಲ್ಲಿ ಆರಿಸಿ; ಉಳಿದ ಘಟಕಗಳ ಬೆಲೆ ಲೆಕ್ಕವಾಗುತ್ತದೆ.')}</p>
              <div className="bar mb-0">
                <Select
                  className="w-auto"
                  value={String(costIdx)}
                  onChange={(v) => setCostFrom(Number(v))}
                  aria-label={bi('Work out costs from', 'ಇದರ ಬೆಲೆಯಿಂದ ಲೆಕ್ಕ')}
                  options={form.units.map((u, i) => ({ value: String(i), label: ((lang === 'kn' && u.labelKn) || u.label || u.code || '?') + (i > 0 ? ' (' + (u.perBase || '?') + ' ' + base + ')' : '') }))}
                />
                <button type="button" className="btn" disabled={!costPreview} onClick={() => costPreview && setForm(costPreview)}>
                  {bi('Fill costs', 'ಬೆಲೆ ತುಂಬಿ')}
                </button>
              </div>
              <p className="muted mb-0">
                {costPreview
                  ? costPreview.units.filter((u) => u.code.trim() && u.cost.trim()).map((u) => '1 ' + u.code + ' = ₹' + u.cost).join(' · ')
                  : bi('Type a cost in the chosen unit first.', 'ಮೊದಲು ಆರಿಸಿದ ಘಟಕದ ಬೆಲೆ ಬರೆಯಿರಿ.')}
              </p>
            </div>
          )}
        </div>

        {item && <ItemSuppliersCard form={form} set={set} sups={sups} found={found} readOnly={readOnly} />}

        <div className="card">
          <AliasEditor
            aliases={form.aliases}
            onChange={(aliases) => set({ aliases })}
            pending={pendingAlias}
            onPending={setPendingAlias}
            unitCodes={unitChoices.map((u) => u.code)}
            readOnly={readOnly}
            label={t('items.otherNames')}
          />
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
          {locs.map((l) => {
            const place = pickName(l.name, l.nameKn, lang);
            const lp = form.lowPlace[l.id] ?? { qty: '', unit: form.lowUnit };
            const setLp = (patch: Partial<{ qty: string; unit: string }>) => set({ lowPlace: { ...form.lowPlace, [l.id]: { ...lp, ...patch } } });
            const label = bi('Running out in ' + place + ' below', place + 'ನಲ್ಲಿ ಇದಕ್ಕಿಂತ ಕಡಿಮೆಯಾದರೆ ಮುಗಿಯುತ್ತಿದೆ');
            return (
              <div className="field" key={l.id}>
                <span>{label}</span>
                <div className="bar mb-0">
                  <input inputMode="decimal" className="in-qty" value={lp.qty} onChange={(e) => setLp({ qty: e.target.value })} aria-label={label} />
                  <Select
                    value={unitChoices.some((u) => u.code === lp.unit) ? lp.unit : base}
                    onChange={(unit) => setLp({ unit })}
                    className="w-auto"
                    aria-label={bi('Unit', 'ಘಟಕ')}
                    options={unitChoices.map((u) => ({ value: u.code, label: (lang === 'kn' && u.labelKn) || u.code }))}
                  />
                </div>
              </div>
            );
          })}
          <p className="muted">
            {bi(
              'Running low is the shop and every godown added up: it puts the item on the buy list. The level for one place marks that shelf and decides what the refill brings to the shop. Leave any of them empty when not needed.',
              'ಅಂಗಡಿ ಮತ್ತು ಎಲ್ಲಾ ಗೋದಾಮು ಸೇರಿಸಿ ನೋಡಲಾಗುತ್ತದೆ: ಇದು ಖರೀದಿ ಪಟ್ಟಿಗೆ ಸೇರಿಸುತ್ತದೆ. ಒಂದು ಜಾಗದ ಮಟ್ಟ ಆ ಶೆಲ್ಫ್ ಅನ್ನು ಗುರುತಿಸುತ್ತದೆ ಮತ್ತು ಅಂಗಡಿಗೆ ಏನು ತರಬೇಕು ಎಂದು ಹೇಳುತ್ತದೆ. ಬೇಡವಾದರೆ ಖಾಲಿ ಬಿಡಿ.',
            )}
          </p>
          <div className="grid2">
            {locs.map((l) => (
              <label className="field" key={l.id}>
                <span>{t('items.rack', { place: pickName(l.name, l.nameKn, lang) })}</span>
                <SuggestInput value={form.racks[l.id] ?? ''} onChange={(v) => set({ racks: { ...form.racks, [l.id]: v } })} suggestions={(racks[l.id] ?? []).map((r) => ({ value: r }))} />
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
  const [countUnit, setCountUnit] = useState(defaultUnitOf(item).code);
  const unitOk = item.units.some((u) => u.code === countUnit) ? countUnit : defaultUnitOf(item).code;
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
                <td className={'num ' + (qtyAt(l.id) < 0 ? 'qty-neg' : isLowAt(item, l.id, qtyAt(l.id)) ? 'qty-low' : '')}>{describeQty(item, qtyAt(l.id), lang)}</td>
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

/**
 * The top of the Stock tab: how much there is (in the default unit, and per place), what it is
 * worth at cost, when it was last bought and sold, and how long it lasts at the recent rate.
 */
function StockSummary({ item, locs, stock, info, sups }: { item: Item; locs: Location[]; stock: StockLevel[]; info: StockInfo; sups: Supplier[] }) {
  const { lang } = useSession();
  const bi = useBi();
  const du = defaultUnitOf(item).code;
  const inDu = (base: number) => qtyInUnit(item, du, base, lang);
  const supName = (id: string) => sups.find((s) => s.id === id)?.name ?? bi('a supplier', 'ಒಬ್ಬ ಸರಬರಾಜುದಾರ');
  const qtyAt = (id: string) => stock.find((s) => s.locationId === id)?.qty ?? 0;
  return (
    <div className="card" data-tour="item-summary">
      <div className="grid2">
        <div>
          <div className="muted">{bi('In all places', 'ಎಲ್ಲಾ ಕಡೆ ಸೇರಿ')}</div>
          <b className={info.total < 0 ? 'qty-neg' : isLow(item, info.total) ? 'qty-low' : ''}>{inDu(info.total)}</b>
          <div className="muted">{locs.map((l) => pickName(l.name, l.nameKn, lang) + ': ' + inDu(qtyAt(l.id))).join(' · ')}</div>
        </div>
        <div>
          <div className="muted">{bi('Value at cost', 'ಖರೀದಿ ಬೆಲೆಯಲ್ಲಿ ಮೌಲ್ಯ')}</div>
          <b>{info.valueAtCost != null ? formatRupees(info.valueAtCost) : bi('no cost saved', 'ಖರೀದಿ ಬೆಲೆ ಇಲ್ಲ')}</b>
        </div>
        <div>
          <div className="muted">{bi('Last bought', 'ಕೊನೆಯ ಖರೀದಿ')}</div>
          {info.lastBought ? (
            <span>
              {when(info.lastBought.at, lang)} · {supName(info.lastBought.supplierId)} · {info.lastBought.qty} {info.lastBought.unit} · {formatRate(info.lastBought.cost)}/{info.lastBought.unit}
            </span>
          ) : (
            <span className="muted">{bi('not through a purchase order yet', 'ಇನ್ನೂ ಖರೀದಿ ಆರ್ಡರ್ ಮೂಲಕ ಇಲ್ಲ')}</span>
          )}
        </div>
        <div>
          <div className="muted">{bi('Last sold', 'ಕೊನೆಯ ಮಾರಾಟ')}</div>
          {info.lastSold ? (
            <span>
              {when(info.lastSold.at, lang)} · {inDu(info.lastSold.qty)}
            </span>
          ) : (
            <span className="muted">{bi('not yet', 'ಇನ್ನೂ ಇಲ್ಲ')}</span>
          )}
        </div>
        <div>
          <div className="muted">{bi('Days of stock left', 'ಎಷ್ಟು ದಿನಕ್ಕೆ ಸಾಕು')}</div>
          {info.daysLeft != null ? (
            <span>
              <b>{info.daysLeft}</b> {bi('days', 'ದಿನ')} · {bi('sold in the last 30 days', 'ಕಳೆದ 30 ದಿನ ಮಾರಾಟ')}: {inDu(info.sold30)}
            </span>
          ) : (
            <span className="muted">{bi('no sales in the last 30 days', 'ಕಳೆದ 30 ದಿನ ಮಾರಾಟ ಇಲ್ಲ')}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Who supplies this item: the ones the shop added by hand, which it can remove, and the ones
 * found in its purchase orders, with the last cost and date. A new order suggests these.
 */
function ItemSuppliersCard({
  form,
  set,
  sups,
  found,
  readOnly,
}: {
  form: ItemForm;
  set: (patch: Partial<ItemForm>) => void;
  sups: Supplier[];
  found: ItemSupplierRow[];
  readOnly: boolean;
}) {
  const { lang } = useSession();
  const bi = useBi();
  const [pick, setPick] = useState('');
  const name = (id: string) => sups.find((s) => s.id === id)?.name ?? id;
  const fromOrders = found.filter((r) => r.lastAt && !form.suppliers.includes(r.supplierId));
  const row = (id: string) => found.find((r) => r.supplierId === id);
  const choices = sups.filter((s) => s.active && !form.suppliers.includes(s.id));
  const last = (r: ItemSupplierRow | undefined) =>
    r?.lastAt ? ' · ' + bi('last', 'ಕೊನೆಗೆ') + ' ' + (r.lastCost != null ? formatRate(r.lastCost) + '/' + r.lastUnit + ', ' : '') + when(r.lastAt, lang) : '';
  return (
    <div className="card" data-tour="item-suppliers">
      <h2 className="subtitle mt-0">{bi('Suppliers', 'ಸರಬರಾಜುದಾರರು')}</h2>
      <p className="muted">
        {bi('Who brings this item. A new purchase order suggests them.', 'ಈ ಸಾಮಾನು ಯಾರು ತರುತ್ತಾರೆ. ಹೊಸ ಖರೀದಿ ಆರ್ಡರ್ ಇವರನ್ನು ಸೂಚಿಸುತ್ತದೆ.')}
      </p>
      {form.suppliers.length === 0 && fromOrders.length === 0 && <p className="muted">{bi('None yet.', 'ಇನ್ನೂ ಇಲ್ಲ.')}</p>}
      {form.suppliers.map((id) => (
        <div className="bar mb-0" key={id}>
          <span className="grow name">
            {name(id)}
            <span className="muted">{last(row(id))}</span>
          </span>
          {!readOnly && (
            <button type="button" className="btn ghost small" onClick={() => set({ suppliers: form.suppliers.filter((x) => x !== id) })}>
              {bi('Remove', 'ತೆಗೆಯಿರಿ')}
            </button>
          )}
        </div>
      ))}
      {fromOrders.map((r) => (
        <div className="bar mb-0" key={r.supplierId}>
          <span className="grow name">
            {name(r.supplierId)}
            <span className="muted">
              {last(r)} · {bi('from purchase orders', 'ಖರೀದಿ ಆರ್ಡರ್‌ಗಳಿಂದ')}
            </span>
          </span>
        </div>
      ))}
      {!readOnly && choices.length > 0 && (
        <div className="bar mt-6">
          <Select
            value={pick}
            onChange={setPick}
            className="grow"
            placeholder={bi('Choose a supplier…', 'ಸರಬರಾಜುದಾರರನ್ನು ಆರಿಸಿ…')}
            aria-label={bi('Supplier', 'ಸರಬರಾಜುದಾರ')}
            options={choices.map((s) => ({ value: s.id, label: s.name, hint: s.phone }))}
          />
          <button
            type="button"
            className="btn"
            disabled={!pick}
            onClick={() => {
              set({ suppliers: [...form.suppliers, pick] });
              setPick('');
            }}
          >
            + {bi('Add supplier', 'ಸರಬರಾಜುದಾರ ಸೇರಿಸಿ')}
          </button>
        </div>
      )}
      {!readOnly && sups.length === 0 && <p className="muted">{bi('Add suppliers under Purchases, Suppliers first.', 'ಮೊದಲು ಖರೀದಿ → ಸರಬರಾಜುದಾರರಲ್ಲಿ ಸೇರಿಸಿ.')}</p>}
    </div>
  );
}

const blankPack = (): PackRow => ({ size: '', price: '', from: '' });

/**
 * "Price by pack size" on the base unit. It opens with one row per other unit that has a size and a
 * price (and the base unit's slabs), and every edit at once writes the base price (the smallest
 * pack's rate) and one slab per other pack into the form; a row from a unit also sets that unit's
 * price. Close keeps the values; Undo puts back the units as they were when the panel opened.
 */
function PackPricer({ base, form, setForm }: { base: string; form: ItemForm; setForm: (fn: (f: ItemForm) => ItemForm) => void }) {
  const bi = useBi();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<PackRow[]>([]);
  const [before, setBefore] = useState<UnitForm[] | null>(null);
  const packs = form.units.slice(1).filter((x) => x.code.trim() && Number(x.perBase) > 0).map((x) => ({ code: x.code, size: Number(x.perBase) }));
  const n = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const edit = (next: PackRow[]) => {
    setRows(next);
    setForm((f) => applyPacks(f, next) ?? f);
  };
  const setRow = (k: number, patch: Partial<PackRow>) => edit(rows.map((x, j) => (j === k ? { ...x, ...patch } : x)));
  const result = slabsFromPacks(rows.map((r) => ({ size: n(r.size), price: n(r.price), ...(r.from.trim() ? { from: n(r.from) } : {}) })));
  const qty = (g: number) => g + ' ' + base;
  if (!open) {
    return (
      <button
        type="button"
        className="btn ghost small"
        onClick={() => {
          setBefore(form.units);
          const start = packsFromItem(form);
          edit(start.length ? start : [blankPack(), blankPack()]);
          setOpen(true);
        }}
      >
        + {bi('Price by pack size', 'ಪ್ಯಾಕ್ ಗಾತ್ರದಿಂದ ಬೆಲೆ')}
      </button>
    );
  }
  return (
    <div className="card">
      <b>{bi('Price by pack size', 'ಪ್ಯಾಕ್ ಗಾತ್ರದಿಂದ ಬೆಲೆ')}</b>
      <p className="muted">
        {bi(
          'Each pack size in ' + base + ' and its price. The smallest pack sets the price of 1 ' + base + '; each bigger pack is a price from a quantity. Changes apply at once.',
          'ಪ್ರತಿ ಪ್ಯಾಕ್‌ನ ಗಾತ್ರ (' + base + ') ಮತ್ತು ಬೆಲೆ. ಚಿಕ್ಕ ಪ್ಯಾಕ್ 1 ' + base + ' ಬೆಲೆ ನೀಡುತ್ತದೆ; ದೊಡ್ಡ ಪ್ಯಾಕ್‌ಗಳು ಪ್ರಮಾಣದಿಂದ ಬೆಲೆ ಆಗುತ್ತವೆ. ಬದಲಾವಣೆಗಳು ತಕ್ಷಣ ಅನ್ವಯವಾಗುತ್ತವೆ.',
        )}
      </p>
      {rows.map((r, k) => {
        const size = n(r.size);
        const price = n(r.price);
        const rate = size > 0 && price >= 0 ? packRate({ size, price }) : null;
        return (
          <div className="unit-grid" key={k}>
            <label className="field">
              <span>{bi('Pack size', 'ಪ್ಯಾಕ್ ಗಾತ್ರ')} ({base})</span>
              <input inputMode="decimal" value={r.size} onChange={(e) => setRow(k, { size: e.target.value })} />
            </label>
            {packs.length > 0 && (
              <label className="field">
                <span>{bi('or a unit', 'ಅಥವಾ ಘಟಕ')}</span>
                <Select
                  value={packs.find((pk) => String(pk.size) === r.size.trim())?.code ?? ''}
                  onChange={(code) => {
                    const pk = packs.find((x) => x.code === code);
                    if (pk) setRow(k, { size: String(pk.size) });
                  }}
                  aria-label={bi('or a unit', 'ಅಥವಾ ಘಟಕ')}
                  options={[{ value: '', label: '—' }, ...packs.map((pk) => ({ value: pk.code, label: pk.code + ' = ' + qty(pk.size) }))]}
                />
              </label>
            )}
            <label className="field">
              <span>{bi('Pack price', 'ಪ್ಯಾಕ್ ಬೆಲೆ')} ₹</span>
              <input inputMode="decimal" value={r.price} onChange={(e) => setRow(k, { price: e.target.value })} />
            </label>
            <label className="field">
              <span>{bi('From', 'ಇಂದ')} ({base})</span>
              <input inputMode="decimal" value={r.from} placeholder={r.size} onChange={(e) => setRow(k, { from: e.target.value })} />
            </label>
            <div className="field">
              <span>{bi('Per', 'ಪ್ರತಿ')} {base}</span>
              <b>{rate == null ? '—' : formatRate(rate)}</b>
            </div>
            <button type="button" className="btn ghost small field" aria-label={bi('Remove', 'ತೆಗೆಯಿರಿ')} onClick={() => edit(rows.filter((_, j) => j !== k))}>
              ×
            </button>
          </div>
        );
      })}
      <div className="bar">
        <button type="button" className="btn ghost small" onClick={() => setRows((x) => [...x, blankPack()])}>
          + {bi('Pack', 'ಪ್ಯಾಕ್')}
        </button>
        <button
          type="button"
          className="btn ghost small"
          onClick={() => {
            if (before) setForm((f) => ({ ...f, units: before }));
            setOpen(false);
          }}
        >
          {bi('Undo', 'ರದ್ದುಮಾಡಿ')}
        </button>
        <button type="button" className="btn ghost small" onClick={() => setOpen(false)}>
          {bi('Close', 'ಮುಚ್ಚಿ')}
        </button>
      </div>
      {result && (
        <p className="muted">
          {bi('Check', 'ಪರಿಶೀಲನೆ')}: {[...result.quotes].reverse().map((q) => qty(q.size) + ' → ' + formatRupees(q.amount)).join(', ')}
        </p>
      )}
    </div>
  );
}

/**
 * Other names as chips. A name goes in with the "+ Add" button, so it never needs the keyboard's
 * Enter key (the tablet's WebView keyboard does not add a line in a textarea). Enter in the box adds too.
 */
function AliasEditor({
  aliases,
  onChange,
  unitCodes,
  readOnly,
  label,
  pending,
  onPending,
}: {
  aliases: string;
  onChange: (aliases: string) => void;
  pending: { text: string; unit: string };
  onPending: (p: { text: string; unit: string }) => void;
  unitCodes: string[];
  readOnly?: boolean;
  label: string;
}) {
  const bi = useBi();
  const { text, unit } = pending;
  const setText = (t: string) => onPending({ text: t, unit });
  const setUnit = (u: string) => onPending({ text, unit: u });
  const chips = aliasChips(aliases);
  const full = chips.length >= MAX_ALIASES;
  const add = () => {
    const next = addAliasChip(chips, text, unitCodes.includes(unit) ? unit : '');
    if (next !== chips) onChange(aliasesFromChips(next));
    if (!full) setText('');
  };
  return (
    <div className="field">
      <span>{label}</span>
      {chips.length > 0 && (
        <div className="bar">
          {chips.map((c, i) => (
            <span key={i} className="chip on">
              {c.text}
              {c.unit ? ` · ${c.unit}` : ''}
              {!readOnly && (
                <button
                  type="button"
                  className="btn ghost small"
                  aria-label={bi('Remove', 'ತೆಗೆಯಿರಿ') + ' ' + c.text}
                  onClick={() => onChange(aliasesFromChips(chips.filter((_, j) => j !== i)))}
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {!readOnly && (
        <div className="bar mb-0">
          <input
            value={text}
            disabled={full}
            enterKeyHint="done"
            aria-label={label}
            onChange={(e) => setText(e.target.value.replace(/,/g, ' '))}
            onKeyDown={(e) => {
              // keyCode 13: some Android WebView keyboards send key "Unidentified" for Enter.
              if (e.key === 'Enter' || e.keyCode === 13) {
                e.preventDefault();
                add();
              }
            }}
          />
          <Select
            value={unit}
            onChange={setUnit}
            className="w-auto"
            disabled={full}
            aria-label={bi('Unit', 'ಘಟಕ')}
            options={[{ value: '', label: bi('any unit', 'ಯಾವುದೇ ಘಟಕ') }, ...unitCodes.map((u) => ({ value: u, label: u }))]}
          />
          <button type="button" className="btn" disabled={full || !text.trim()} onClick={add}>
            + {bi('Add', 'ಸೇರಿಸಿ')}
          </button>
        </div>
      )}
      {full && <p className="muted">{bi(`At most ${MAX_ALIASES} names.`, `ಗರಿಷ್ಠ ${MAX_ALIASES} ಹೆಸರುಗಳು.`)}</p>}
    </div>
  );
}
