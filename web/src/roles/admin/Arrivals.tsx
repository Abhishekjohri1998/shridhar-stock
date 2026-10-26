import { useEffect, useState } from 'react';
import { pickName } from '@stock/core';
import { http } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useSession } from '../../lib/session';
import { Empty, Loading, Select, useBi } from '../../components/ui';

/*
 * The shop's paper flow after the order: Allot (tick the units each carrier brings, or "Vendor
 * brings it") and Arriving (per carrier, then vendor, tick what came; only that goes into stock).
 */

const VENDOR = 'vendor';
const MAX_TICKS = 30;
const keyOf = (poId: string, itemId: string) => poId + '|' + itemId;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const clamp = (n: number, max: number) => Math.max(0, Math.min(max, r3(n)));

/** One square per unit, ticked up to `count`. Tapping a ticked square unticks it and the ones after. */
function TickBoxes({ max, count, onChange, label }: { max: number; count: number; onChange: (n: number) => void; label: string }) {
  const n = Math.floor(max);
  if (n > MAX_TICKS || n < 1) return null;
  return (
    <div className="tick-grid" role="group" aria-label={label}>
      {Array.from({ length: n }, (_, i) => {
        const on = i < count;
        return (
          <button key={i} type="button" className={'tick' + (on ? ' on' : '')} aria-pressed={on} aria-label={String(i + 1)} onClick={() => onChange(on ? i : i + 1)}>
            {on ? '✓' : ''}
          </button>
        );
      })}
    </div>
  );
}

/** The count box and, above 30 units, a stepper in place of the squares. */
function CountBox({ max, count, onChange, label }: { max: number; count: number; onChange: (n: number) => void; label: string }) {
  const bi = useBi();
  const many = Math.floor(max) > MAX_TICKS;
  return (
    <span className="bar mb-0">
      {many && (
        <button type="button" className="chip" onClick={() => onChange(clamp(count - 1, max))} aria-label={bi('One less', 'ಒಂದು ಕಡಿಮೆ')}>
          −
        </button>
      )}
      <input inputMode="decimal" className="in-qty" value={count ? String(count) : ''} placeholder="0" onChange={(e) => onChange(clamp(Number(e.target.value) || 0, max))} aria-label={label} />
      {many && (
        <button type="button" className="chip" onClick={() => onChange(clamp(count + 1, max))} aria-label={bi('One more', 'ಒಂದು ಹೆಚ್ಚು')}>
          +
        </button>
      )}
    </span>
  );
}

// ------------------------------------------------------------------ Allot

interface AllotLine {
  poId: string;
  poNo: number;
  itemId: string;
  nameEn: string;
  nameKn: string;
  unit: string;
  due: number;
  unallotted: number;
  on: { loadId: string; carrierId: string; carrierName: string; qty: number }[];
}
interface AllotView {
  carriers: { id: string; name: string; vehicleNo?: string }[];
  vendors: { supplierId: string; name: string; lines: AllotLine[] }[];
}

