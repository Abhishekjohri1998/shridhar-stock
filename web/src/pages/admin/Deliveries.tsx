import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { distanceKm, distanceText, formatRupees, isActiveDelivery, type CustomerProfile, type Delivery, type VehicleKind } from '@stock/core';
import { http } from '../../lib/api';
import { useLive, useSettled } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { statusWord } from '../../lib/words';
import { Empty, Loading, Select, Status, SuggestInput, useBi } from '../../components/ui';
import { LiveMap, type LatLng, type MapMarker } from '../../components/LiveMap';
import { PinPicker } from '../../components/PinPicker';

type Row = Delivery & { personName: string };
type Live = { shop: LatLng | null; deliveries: Row[] };

export const VEHICLE_ICON: Record<VehicleKind, string> = { bike: '🏍', car: '🚚' };
export function vehicleWord(k: VehicleKind | undefined, bi: (en: string, kn: string) => string): string {
  return k === 'car' ? bi('4-wheeler', '4 ಚಕ್ರ') : bi('Bike', 'ಬೈಕ್');
}

/** Seconds since, as "12 s ago" or "3 min ago". */
export function agoText(iso: string | undefined, nowMs: number, bi: (en: string, kn: string) => string): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 60) return s + bi(' s ago', ' ಸೆ. ಹಿಂದೆ');
  if (s < 3600) return Math.round(s / 60) + bi(' min ago', ' ನಿ. ಹಿಂದೆ');
  return Math.round(s / 3600) + bi(' h ago', ' ಗಂ. ಹಿಂದೆ');
}

