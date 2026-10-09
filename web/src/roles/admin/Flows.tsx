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
import { PinPicker } from '../../components/PinPicker';

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
          {!b.cancelled && (
            <div className="bar">
              <Link className="btn" to={'/admin/deliveries?bill=' + b.no} data-tour="bills-deliver">
                🏠 {bi('Deliver', 'ಡೆಲಿವರಿ')}
              </Link>
            </div>
          )}
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
  const { value: settings } = useLoad(() => http.get<{ roundTo: number; bikeMaxItems: number; bikeMaxAmount: number; shopLat?: number; shopLng?: number; shopPhone?: string }>('/admin/settings'), [version]);
  const saveSettings = async (patch: Record<string, number | string>) => {
    try {
      await http.put('/admin/settings', patch);
    } catch (e) {
      setSyncMsg((e as Error).message);
    }
    setVersion((v) => v + 1);
  };
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
        bi('Read. New bills: ', 'ಓದಲಾಯಿತು. ಹೊಸ ಬಿಲ್: ') + r.newBills + bi(', stock moves: ', ', ಸ್ಟಾಕ್ ಬದಲಾವಣೆ: ') + (r.posted + r.reversed) + bi(', to digitise: ', ', ಡಿಜಿಟೈಸ್ ಮಾಡಬೇಕು: ') + r.toConfirm,
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
      {settings && <DeliverySettings s={settings} save={saveSettings} />}
    </>
  );
}

export function useItemsName() {
  const { lang } = useSession();
  return (n: { nameEn: string; nameKn: string }) => pickName(n.nameEn, n.nameKn, lang);
}

// ---------------------------------------------------------------- settings: home deliveries

/** The Bike / 4-wheeler rule and the shop's place on the map. */
function DeliverySettings({ s, save }: { s: { bikeMaxItems: number; bikeMaxAmount: number; shopLat?: number; shopLng?: number; shopPhone?: string }; save: (patch: Record<string, number | string>) => Promise<void> }) {
  const bi = useBi();
  const [phone, setPhone] = useState(s.shopPhone ?? '');
  const [items, setItems] = useState(String(s.bikeMaxItems));
  const [amount, setAmount] = useState(String(s.bikeMaxAmount));
  const [pinOpen, setPinOpen] = useState(false);
  const shop = s.shopLat != null && s.shopLng != null ? { lat: s.shopLat, lng: s.shopLng } : null;
  return (
    <div className="card">
      <h2 className="subtitle mt-0" data-tour="settings-delivery">{bi('Home delivery', 'ಮನೆ ಡೆಲಿವರಿ')}</h2>
      <p>{bi('A delivery is suggested by 🏍 bike when it has at most this many item lines and this amount; otherwise by 🚚 4-wheeler. The admin can switch it with one tap.', 'ಇಷ್ಟು ಸಾಲು ಮತ್ತು ಇಷ್ಟು ಮೊತ್ತದವರೆಗೆ 🏍 ಬೈಕ್; ಹೆಚ್ಚಿದ್ದರೆ 🚚 4 ಚಕ್ರ. ಒಂದು ಒತ್ತಿನಲ್ಲಿ ಬದಲಿಸಬಹುದು.')}</p>
      <div className="grid2">
        <label className="field">
          <span>{bi('Bike: up to item lines', 'ಬೈಕ್: ಸಾಲುಗಳವರೆಗೆ')}</span>
          <input inputMode="numeric" value={items} onChange={(e) => setItems(e.target.value)} />
        </label>
        <label className="field">
          <span>{bi('Bike: up to ₹', 'ಬೈಕ್: ₹ ವರೆಗೆ')}</span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
      </div>
      <div className="bar">
        <button className="btn" onClick={() => save({ bikeMaxItems: Math.max(0, Math.round(Number(items) || 0)), bikeMaxAmount: Math.max(0, Number(amount) || 0) })}>
          {bi('Save the rule', 'ನಿಯಮ ಉಳಿಸಿ')}
        </button>
        <button className="btn" onClick={() => setPinOpen(!pinOpen)}>
          🏪 {shop ? bi('Move the shop on the map', 'ನಕ್ಷೆಯಲ್ಲಿ ಅಂಗಡಿ ಸರಿಸಿ') : bi('Put the shop on the map', 'ಅಂಗಡಿಯನ್ನು ನಕ್ಷೆಯಲ್ಲಿ ಇಡಿ')}
        </button>
      </div>
      {pinOpen && <PinPicker value={shop} icon="🏪" onChange={(p) => void save({ shopLat: p.lat, shopLng: p.lng })} />}
      <div className="bar">
        <label className="field grow">
          <span>{bi('Shop phone, for customers (on the tracking page)', 'ಗ್ರಾಹಕರಿಗೆ ಅಂಗಡಿ ಫೋನ್ (ಟ್ರ್ಯಾಕಿಂಗ್ ಪುಟದಲ್ಲಿ)')}</span>
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98XXXXXXXX" />
        </label>
        <button className="btn" onClick={() => void save({ shopPhone: phone })}>
          {bi('Save', 'ಉಳಿಸಿ')}
        </button>
      </div>
    </div>
  );
}