export function AllotTab({ onDone }: { onDone: (msg: string) => void }) {
  const bi = useBi();
  const { lang } = useSession();
  const live = useLive('pos');
  const [version, setVersion] = useState(0);
  const [view, setView] = useState<AllotView | null>(null);
  const [carrier, setCarrier] = useState(VENDOR);
  const [count, setCount] = useState<Record<string, number>>({});
  const [newName, setNewName] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    http
      .get<AllotView>('/admin/allot')
      .then(setView)
      .catch((e: Error) => setErr(e.message));
  }, [version, live]);
  if (!view) return err ? <div className="msg err">{err}</div> : <Loading />;
  const carrierName = carrier === VENDOR ? bi('Vendor brings it', 'ಮಾರಾಟಗಾರರೇ ತರುತ್ತಾರೆ') : (view.carriers.find((c) => c.id === carrier)?.name ?? '');
  const lines = Object.entries(count).filter(([, n]) => n > 0);
  const set = (k: string, n: number) => setCount({ ...count, [k]: n });
  const addCarrier = async () => {
    const name = (newName ?? '').trim();
    if (!name) return;
    setErr('');
    try {
      const c = await http.post<{ id: string }>('/admin/carriers', { name });
      setNewName(null);
      setCarrier(c.id);
      setVersion((v) => v + 1);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const allot = async () => {
    setErr('');
    setBusy(true);
    try {
      const r = await http.post<{ capped: boolean }>('/admin/loads/allot', {
        carrierId: carrier,
        lines: lines.map(([k, qty]) => {
          const [poId, itemId] = k.split('|') as [string, string];
          return { poId, itemId, qty };
        }),
      });
      setCount({});
      setVersion((v) => v + 1);
      onDone(bi('Allotted to ', 'ಇವರಿಗೆ ಹಾಕಲಾಗಿದೆ: ') + carrierName + '.' + (r.capped ? ' ' + bi('Some were already allotted: only the rest went.', 'ಕೆಲವು ಈಗಾಗಲೇ ಹಾಕಲಾಗಿತ್ತು: ಉಳಿದದ್ದು ಮಾತ್ರ ಹೋಯಿತು.') : ''));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="card" data-tour="allot-carrier">
        <b>{bi('Who brings it?', 'ಯಾರು ತರುತ್ತಾರೆ?')}</b>
        <div className="chips mt-6">
          <button type="button" className={'chip' + (carrier === VENDOR ? ' on' : '')} onClick={() => setCarrier(VENDOR)}>
            {bi('Vendor brings it', 'ಮಾರಾಟಗಾರರೇ ತರುತ್ತಾರೆ')}
          </button>
          {view.carriers.map((c) => (
            <button key={c.id} type="button" className={'chip' + (carrier === c.id ? ' on' : '')} onClick={() => setCarrier(c.id)}>
              {c.name}
            </button>
          ))}
          <button type="button" className="chip" onClick={() => setNewName(newName == null ? '' : null)}>
            + {bi('New carrier', 'ಹೊಸ ಸಾಗಣೆದಾರ')}
          </button>
        </div>
        {newName != null && (
          <div className="bar mt-6">
            <input className="grow" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={bi('Owner or driver name', 'ಮಾಲೀಕ ಅಥವಾ ಚಾಲಕರ ಹೆಸರು')} aria-label={bi('New carrier', 'ಹೊಸ ಸಾಗಣೆದಾರ')} />
            <button type="button" className="btn" disabled={!newName.trim()} onClick={addCarrier}>
              {bi('Add', 'ಸೇರಿಸಿ')}
            </button>
          </div>
        )}
      </div>
      {err && <div className="msg err">{err}</div>}
      {view.vendors.length === 0 && <Empty tour="allot-vendors">{bi('Nothing on order is waiting to be allotted.', 'ಹಾಕಲು ಯಾವ ಆರ್ಡರ್ ಸಾಮಾನೂ ಬಾಕಿ ಇಲ್ಲ.')}</Empty>}
      {view.vendors.map((v) => {
        const free = v.lines.filter((l) => l.unallotted > 0);
        const all = free.length > 0 && free.every((l) => (count[keyOf(l.poId, l.itemId)] ?? 0) >= l.unallotted);
        return (
          <div className="card" key={v.supplierId} data-tour="allot-vendors">
            <div className="bar">
              <b className="grow">{v.name}</b>
              {free.length > 0 && (
                <label className="check mb-0">
                  <input
                    type="checkbox"
                    checked={all}
                    onChange={(e) => {
                      const n = { ...count };
                      for (const l of free) n[keyOf(l.poId, l.itemId)] = e.target.checked ? l.unallotted : 0;
                      setCount(n);
                    }}
                  />
                  {bi('All', 'ಎಲ್ಲ')}
                </label>
              )}
            </div>
            {v.lines.map((l) => {
              const k = keyOf(l.poId, l.itemId);
              const c = count[k] ?? 0;
              const name = pickName(l.nameEn, l.nameKn, lang);
              return (
                <div className="tick-row" key={k}>
                  <div className="bar mb-0">
                    <span className="grow">
                      {name} · {l.unit} · <span className="muted">#{l.poNo}</span>
                    </span>
                    {l.unallotted > 0 && <CountBox max={l.unallotted} count={c} onChange={(n) => set(k, n)} label={bi('How many', 'ಎಷ್ಟು')} />}
                  </div>
                  {l.unallotted > 0 && <TickBoxes max={l.unallotted} count={c} onChange={(n) => set(k, n)} label={name} />}
                  {Math.floor(l.unallotted) > MAX_TICKS && <div className="muted">{bi('Many units: use the count, or All.', 'ತುಂಬಾ ಘಟಕಗಳು: ಎಣಿಕೆ ಅಥವಾ ಎಲ್ಲ ಬಳಸಿ.')}</div>}
                  <div className="muted">
                    {l.unallotted > 0 ? bi('Not yet allotted ', 'ಇನ್ನೂ ಹಾಕಿಲ್ಲ ') + l.unallotted : bi('All allotted', 'ಎಲ್ಲ ಹಾಕಲಾಗಿದೆ')}
                    {l.on.map((o) => (
                      <span key={o.loadId}>
                        {' · '}
                        {bi('on ', '')}
                        {o.carrierId === VENDOR ? bi('Vendor brings it', 'ಮಾರಾಟಗಾರರೇ ತರುತ್ತಾರೆ') : o.carrierName} {o.qty}
                        {lang === 'kn' ? ' ರಲ್ಲಿ' : ''}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      {view.vendors.length > 0 && (
        <div className="bar">
          <button type="button" className="btn primary" disabled={busy || !lines.length} onClick={allot} data-tour="allot-save">
            {bi('Allot to ', 'ಇವರಿಗೆ ಹಾಕಿ: ') + carrierName}
          </button>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ Arriving

interface ArrLine {
  poId: string;
  poNo: number;
  itemId: string;
  nameEn: string;
  nameKn: string;
  unit: string;
  onLoad: number;
  received: number;
  due: number;
  ratePerUnit?: number;
  placeId?: string;
}
interface ArrLoad {
  id: string;
  carrierId: string;
  carrierName: string;
  vehicleNo?: string;
  driverName?: string;
  date: string;
  notes: string;
  vendors: { supplierId: string; name: string; lines: ArrLine[] }[];
}
interface ArrView {
  loads: ArrLoad[];
  places: { id: string; name: string; nameKn: string }[];
  canRate: boolean;
}

/** Arriving: for the admin (with delivery ₹/unit) and the worker screens (without). */
export function ArrivingTab({ onDone }: { onDone?: (msg: string) => void }) {
  const bi = useBi();
  const live = useLive('pos');
  const [version, setVersion] = useState(0);
  const [view, setView] = useState<ArrView | null>(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    http
      .get<ArrView>('/arriving')
      .then(setView)
      .catch((e: Error) => setErr(e.message));
  }, [version, live]);
  if (!view) return err ? <div className="msg err">{err}</div> : <Loading />;
  const done = (m: string) => {
    setVersion((v) => v + 1);
    if (onDone) onDone(m);
    else setNote(m);
  };
  return (
    <>
      {err && <div className="msg err">{err}</div>}
      {note && <div className="msg ok">{note}</div>}
      {view.loads.length === 0 && <Empty tour="arriving-carrier">{bi('Nothing is on the way. Allot goods to a carrier first.', 'ಯಾವುದೂ ದಾರಿಯಲ್ಲಿಲ್ಲ. ಮೊದಲು ಸಾಮಾನನ್ನು ಸಾಗಣೆದಾರರಿಗೆ ಹಾಕಿ.')}</Empty>}
      {view.loads.map((ld) => (
        <ArrivingLoad key={ld.id + ':' + version} ld={ld} places={view.places} canRate={view.canRate} onDone={done} />
      ))}
    </>
  );
}

function ArrivingLoad({ ld, places, canRate, onDone }: { ld: ArrLoad; places: ArrView['places']; canRate: boolean; onDone: (m: string) => void }) {
  const bi = useBi();
  const { lang } = useSession();
  const all = ld.vendors.flatMap((v) => v.lines);
  const [count, setCount] = useState<Record<string, number>>({});
  const [rate, setRate] = useState<Record<string, string>>(() => Object.fromEntries(all.map((l) => [keyOf(l.poId, l.itemId), l.ratePerUnit != null ? String(l.ratePerUnit) : ''])));
  const [del, setDel] = useState<Set<string>>(new Set());
  const [storeIn, setStoreIn] = useState<Record<string, string>>(() => Object.fromEntries(all.map((l) => [keyOf(l.poId, l.itemId), l.placeId ?? places[0]?.id ?? ''])));
  const [split, setSplit] = useState<Record<string, Record<string, string>>>({});
  const [notes, setNotes] = useState(ld.notes);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const splitSum = (k: string) => r3(Object.values(split[k] ?? {}).reduce((n, x) => n + (Number(x) || 0), 0));
  const splitBad = (k: string) => !!split[k] && !del.has(k) && (count[k] ?? 0) > 0 && Math.abs(splitSum(k) - (count[k] ?? 0)) > 1e-6;
  const anyBad = all.some((l) => splitBad(keyOf(l.poId, l.itemId)));
  const into = r3(all.reduce((n, l) => n + (del.has(keyOf(l.poId, l.itemId)) ? 0 : (count[keyOf(l.poId, l.itemId)] ?? 0)), 0));
  const removed = all.filter((l) => del.has(keyOf(l.poId, l.itemId)));
  const stay = r3(all.reduce((n, l) => n + (del.has(keyOf(l.poId, l.itemId)) ? 0 : l.onLoad - (count[keyOf(l.poId, l.itemId)] ?? 0)), 0));
  const changedRate = canRate && all.some((l) => rate[keyOf(l.poId, l.itemId)] !== String(l.ratePerUnit ?? ''));
  const nothing = !into && !removed.length && notes === ld.notes && !changedRate;
  const save = async () => {
    const summary =
      bi(into + ' units into stock, ' + stay + ' stay waiting', into + ' ಘಟಕ ಸ್ಟಾಕಿಗೆ, ' + stay + ' ಕಾಯುತ್ತವೆ') + (removed.length ? bi(', ' + removed.length + ' taken off this carrier', ', ' + removed.length + ' ಈ ಸಾಗಣೆದಾರರಿಂದ ತೆಗೆದಿದೆ') : '') + '. ' + bi('Save?', 'ಉಳಿಸಬೇಕೆ?');
    if (!window.confirm(summary)) return;
    setErr('');
    setBusy(true);
    try {
      const lines = all
        .map((l) => {
          const k = keyOf(l.poId, l.itemId);
          const n = count[k] ?? 0;
          const r = canRate && rate[k] !== String(l.ratePerUnit ?? '') && rate[k] !== '' ? { ratePerUnit: Number(rate[k]) || 0 } : {};
          if (del.has(k)) return { poId: l.poId, itemId: l.itemId, arrived: 0, remove: true };
          if (!n && !('ratePerUnit' in r)) return null;
          const where = split[k] ? { places: places.map((p) => ({ placeId: p.id, qty: Number(split[k]![p.id]) || 0 })).filter((p) => p.qty > 0) } : storeIn[k] ? { placeId: storeIn[k] } : {};
          return { poId: l.poId, itemId: l.itemId, arrived: n, ...r, ...(n ? where : {}) };
        })
        .filter((x) => x != null);
      await http.post('/arriving/' + ld.id + '/save', { notes: notes.trim(), lines });
      onDone(bi('Saved: ' + into + ' units into stock, ' + stay + ' stay waiting.', 'ಉಳಿಸಲಾಗಿದೆ: ' + into + ' ಘಟಕ ಸ್ಟಾಕಿಗೆ, ' + stay + ' ಕಾಯುತ್ತವೆ.'));
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="card" data-tour="arriving-carrier">
      <b>{ld.carrierId === VENDOR ? bi('Vendor brings it', 'ಮಾರಾಟಗಾರರೇ ತರುತ್ತಾರೆ') : ld.carrierName}</b>
      <div className="muted">
        {[ld.vehicleNo, ld.driverName, ld.date].filter(Boolean).join(' · ')}
      </div>
      {err && <div className="msg err">{err}</div>}
      {ld.vendors.map((v) => {
        const open = v.lines.filter((l) => !del.has(keyOf(l.poId, l.itemId)));
        const allOn = open.length > 0 && open.every((l) => (count[keyOf(l.poId, l.itemId)] ?? 0) >= l.onLoad);
        return (
          <div className="card mt-8" key={v.supplierId} data-tour="arriving-vendor">
            <div className="bar">
              <b className="grow">{v.name}</b>
              <label className="check mb-0">
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={(e) => {
                    const n = { ...count };
                    for (const l of open) n[keyOf(l.poId, l.itemId)] = e.target.checked ? l.onLoad : 0;
                    setCount(n);
                  }}
                />
                {bi('All', 'ಎಲ್ಲ')}
              </label>
            </div>
            {v.lines.map((l) => {
              const k = keyOf(l.poId, l.itemId);
              const c = count[k] ?? 0;
              const name = pickName(l.nameEn, l.nameKn, lang);
              const gone = del.has(k);
              const set = (n: number) => setCount({ ...count, [k]: n });
              return (
                <div className="tick-row" key={k}>
                  <div className="bar mb-0">
                    <span className={'grow' + (gone ? ' muted' : '')}>
                      {name} · {l.unit} · {bi('on load ', 'ಸಾಗಣೆಯಲ್ಲಿ ')}
                      {l.onLoad}
                    </span>
                    {!gone && <CountBox max={l.onLoad} count={c} onChange={set} label={bi('Arrived', 'ಬಂದದ್ದು')} />}
                    <button
                      type="button"
                      className={'chip' + (gone ? ' on' : '')}
                      onClick={() => {
                        const n = new Set(del);
                        if (gone) n.delete(k);
                        else n.add(k);
                        setDel(n);
                      }}
                      title={bi('Take it off this carrier: back to "not yet allotted"', 'ಈ ಸಾಗಣೆದಾರರಿಂದ ತೆಗೆಯಿರಿ: ಮತ್ತೆ "ಹಾಕಿಲ್ಲ"ಕ್ಕೆ')}
                    >
                      {gone ? bi('Undo', 'ರದ್ದು') : bi('Del', 'ತೆಗೆ')}
                    </button>
                  </div>
                  {!gone && (
                    <>
                      <TickBoxes max={l.onLoad} count={c} onChange={set} label={name} />
                      <div className="bar mt-6">
                        {canRate && (
                          <label className="field mb-0">
                            <span>{bi('Delivery ₹/unit', 'ಸಾಗಣೆ ₹/ಘಟಕ')}</span>
                            <input inputMode="decimal" className="in-price" value={rate[k] ?? ''} onChange={(e) => setRate({ ...rate, [k]: e.target.value })} aria-label={bi('Delivery charge per unit', 'ಪ್ರತಿ ಘಟಕ ಸಾಗಣೆ ವೆಚ್ಚ')} />
                          </label>
                        )}
                        {!split[k] && (
                          <label className="field grow mb-0">
                            <span>{bi('Store in', 'ಇಡುವುದು')}</span>
                            <Select value={storeIn[k] ?? ''} onChange={(x) => setStoreIn({ ...storeIn, [k]: x })} aria-label={bi('Store in', 'ಇಡುವುದು')} options={places.map((x) => ({ value: x.id, label: pickName(x.name, x.nameKn, lang) }))} />
                          </label>
                        )}
                        <button
                          type="button"
                          className={'chip' + (split[k] ? ' on' : '')}
                          onClick={() => (split[k] ? setSplit(Object.fromEntries(Object.entries(split).filter(([x]) => x !== k))) : setSplit({ ...split, [k]: Object.fromEntries(places.map((x) => [x.id, x.id === storeIn[k] && c ? String(c) : ''])) }))}
                        >
                          {bi('Split', 'ಹಂಚಿ')}
                        </button>
                      </div>
                      {split[k] && (
                        <div className="split-places">
                          {places.map((x) => (
                            <label key={x.id} className="bar mb-0">
                              <span className="grow">{pickName(x.name, x.nameKn, lang)}</span>
                              <input inputMode="decimal" className="in-qty" value={split[k]![x.id] ?? ''} onChange={(e) => setSplit({ ...split, [k]: { ...split[k]!, [x.id]: e.target.value } })} aria-label={pickName(x.name, x.nameKn, lang)} /> {l.unit}
                            </label>
                          ))}
                          <div className={splitBad(k) ? 'msg err' : 'muted'} aria-live="polite">
                            {splitSum(k)} / {c} {l.unit}
                            {splitBad(k) && ' · ' + bi('must add up to what arrived', 'ಬಂದದ್ದಕ್ಕೆ ಸಮ ಆಗಬೇಕು')}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
      <label className="field mt-8" data-tour="arriving-notes">
        <span>{bi('Notes', 'ಟಿಪ್ಪಣಿ')}</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder={bi('Anything about this load (optional)', 'ಈ ಸಾಗಣೆಯ ಬಗ್ಗೆ ಏನಾದರೂ (ಬೇಕಿದ್ದರೆ)')} />
      </label>
      <div className="bar">
        <button type="button" className="btn primary" disabled={busy || anyBad || nothing} onClick={save} data-tour="arriving-save">
          {bi('Finish / Save', 'ಮುಗಿಸಿ / ಉಳಿಸಿ')}
        </button>
        <span className="muted">
          {bi(into + ' into stock · ' + stay + ' stay waiting', into + ' ಸ್ಟಾಕಿಗೆ · ' + stay + ' ಕಾಯುತ್ತವೆ')}
        </span>
      </div>
    </div>
  );
}

/** The worker screens' Arriving tab: the same component, rates hidden by the server for workers. */
export function ArrivingPage() {
  const bi = useBi();
  return (
    <>
      <h1 className="title">{bi('Arriving', 'ಬರುತ್ತಿರುವ ಸಾಮಾನು')}</h1>
      <ArrivingTab />
    </>
  );
}
