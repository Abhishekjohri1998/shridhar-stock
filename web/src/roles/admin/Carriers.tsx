import { useState } from 'react';
import { deliveryRows, formatRate, pickName, round2, type Carrier, type CarrierLoad, type CarrierTrip, type DeliveryChecklist, type Item, type Supplier } from '@stock/core';
import { api, http } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { Empty, Loading, Money, Select, Table, useBi } from '../../components/ui';
import { useItemSearch } from './Buying';

/** Today in India, YYYY-MM-DD. */
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** A delivery checklist this carrier brought, with its order and supplier. */
type CarrierDelivery = DeliveryChecklist & { poId: string; poNo: number; supplierId: string };

type ItemName = Pick<Item, 'id' | 'nameEn' | 'nameKn' | 'units'>;

/**
 * Buy & move → Carriers: the daily vehicles that bring goods from suppliers who do not deliver.
 * Each carrier keeps their trips: the date, the supplier, what was brought and the charge. When
 * the order is received, linking its trip spreads that charge into the items' cost.
 */
export function CarriersPage() {
  const bi = useBi();
  const { lang } = useSession();
  const [version, setVersion] = useState(0);
  const live = useLive('pos');
  const { value, error } = useLoad(async () => {
    const [data, sups, items, loads] = await Promise.all([http.get<{ carriers: Carrier[]; trips: CarrierTrip[]; deliveries?: CarrierDelivery[] }>('/admin/carriers'), http.get<Supplier[]>('/admin/suppliers'), api.items(true), http.get<CarrierLoad[]>('/admin/loads')]);
    return { ...data, sups, loads, items: new Map<string, ItemName>(items.map((i) => [i.id, i])) };
  }, [version, live]);
  const [editing, setEditing] = useState<Carrier | 'new' | null>(null);
  const [tripFor, setTripFor] = useState<{ carrierId: string; trip?: CarrierTrip } | null>(null);
  const [note, setNote] = useState('');
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const done = (msg = '') => {
    setEditing(null);
    setTripFor(null);
    setNote(msg);
    setVersion((v) => v + 1);
  };
  const supName = (id?: string) => (id ? (value.sups.find((s) => s.id === id)?.name ?? id) : '');
  return (
    <>
      <h1 className="title">{bi('Carriers', 'ಸಾಗಣೆದಾರರು')}</h1>
      <p className="muted">{bi('Vehicles that bring goods from suppliers, and what each trip charged.', 'ಸರಬರಾಜುದಾರರಿಂದ ಸಾಮಾನು ತರುವ ವಾಹನಗಳು, ಪ್ರತಿ ಓಡಾಟದ ಬಾಡಿಗೆ.')}</p>
      {note && <div className="msg ok">{note}</div>}
      <div className="bar">
        <button className="btn primary" onClick={() => setEditing('new')} data-tour="carriers-new">
          + {bi('New carrier', 'ಹೊಸ ಸಾಗಣೆದಾರ')}
        </button>
      </div>
      {editing && <CarrierForm c={editing === 'new' ? null : editing} onDone={done} />}
      {value.carriers.length === 0 && !editing && <Empty>{bi('No carriers yet. Add the vehicles that bring your goods.', 'ಇನ್ನೂ ಸಾಗಣೆದಾರರಿಲ್ಲ. ನಿಮ್ಮ ಸಾಮಾನು ತರುವ ವಾಹನಗಳನ್ನು ಸೇರಿಸಿ.')}</Empty>}
      {value.carriers.map((c) => {
        const trips = value.trips.filter((t) => t.carrierId === c.id);
        const brought = (value.deliveries ?? []).filter((d) => d.carrierId === c.id);
        const loads = value.loads.filter((l) => l.carrierId === c.id && l.lines.some((x) => x.received && x.received.qty > 0));
        return (
          <div className="card carrier-card" key={c.id} data-carrier={c.id}>
            <div className="bar between">
              <span className="name">
                {c.name}
                {c.vehicleNo && <span className="muted"> · {c.vehicleNo}</span>}
                {!c.active && <span className="pill bad"> {bi('Switched off', 'ನಿಲ್ಲಿಸಲಾಗಿದೆ')}</span>}
              </span>
              <span className="bar">
                {c.phone && <a href={'tel:' + c.phone}>{c.phone}</a>}
                <button className="btn small" onClick={() => setEditing(c)}>
                  {bi('Edit', 'ಬದಲಿಸಿ')}
                </button>
                {c.active && (
                  <button className="btn small primary" onClick={() => setTripFor({ carrierId: c.id })}>
                    + {bi('Trip', 'ಓಡಾಟ')}
                  </button>
                )}
              </span>
            </div>
            {c.notes && <div className="muted">{c.notes}</div>}
            {tripFor?.carrierId === c.id && <TripForm carrierId={c.id} trip={tripFor.trip} sups={value.sups} items={value.items} onDone={done} />}
            {trips.length > 0 && (
              <ul className="trip-list">
                {trips.map((t) => (
                  <li key={t.id}>
                    <span className="trip-date">{t.date}</span>
                    <span className="grow">
                      {supName(t.supplierId) && <b>{supName(t.supplierId)}</b>}
                      {t.lines.length > 0 && (
                        <span className="muted">
                          {' '}
                          ·{' '}
                          {t.lines
                            .map((l) => {
                              const it = value.items.get(l.itemId);
                              return (it ? pickName(it.nameEn, it.nameKn, lang) : l.itemId) + ' ' + l.qty + ' ' + l.unit;
                            })
                            .join(', ')}
                        </span>
                      )}
                    </span>
                    <Money v={t.charge} />
                    {t.poId ? (
                      <span className="pill ok">{bi('in order', 'ಆರ್ಡರ್‌ನಲ್ಲಿ')} #{t.poId.replace(/^po_/, '')}</span>
                    ) : (
                      <button className="btn ghost small" onClick={() => setTripFor({ carrierId: c.id, trip: t })}>
                        {bi('Edit', 'ಬದಲಿಸಿ')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {loads.length > 0 && (
              <>
                <div className="muted mt-10">{bi('Loads brought', 'ತಂದ ಲೋಡುಗಳು')} · {loads.length}</div>
                {loads.map((l) => (
                  <LoadCharges key={l.id + ':' + version} ld={l} items={value.items} onDone={done} />
                ))}
              </>
            )}
            {brought.length > 0 && (
              <>
                <div className="muted mt-10">{bi('Deliveries brought', 'ತಂದ ಸಾಮಾನು')} · {brought.length}</div>
                <ul className="trip-list" data-carrier-deliveries={c.id}>
                  {brought.map((d) => {
                    const short = d.lines.filter((l) => l.condition !== 'ok' || l.arrived < l.ordered).length;
                    return (
                      <li key={d.id}>
                        <span className="trip-date">{d.at.slice(0, 10)}</span>
                        <span className="grow">
                          <b>{supName(d.supplierId)}</b> · #{d.poNo}
                          {d.vehicleNo && <span className="muted"> · {d.vehicleNo}</span>}
                          <span className="muted">
                            {' '}
                            · {d.lines.filter((l) => l.ok).length}/{d.lines.length} {bi('ticked', 'ಗುರುತು')}
                          </span>
                        </span>
                        {short > 0 ? <span className="pill warn">{short} {bi('short or damaged', 'ಕಡಿಮೆ ಅಥವಾ ಹಾಳು')}</span> : <span className="pill ok">{bi('All OK', 'ಎಲ್ಲಾ ಸರಿ')}</span>}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

function CarrierForm({ c, onDone }: { c: Carrier | null; onDone: (msg?: string) => void }) {
  const bi = useBi();
  const [name, setName] = useState(c?.name ?? '');
  const [phone, setPhone] = useState(c?.phone ?? '');
  const [vehicleNo, setVehicle] = useState(c?.vehicleNo ?? '');
  const [notes, setNotes] = useState(c?.notes ?? '');
  const [err, setErr] = useState('');
  const save = async (active?: boolean) => {
    setErr('');
    try {
      const body = { name, phone, vehicleNo, notes, ...(active != null ? { active } : {}) };
      if (c) await http.put('/admin/carriers/' + c.id, body);
      else await http.post('/admin/carriers', body);
      onDone(bi('Carrier saved.', 'ಸಾಗಣೆದಾರ ಉಳಿಸಲಾಗಿದೆ.'));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="card">
      {err && <div className="msg err">{err}</div>}
      <div className="grid2">
        <label className="field">
          <span>{bi('Owner or driver', 'ಮಾಲೀಕ ಅಥವಾ ಚಾಲಕ')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{bi('Phone', 'ಫೋನ್')}</span>
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field">
          <span>{bi('Vehicle number', 'ವಾಹನ ಸಂಖ್ಯೆ')}</span>
          <input value={vehicleNo} onChange={(e) => setVehicle(e.target.value)} placeholder="KA 01 AB 1234" />
        </label>
        <label className="field">
          <span>{bi('Notes', 'ಟಿಪ್ಪಣಿ')}</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={bi('Which route, which days', 'ಯಾವ ದಾರಿ, ಯಾವ ದಿನಗಳು')} />
        </label>
      </div>
      <div className="bar">
        <button className="btn primary" onClick={() => save()}>
          {bi('Save', 'ಉಳಿಸಿ')}
        </button>
        {c && (
          <button className="btn" onClick={() => save(!c.active)}>
            {c.active ? bi('Switch off', 'ನಿಲ್ಲಿಸಿ') : bi('Switch on', 'ಆರಂಭಿಸಿ')}
          </button>
        )}
        <button className="btn" onClick={() => onDone()}>
          {bi('Cancel', 'ರದ್ದು')}
        </button>
      </div>
    </div>
  );
}

interface LineIn {
  itemId: string;
  unit: string;
  qty: string;
  value: string;
}

function TripForm({ carrierId, trip, sups, items, onDone }: { carrierId: string; trip?: CarrierTrip; sups: Supplier[]; items: Map<string, ItemName>; onDone: (msg?: string) => void }) {
  const bi = useBi();
  const { lang } = useSession();
  const [date, setDate] = useState(trip?.date ?? today());
  const [supplierId, setSupplier] = useState(trip?.supplierId ?? '');
  const [charge, setCharge] = useState(trip ? String(trip.charge) : '');
  const [lines, setLines] = useState<LineIn[]>(() => (trip?.lines ?? []).map((l) => ({ itemId: l.itemId, unit: l.unit, qty: String(l.qty), value: l.value != null ? String(l.value) : '' })));
  const [q, setQ] = useState('');
  const found = useItemSearch(q).filter((i) => !lines.some((l) => l.itemId === i.id));
  const [err, setErr] = useState('');
  const set = (i: number, patch: Partial<LineIn>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const save = async () => {
    setErr('');
    try {
      const body = {
        date,
        carrierId,
        ...(supplierId ? { supplierId } : {}),
        charge: Number(charge) || 0,
        lines: lines.filter((l) => Number(l.qty) > 0).map((l) => ({ itemId: l.itemId, unit: l.unit, qty: Number(l.qty), ...(Number(l.value) > 0 ? { value: Number(l.value) } : {}) })),
      };
      if (trip) await http.put('/admin/trips/' + trip.id, body);
      else await http.post('/admin/trips', body);
      onDone(bi('Trip saved. Link it when you receive the order, and its charge goes into the cost.', 'ಓಡಾಟ ಉಳಿಸಲಾಗಿದೆ. ಆರ್ಡರ್ ಬಂದಾಗ ಜೋಡಿಸಿ, ಬಾಡಿಗೆ ಖರೀದಿ ಬೆಲೆಗೆ ಸೇರುತ್ತದೆ.'));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const remove = async () => {
    if (!trip) return;
    try {
      await http.del('/admin/trips/' + trip.id);
      onDone(bi('Trip removed.', 'ಓಡಾಟ ತೆಗೆಯಲಾಗಿದೆ.'));
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="card trip-form">
      {err && <div className="msg err">{err}</div>}
      <div className="grid2">
        <label className="field">
          <span>{bi('Date', 'ದಿನಾಂಕ')}</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="field">
          <span>{bi('From supplier', 'ಸರಬರಾಜುದಾರರಿಂದ')}</span>
          <Select
            value={supplierId}
            onChange={setSupplier}
            aria-label={bi('From supplier', 'ಸರಬರಾಜುದಾರರಿಂದ')}
            options={[{ value: '', label: bi('Not said', 'ಹೇಳಿಲ್ಲ') }, ...sups.filter((s) => s.active || s.id === supplierId).map((s) => ({ value: s.id, label: s.name }))]}
          />
        </label>
        <label className="field">
          <span>{bi('Charge ₹', 'ಬಾಡಿಗೆ ₹')}</span>
          <input inputMode="decimal" value={charge} onChange={(e) => setCharge(e.target.value)} />
        </label>
      </div>
      <input placeholder={bi('Add what it brought…', 'ತಂದ ಸಾಮಾನು ಸೇರಿಸಿ…')} value={q} onChange={(e) => setQ(e.target.value)} />
      {found.length > 0 && (
        <div className="chips mt-6">
          {found.map((i) => (
            <button
              key={i.id}
              className="chip"
              onClick={() => {
                const u = i.defaultUnit ? i.units.find((x) => x.code === i.defaultUnit) : [...i.units].sort((a, b) => b.perBase - a.perBase)[0];
                items.set(i.id, i);
                setLines([...lines, { itemId: i.id, unit: u?.code ?? i.units[0]!.code, qty: '1', value: '' }]);
                setQ('');
              }}
            >
              {pickName(i.nameEn, i.nameKn, lang)}
            </button>
          ))}
        </div>
      )}
      {lines.map((l, i) => {
        const it = items.get(l.itemId);
        return (
          <div className="bar mt-6" key={l.itemId}>
            <span className="grow name">{it ? pickName(it.nameEn, it.nameKn, lang) : l.itemId}</span>
            <input inputMode="decimal" className="in-qty" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} aria-label={bi('Quantity', 'ಪ್ರಮಾಣ')} />
            <Select value={l.unit} onChange={(unit) => set(i, { unit })} className="w-auto" aria-label={bi('Unit', 'ಘಟಕ')} options={(it?.units ?? [{ code: l.unit, label: l.unit, labelKn: '' }]).map((u) => ({ value: u.code, label: (lang === 'kn' && u.labelKn) || u.label }))} />
            ₹<input inputMode="decimal" className="in-price" value={l.value} placeholder={bi('value', 'ಮೌಲ್ಯ')} onChange={(e) => set(i, { value: e.target.value })} aria-label={bi('Value, if known', 'ಮೌಲ್ಯ, ಗೊತ್ತಿದ್ದರೆ')} />
            <button className="btn ghost small" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={bi('Remove', 'ತೆಗೆಯಿರಿ')}>
              ✕
            </button>
          </div>
        );
      })}
      {lines.length > 0 && Number(charge) > 0 && (
        <div className="muted mt-6">
          {bi('The charge is shared by value when every line has one, else by quantity.', 'ಎಲ್ಲ ಸಾಲಿಗೂ ಮೌಲ್ಯ ಇದ್ದರೆ ಬಾಡಿಗೆ ಮೌಲ್ಯದಂತೆ, ಇಲ್ಲದಿದ್ದರೆ ಪ್ರಮಾಣದಂತೆ ಹಂಚುತ್ತದೆ.')} ({formatRate(Number(charge))})
        </div>
      )}
      <div className="bar mt-10">
        <button className="btn primary" onClick={save} disabled={!date}>
          {bi('Save trip', 'ಓಡಾಟ ಉಳಿಸಿ')}
        </button>
        {trip && (
          <button className="btn" onClick={remove}>
            {bi('Remove', 'ತೆಗೆಯಿರಿ')}
          </button>
        )}
        <button className="btn" onClick={() => onDone()}>
          {bi('Cancel', 'ರದ್ದು')}
        </button>
      </div>
    </div>
  );
}

/**
 * One load in a carrier's history, with its delivery-charge table: a row per item (qty = what
 * arrived on the load) and per combined package (qty 1), the rate per item editable. Save keeps
 * the rates; "Add to cost of items" puts them into the items' landed cost (again after an edit,
 * it replaces, never adds twice).
 */
function LoadCharges({ ld, items, onDone }: { ld: CarrierLoad; items: Map<string, ItemName>; onDone: (msg?: string) => void }) {
  const bi = useBi();
  const { lang } = useSession();
  const [open, setOpen] = useState(false);
  const start = deliveryRows(ld);
  const [rate, setRate] = useState<Record<string, string>>(() => Object.fromEntries(start.rows.map((r) => [r.kind + ':' + r.id, r.rate ? String(r.rate) : ''])));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nameOf = (id: string) => {
    const it = items.get(id);
    return it ? pickName(it.nameEn, it.nameKn, lang) : id;
  };
  const rates = {
    items: Object.fromEntries(start.rows.filter((r) => r.kind === 'item').map((r) => [r.id, Number(rate['item:' + r.id]) || 0])),
    packages: Object.fromEntries(start.rows.filter((r) => r.kind === 'package').map((r) => [r.id, Number(rate['package:' + r.id]) || 0])),
  };
  const now = deliveryRows(ld, rates);
  const bad = Object.values(rate).some((v) => v.trim() !== '' && !(Number(v) >= 0));
  const save = async (apply: boolean) => {
    setErr('');
    setBusy(true);
    try {
      await http.put('/admin/loads/' + ld.id + '/delivery', { ...rates, apply });
      onDone(apply ? bi('Delivery charges added to the cost of items.', 'ಸಾಗಣೆ ಬಾಡಿಗೆ ಸಾಮಾನಿನ ಖರೀದಿ ಬೆಲೆಗೆ ಸೇರಿಸಲಾಗಿದೆ.') : bi('Delivery charges saved.', 'ಸಾಗಣೆ ಬಾಡಿಗೆ ಉಳಿಸಲಾಗಿದೆ.'));
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="card mt-8" data-load-charges={ld.id}>
      <div className="bar between">
        <span>
          <span className="trip-date">{ld.date}</span> {ld.vehicleNo && <span className="muted">· {ld.vehicleNo}</span>}
          {ld.done && <span className="pill ok"> {bi('Finished', 'ಮುಗಿದಿದೆ')}</span>}
        </span>
        <span className="bar">
          <Money v={start.total} />
          <button className="btn small" onClick={() => setOpen(!open)}>
            {open ? bi('Close', 'ಮುಚ್ಚಿ') : bi('Delivery charges', 'ಸಾಗಣೆ ಬಾಡಿಗೆ')}
          </button>
        </span>
      </div>
      {open && (
        <>
          {err && <div className="msg err">{err}</div>}
          {!ld.deliveryRates && start.total > 0 && <div className="muted">{bi('Converted from this load’s old charge.', 'ಈ ಲೋಡಿನ ಹಳೆಯ ಬಾಡಿಗೆಯಿಂದ ಬದಲಿಸಲಾಗಿದೆ.')}</div>}
          <Table>
            <thead>
              <tr>
                <th>{bi('No', 'ಸಂ')}</th>
                <th>{bi('Item', 'ಸಾಮಾನು')}</th>
                <th className="num">{bi('Qty', 'ಪ್ರಮಾಣ')}</th>
                <th className="num">{bi('Rate per item', 'ಪ್ರತಿ ಸಾಮಾನಿನ ದರ')}</th>
                <th className="num">{bi('Total', 'ಒಟ್ಟು')}</th>
              </tr>
            </thead>
            <tbody>
              {now.rows.map((r) => {
                const k = r.kind + ':' + r.id;
                return (
                  <tr key={k}>
                    <td>{r.no}</td>
                    <td>{r.kind === 'item' ? nameOf(r.id) : (r.label ?? '') + ' ' + bi('(combined)', '(ಒಟ್ಟು)')}</td>
                    <td className="num">{r.qty}</td>
                    <td className="num">
                      <input inputMode="decimal" className="in-price" value={rate[k] ?? ''} placeholder="0" onChange={(e) => setRate({ ...rate, [k]: e.target.value })} aria-label={bi('Rate per item', 'ಪ್ರತಿ ಸಾಮಾನಿನ ದರ')} />
                    </td>
                    <td className="num">
                      <Money v={r.total} />
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td />
                <td />
                <td />
                <td className="num">
                  <b>{bi('Total', 'ಒಟ್ಟು')}</b>
                </td>
                <td className="num">
                  <b>
                    <Money v={round2(now.total)} />
                  </b>
                </td>
              </tr>
            </tbody>
          </Table>
          <div className="bar mt-6">
            <button className="btn" disabled={busy || bad} onClick={() => save(false)}>
              {bi('Save', 'ಉಳಿಸಿ')}
            </button>
            <button className="btn primary" disabled={busy || bad} onClick={() => save(true)}>
              {bi('Add to cost of items', 'ಸಾಮಾನಿನ ಖರೀದಿ ಬೆಲೆಗೆ ಸೇರಿಸಿ')}
            </button>
            {ld.deliveryRates?.appliedAt && <span className="muted">{bi('Added on ', 'ಸೇರಿಸಿದ್ದು ') + ld.deliveryRates.appliedAt.slice(0, 10)}</span>}
          </div>
        </>
      )}
    </div>
  );
}
