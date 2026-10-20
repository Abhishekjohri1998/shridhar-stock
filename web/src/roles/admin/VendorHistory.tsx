import { useEffect, useState } from 'react';
import { PAY_METHODS, pickName, poBill, poProgress, type Carrier, type DeliveryChecklist, type PayMethod, type PoDelivery, type PoPayment, type PurchaseOrder } from '@stock/core';
import { api, http } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { statusWord } from '../../lib/words';
import { Empty, Loading, Money, Select, Status, useBi, when } from '../../components/ui';

/*
 * Vendor history (Buy & move → Purchases): how each order comes, what was paid and what is
 * pending, the delivery checklists, and a supplier's whole history. Shared by the order cards and
 * the supplier details.
 */

export const PAY_WORDS: Record<PayMethod, [string, string]> = { cash: ['Cash', 'ನಗದು'], upi: ['UPI', 'ಯುಪಿಐ'], bank: ['Bank', 'ಬ್ಯಾಂಕ್'], credit: ['Credit', 'ಸಾಲ'] };
export const CONDITION_WORDS: Record<string, [string, string]> = { ok: ['OK', 'ಸರಿ'], damaged: ['Damaged', 'ಹಾಳಾಗಿದೆ'], short: ['Short', 'ಕಡಿಮೆ'] };

/** "🚚 Shivu · KA 09 AB 1234" or "🏪 Vendor brings it". */
export function DeliveryText({ d, carriers }: { d?: Pick<PoDelivery, 'mode' | 'carrierId' | 'vehicleNo' | 'driverName'>; carriers: Carrier[] }) {
  const bi = useBi();
  if (!d) return null;
  if (d.mode === 'self') return <span>🏪 {bi('Vendor brings it', 'ಮಾರಾಟಗಾರರೇ ತರುತ್ತಾರೆ')}</span>;
  const c = carriers.find((x) => x.id === d.carrierId);
  return (
    <span>
      🚚 {c?.name ?? bi('Carrier', 'ಸಾಗಣೆದಾರ')}
      {d.vehicleNo && ' · ' + d.vehicleNo}
      {d.driverName && d.driverName !== c?.name && ' · ' + d.driverName}
    </span>
  );
}

/** The carriers, for names and the pickers; an empty list if they cannot be read. */
export function useCarriers(): Carrier[] {
  const [list, setList] = useState<Carrier[]>([]);
  useEffect(() => {
    http
      .get<{ carriers: Carrier[] }>('/admin/carriers')
      .then((r) => setList(r.carriers))
      .catch(() => undefined);
  }, []);
  return list;
}

