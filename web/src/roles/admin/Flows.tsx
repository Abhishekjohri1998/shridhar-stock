import { useState } from 'react';
import { Link } from 'react-router-dom';
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
  const { lang, me } = useSession();
  const { items } = useCatalog();
  const live = useLive('bills');
  const { value, error } = useLoad(() => http.get<(BillMirror & { rounded: number; roundOff: number })[]>('/admin/bills?limit=100'), [live]);
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
              {when(b.at, lang)} · <Money v={b.rounded} />
              {b.roundOff !== 0 && (
                <span className="muted">
                  {' '}
                  ({bi('round off', 'ರೌಂಡ್ ಆಫ್')} {b.roundOff > 0 ? '+' : '−'}
                  {formatRupees(Math.abs(b.roundOff))})
                </span>
              )}
              {b.balance > 0 && <span className="pill warn"> {bi('due', 'ಬಾಕಿ')} {formatRupees(b.balance)}</span>}
              {me?.role === 'admin' && b.customer && !b.cancelled && (
                <Link className="btn small" to={'/admin/deliveries?bill=' + b.no} style={{ marginLeft: 8 }}>
                  🛵 {bi('Deliver', 'ಡೆಲಿವರಿ')}
                </Link>
              )}
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
  const { value: settings } = useLoad(() => http.get<{ roundTo: number }>('/admin/settings'), [version]);
  const setRound = async (roundTo: number) => {
    try {
      await http.put('/admin/settings', { roundTo });
    } catch (e) {
      setSyncMsg((e as Error).message);
    }
    setVersion((v) => v + 1);
  };
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
          {bi('Bills are read from the billing server every 3 seconds while a bill is open, and every 15 seconds when the shop is quiet. Stock never writes to billing.', 'ಬಿಲ್ ತೆರೆದಿರುವಾಗ ಪ್ರತಿ 3 ಸೆಕೆಂಡಿಗೆ, ಅಂಗಡಿ ಶಾಂತವಾಗಿರುವಾಗ ಪ್ರತಿ 15 ಸೆಕೆಂಡಿಗೆ ಬಿಲ್ಲಿಂಗ್ ಸರ್ವರ್‌ನಿಂದ ಬಿಲ್‌ಗಳನ್ನು ಓದಲಾಗುತ್ತದೆ. ಸ್ಟಾಕ್ ಬಿಲ್ಲಿಂಗ್‌ಗೆ ಬರೆಯುವುದಿಲ್ಲ.')}
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
        <h2 className="subtitle" style={{ marginTop: 0 }}>{bi('Rounding off', 'ರೌಂಡ್ ಆಫ್')}</h2>
        <p>
          {bi('Bill totals on the worker’s screen, the bills list and reports are shown rounded to this, with the round-off as its own line.', 'ಕೆಲಸಗಾರರ ಪರದೆ, ಬಿಲ್ ಪಟ್ಟಿ ಮತ್ತು ವರದಿಗಳಲ್ಲಿ ಬಿಲ್ ಮೊತ್ತವನ್ನು ಇದಕ್ಕೆ ರೌಂಡ್ ಮಾಡಿ, ರೌಂಡ್ ಆಫ್ ಬೇರೆ ಸಾಲಿನಲ್ಲಿ ತೋರಿಸಲಾಗುತ್ತದೆ.')}
        </p>
        <div className="chips">
          {[0, 1, 5, 10].map((n) => (
            <button key={n} className={'chip ' + (settings?.roundTo === n ? 'on' : '')} onClick={() => setRound(n)}>
              {n === 0 ? bi('No rounding', 'ರೌಂಡ್ ಬೇಡ') : '₹' + n}
            </button>
          ))}
        </div>
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
