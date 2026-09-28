import { Fragment, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ADJUST_REASONS,
  describeQty,
  itemMatches,
  pickName,
  type AdjustReason,
  type Item,
  type Location,
  type MsgKey,
  type StockMove,
} from '@stock/core';
import { api } from '../../lib/api';
import { useLoad, useSession } from '../../lib/session';

export function StockPage() {
  const { t, lang } = useSession();
  const [params, setParams] = useSearchParams();
  const onlyLow = params.get('low') === '1';
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const { value, error, reload } = useLoad(async () => {
    const [items, stock, locs] = await Promise.all([api.items(), api.stock(), api.locations()]);
    return { items, stock, locs: locs.filter((l) => l.active) };
  });

  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <p className="muted">{t('common.loading')}</p>;
  const { items, stock, locs } = value;
  const qty = new Map(stock.map((s) => [s.itemId + '|' + s.locationId, s.qty]));
  const qtyOf = (i: Item, l: Location) => qty.get(i.id + '|' + l.id) ?? 0;
  const isLow = (i: Item, l: Location) => i.reorderAt[l.id] != null && qtyOf(i, l) < i.reorderAt[l.id]!;
  const shop = locs.find((l) => l.kind === 'shop');
  const shown = items.filter((i) => (!q.trim() || itemMatches(i, q)) && (!onlyLow || (shop && isLow(i, shop))));

  const recount = async () => {
    const r = await api.recount();
    setNote(t('stock.recountDone', { n: r.checked, d: r.fixed.length }));
    reload();
  };

  return (
    <>
      <h1 className="title">{t('stock.title')}</h1>
      {note && <div className="msg ok">{note}</div>}
      <div className="bar">
        <input className="grow" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setParams(e.target.checked ? { low: '1' } : {})} />
          {t('stock.onlyLow')}
        </label>
        <button className="btn" onClick={recount}>
          {t('stock.recount')}
        </button>
      </div>
      {shown.length === 0 ? (
        <div className="card">{t('common.none')}</div>
      ) : (
        <div className="scroll">
          <table className="list">
            <thead>
              <tr>
                <th>{t('stock.item')}</th>
                {locs.map((l) => (
                  <th key={l.id} className="num">
                    {pickName(l.name, l.nameKn, lang)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => (
                <Fragment key={i.id}>
                  <tr className="link" onClick={() => setOpen(open === i.id ? null : i.id)}>
                    <td className="name">{pickName(i.nameEn, i.nameKn, lang)}</td>
                    {locs.map((l) => {
                      const v = qtyOf(i, l);
                      return (
                        <td key={l.id} className={'num ' + (v < 0 ? 'qty-neg' : isLow(i, l) ? 'qty-low' : '')}>
                          {describeQty(i, v, lang)}
                          {i.racks[l.id] && <div className="muted">{i.racks[l.id]}</div>}
                        </td>
                      );
                    })}
                  </tr>
                  {open === i.id && (
                    <tr>
                      <td colSpan={locs.length + 1}>
                        <ItemStock item={i} locs={locs} onChanged={reload} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ItemStock({ item, locs, onChanged }: { item: Item; locs: Location[]; onChanged: () => void }) {
  const { t, lang } = useSession();
  const [loc, setLoc] = useState(locs[0]?.id ?? '');
  const [actual, setActual] = useState('');
  const [reason, setReason] = useState<AdjustReason>('counted');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const moves = useLoad(() => api.moves(item.id), [item.id]);
  const placeName = (id?: string) => {
    const l = locs.find((x) => x.id === id);
    return l ? pickName(l.name, l.nameKn, lang) : '';
  };

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setActual('');
      setNote('');
      moves.reload();
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() =>
      api.adjust({
        itemId: item.id,
        locationId: loc,
        actual: Number(actual),
        reason,
        ...(note.trim() ? { note } : {}),
        requestId: crypto.randomUUID(),
      }),
    );
  };

  const isFirst = (moves.value ?? []).every((m: StockMove) => m.from !== loc && m.to !== loc);
  return (
    <div>
      {error && <div className="msg err">{error}</div>}
      <form className="grid2" onSubmit={submit}>
        <label className="field">
          <span>{t('places.title')}</span>
          <select value={loc} onChange={(e) => setLoc(e.target.value)}>
            {locs.map((l) => (
              <option key={l.id} value={l.id}>
                {pickName(l.name, l.nameKn, lang)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            {t('stock.actual')} · {item.units[0]!.code}
          </span>
          <input inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value)} />
        </label>
        {!isFirst && (
          <>
            <label className="field">
              <span>{t('stock.reason')}</span>
              <select value={reason} onChange={(e) => setReason(e.target.value as AdjustReason)}>
                {ADJUST_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {t(('stock.reason.' + r) as MsgKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('stock.note')}</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </>
        )}
        <div className="bar">
          {isFirst ? (
            <button
              type="button"
              className="btn primary"
              disabled={busy || actual.trim() === ''}
              onClick={() => run(() => api.openStock(item.id, loc, Number(actual)))}
            >
              {t('stock.open')}
            </button>
          ) : (
            <button className="btn primary" disabled={busy || actual.trim() === ''}>
              {t('stock.adjust')}
            </button>
          )}
        </div>
      </form>
      <h3 className="subtitle">{t('stock.moves')}</h3>
      {(moves.value ?? []).length === 0 && <p className="muted">{t('common.none')}</p>}
      {(moves.value ?? []).map((m) => (
        <div key={m.id} className="muted" style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
          {new Date(m.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
          <b>{t(('stock.kind.' + m.kind) as MsgKey)}</b> · {m.from ? placeName(m.from) + ' −' : placeName(m.to) + ' +'}
          {describeQty(item, m.qty, lang)}
          {m.kind === 'adjust' && ' · ' + t(('stock.reason.' + m.ref) as MsgKey)}
          {m.note && ' · ' + m.note}
        </div>
      ))}
    </div>
  );
}
