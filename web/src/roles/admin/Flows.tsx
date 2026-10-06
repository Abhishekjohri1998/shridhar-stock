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
import { Empty, InkView, Loading, Money, Status, useBi, when, Table } from '../../components/ui';

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
      <p className="muted" data-tour="bills-intro">{bi('Read from the billing app. Each line shows how it moved stock.', 'ಬಿಲ್ಲಿಂಗ್ ಆ್ಯಪ್‌ನಿಂದ ಓದಲಾಗಿದೆ. ಪ್ರತಿ ಸಾಲು ಸ್ಟಾಕ್ ಹೇಗೆ ಬದಲಾಯಿತು ಎಂದು ತೋರಿಸುತ್ತದೆ.')}</p>
      {value.length === 0 && (
        <Empty tour="bills-card">
          {bi('No bills yet. Bills made in the billing app show here by themselves.', 'ಇನ್ನೂ ಬಿಲ್‌ಗಳಿಲ್ಲ. ಬಿಲ್ಲಿಂಗ್ ಆ್ಯಪ್‌ನಲ್ಲಿ ಮಾಡಿದ ಬಿಲ್‌ಗಳು ಇಲ್ಲಿ ತಾನಾಗಿ ಬರುತ್ತವೆ.')}
        </Empty>
      )}
      {value.map((b) => (
        <div className="card" key={b.no} data-tour="bills-card">
          <div className="bar between">
            <span className="name">
              #{b.no} · {b.customer?.name ?? bi('walk-in', 'ಗ್ರಾಹಕ')}
            </span>
            <span className="muted">
              {when(b.at, lang)} · <span data-tour="bills-total"><Money v={b.rounded} /></span>
              {b.roundOff !== 0 && (
                <span className="muted">
                  {' '}
                  ({bi('round off', 'ರೌಂಡ್ ಆಫ್')} {b.roundOff > 0 ? '+' : '−'}
                  {formatRupees(Math.abs(b.roundOff))})
                </span>
              )}
              {b.balance > 0 && <span className="pill warn"> {bi('due', 'ಬಾಕಿ')} {formatRupees(b.balance)}</span>}
            </span>
          </div>
          <Table className="list plain">
            <tbody>
              {b.lines.map((l) => (
                <tr key={l.i}>
                  <td className="col-tick muted">
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
                  <td className="col-mid" data-tour="bills-state">
                    <Status s={l.state} label={statusWord(l.state, lang, true)} />
                    {l.reading && l.state === 'read-auto' && <span className="muted"> {Math.round(l.reading.confidence * 100)}%</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
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
      }>('/admin/home'),
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
      <div className="card" data-tour="settings-link">
        <h2 className="subtitle mt-0">{bi('Link to billing', 'ಬಿಲ್ಲಿಂಗ್ ಸಂಪರ್ಕ')}</h2>
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
        <button className="btn" onClick={syncNow} data-tour="settings-sync">
          ↻ {bi('Read bills now', 'ಈಗಲೇ ಬಿಲ್ ಓದಿ')}
        </button>
      </div>
      <div className="card">
        <h2 className="subtitle mt-0" data-tour="settings-round">{bi('Rounding off', 'ರೌಂಡ್ ಆಫ್')}</h2>
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
    </>
  );
}

export function useItemsName() {
  const { lang } = useSession();
  return (n: { nameEn: string; nameKn: string }) => pickName(n.nameEn, n.nameKn, lang);
}