/** A payment: amount, how, a note. `path` is the order's or the supplier's "pay pending". */
export function PaymentForm({ path, max, onDone }: { path: string; max: number; onDone: (msg: string) => void }) {
  const bi = useBi();
  const [amount, setAmount] = useState(max > 0 ? String(max) : '');
  const [method, setMethod] = useState<PayMethod>('cash');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const n = Number(amount);
  const over = n > max + 1e-9;
  const save = async () => {
    setErr('');
    setBusy(true);
    try {
      await http.post(path, { amount: n, method, ...(note.trim() ? { note: note.trim() } : {}) });
      onDone(bi('Payment saved.', 'ಪಾವತಿ ಉಳಿಸಲಾಗಿದೆ.'));
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="card" onClick={(e) => e.stopPropagation()}>
      {err && <div className="msg err">{err}</div>}
      <div className="grid2">
        <label className="field">
          <span>
            {bi('Amount ₹', 'ಮೊತ್ತ ₹')} ({bi('pending', 'ಬಾಕಿ')} <Money v={max} />)
          </span>
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={bi('Amount', 'ಮೊತ್ತ')} />
        </label>
        <label className="field">
          <span>{bi('Note (optional)', 'ಟಿಪ್ಪಣಿ (ಬೇಕಿದ್ದರೆ)')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={bi('UPI ref, cheque no.', 'ಯುಪಿಐ ಸಂಖ್ಯೆ, ಚೆಕ್ ಸಂಖ್ಯೆ')} />
        </label>
      </div>
      <div className="chips" role="group" aria-label={bi('Paid by', 'ಪಾವತಿ ವಿಧಾನ')}>
        {PAY_METHODS.map((m) => (
          <button key={m} type="button" className={'chip' + (method === m ? ' on' : '')} onClick={() => setMethod(m)}>
            {bi(PAY_WORDS[m][0], PAY_WORDS[m][1])}
          </button>
        ))}
      </div>
      {over && <div className="msg err mt-6">{bi('That is more than is pending.', 'ಅದು ಬಾಕಿಗಿಂತ ಹೆಚ್ಚು.')}</div>}
      <div className="bar mt-8">
        <button className="btn primary" disabled={busy || !(n > 0) || over} onClick={save}>
          ✓ {bi('Save payment', 'ಪಾವತಿ ಉಳಿಸಿ')}
        </button>
        <button className="btn" onClick={() => onDone('')}>
          {bi('Cancel', 'ರದ್ದು')}
        </button>
      </div>
    </div>
  );
}

export function PaymentsList({ list }: { list: PoPayment[] }) {
  const bi = useBi();
  const { lang } = useSession();
  if (!list.length) return <div className="muted">{bi('No payments yet.', 'ಇನ್ನೂ ಪಾವತಿ ಇಲ್ಲ.')}</div>;
  return (
    <ul className="trip-list">
      {list.map((x) => (
        <li key={x.id}>
          <span className="trip-date">{when(x.at, lang)}</span>
          <span className="grow">
            {bi(PAY_WORDS[x.method][0], PAY_WORDS[x.method][1])}
            {x.note && <span className="muted"> · {x.note}</span>}
          </span>
          <Money v={x.amount} />
        </li>
      ))}
    </ul>
  );
}

/** Delivery checklists: date, how it came, lines ticked, and any shortage or damage by name. */
export function ChecklistList({ list, carriers, nameOf, showOrder }: { list: (DeliveryChecklist & { poNo?: number })[]; carriers: Carrier[]; nameOf: (id: string) => string; showOrder?: boolean }) {
  const bi = useBi();
  const { lang } = useSession();
  if (!list.length) return <div className="muted">{bi('No deliveries yet.', 'ಇನ್ನೂ ಸಾಮಾನು ಬಂದಿಲ್ಲ.')}</div>;
  return (
    <ul className="trip-list">
      {list.map((c) => {
        const bad = c.lines.filter((l) => l.condition !== 'ok' || l.arrived < l.ordered);
        return (
          <li key={c.id}>
            <span className="trip-date">{when(c.at, lang)}</span>
            <span className="grow">
              {showOrder && c.poNo != null && <b>#{c.poNo} · </b>}
              <DeliveryText d={c} carriers={carriers} />
              {c.carrierConfirmed && <span className="muted"> ✓ {bi('checked', 'ಪರಿಶೀಲಿಸಲಾಗಿದೆ')}</span>}
              <span className="muted">
                {' '}
                · {c.lines.filter((l) => l.ok).length}/{c.lines.length} {bi('ticked', 'ಗುರುತು')}
              </span>
              {bad.length > 0 && (
                <div className="muted">
                  {bad.map((l) => nameOf(l.itemId) + ' ' + l.arrived + '/' + l.ordered + ' ' + bi(CONDITION_WORDS[l.condition]![0], CONDITION_WORDS[l.condition]![1]) + (l.note ? ' (' + l.note + ')' : '')).join(' · ')}
                </div>
              )}
            </span>
            {bad.length > 0 ? <span className="pill warn">{bi('Short or damaged', 'ಕಡಿಮೆ ಅಥವಾ ಹಾಳು')}</span> : <span className="pill ok">{bi('All OK', 'ಎಲ್ಲಾ ಸರಿ')}</span>}
          </li>
        );
      })}
    </ul>
  );
}

type HistOrder = PurchaseOrder & { billTotal: number; paid: number; pending: number; progress: ReturnType<typeof poProgress> };
interface History {
  summary: { bought: number; paid: number; pending: number; orders: number; lastPurchase: string | null };
  purchases: HistOrder[];
  deliveries: (DeliveryChecklist & { poId: string; poNo: number })[];
}

/** A supplier's details: totals, "Pay pending", each order (tap for payments and checklists), and the delivery history. */
export function SupplierHistory({ supplierId }: { supplierId: string }) {
  const bi = useBi();
  const { lang } = useSession();
  const live = useLive('pos');
  const [version, setVersion] = useState(0);
  const { value, error } = useLoad(async () => {
    const [h, items] = await Promise.all([http.get<History>('/admin/suppliers/' + supplierId + '/history'), api.items(true).catch(() => [])]);
    return { h, names: new Map(items.map((i) => [i.id, pickName(i.nameEn, i.nameKn, lang)])) };
  }, [supplierId, version, live]);
  const carriers = useCarriers();
  const [open, setOpen] = useState<string | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [note, setNote] = useState('');
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const { h, names } = value;
  const nameOf = (id: string) => names.get(id) ?? id;
  const done = (msg: string) => {
    setPaying(null);
    setNote(msg);
    if (msg) setVersion((v) => v + 1);
  };
  return (
    <div className="card" data-tour="supplier-history" onClick={(e) => e.stopPropagation()}>
      {note && <div className="msg ok">{note}</div>}
      <div className="grid2">
        <div className="field">
          <span>{bi('Total bought', 'ಒಟ್ಟು ಖರೀದಿ')}</span>
          <b>
            <Money v={h.summary.bought} />
          </b>
        </div>
        <div className="field">
          <span>{bi('Paid', 'ಪಾವತಿಸಲಾಗಿದೆ')}</span>
          <b>
            <Money v={h.summary.paid} />
          </b>
        </div>
        <div className="field">
          <span>{bi('Pending', 'ಬಾಕಿ')}</span>
          <b className={h.summary.pending > 0 ? 'qty-neg' : ''}>
            <Money v={h.summary.pending} />
          </b>
        </div>
        <div className="field">
          <span>{bi('Last purchase', 'ಕೊನೆಯ ಖರೀದಿ')}</span>
          <b>{h.summary.lastPurchase ? when(h.summary.lastPurchase, lang) : '—'}</b>
        </div>
      </div>
      {h.summary.pending > 0 && paying !== 'all' && (
        <button className="btn primary" onClick={() => setPaying('all')}>
          ₹ {bi('Pay pending (oldest first)', 'ಬಾಕಿ ಪಾವತಿಸಿ (ಹಳೆಯದು ಮೊದಲು)')}
        </button>
      )}
      {paying === 'all' && <PaymentForm path={'/admin/suppliers/' + supplierId + '/pay'} max={h.summary.pending} onDone={done} />}

      <h3 className="mt-14">{bi('Purchase history', 'ಖರೀದಿ ಇತಿಹಾಸ')}</h3>
      {h.purchases.length === 0 && <Empty>{bi('No orders from this supplier yet.', 'ಈ ಸರಬರಾಜುದಾರರಿಂದ ಇನ್ನೂ ಆರ್ಡರ್ ಇಲ್ಲ.')}</Empty>}
      <ul className="trip-list">
        {h.purchases.map((p) => (
          <li key={p.id} className="clickable" aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
            <span className="trip-date">
              #{p.no} · {when(p.at, lang)}
            </span>
            <span className="grow">
              <Money v={p.billTotal} />
              <span className="muted">
                {' '}
                · {bi('paid', 'ಪಾವತಿ')} <Money v={p.paid} />
              </span>
              {p.pending > 0 && (
                <span className="qty-neg">
                  {' '}
                  · {bi('pending', 'ಬಾಕಿ')} <Money v={p.pending} />
                </span>
              )}
              <div className="muted">
                <DeliveryText d={p.delivery} carriers={carriers} />
              </div>
            </span>
            <Status s={p.progress} label={statusWord(p.progress, lang)} />
            {open === p.id && (
              <div className="grow" onClick={(e) => e.stopPropagation()}>
                <div className="muted mt-6">{p.lines.map((l) => nameOf(l.itemId) + ' ' + l.qty + ' ' + l.unit).join(', ')}</div>
                <b className="mt-8">{bi('Payments', 'ಪಾವತಿಗಳು')}</b>
                <PaymentsList list={p.payments ?? []} />
                {p.pending > 0 && paying !== p.id && p.status !== 'cancelled' && (
                  <button className="btn small mt-6" onClick={() => setPaying(p.id)}>
                    + {bi('Payment', 'ಪಾವತಿ')}
                  </button>
                )}
                {paying === p.id && <PaymentForm path={'/admin/purchases/' + p.id + '/payments'} max={p.pending} onDone={done} />}
                <b className="mt-8">{bi('Delivery checklists', 'ಸಾಮಾನು ಪರಿಶೀಲನೆ')}</b>
                <ChecklistList list={p.checklists ?? []} carriers={carriers} nameOf={nameOf} />
              </div>
            )}
          </li>
        ))}
      </ul>

      <h3 className="mt-14">{bi('Delivery history', 'ಸಾಮಾನು ಬಂದ ಇತಿಹಾಸ')}</h3>
      <ChecklistList list={h.deliveries} carriers={carriers} nameOf={nameOf} showOrder />
    </div>
  );
}

/** An order's money line: bill, paid, pending. */
export function BillLine({ p }: { p: PurchaseOrder }) {
  const bi = useBi();
  const b = poBill(p);
  return (
    <span>
      {bi('Bill', 'ಬಿಲ್')} <Money v={b.billTotal} /> · {bi('paid', 'ಪಾವತಿ')} <Money v={b.paid} />
      {b.pending > 0 && (
        <span className="qty-neg">
          {' '}
          · {bi('pending', 'ಬಾಕಿ')} <Money v={b.pending} />
        </span>
      )}
    </span>
  );
}
