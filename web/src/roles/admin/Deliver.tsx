import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatRupees, type BillMirror, type CustomerProfile, type Delivery, type Person } from '@stock/core';
import { http } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { statusWord } from '../../lib/words';
import { Empty, Loading, Money, Status, useBi, VehicleOptions, when } from '../../components/ui';

/** Deliveries: send a bill out, see where everything is, and hand a drop to someone else. */
export function DeliveriesPage() {
  const bi = useBi();
  const { lang } = useSession();
  const [params, setParams] = useSearchParams();
  const [version, setVersion] = useState(0);
  const live = useLive('deliveries', 'bills');
  const { value, error } = useLoad(async () => {
    const [deliveries, bills, customers, people] = await Promise.all([
      http.get<Delivery[]>('/admin/deliveries'),
      http.get<BillMirror[]>('/admin/bills?limit=60'),
      http.get<CustomerProfile[]>('/admin/customers'),
      http.get<Person[]>('/people'),
    ]);
    return { deliveries, bills, customers, drivers: people.filter((p) => p.role === 'delivery' && p.active) };
  }, [version, live]);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [err, setErr] = useState('');
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const billNo = Number(params.get('bill')) || 0;
  const act = async (path: string, body: unknown) => {
    setErr('');
    try {
      await http.post(path, body);
      setVersion((v) => v + 1);
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    }
  };
  const personName = (id?: string) => value.drivers.find((p) => p.id === id)?.name ?? '—';
  const shown = value.deliveries.filter((d) => filter === 'all' || d.status !== 'delivered');
  const busy = new Set(value.deliveries.filter((d) => d.status !== 'delivered').map((d) => d.billNo));
  const candidates = value.bills.filter((b) => !b.cancelled && b.customer && !busy.has(b.no));

  return (
    <>
      <h1 className="title">{bi('Deliveries', 'ಡೆಲಿವರಿಗಳು')}</h1>
      {err && <div className="msg err">{err}</div>}
      <NewDelivery
        key={billNo}
        bills={candidates}
        customers={value.customers}
        drivers={value.drivers}
        start={billNo}
        onSend={async (body) => {
          const ok = await act('/admin/deliveries', body);
          if (ok) setParams({});
          return ok;
        }}
        onLandmark={(id, landmark) => act('/admin/customers/' + id, { landmark })}
      />
      <div className="chips my-12">
        <button className={'chip ' + (filter === 'open' ? 'on' : '')} onClick={() => setFilter('open')}>
          {bi('To do', 'ಬಾಕಿ')}
        </button>
        <button className={'chip ' + (filter === 'all' ? 'on' : '')} onClick={() => setFilter('all')}>
          {bi('All', 'ಎಲ್ಲ')}
        </button>
      </div>
      {shown.length === 0 && <Empty>{bi('Nothing out for delivery.', 'ಡೆಲಿವರಿಗೆ ಏನೂ ಇಲ್ಲ.')}</Empty>}
      {shown.map((d) => (
        <div className="card" key={d.id}>
          <div className="bar between">
            <span className="name">
              {bi('Bill', 'ಬಿಲ್')} #{d.billNo} · {d.name}
            </span>
            <Status s={d.status} label={statusWord(d.status, lang)} />
          </div>
          <div className="muted">
            {d.address}
            {d.landmark && ' · 📍 ' + d.landmark} · {d.phone}
          </div>
          <div className="muted">
            {bi('Given', 'ಕೊಟ್ಟದ್ದು')} {when(d.at, lang)}
            {d.times.out && ' · ' + bi('left', 'ಹೊರಟದ್ದು') + ' ' + when(d.times.out, lang)}
            {d.times.delivered && ' · ' + bi('delivered', 'ತಲುಪಿದ್ದು') + ' ' + when(d.times.delivered, lang)}
            {d.times.failed && d.status === 'failed' && ' · ' + bi('not delivered', 'ತಲುಪಿಲ್ಲ') + ' ' + when(d.times.failed, lang)}
          </div>
          {d.note && <div className={d.status === 'failed' ? 'qty-neg' : 'muted'}>“{d.note}”</div>}
          <div className="bar mt-8">
            {d.amountDue > 0 && (
              <span className="grow">
                {bi('To collect', 'ವಸೂಲಿ')} <Money v={d.amountDue} />
              </span>
            )}
            <span className={d.amountDue > 0 ? '' : 'grow'}>
              🛵 {personName(d.personId)}
              {d.vehicle && ' · ' + d.vehicle}
            </span>
            {d.status !== 'delivered' && (
              <select
                value=""
                onChange={(e) => e.target.value && act('/admin/deliveries/' + d.id + '/assign', { personId: e.target.value })} className="w-auto"
                aria-label={bi('Give to someone else', 'ಬೇರೆಯವರಿಗೆ ಕೊಡಿ')}
              >
                <option value="">{bi('Give to…', 'ಇವರಿಗೆ ಕೊಡಿ…')}</option>
                {value.drivers
                  .filter((p) => p.id !== d.personId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

function NewDelivery({
  bills,
  customers,
  drivers,
  start,
  onSend,
  onLandmark,
}: {
  bills: BillMirror[];
  customers: CustomerProfile[];
  drivers: Person[];
  start: number;
  onSend: (body: { billNo: number; personId: string; vehicle?: string; address?: string }) => Promise<boolean>;
  onLandmark: (customerId: string, landmark: string) => Promise<boolean>;
}) {
  const bi = useBi();
  const { lang } = useSession();
  const [billNo, setBillNo] = useState(start || 0);
  const [personId, setPerson] = useState(drivers[0]?.id ?? '');
  const [vehicle, setVehicle] = useState('');
  const [address, setAddress] = useState('');
  const bill = bills.find((b) => b.no === billNo);
  const customer = bill?.customer ? customers.find((c) => c.key === bill.customer!.key) : undefined;
  const [landmark, setLandmark] = useState(customer?.landmark ?? '');

  if (!billNo || !bill) {
    return (
      <div className="card">
        <div className="name mb-6">
          🛵 {bi('Send a bill for delivery', 'ಬಿಲ್ ಅನ್ನು ಡೆಲಿವರಿಗೆ ಕಳುಹಿಸಿ')}
        </div>
        {bills.length === 0 ? (
          <p className="muted">{bi('No recent bills with a customer waiting to go.', 'ಗ್ರಾಹಕರಿರುವ ಬಿಲ್‌ಗಳು ಇಲ್ಲ.')}</p>
        ) : (
          <div className="chips">
            {bills.slice(0, 12).map((b) => (
              <button
                key={b.no}
                className="chip"
                onClick={() => {
                  setBillNo(b.no);
                  const c = customers.find((x) => x.key === b.customer?.key);
                  setLandmark(c?.landmark ?? '');
                  setAddress('');
                }}
              >
                #{b.no} · {b.customer!.name} · {formatRupees(b.total)}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="card">
      <div className="bar between">
        <span className="name">
          🛵 {bi('Bill', 'ಬಿಲ್')} #{bill.no} · {bill.customer!.name}
        </span>
        <span className="muted">
          {when(bill.at, lang)} · <Money v={bill.total} />
          {bill.balance > 0 && ' · ' + bi('collect', 'ವಸೂಲಿ') + ' ' + formatRupees(bill.balance)}
        </span>
      </div>
      <div className="grid2 mt-8">
        <label className="field">
          <span>{bi('Address (from billing)', 'ವಿಳಾಸ (ಬಿಲ್ಲಿಂಗ್‌ನಿಂದ)')}</span>
          <input value={address || customer?.address || ''} onChange={(e) => setAddress(e.target.value)} placeholder={bi('No address in billing: type one', 'ವಿಳಾಸ ಇಲ್ಲ: ಬರೆಯಿರಿ')} />
        </label>
        <label className="field">
          <span>{bi('Landmark (kept here)', 'ಗುರುತು (ಇಲ್ಲಿ ಉಳಿಯುತ್ತದೆ)')}</span>
          <input value={landmark} onChange={(e) => setLandmark(e.target.value)} onBlur={() => customer && landmark !== (customer.landmark ?? '') && onLandmark(customer.id, landmark)} placeholder={bi('Opposite the temple', 'ದೇವಸ್ಥಾನದ ಎದುರು')} />
        </label>
        <label className="field">
          <span>{bi('Who takes it', 'ಯಾರು ತೆಗೆದುಕೊಂಡು ಹೋಗುತ್ತಾರೆ')}</span>
          <select value={personId} onChange={(e) => setPerson(e.target.value)}>
            {drivers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{bi('Vehicle', 'ವಾಹನ')}</span>
          <input list="vehicles" value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder={bi('Scooter', 'ಸ್ಕೂಟರ್')} />
          <VehicleOptions />
        </label>
      </div>
      {drivers.length === 0 && <div className="msg err">{bi('Add a delivery person under People first.', 'ಮೊದಲು “ಜನರು” ನಲ್ಲಿ ಡೆಲಿವರಿ ವ್ಯಕ್ತಿ ಸೇರಿಸಿ.')}</div>}
      <div className="bar">
        <button
          className="btn primary"
          disabled={!personId}
          onClick={async () => {
            if (customer && landmark !== (customer.landmark ?? '')) await onLandmark(customer.id, landmark);
            if (await onSend({ billNo: bill.no, personId, ...(vehicle ? { vehicle } : {}), ...(address ? { address } : {}) })) setBillNo(0);
          }}
        >
          🛵 {bi('Send for delivery', 'ಡೆಲಿವರಿಗೆ ಕಳುಹಿಸಿ')}
        </button>
        <button className="btn" onClick={() => setBillNo(0)}>
          {bi('Another bill', 'ಬೇರೆ ಬಿಲ್')}
        </button>
      </div>
    </div>
  );
}
