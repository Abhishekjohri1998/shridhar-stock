import { useEffect, useState } from 'react';
import { loadTotal, pickName, poStage, receivedQty, round2, type Carrier, type CarrierLoad, type PurchaseOrder, type Supplier } from '@stock/core';
import { http } from '../../lib/api';
import { useLive } from '../../lib/live';
import { Money, Select, Table, useBi } from '../../components/ui';

type Brief = { nameEn: string; nameKn: string; units: { code: string; label: string; labelKn: string }[] };

const keyOf = (poId: string, itemId: string) => poId + '|' + itemId;
/** Today in India, YYYY-MM-DD. */
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * Open: ordered lines (from any vendors' orders) ticked and moved onto a carrier's load, each with
 * its own delivery rate per unit; the load's charge is Σ rate × qty, live. A load moves to another
 * carrier when one backs out; lines can be moved, or left for next time (back to unassigned).
 */
export function CarrierLoads({ orders, sups, items, carriers, lang, onDone }: { orders: PurchaseOrder[]; sups: Supplier[]; items: Map<string, Brief>; carriers: Carrier[]; lang: 'en' | 'kn'; onDone: (msg: string) => void }) {
  const bi = useBi();
  const live = useLive('pos');
  const [version, setVersion] = useState(0);
  const [loads, setLoads] = useState<CarrierLoad[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [carrierId, setCarrierId] = useState('');
  const [vehicleNo, setVehicleNo] = useState('');
  const [driverName, setDriverName] = useState('');
  const [date, setDate] = useState(today());
  const [rates, setRates] = useState<Record<string, string>>({});
  const [other, setOther] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  useEffect(() => {
    http
      .get<CarrierLoad[]>('/admin/loads')
      .then((l) => {
        setLoads(l);
        setRates({});
      })
      .catch((e: Error) => setErr(e.message));
  }, [version, live]);
  const open = orders.filter((p) => poStage(p.status) === 'ordered');
  const poOf = new Map(orders.map((p) => [p.id, p]));
  const due = (p: PurchaseOrder, itemId: string) => {
    const l = p.lines.find((x) => x.itemId === itemId);
    return l ? Math.max(0, Math.round((l.qty - receivedQty(p, itemId)) * 1e6) / 1e6) : 0;
  };
  const onLoad = new Map<string, CarrierLoad>();
  for (const ld of loads) for (const x of ld.lines) if (!x.received) onLoad.set(keyOf(x.poId, x.itemId), ld);
  const unassigned = open.flatMap((p) => p.lines.filter((l) => due(p, l.itemId) > 0 && !onLoad.has(keyOf(p.id, l.itemId))).map((l) => ({ p, l })));
  const shown = loads.filter((ld) => ld.lines.some((x) => !x.received) || ld.lines.some((x) => x.received && Date.now() - Date.parse(x.received.at) < 14 * 86400_000));
  const carrierName = (id: string) => (id === 'vendor' ? bi('Vendor brings it', 'ಮಾರಾಟಗಾರರೇ ತರುತ್ತಾರೆ') : (carriers.find((c) => c.id === id)?.name ?? id));
  const nameOf = (id: string) => {
    const it = items.get(id);
    return it ? pickName(it.nameEn, it.nameKn, lang) : id;
  };
  const unitOf = (p: PurchaseOrder | undefined, itemId: string) => {
    const code = p?.lines.find((x) => x.itemId === itemId)?.unit ?? '';
    const u = items.get(itemId)?.units.find((x) => x.code === code);
    return (u && ((lang === 'kn' && u.labelKn) || u.label || u.code)) || code;
  };
  const supName = (p?: PurchaseOrder) => (p ? (sups.find((s) => s.id === p.supplierId)?.name ?? '') : '');
  const toggle = (k: string, on: boolean) => {
    const n = new Set(sel);
    if (on) n.add(k);
    else n.delete(k);
    setSel(n);
  };
  const run = async (f: () => Promise<unknown>, msg: string) => {
    setErr('');
    try {
      await f();
      setSel(new Set());
      setVersion((v) => v + 1);
      onDone(msg);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const selLines = [...sel].map((k) => {
    const [poId, itemId] = k.split('|') as [string, string];
    return { poId, itemId };
  });
  const rateOf = (ld: CarrierLoad, poId: string, itemId: string) => {
    const t = rates[ld.id + '|' + keyOf(poId, itemId)];
    if (t != null) return Number(t) || 0;
    return ld.lines.find((x) => x.poId === poId && x.itemId === itemId)?.ratePerUnit ?? 0;
  };
  const waitingLoads = loads.filter((ld) => ld.lines.some((x) => !x.received));
  const move = () =>
    run(
      () =>
        http.post('/admin/loads/move', {
          lines: selLines,
          ...(target ? { loadId: target } : { carrierId, ...(vehicleNo.trim() ? { vehicleNo: vehicleNo.trim() } : {}), ...(driverName.trim() ? { driverName: driverName.trim() } : {}), date }),
        }),
      bi('Moved to the carrier.', 'ಸಾಗಣೆದಾರರಿಗೆ ಹಾಕಲಾಗಿದೆ.'),
    );
  if (!open.length && !shown.length) return null;
  return (
    <div className="card" data-tour="purchases-loads">
      <b>{bi('Goods carriers', 'ಸಾಗಣೆ ವಾಹನಗಳು')}</b>
      {err && <div className="msg err">{err}</div>}
      {unassigned.length > 0 && (
        <>
          <div className="muted mt-6">{bi('Not yet assigned: tick lines, from any orders, to move them to a carrier.', 'ಇನ್ನೂ ನಿಗದಿಯಾಗಿಲ್ಲ: ಯಾವ ಆರ್ಡರಿನದ್ದಾದರೂ ಸಾಲುಗಳನ್ನು ಗುರುತಿಸಿ, ಸಾಗಣೆದಾರರಿಗೆ ಹಾಕಿ.')}</div>
          {unassigned.map(({ p, l }) => {
            const k = keyOf(p.id, l.itemId);
            return (
              <label className="check" key={k}>
                <input type="checkbox" checked={sel.has(k)} onChange={(e) => toggle(k, e.target.checked)} />
                {nameOf(l.itemId)} · {due(p, l.itemId)} {unitOf(p, l.itemId)} · #{p.no} {supName(p)}
              </label>
            );
          })}
        </>
      )}
      {shown.map((ld) => {
        const lines = ld.lines.map((x) => ({ ...x, ratePerUnit: rateOf(ld, x.poId, x.itemId) }));
        const changed = ld.lines.some((x) => rates[ld.id + '|' + keyOf(x.poId, x.itemId)] != null && rateOf(ld, x.poId, x.itemId) !== x.ratePerUnit);
        const waiting = ld.lines.filter((x) => !x.received);
        const mine = selLines.filter((s) => waiting.some((x) => x.poId === s.poId && x.itemId === s.itemId));
        return (
          <div className="card mt-8" key={ld.id}>
            <div className="bar between">
              <span className="name">
                🚚 {carrierName(ld.carrierId)}
                {ld.vehicleNo && ' · ' + ld.vehicleNo}
                {ld.driverName && ' · ' + ld.driverName}
              </span>
              <span className="muted">{ld.date}</span>
            </div>
            <Table>
              <thead>
                <tr>
                  <th />
                  <th>{bi('Item', 'ಸಾಮಾನು')}</th>
                  <th className="num">{bi('Qty', 'ಪ್ರಮಾಣ')}</th>
                  <th className="num">{bi('Delivery ₹ / unit', 'ಸಾಗಣೆ ₹ / ಘಟಕ')}</th>
                  <th className="num">₹</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((x) => {
                  const k = keyOf(x.poId, x.itemId);
                  const p = poOf.get(x.poId);
                  const qty = x.received ? x.received.qty : x.qty;
                  return (
                    <tr key={k + (x.received ? ':r' + x.received.receipt : '')}>
                      <td>{x.received ? '✓' : <input type="checkbox" checked={sel.has(k)} onChange={(e) => toggle(k, e.target.checked)} aria-label={bi('Choose', 'ಆರಿಸಿ')} />}</td>
                      <td>
                        {nameOf(x.itemId)}
                        <div className="muted">
                          #{p?.no ?? x.poId.replace(/^po_/, '')} {supName(p)}
                          {x.received && ' · ' + bi('received', 'ಬಂದಿದೆ')}
                        </div>
                      </td>
                      <td className="num">
                        {qty} {unitOf(p, x.itemId)}
                      </td>
                      <td className="num">
                        <input inputMode="decimal" className="in-price" value={rates[ld.id + '|' + k] ?? String(x.ratePerUnit)} onChange={(e) => setRates({ ...rates, [ld.id + '|' + k]: e.target.value })} aria-label={bi('Delivery ₹ / unit', 'ಸಾಗಣೆ ₹ / ಘಟಕ')} />
                      </td>
                      <td className="num">{round2(x.ratePerUnit * qty)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <div className="bar mt-6">
              <b className="grow">
                {bi('Delivery charge', 'ಸಾಗಣೆ ಬಾಡಿಗೆ')} <Money v={loadTotal(lines)} />
                <div className="muted">{lines.map((x) => (x.received ? x.received.qty : x.qty) + '×' + x.ratePerUnit).join(' + ')}</div>
              </b>
              {changed && (
                <button className="btn primary small" onClick={() => run(() => http.put('/admin/loads/' + ld.id + '/rates', { lines: lines.map((x) => ({ poId: x.poId, itemId: x.itemId, ratePerUnit: x.ratePerUnit })) }), bi('Delivery rates saved; costs updated for what was received.', 'ಸಾಗಣೆ ದರ ಉಳಿಸಲಾಗಿದೆ; ಬಂದ ಸಾಮಾನಿನ ಬೆಲೆ ಬದಲಾಗಿದೆ.'))}>
                  {bi('Save rates', 'ದರ ಉಳಿಸಿ')}
                </button>
              )}
            </div>
            {waiting.length > 0 && (
              <div className="bar mt-6">
                <Select
                  value={other[ld.id] ?? ''}
                  onChange={(v) => setOther({ ...other, [ld.id]: v })}
                  aria-label={bi('Move to another carrier', 'ಬೇರೆ ಸಾಗಣೆದಾರರಿಗೆ')}
                  options={[{ value: '', label: bi('Move to another carrier…', 'ಬೇರೆ ಸಾಗಣೆದಾರರಿಗೆ…') }, ...carriers.filter((c) => c.active && c.id !== ld.carrierId).map((c) => ({ value: c.id, label: c.name, hint: c.vehicleNo }))]}
                />
                <button className="btn small" disabled={!other[ld.id]} onClick={() => run(() => http.post('/admin/loads/' + ld.id + '/carrier', { carrierId: other[ld.id] }), bi('The load is with the other carrier now.', 'ಲೋಡ್ ಈಗ ಬೇರೆ ಸಾಗಣೆದಾರರ ಬಳಿ ಇದೆ.'))}>
                  {bi('Move load', 'ಲೋಡ್ ಸರಿಸಿ')}
                </button>
                {mine.length > 0 && (
                  <button className="btn small" onClick={() => run(() => http.post('/admin/loads/' + ld.id + '/unassign', { lines: mine }), bi('Left for next time: not yet assigned.', 'ಮುಂದಿನ ಸಲಕ್ಕೆ ಬಿಡಲಾಗಿದೆ: ಇನ್ನೂ ನಿಗದಿಯಾಗಿಲ್ಲ.'))}>
                    {bi('Leave for next time', 'ಮುಂದಿನ ಸಲಕ್ಕೆ ಬಿಡಿ')}
                  </button>
                )}
              </div>
            )}
            {ld.history.length > 1 && (
              <div className="muted mt-6">
                {bi('History', 'ಇತಿಹಾಸ')}: {ld.history.slice(-3).map((h) => new Date(h.at).toLocaleDateString() + ' ' + h.action + (h.fromCarrierId ? ' ← ' + carrierName(h.fromCarrierId) : '') + (h.action === 'move-out' && h.carrierId ? ' → ' + carrierName(h.carrierId) : '')).join(' · ')}
              </div>
            )}
          </div>
        );
      })}
      {sel.size > 0 && (
        <div className="card mt-8">
          <b>
            {bi('Move to carrier', 'ಸಾಗಣೆದಾರರಿಗೆ ಹಾಕಿ')} · {sel.size}
          </b>
          <div className="grid2 mt-6">
            <label className="field">
              <span>{bi('Load', 'ಲೋಡ್')}</span>
              <Select
                value={target}
                onChange={setTarget}
                aria-label={bi('Load', 'ಲೋಡ್')}
                options={[{ value: '', label: bi('New load', 'ಹೊಸ ಲೋಡ್') }, ...waitingLoads.map((ld) => ({ value: ld.id, label: carrierName(ld.carrierId) + ' · ' + ld.date, hint: ld.vehicleNo }))]}
              />
            </label>
            {!target && (
              <>
                <label className="field">
                  <span>{bi('Carrier', 'ಸಾಗಣೆದಾರ')}</span>
                  <Select
                    value={carrierId}
                    onChange={(id) => {
                      setCarrierId(id);
                      setVehicleNo(carriers.find((x) => x.id === id)?.vehicleNo ?? '');
                    }}
                    aria-label={bi('Carrier', 'ಸಾಗಣೆದಾರ')}
                    options={[{ value: '', label: bi('Choose', 'ಆರಿಸಿ') }, ...carriers.filter((c) => c.active).map((c) => ({ value: c.id, label: c.name, hint: c.vehicleNo }))]}
                  />
                </label>
                <label className="field">
                  <span>{bi('Vehicle no. (optional)', 'ವಾಹನ ಸಂಖ್ಯೆ (ಬೇಕಿದ್ದರೆ)')}</span>
                  <input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} />
                </label>
                <label className="field">
                  <span>{bi('Driver (optional)', 'ಚಾಲಕ (ಬೇಕಿದ್ದರೆ)')}</span>
                  <input value={driverName} onChange={(e) => setDriverName(e.target.value)} />
                </label>
                <label className="field">
                  <span>{bi('Date', 'ದಿನಾಂಕ')}</span>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
              </>
            )}
          </div>
          <div className="bar mt-6">
            <button className="btn primary" disabled={!target && !carrierId} onClick={move}>
              🚚 {bi('Move to carrier', 'ಸಾಗಣೆದಾರರಿಗೆ ಹಾಕಿ')}
            </button>
            <button className="btn" onClick={() => setSel(new Set())}>
              {bi('Clear', 'ತೆರವು')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
