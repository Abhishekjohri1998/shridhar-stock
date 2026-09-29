import { useState } from 'react';
import {
  formatRupees,
  pickName,
  type BillMirror,
  type Delivery,
  type OrderRequest,
  type PurchaseOrder,
  type Refill,
  type Supplier,
  type Transfer,
} from '@stock/core';
import { http } from '../../lib/api';
import { useLive } from '../../lib/live';
import { itemName, placeName, qtyText, useCatalog } from '../../lib/catalog';
import { useLoad, useSession } from '../../lib/session';
import { statusWord } from '../../lib/words';
import { Empty, InkView, Loading, Money, Status, useBi, when } from '../../components/ui';

// ---------------------------------------------------------------- bills from billing

export function BillsPage() {
  const bi = useBi();
  const { lang } = useSession();
  const { items } = useCatalog();
  const live = useLive('bills');
  const { value, error } = useLoad(() => http.get<BillMirror[]>('/admin/bills?limit=100'), [live]);
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  return (
    <>
      <h1 className="title">{bi('Bills from billing', 'ಬಿಲ್ಲಿಂಗ್‌ನಿಂದ ಬಂದ ಬಿಲ್‌ಗಳು')}</h1>
      <p className="muted">{bi('Read from the billing app. Each line shows how it moved stock.', 'ಬಿಲ್ಲಿಂಗ್ ಆ್ಯಪ್‌ನಿಂದ ಓದಲಾಗಿದೆ. ಪ್ರತಿ ಸಾಲು ಸ್ಟಾಕ್ ಹೇಗೆ ಬದಲಾಯಿತು ಎಂದು ತೋರಿಸುತ್ತದೆ.')}</p>
      {value.length === 0 && <Empty>{bi('No bills yet.', 'ಇನ್ನೂ ಬಿಲ್‌ಗಳಿಲ್ಲ.')}</Empty>}
      {value.map((b) => (
        <div className="card" key={b.no}>
          <div className="bar" style={{ justifyContent: 'space-between' }}>
            <span className="name">
              #{b.no} · {b.customer?.name ?? bi('walk-in', 'ಗ್ರಾಹಕ')}
            </span>
            <span className="muted">
              {when(b.at, lang)} · <Money v={b.total} />
              {b.balance > 0 && <span className="pill warn"> {bi('due', 'ಬಾಕಿ')} {formatRupees(b.balance)}</span>}
            </span>
          </div>
          <table className="list plain">
            <tbody>
              {b.lines.map((l) => (
                <tr key={l.i}>
                  <td style={{ width: 28 }} className="muted">
                    {l.i + 1}
                  </td>
                  <td>
                    {l.ink ? <InkView ink={l.ink} height={30} /> : l.name}
                    {l.itemId && (
                      <div className="muted">
                        → {itemName(items, l.itemId, lang)}
                        {l.baseQty != null && ' · ' + qtyText(items, l.itemId, l.baseQty, lang)}
                      </div>
                    )}
                  </td>
                  <td className="num">{formatRupees(l.amount)}</td>
                  <td style={{ width: 150 }}>
                    <Status s={l.state} label={statusWord(l.state, lang, true)} />
                    {l.reading && l.state === 'read-auto' && <span className="muted"> {Math.round(l.reading.confidence * 100)}%</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- refill

export function RefillPage() {
  const bi = useBi();
  const { lang } = useSession();
  const [version, setVersion] = useState(0);
  const { items, locs } = useCatalog(version);
  const live = useLive('stock', 'items');
  const { value, error } = useLoad(() => http.get<Refill>('/admin/refill'), [version, live]);
  const [msg, setMsg] = useState('');
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const shop = locs.find((l) => l.kind === 'shop');
  const send = async (from: string, lines: { itemId: string; qty: number }[]) => {
    const t = await http.post<Transfer>('/admin/transfers', { from, to: shop!.id, lines });
    setMsg(bi('Sent to ', 'ಕಳುಹಿಸಲಾಗಿದೆ: ') + placeName(locs, from, lang) + ' · ' + bi('transfer', 'ವರ್ಗಾವಣೆ') + ' #' + t.no);
    setVersion((v) => v + 1);
  };
  return (
    <>
      <h1 className="title">{bi('Running low: plan trips', 'ಮುಗಿಯುತ್ತಿರುವುದು: ತರಿಸುವ ಯೋಜನೆ')}</h1>
      <p className="muted">
        {bi(
          'Everything low in the shop, grouped by the godown that has it: one trip brings it all. Each item is topped up to twice its running-out level.',
          'ಅಂಗಡಿಯಲ್ಲಿ ಕಡಿಮೆ ಇರುವುದೆಲ್ಲ, ಅದು ಇರುವ ಗೋದಾಮಿನಂತೆ ಗುಂಪು: ಒಂದೇ ಬಾರಿಗೆ ಎಲ್ಲ ತರಬಹುದು.',
        )}
      </p>
      {msg && <div className="msg ok">{msg}</div>}
      {value.trips.length === 0 && value.buy.length === 0 && <Empty>{bi('Nothing is running low.', 'ಏನೂ ಮುಗಿಯುತ್ತಿಲ್ಲ.')}</Empty>}
      {value.trips.map((trip) => (
        <div className="card" key={trip.from}>
          <div className="bar" style={{ justifyContent: 'space-between' }}>
            <span className="name">
              🚚 {bi('From', 'ಇಂದ')} {placeName(locs, trip.from, lang)} · {trip.lines.length} {bi('items', 'ಸಾಮಾನು')}
            </span>
            <button className="btn primary" onClick={() => send(trip.from, trip.lines.map((l) => ({ itemId: l.itemId, qty: l.qty })))}>
              {bi('Ask the godown to send', 'ಗೋದಾಮಿಗೆ ಕಳುಹಿಸಲು ಹೇಳಿ')}
            </button>
          </div>
          <table className="list plain">
            <thead>
              <tr>
                <th>{bi('Item', 'ಸಾಮಾನು')}</th>
                <th className="num">{bi('Shop has', 'ಅಂಗಡಿಯಲ್ಲಿ')}</th>
                <th className="num">{bi('Godown has', 'ಗೋದಾಮಿನಲ್ಲಿ')}</th>
                <th className="num">{bi('Bring', 'ತನ್ನಿ')}</th>
              </tr>
            </thead>
            <tbody>
              {trip.lines.map((l) => (
                <tr key={l.itemId}>
                  <td>{itemName(items, l.itemId, lang)}</td>
                  <td className={'num ' + (l.shopQty < 0 ? 'qty-neg' : 'qty-low')}>{qtyText(items, l.itemId, l.shopQty, lang)}</td>
                  <td className="num">{qtyText(items, l.itemId, l.godownQty, lang)}</td>
                  <td className="num name">{qtyText(items, l.itemId, l.qty, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {value.buy.length > 0 && (
        <div className="card">
          <div className="name">🛒 {bi('No godown has enough: buy from a supplier', 'ಯಾವ ಗೋದಾಮಿನಲ್ಲೂ ಸಾಕಷ್ಟಿಲ್ಲ: ಸರಬರಾಜುದಾರರಿಂದ ಖರೀದಿಸಿ')}</div>
          {value.buy.map((b) => (
            <div key={b.itemId} className="muted">
              {itemName(items, b.itemId, lang)} · {bi('short', 'ಕೊರತೆ')} {qtyText(items, b.itemId, b.qty, lang)}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- transfers

export function TransfersPage() {
  const bi = useBi();
  const { lang } = useSession();
  const [version, setVersion] = useState(0);
  const { items, locs } = useCatalog(version);
  const live = useLive('transfers');
  const { value, error } = useLoad(() => http.get<Transfer[]>('/admin/transfers'), [version, live]);
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const receive = async (t: Transfer) => {
    await http.post('/transfers/' + t.id + '/receive', {});
    setVersion((v) => v + 1);
  };
  return (
    <>
      <h1 className="title">{bi('Transfers between places', 'ಸ್ಥಳಗಳ ನಡುವೆ ಸಾಗಣೆ')}</h1>
      {value.length === 0 && <Empty>{bi('No transfers yet.', 'ಇನ್ನೂ ಸಾಗಣೆ ಇಲ್ಲ.')}</Empty>}
      {value.map((t) => (
        <div className="card" key={t.id}>
          <div className="bar" style={{ justifyContent: 'space-between' }}>
            <span className="name">
              #{t.no} · {placeName(locs, t.from, lang)} → {placeName(locs, t.to, lang)}
            </span>
            <Status s={t.status} label={statusWord(t.status, lang)} />
          </div>
          <div className="muted">
            {when(t.at, lang)}
            {t.vehicle && ' · ' + t.vehicle}
            {t.driver && ' · ' + t.driver}
            {t.note && ' · ' + t.note}
          </div>
          {t.noteInk && <InkView ink={t.noteInk} height={28} />}
          <ul className="lines">
            {t.lines.map((l) => {
              const short = l.received != null && l.sent != null && l.received < l.sent;
              return (
                <li key={l.itemId}>
                  {itemName(items, l.itemId, lang)} · {qtyText(items, l.itemId, l.sent ?? l.qty, lang)}
                  {l.received != null && <span className={short ? 'qty-neg' : 'muted'}> → {bi('got', 'ಬಂದದ್ದು')} {qtyText(items, l.itemId, l.received, lang)}</span>}
                </li>
              );
            })}
          </ul>
          {t.status === 'sent' && locs.find((l) => l.id === t.to)?.kind === 'shop' && (
            <button className="btn primary" onClick={() => receive(t)}>
              {bi('Received at the shop', 'ಅಂಗಡಿಗೆ ಬಂದಿದೆ')}
            </button>
          )}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- purchase orders

export function PurchasesPage() {
  const bi = useBi();
  const livePos = useLive('pos');
  const { lang } = useSession();
  const [version, setVersion] = useState(0);
  const { items, locs } = useCatalog(version);
  const { value, error } = useLoad(async () => {
    const [pos, sups] = await Promise.all([http.get<PurchaseOrder[]>('/admin/pos'), http.get<Supplier[]>('/admin/suppliers')]);
    return { pos, sups };
  }, [version, livePos]);
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const receive = async (p: PurchaseOrder) => {
    await http.post('/admin/pos/' + p.id + '/receive', {});
    setVersion((v) => v + 1);
  };
  return (
    <>
      <h1 className="title">{bi('Purchase orders', 'ಖರೀದಿ ಆರ್ಡರ್‌ಗಳು')}</h1>
      <p className="muted">{bi('Suppliers', 'ಸರಬರಾಜುದಾರರು')}: {value.sups.map((s) => s.name).join(' · ')}</p>
      {value.pos.map((p) => (
        <div className="card" key={p.id}>
          <div className="bar" style={{ justifyContent: 'space-between' }}>
            <span className="name">
              #{p.no} · {value.sups.find((s) => s.id === p.supplierId)?.name} → {placeName(locs, p.to, lang)}
            </span>
            <Status s={p.status} label={statusWord(p.status, lang)} />
          </div>
          <div className="muted">
            {when(p.at, lang)}
            {p.invoiceNo && ' · ' + bi('invoice', 'ಇನ್‌ವಾಯ್ಸ್') + ' ' + p.invoiceNo}
            {p.vehicle && ' · ' + p.vehicle}
            {p.eta && ' · ETA ' + p.eta}
          </div>
          <ul className="lines">
            {p.lines.map((l) => (
              <li key={l.itemId}>
                {itemName(items, l.itemId, lang)} · {l.qty} {l.unit} × {formatRupees(l.cost)}
              </li>
            ))}
          </ul>
          <div className="bar">
            <b className="grow">
              <Money v={p.lines.reduce((s, l) => s + l.qty * l.cost, 0)} />
            </b>
            {(p.status === 'dispatched' || p.status === 'confirmed') && (
              <button className="btn primary" onClick={() => receive(p)}>
                {bi('Goods received', 'ಸಾಮಾನು ಬಂದಿದೆ')}
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- deliveries

export function DeliveriesPage() {
  const bi = useBi();
  const { lang } = useSession();
  const live = useLive('deliveries');
  const { value, error } = useLoad(() => http.get<Delivery[]>('/admin/deliveries'), [live]);
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  return (
    <>
      <h1 className="title">{bi('Deliveries', 'ಡೆಲಿವರಿಗಳು')}</h1>
      {value.map((d) => (
        <div className="card" key={d.id}>
          <div className="bar" style={{ justifyContent: 'space-between' }}>
            <span className="name">
              {bi('Bill', 'ಬಿಲ್')} #{d.billNo} · {d.name}
            </span>
            <Status s={d.status} label={statusWord(d.status, lang)} />
          </div>
          <div className="muted">
            {d.address}
            {d.landmark && ' · ' + d.landmark} · {d.vehicle ?? ''} · {when(d.at, lang)}
          </div>
          {d.amountDue > 0 && (
            <div>
              {bi('To collect', 'ವಸೂಲಿ')}: <Money v={d.amountDue} />
            </div>
          )}
          {d.note && <div className="muted">“{d.note}”</div>}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- customer requests

export function RequestsPage() {
  const bi = useBi();
  const liveOrders = useLive('orders');
  const { lang } = useSession();
  const [version, setVersion] = useState(0);
  const { items } = useCatalog(version);
  const { value, error } = useLoad(async () => {
    const [orders, customers] = await Promise.all([http.get<OrderRequest[]>('/admin/orders'), http.get<{ key: string; name: string }[]>('/admin/customers')]);
    return { orders, customers };
  }, [version, liveOrders]);
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const set = async (o: OrderRequest, status: 'done' | 'declined') => {
    await http.post('/admin/orders/' + o.id, { status });
    setVersion((v) => v + 1);
  };
  return (
    <>
      <h1 className="title">{bi('Customer requests', 'ಗ್ರಾಹಕರ ಬೇಡಿಕೆಗಳು')}</h1>
      <p className="muted">{bi('Make the bill in the billing app, then mark it billed here.', 'ಬಿಲ್ಲಿಂಗ್ ಆ್ಯಪ್‌ನಲ್ಲಿ ಬಿಲ್ ಮಾಡಿ, ನಂತರ ಇಲ್ಲಿ ಗುರುತಿಸಿ.')}</p>
      {value.orders.map((o) => (
        <div className="card" key={o.id}>
          <div className="bar" style={{ justifyContent: 'space-between' }}>
            <span className="name">{value.customers.find((c) => c.key === o.customerKey)?.name ?? o.customerKey}</span>
            <Status s={o.status} label={statusWord(o.status, lang)} />
          </div>
          <div className="muted">
            {when(o.at, lang)}
            {o.note && ' · “' + o.note + '”'}
          </div>
          <ul className="lines">
            {o.lines.map((l, i) => (
              <li key={i}>
                {l.ink && <InkView ink={l.ink} height={26} />} {l.itemId ? itemName(items, l.itemId, lang) : l.text}
                {l.qty != null && ' · ' + l.qty + ' ' + (l.unit ?? '')}
              </li>
            ))}
          </ul>
          {o.status === 'new' && (
            <div className="bar">
              <button className="btn primary" onClick={() => set(o, 'done')}>
                {bi('Billed', 'ಬಿಲ್ ಆಯಿತು')}
              </button>
              <button className="btn" onClick={() => set(o, 'declined')}>
                {bi('Decline', 'ನಿರಾಕರಿಸಿ')}
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- settings: the links

export function SettingsPage() {
  const bi = useBi();
  const { lang } = useSession();
  const [version, setVersion] = useState(0);
  const [syncMsg, setSyncMsg] = useState('');
  const { value } = useLoad(
    () =>
      http.get<{
        link: { ok: boolean; message?: string; lastBillNo?: number; at?: string; lastOkAt?: string } | null;
        reader: { enabled: boolean; message?: string; monthLines: number; monthCostRupees: number; capRupees: number } | null;
      }>('/admin/summary'),
    [version],
  );
  const syncNow = async () => {
    setSyncMsg('');
    try {
      const r = await http.post<{ newBills: number; posted: number; reversed: number; toConfirm: number }>('/admin/link/sync', {});
      setSyncMsg(
        bi('Read. New bills: ', 'ಓದಲಾಯಿತು. ಹೊಸ ಬಿಲ್: ') + r.newBills + bi(', stock moves: ', ', ಸ್ಟಾಕ್ ಬದಲಾವಣೆ: ') + (r.posted + r.reversed) + bi(', to confirm: ', ', ಖಚಿತಪಡಿಸಬೇಕು: ') + r.toConfirm,
      );
    } catch (e) {
      setSyncMsg((e as Error).message);
    }
    setVersion((v) => v + 1);
  };
  return (
    <>
      <h1 className="title">{bi('Settings', 'ಸೆಟ್ಟಿಂಗ್ಸ್')}</h1>
      <div className="card">
        <h2 className="subtitle" style={{ marginTop: 0 }}>{bi('Link to billing', 'ಬಿಲ್ಲಿಂಗ್ ಸಂಪರ್ಕ')}</h2>
        <p>
          {bi('Bills are read from the billing server every 15 seconds. Stock never writes to billing.', 'ಪ್ರತಿ 15 ಸೆಕೆಂಡಿಗೆ ಬಿಲ್ಲಿಂಗ್ ಸರ್ವರ್‌ನಿಂದ ಬಿಲ್‌ಗಳನ್ನು ಓದಲಾಗುತ್ತದೆ. ಸ್ಟಾಕ್ ಬಿಲ್ಲಿಂಗ್‌ಗೆ ಬರೆಯುವುದಿಲ್ಲ.')}
        </p>
        {value?.link ? (
          <p className={value.link.ok ? '' : 'qty-neg'}>
            {value.link.ok ? '● ' + bi('Working', 'ಸರಿಯಾಗಿದೆ') : '○ ' + bi('Not reachable', 'ಸಿಗುತ್ತಿಲ್ಲ')} · {value.link.message}
            {value.link.lastBillNo ? ' · ' + bi('last bill', 'ಕೊನೆಯ ಬಿಲ್') + ' #' + value.link.lastBillNo : ''}
            {value.link.lastOkAt ? ' · ' + bi('last read', 'ಕೊನೆಯ ಓದು') + ' ' + when(value.link.lastOkAt, lang) : ''}
          </p>
        ) : (
          <p className="muted">{bi('Not set up. On the server, BILLING_URL and BILLING_PIN go in server/.env.', 'ಹೊಂದಿಸಿಲ್ಲ. ಸರ್ವರ್‌ನ server/.env ನಲ್ಲಿ BILLING_URL ಮತ್ತು BILLING_PIN.')}</p>
        )}
        {syncMsg && <div className="msg ok">{syncMsg}</div>}
        <button className="btn" onClick={syncNow}>
          ↻ {bi('Read bills now', 'ಈಗಲೇ ಬಿಲ್ ಓದಿ')}
        </button>
      </div>
      <div className="card">
        <h2 className="subtitle" style={{ marginTop: 0 }}>{bi('Handwriting reader', 'ಕೈಬರಹ ಓದುವಿಕೆ')}</h2>
        <p>
          {bi(
            'Handwritten bill lines are read by Claude, choosing only from your items. Only the writing is sent, never the customer or amounts. Sure readings update stock; unsure ones come to “To confirm”.',
            'ಕೈಬರಹದ ಬಿಲ್ ಸಾಲುಗಳನ್ನು Claude ಓದುತ್ತದೆ, ನಿಮ್ಮ ಸಾಮಾನುಗಳಿಂದ ಮಾತ್ರ ಆರಿಸುತ್ತದೆ. ಬರಹ ಮಾತ್ರ ಕಳುಹಿಸಲಾಗುತ್ತದೆ, ಗ್ರಾಹಕ ಅಥವಾ ಮೊತ್ತವಲ್ಲ.',
          )}
        </p>
        {value?.reader && (
          <p>
            {value.reader.monthLines} {bi('lines this month', 'ಸಾಲು ಈ ತಿಂಗಳು')} · ≈ {formatRupees(value.reader.monthCostRupees)} / {formatRupees(value.reader.capRupees)} {bi('limit', 'ಮಿತಿ')}
          </p>
        )}
        <p className="muted">{value?.reader?.message ?? ''}</p>
        <button
          className="btn"
          onClick={async () => {
            try {
              const r = await http.post<{ read: number; auto: number; queued: number; skipped: string | null }>('/admin/reader/run', {});
              setSyncMsg(r.skipped === 'no-reader' ? bi('No reader key set on the server.', 'ಸರ್ವರ್‌ನಲ್ಲಿ ಕೀ ಇಲ್ಲ.') : bi('Read ', 'ಓದಿದ್ದು ') + r.read + ' · ' + bi('by themselves ', 'ತಾನಾಗಿ ') + r.auto + ' · ' + bi('to confirm ', 'ಖಚಿತಪಡಿಸಬೇಕು ') + r.queued);
            } catch (e) {
              setSyncMsg((e as Error).message);
            }
            setVersion((v) => v + 1);
          }}
        >
          ✎ {bi('Read waiting handwriting now', 'ಬಾಕಿ ಕೈಬರಹ ಈಗ ಓದಿ')}
        </button>
      </div>
    </>
  );
}

export function useItemsName() {
  const { lang } = useSession();
  return (n: { nameEn: string; nameKn: string }) => pickName(n.nameEn, n.nameKn, lang);
}