function useNow(ms = 1000): number {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

type Road = { points: LatLng[]; km: number | null; minutes: number | null };
/** Ask for the road again after this long, or sooner once the worker has moved this far. */
const ROAD_EVERY_MS = 30_000;
const ROAD_MOVED_KM = 0.2;

/**
 * The road still ahead for each delivery on the way, from the server's router. Asked when one
 * starts, then at most every 30 s or when the worker has moved 200 m; a failure just means no road.
 */
function useRoads(rows: Row[] | undefined, nowMs: number): Map<string, Road> {
  const [roads, setRoads] = useState(() => new Map<string, Road>());
  const asked = useRef(new Map<string, { at: number; from: LatLng }>());
  const tick = Math.floor(nowMs / ROAD_EVERY_MS);
  useEffect(() => {
    if (!rows) return;
    const out = rows.filter((d) => d.status === 'out' && d.pos && d.lat != null && d.lng != null);
    for (const d of out) {
      const pos = { lat: d.pos!.lat, lng: d.pos!.lng };
      const last = asked.current.get(d.id);
      if (last && Date.now() - last.at < ROAD_EVERY_MS && distanceKm(last.from, pos) < ROAD_MOVED_KM) continue;
      asked.current.set(d.id, { at: Date.now(), from: pos });
      http
        .get<Road>('/admin/deliveries/' + d.id + '/route')
        .then((r) => setRoads((m) => new Map(m).set(d.id, r)))
        .catch(() => undefined);
    }
    // Forget the ones no longer on the way.
    const ids = new Set(out.map((d) => d.id));
    for (const id of [...asked.current.keys()]) if (!ids.has(id)) asked.current.delete(id);
    setRoads((m) => ([...m.keys()].some((id) => !ids.has(id)) ? new Map([...m].filter(([id]) => ids.has(id))) : m));
  }, [rows, tick]);
  return roads;
}

/**
 * Buy & move → Deliveries: the live map (the shop, each home, each worker on the way gliding as
 * their phone reports), the list beside it, and the form that sends a new delivery.
 */
export function DeliveriesPage() {
  const bi = useBi();
  const { lang } = useSession();
  const [params, setParams] = useSearchParams();
  const bill = params.get('bill');
  const [adding, setAdding] = useState(!!bill);
  const live = useSettled(useLive('delivery'), 1000);
  const { value, error, reload } = useLoad(() => http.get<Live>('/admin/deliveries'), [live]);
  const now = useNow();
  const roads = useRoads(value?.deliveries, now);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (bill) setAdding(true);
  }, [bill]);

  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;

  const markers: MapMarker[] = [];
  if (value.shop) markers.push({ id: 'shop', ...value.shop, icon: '🏪', label: bi('Shop', 'ಅಂಗಡಿ') });
  for (const d of value.deliveries) {
    if (d.lat == null || d.lng == null) continue;
    const active = isActiveDelivery(d.status);
    markers.push({ id: 'to-' + d.id, lat: d.lat, lng: d.lng, icon: d.status === 'delivered' ? '✅' : '📍', label: d.name, faded: !active });
    if (d.status === 'out' && d.pos) {
      markers.push({ id: 'go-' + d.id, lat: d.pos.lat, lng: d.pos.lng, icon: VEHICLE_ICON[d.vehicleKind ?? 'bike'], label: d.personName, moving: true, trail: (d.track ?? []).slice(0, -1), route: roads.get(d.id)?.points });
    }
  }
  const fit = markers.filter((m) => !m.faded);

  const switchKind = async (d: Row) => {
    setErr('');
    try {
      await http.put('/admin/deliveries/' + d.id, { vehicleKind: d.vehicleKind === 'car' ? 'bike' : 'car' });
      reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const closeForm = () => {
    setAdding(false);
    if (bill) setParams({}, { replace: true });
    reload();
  };

  return (
    <>
      <h1 className="title">{bi('Deliveries', 'ಡೆಲಿವರಿ')}</h1>
      <p className="muted">{bi('Home deliveries by your workers, live on the map.', 'ಕೆಲಸಗಾರರ ಮನೆ ಡೆಲಿವರಿ, ನಕ್ಷೆಯಲ್ಲಿ ನೇರ.')}</p>
      <div className="bar">
        <button className="btn primary" data-tour="deliveries-new" onClick={() => setAdding(true)}>
          + {bi('New delivery', 'ಹೊಸ ಡೆಲಿವರಿ')}
        </button>
      </div>
      {adding && <DeliveryForm bill={bill ? Number(bill) : 0} shop={value.shop} onDone={closeForm} />}
      {err && <div className="msg err">{err}</div>}
      {!value.shop && (
        <div className="msg">{bi('Tip: put the shop on the map in Setup → Settings, so distances start from the shop.', 'ಸಲಹೆ: ಸೆಟಪ್ → ಸೆಟ್ಟಿಂಗ್ಸ್‌ನಲ್ಲಿ ಅಂಗಡಿಯನ್ನು ನಕ್ಷೆಯಲ್ಲಿ ಇಡಿ.')}</div>
      )}
      <div className="deliveries-layout">
        <div data-tour="deliveries-map">
          <LiveMap markers={markers} fit={fit.length ? fit : markers} />
        </div>
        <div className="deliveries-list" data-tour="deliveries-list">
          {value.deliveries.length === 0 && <Empty>{bi('No deliveries today. Start one from a bill (🏠 Deliver) or with “+ New delivery”.', 'ಇಂದು ಡೆಲಿವರಿ ಇಲ್ಲ. ಬಿಲ್‌ನಿಂದ (🏠 ಡೆಲಿವರಿ) ಅಥವಾ “+ ಹೊಸ ಡೆಲಿವರಿ”.')}</Empty>}
          {value.deliveries.map((d) => {
            const active = isActiveDelivery(d.status);
            const from = d.status === 'out' && d.pos ? d.pos : value.shop;
            const road = d.status === 'out' ? roads.get(d.id) : undefined;
            const left =
              road && road.km != null && road.minutes != null
                ? distanceText(road.km) + bi(' by road · ', ' ರಸ್ತೆಯಲ್ಲಿ · ') + road.minutes + bi(' min', ' ನಿ.')
                : active && from && d.lat != null && d.lng != null
                  ? distanceText(distanceKm(from, { lat: d.lat, lng: d.lng }))
                  : '';
            return (
              <div key={d.id} className={'card delivery-card' + (active ? '' : ' faded')}>
                <div className="bar between m-0">
                  <span className="name">
                    {d.name}
                    {d.billNo ? <span className="muted"> · #{d.billNo}</span> : null}
                  </span>
                  <Status s={d.status} label={d.status === 'pending' ? bi('Assigned', 'ನೇಮಿಸಲಾಗಿದೆ') : statusWord(d.status, lang)} />
                </div>
                <div className="muted">{[d.address, d.landmark].filter(Boolean).join(' · ')}</div>
                <div className="delivery-meta">
                  {active ? (
                    <button className="chip on" title={bi('Switch the vehicle', 'ವಾಹನ ಬದಲಿಸಿ')} onClick={() => switchKind(d)}>
                      {VEHICLE_ICON[d.vehicleKind ?? 'bike']} {vehicleWord(d.vehicleKind, bi)}
                    </button>
                  ) : (
                    <span>{VEHICLE_ICON[d.vehicleKind ?? 'bike']}</span>
                  )}
                  <span>👤 {d.personName || '—'}</span>
                  {d.status === 'out' && <span>⏱ {agoText(d.pos?.at ?? d.times.out, now, bi)}</span>}
                  {left && <span>↔ {left}</span>}
                  {d.amountDue > 0 && <span>{bi('Collect', 'ಪಡೆಯಬೇಕು')} {formatRupees(d.amountDue)}</span>}
                  {d.status === 'delivered' && d.collected != null && <span>{bi('Collected', 'ಪಡೆದದ್ದು')} {formatRupees(d.collected)}</span>}
                  {d.status === 'failed' && d.reason && <span>“{d.reason}”</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

interface Draft {
  billNo: number;
  customerKey: string;
  name: string;
  phone: string;
  address: string;
  landmark: string;
  lat?: number;
  lng?: number;
  itemCount: number;
  amount: number;
  amountDue: number;
  vehicleKind: VehicleKind;
  rule: { bikeMaxItems: number; bikeMaxAmount: number };
}

/** The New delivery form: who, where (the pin), what, which vehicle, which worker. */
function DeliveryForm({ bill, shop, onDone }: { bill: number; shop: LatLng | null; onDone: () => void }) {
  const bi = useBi();
  const nav = useNavigate();
  const [customer, setCustomer] = useState('');
  const { value: draft, error } = useLoad(() => http.get<Draft>('/admin/deliveries/draft' + (bill ? '?bill=' + bill : customer ? '?customer=' + encodeURIComponent(customer) : '')), [bill, customer]);
  const { value: workers } = useLoad(() => http.get<{ id: string; name: string; phone: string }[]>('/admin/deliveries/workers'));
  const { value: customers } = useLoad(() => (bill ? Promise.resolve([] as CustomerProfile[]) : http.get<CustomerProfile[]>('/admin/customers')), [bill]);
  const { value: vehicles } = useLoad(() => http.get<{ number: string; type: string; driverName: string; kind?: VehicleKind }[]>('/vehicles'));
  const [f, setF] = useState<Draft | null>(null);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [kind, setKind] = useState<VehicleKind>('bike');
  const [chosen, setChosen] = useState(false);
  const [vehicle, setVehicle] = useState('');
  const [personId, setPersonId] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!draft) return;
    setF(draft);
    setPin(draft.lat != null && draft.lng != null ? { lat: draft.lat, lng: draft.lng } : null);
    setKind(draft.vehicleKind);
    setChosen(false);
  }, [draft]);

  if (error) return <div className="msg err">{error}</div>;
  if (!f || !workers) return <Loading />;
  const set = (patch: Partial<Draft>) => setF({ ...f, ...patch });
  const suggested: VehicleKind = f.itemCount <= f.rule.bikeMaxItems && f.amount <= f.rule.bikeMaxAmount ? 'bike' : 'car';
  const shownKind = chosen ? kind : suggested;
  const ofKind = (vehicles ?? []).filter((v) => v.kind === shownKind);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg('');
    if (!pin) return setMsg(bi('Drop the pin on the home first.', 'ಮೊದಲು ಮನೆಯ ಮೇಲೆ ಪಿನ್ ಇಡಿ.'));
    if (!personId) return setMsg(bi('Pick a worker.', 'ಕೆಲಸಗಾರರನ್ನು ಆರಿಸಿ.'));
    setBusy(true);
    try {
      await http.post('/admin/deliveries', {
        billNo: f.billNo,
        customerKey: f.customerKey,
        name: f.name,
        phone: f.phone,
        address: f.address,
        ...(f.landmark ? { landmark: f.landmark } : {}),
        lat: pin.lat,
        lng: pin.lng,
        itemCount: f.itemCount,
        amount: f.amount,
        amountDue: f.amountDue,
        vehicleKind: shownKind,
        ...(vehicle ? { vehicle } : {}),
        personId,
      });
      onDone();
    } catch (err) {
      setMsg((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <form className="card" onSubmit={submit} data-tour="delivery-form">
      <h2 className="subtitle mt-0">
        {bi('New delivery', 'ಹೊಸ ಡೆಲಿವರಿ')}
        {f.billNo ? ' · ' + bi('bill', 'ಬಿಲ್') + ' #' + f.billNo : ''}
      </h2>
      {!bill && customers && customers.length > 0 && (
        <label className="field">
          <span>{bi('Customer from billing (or type below)', 'ಬಿಲ್ಲಿಂಗ್‌ನ ಗ್ರಾಹಕ (ಅಥವಾ ಕೆಳಗೆ ಬರೆಯಿರಿ)')}</span>
          <Select
            value={customer}
            onChange={setCustomer}
            placeholder={bi('Pick a customer', 'ಗ್ರಾಹಕರನ್ನು ಆರಿಸಿ')}
            options={customers.map((c) => ({ value: c.key, label: c.name, text: c.name + ' ' + c.key, hint: c.address }))}
          />
        </label>
      )}
      <div className="grid2">
        <label className="field">
          <span>{bi('Customer', 'ಗ್ರಾಹಕ')}</span>
          <input value={f.name} onChange={(e) => set({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>{bi('Phone', 'ಫೋನ್')}</span>
          <input inputMode="tel" value={f.phone} onChange={(e) => set({ phone: e.target.value })} />
        </label>
        <label className="field">
          <span>{bi('Address', 'ವಿಳಾಸ')}</span>
          <input value={f.address} onChange={(e) => set({ address: e.target.value })} />
        </label>
        <label className="field">
          <span>{bi('Landmark', 'ಹೆಗ್ಗುರುತು')}</span>
          <input value={f.landmark} onChange={(e) => set({ landmark: e.target.value })} />
        </label>
      </div>
      <PinPicker value={pin} onChange={setPin} search={f.address} near={shop} />
      <div className="grid2">
        <label className="field">
          <span>{bi('Item lines', 'ಸಾಮಾನು ಸಾಲುಗಳು')}</span>
          <input inputMode="numeric" value={String(f.itemCount)} onChange={(e) => set({ itemCount: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
        </label>
        <label className="field">
          <span>{bi('Order value ₹', 'ಆರ್ಡರ್ ಮೊತ್ತ ₹')}</span>
          <input inputMode="decimal" value={String(f.amount)} onChange={(e) => set({ amount: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label className="field">
          <span>{bi('To collect ₹', 'ಪಡೆಯಬೇಕಾದ ₹')}</span>
          <input inputMode="decimal" value={String(f.amountDue)} onChange={(e) => set({ amountDue: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
      </div>
      <div className="field" data-tour="delivery-vehicle">
        <span>
          {bi('Vehicle', 'ವಾಹನ')} ·{' '}
          <span className="muted">
            {bi('suggested', 'ಸಲಹೆ')}: {VEHICLE_ICON[suggested]} {vehicleWord(suggested, bi)} ({bi('bike up to', 'ಬೈಕ್')} {f.rule.bikeMaxItems} {bi('lines and', 'ಸಾಲು ಮತ್ತು')} {formatRupees(f.rule.bikeMaxAmount)})
          </span>
        </span>
        <div className="chips">
          {(['bike', 'car'] as const).map((k) => (
            <button
              type="button"
              key={k}
              className={'chip ' + (shownKind === k ? 'on' : '')}
              onClick={() => {
                setKind(k);
                setChosen(true);
                setVehicle('');
              }}
            >
              {VEHICLE_ICON[k]} {vehicleWord(k, bi)}
            </button>
          ))}
        </div>
        {ofKind.length > 0 && (
          <div className="mt-10">
            <SuggestInput value={vehicle} onChange={setVehicle} placeholder={bi('Which one (optional)', 'ಯಾವುದು (ಬೇಕಿದ್ದರೆ)')} suggestions={ofKind.map((v) => ({ value: v.number, hint: [v.type, v.driverName].filter(Boolean).join(' · ') }))} />
          </div>
        )}
      </div>
      <label className="field" data-tour="delivery-worker">
        <span>{bi('Worker who delivers', 'ಡೆಲಿವರಿ ಮಾಡುವ ಕೆಲಸಗಾರ')}</span>
        <Select value={personId} onChange={setPersonId} placeholder={bi('Pick a worker', 'ಕೆಲಸಗಾರರನ್ನು ಆರಿಸಿ')} options={workers.map((w) => ({ value: w.id, label: w.name, hint: w.phone }))} />
      </label>
      {workers.length === 0 && (
        <div className="msg">
          {bi('No workers yet.', 'ಇನ್ನೂ ಕೆಲಸಗಾರರಿಲ್ಲ.')}{' '}
          <button type="button" className="btn ghost" onClick={() => nav('/admin/people')}>
            {bi('Add one in People', 'ಜನರಲ್ಲಿ ಸೇರಿಸಿ')}
          </button>
        </div>
      )}
      {msg && <div className="msg err">{msg}</div>}
      <div className="bar">
        <button className="btn primary" disabled={busy} data-tour="delivery-send">
          {bi('Send for delivery', 'ಡೆಲಿವರಿಗೆ ಕಳುಹಿಸಿ')}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          {bi('Cancel', 'ರದ್ದು')}
        </button>
      </div>
    </form>
  );
}
