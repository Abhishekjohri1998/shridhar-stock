import { useEffect, useMemo, useState } from 'react';
import { describeQty, formatRupees, itemMatches, pickName, type Delivery, type Ink, type ItemUnit, type OrderRequest, type Transfer } from '@stock/core';
import { http } from '../lib/api';
import { useLive } from '../lib/live';
import { useLoad, useSession } from '../lib/session';
import { statusWord } from '../lib/words';
import { Empty, InkView, Loading, Money, Status, Tabs, useBi, when } from '../components/ui';
import { WriteToFind, type WrittenResult } from '../components/WriteToFind';
import type { Summary } from './admin/Home';

/** A slow safety net under the live stream, for a phone whose stream quietly stalled. */
function useTick(ms: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}

// ================================================================ owner / partner

export function OwnerHome() {
  const bi = useBi();
  const live = useLive('bills', 'stock', 'transfers', 'pos', 'deliveries', 'orders');
  const { value: s, error } = useLoad(() => http.get<Summary>('/admin/summary'), [live]);
  if (error) return <div className="msg err">{error}</div>;
  if (!s) return <Loading />;
  const rate = s.handwrittenLines ? Math.round((s.autoRead / s.handwrittenLines) * 100) : 0;
  const tile = (label: string, v: React.ReactNode, tone = '') => (
    <div className={'tile ' + tone}>
      <b>{v}</b>
      {label}
    </div>
  );
  return (
    <>
      <h1 className="title">{bi('How the shop is doing', 'ಅಂಗಡಿ ಹೇಗೆ ನಡೆಯುತ್ತಿದೆ')}</h1>
      <div className="tiles">
        {tile(bi('Sales today', 'ಇಂದಿನ ಮಾರಾಟ'), <Money v={s.salesToday} />)}
        {tile(bi('Bills today', 'ಇಂದಿನ ಬಿಲ್‌ಗಳು'), s.billsToday)}
        {tile(bi('Money still due', 'ಬರಬೇಕಾದ ಹಣ'), <Money v={s.due} />, s.due ? 'warn' : '')}
        {tile(bi('Stock value at cost', 'ಖರೀದಿ ಬೆಲೆಯಲ್ಲಿ ಸ್ಟಾಕ್'), <Money v={s.stockValue} />)}
        {tile(bi('Running low', 'ಮುಗಿಯುತ್ತಿದೆ'), s.low, s.low ? 'warn' : '')}
        {tile(bi('Below zero', 'ಸೊನ್ನೆಗಿಂತ ಕಡಿಮೆ'), s.negative, s.negative ? 'bad' : '')}
        {tile(bi('On the way to the shop', 'ಅಂಗಡಿಗೆ ದಾರಿಯಲ್ಲಿ'), s.inTransit)}
        {tile(bi('Open purchase orders', 'ತೆರೆದ ಖರೀದಿ ಆರ್ಡರ್'), s.openPos)}
        {tile(bi('Handwriting read by itself', 'ತಾನಾಗಿ ಓದಿದ ಕೈಬರಹ'), rate + '%')}
      </div>
      <p className="muted" style={{ marginTop: 14 }}>
        {bi('Read only. Reports and Excel files are under “Excel files”.', 'ನೋಡಲು ಮಾತ್ರ. ವರದಿ ಮತ್ತು ಎಕ್ಸೆಲ್ ಫೈಲ್‌ಗಳು “ಎಕ್ಸೆಲ್ ಫೈಲ್” ನಲ್ಲಿ.')}
      </p>
    </>
  );
}

// ================================================================ shop worker

interface WorkerLine {
  i: number;
  name: string;
  ink?: Ink;
  qty: number;
  readText?: string;
  itemId?: string;
  itemName: string;
  unit?: string;
  rack: string;
  fetched: boolean;
}
interface WorkerBill {
  no: number;
  at: string;
  customer: string;
  lines: WorkerLine[];
}

/**
 * The pick list: a bill as soon as it is saved in billing, its lines grouped by where they are
 * kept, so the worker walks the shop once. Handwritten lines show the writing itself, with what
 * the reader made of it underneath.
 */
export function WorkerHome({ screen = false }: { screen?: boolean }) {
  const bi = useBi();
  const { lang } = useSession();
  const live = useLive('bills', 'items');
  const tick = useTick(60_000);
  const [version, setVersion] = useState(0);
  const { value, error } = useLoad(() => http.get<WorkerBill[]>('/worker/bills'), [live, tick, version]);
  const [open, setOpen] = useState<number | null>(null);
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  if (value.length === 0) return <Empty>{bi('No bills yet today. New bills appear here by themselves.', 'ಇಂದು ಇನ್ನೂ ಬಿಲ್ ಇಲ್ಲ. ಹೊಸ ಬಿಲ್‌ಗಳು ತಾವಾಗಿ ಇಲ್ಲಿ ಬರುತ್ತವೆ.')}</Empty>;
  const bill = value.find((b) => b.no === open) ?? value[0]!;
  const groups = new Map<string, WorkerLine[]>();
  for (const l of bill.lines) {
    const k = l.rack || bi('Not on a rack', 'ರ‍್ಯಾಕ್ ಇಲ್ಲ');
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const done = bill.lines.filter((l) => l.fetched).length;
  const tickLine = async (l: WorkerLine) => {
    await http.post('/worker/bills/' + bill.no + '/lines/' + l.i + '/fetched', { fetched: !l.fetched });
    setVersion((v) => v + 1);
  };
  return (
    <div className={screen ? 'worker screen' : 'worker'}>
      {!screen && value.length > 1 && (
        <div className="chips" style={{ marginBottom: 10 }}>
          {value.map((b) => (
            <button key={b.no} className={'chip ' + (b.no === bill.no ? 'on' : '')} onClick={() => setOpen(b.no)}>
              #{b.no} · {b.customer || bi('walk-in', 'ಗ್ರಾಹಕ')} · {b.lines.filter((l) => l.fetched).length}/{b.lines.length}
            </button>
          ))}
        </div>
      )}
      <div className="bar" style={{ justifyContent: 'space-between' }}>
        <h1 className="title" style={{ margin: 0 }}>
          {bi('Bill', 'ಬಿಲ್')} #{bill.no} · {bill.customer || bi('walk-in', 'ಗ್ರಾಹಕ')}
        </h1>
        <span className={'pill ' + (done === bill.lines.length ? 'ok' : 'warn')}>
          {done} {bi('of', '/')} {bill.lines.length} {bi('fetched', 'ತಂದಿದೆ')}
        </span>
      </div>
      <p className="muted">{when(bill.at, lang)}</p>
      {done === bill.lines.length && (
        <div className="banner ok">✓ {bi('Everything on this bill is fetched.', 'ಈ ಬಿಲ್‌ನ ಎಲ್ಲವನ್ನೂ ತರಲಾಗಿದೆ.')}</div>
      )}
      {[...groups.entries()].map(([rack, lines]) => (
        <div key={rack} className="card">
          <div className="rack">📍 {rack}</div>
          {lines.map((l) => (
            <div key={l.i} className={'pick ' + (l.fetched ? 'got' : '')}>
              <div className="grow">
                <div className="pick-name">
                  {l.ink ? <InkView ink={l.ink} height={screen ? 60 : 44} /> : l.name}
                </div>
                <div className="muted">
                  {l.itemName || l.readText || ''} {l.unit ? '· ' + l.qty + ' ' + l.unit : '· ' + l.qty}
                </div>
              </div>
              {!screen && (
                <button className={'fetch ' + (l.fetched ? 'on' : '')} onClick={() => tickLine(l)} aria-pressed={l.fetched}>
                  {l.fetched ? '✓' : bi('Fetched', 'ತಂದೆ')}
                </button>
              )}
              {screen && l.fetched && <span className="fetch on">✓</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ================================================================ godown

interface GItem {
  itemId: string;
  nameEn: string;
  nameKn: string;
  units: { code: string; labelKn: string; perBase: number }[];
  rack: string;
  qty: number;
}

export function GodownHome() {
  const bi = useBi();
  const { lang, me } = useSession();
  const [tab, setTab] = useState<'requests' | 'incoming' | 'stock'>('requests');
  const [version, setVersion] = useState(0);
  const live = useLive('transfers', 'stock', 'items');
  const { value, error } = useLoad(async () => {
    const [transfers, stock] = await Promise.all([http.get<Transfer[]>('/godown/transfers'), http.get<GItem[]>('/godown/stock')]);
    return { transfers, stock };
  }, [version, live]);
  const [q, setQ] = useState('');
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const byId = new Map(value.stock.map((s) => [s.itemId, s]));
  const nm = (id: string) => {
    const s = byId.get(id);
    return s ? pickName(s.nameEn, s.nameKn, lang) : id;
  };
  /** 96 pieces of Parle-G, said the way the godown counts it: "4 pack". */
  const dq = (id: string, qty: number) => {
    const s = byId.get(id);
    return s ? describeQty({ units: s.units as ItemUnit[] }, qty, lang) : String(qty);
  };
  const g = me!.linkedId!;
  const outgoing = value.transfers.filter((t) => t.from === g && t.status === 'requested');
  const incoming = value.transfers.filter((t) => t.to === g && t.status === 'sent');
  const history = value.transfers.filter((t) => t.status === 'received' || (t.from === g && t.status === 'sent'));

  return (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'requests', label: bi('To send', 'ಕಳುಹಿಸಬೇಕು') + (outgoing.length ? ' (' + outgoing.length + ')' : '') },
          { key: 'incoming', label: bi('Coming in', 'ಬರುತ್ತಿದೆ') + (incoming.length ? ' (' + incoming.length + ')' : '') },
          { key: 'stock', label: bi('My stock', 'ನನ್ನ ಸ್ಟಾಕ್') },
        ]}
      />
      {tab === 'requests' && (
        <>
          {outgoing.length === 0 && <Empty>{bi('Nothing to send right now.', 'ಈಗ ಕಳುಹಿಸಲು ಏನೂ ಇಲ್ಲ.')}</Empty>}
          {outgoing.map((t) => (
            <SendCard key={t.id} t={t} nm={nm} dq={dq} rack={(id) => byId.get(id)?.rack ?? ''} have={(id) => byId.get(id)?.qty ?? 0} onDone={() => setVersion((v) => v + 1)} />
          ))}
          {history.length > 0 && <h2 className="subtitle">{bi('Earlier', 'ಹಿಂದಿನವು')}</h2>}
          {history.map((t) => (
            <div className="card muted" key={t.id}>
              #{t.no} · {statusWord(t.status, lang)} · {when(t.at, lang)} · {t.lines.map((l) => nm(l.itemId)).join(', ')}
            </div>
          ))}
        </>
      )}
      {tab === 'incoming' && (
        <>
          {incoming.length === 0 && <Empty>{bi('Nothing on the way to this godown.', 'ಈ ಗೋದಾಮಿಗೆ ಏನೂ ಬರುತ್ತಿಲ್ಲ.')}</Empty>}
          {incoming.map((t) => (
            <ReceiveCard key={t.id} t={t} nm={nm} dq={dq} onDone={() => setVersion((v) => v + 1)} />
          ))}
        </>
      )}
      {tab === 'stock' && (
        <>
          <input placeholder={bi('Search', 'ಹುಡುಕಿ')} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
          <table className="list">
            <tbody>
              {value.stock
                .filter((s) => s.qty !== 0 || q)
                .filter((s) => !q.trim() || itemMatches({ nameEn: s.nameEn, nameKn: s.nameKn }, q))
                .map((s) => (
                  <tr key={s.itemId}>
                    <td className="name">{pickName(s.nameEn, s.nameKn, lang)}</td>
                    <td className="muted">{s.rack}</td>
                    <td className={'num ' + (s.qty < 0 ? 'qty-neg' : '')}>{dq(s.itemId, s.qty)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}

function SendCard({ t, nm, dq, rack, have, onDone }: { t: Transfer; nm: (id: string) => string; dq: (id: string, q: number) => string; rack: (id: string) => string; have: (id: string) => number; onDone: () => void }) {
  const bi = useBi();
  const { lang } = useSession();
  const [sent, setSent] = useState<Record<string, string>>(() => Object.fromEntries(t.lines.map((l) => [l.itemId, String(Math.min(l.qty, Math.max(0, have(l.itemId))))])));
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [error, setError] = useState('');
  const send = async () => {
    setError('');
    try {
      await http.post('/transfers/' + t.id + '/send', { vehicle, driver, sent: Object.fromEntries(Object.entries(sent).map(([k, v]) => [k, Number(v) || 0])) });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="card">
      <div className="bar" style={{ justifyContent: 'space-between' }}>
        <span className="name">
          #{t.no} · {bi('for the shop', 'ಅಂಗಡಿಗೆ')}
        </span>
        <span className="muted">{when(t.at, lang)}</span>
      </div>
      {error && <div className="msg err">{error}</div>}
      <table className="list plain">
        <thead>
          <tr>
            <th>{bi('Item', 'ಸಾಮಾನು')}</th>
            <th>{bi('Where', 'ಎಲ್ಲಿ')}</th>
            <th className="num">{bi('Asked', 'ಕೇಳಿದ್ದು')}</th>
            <th className="num">{bi('Sending', 'ಕಳುಹಿಸುವುದು')}</th>
          </tr>
        </thead>
        <tbody>
          {t.lines.map((l) => (
            <tr key={l.itemId}>
              <td className="name">{nm(l.itemId)}</td>
              <td className="muted">{rack(l.itemId)}</td>
              <td className="num">{dq(l.itemId, l.qty)}</td>
              <td className="num">
                <input inputMode="decimal" value={sent[l.itemId] ?? ''} onChange={(e) => setSent({ ...sent, [l.itemId]: e.target.value })} style={{ width: 80 }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid2" style={{ marginTop: 10 }}>
        <label className="field">
          <span>{bi('Vehicle', 'ವಾಹನ')}</span>
          <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="KA-17 AB 1234" />
        </label>
        <label className="field">
          <span>{bi('Driver', 'ಚಾಲಕ')}</span>
          <input value={driver} onChange={(e) => setDriver(e.target.value)} />
        </label>
      </div>
      <button className="btn primary" onClick={send}>
        🚚 {bi('Sent', 'ಕಳುಹಿಸಿದೆ')}
      </button>
    </div>
  );
}

// ================================================================ vendor

interface VendorPo {
  id: string;
  no: number;
  status: string;
  at: string;
  to: string;
  invoiceNo?: string;
  vehicle?: string;
  eta?: string;
  lines: { name: string; nameKn: string; unit: string; qty: number; cost: number }[];
  total: number;
}

export function VendorHome() {
  const bi = useBi();
  const { lang } = useSession();
  const [version, setVersion] = useState(0);
  const live = useLive('pos');
  const { value, error } = useLoad(() => http.get<{ supplier: { name: string } | null; orders: VendorPo[] }>('/vendor/pos'), [version, live]);
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  return (
    <>
      <h1 className="title">
        {bi('Orders for', 'ಆರ್ಡರ್‌ಗಳು:')} {value.supplier?.name}
      </h1>
      {value.orders.length === 0 && <Empty>{bi('No orders yet.', 'ಇನ್ನೂ ಆರ್ಡರ್ ಇಲ್ಲ.')}</Empty>}
      {value.orders.map((p) => (
        <VendorCard key={p.id} p={p} onDone={() => setVersion((v) => v + 1)} lang={lang} bi={bi} />
      ))}
    </>
  );
}

function VendorCard({ p, onDone, lang, bi }: { p: VendorPo; onDone: () => void; lang: 'en' | 'kn'; bi: (en: string, kn: string) => string }) {
  const [invoiceNo, setInvoice] = useState(p.invoiceNo ?? '');
  const [vehicle, setVehicle] = useState(p.vehicle ?? '');
  const [eta, setEta] = useState(p.eta ?? '');
  const act = async (path: string, body: unknown = {}) => {
    await http.post('/pos/' + p.id + path, body);
    onDone();
  };
  return (
    <div className="card">
      <div className="bar" style={{ justifyContent: 'space-between' }}>
        <span className="name">
          #{p.no} · {bi('deliver to', 'ತಲುಪಿಸುವುದು:')} {p.to}
        </span>
        <Status s={p.status} label={statusWord(p.status, lang)} />
      </div>
      <div className="muted">{when(p.at, lang)}</div>
      <ul className="lines">
        {p.lines.map((l, i) => (
          <li key={i}>
            {lang === 'kn' && l.nameKn ? l.nameKn : l.name} · {l.qty} {l.unit} × {formatRupees(l.cost)}
          </li>
        ))}
      </ul>
      <b>
        <Money v={p.total} />
      </b>
      {p.status === 'ordered' && (
        <div className="bar" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={() => act('/confirm')}>
            {bi('Confirm order', 'ಆರ್ಡರ್ ಒಪ್ಪಿಕೊಳ್ಳಿ')}
          </button>
        </div>
      )}
      {(p.status === 'confirmed' || p.status === 'ordered') && (
        <div className="grid2" style={{ marginTop: 10 }}>
          <label className="field">
            <span>{bi('Invoice no.', 'ಇನ್‌ವಾಯ್ಸ್ ಸಂಖ್ಯೆ')}</span>
            <input value={invoiceNo} onChange={(e) => setInvoice(e.target.value)} />
          </label>
          <label className="field">
            <span>{bi('Vehicle', 'ವಾಹನ')}</span>
            <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
          </label>
          <label className="field">
            <span>{bi('Arrives', 'ತಲುಪುವ ಸಮಯ')}</span>
            <input value={eta} onChange={(e) => setEta(e.target.value)} placeholder={bi('Today 6 pm', 'ಇಂದು ಸಂಜೆ 6')} />
          </label>
          <div className="field">
            <span>&nbsp;</span>
            <button className="btn primary" onClick={() => act('/dispatch', { invoiceNo, vehicle, eta })}>
              🚚 {bi('Dispatched', 'ಕಳುಹಿಸಿದೆ')}
            </button>
          </div>
        </div>
      )}
      {p.status === 'dispatched' && (
        <p className="muted">
          {p.invoiceNo} · {p.vehicle} · {p.eta}
        </p>
      )}
    </div>
  );
}

// ================================================================ delivery

type Drop = Delivery & { lines: { text: string; ink?: Ink; qty: number }[] };

export function DeliveryHome() {
  const bi = useBi();
  const { lang } = useSession();
  const [version, setVersion] = useState(0);
  const live = useLive('deliveries', 'bills');
  const { value, error } = useLoad(() => http.get<Drop[]>('/delivery/mine'), [version, live]);
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const setStatus = async (d: Drop, status: 'out' | 'delivered' | 'failed') => {
    const note = status === 'failed' ? window.prompt(bi('What happened?', 'ಏನಾಯಿತು?')) ?? '' : undefined;
    await http.post('/deliveries/' + d.id + '/status', { status, ...(note ? { note } : {}) });
    setVersion((v) => v + 1);
  };
  const todo = value.filter((d) => d.status !== 'delivered');
  const done = value.filter((d) => d.status === 'delivered');
  return (
    <>
      <h1 className="title">{bi('My deliveries', 'ನನ್ನ ಡೆಲಿವರಿಗಳು')}</h1>
      {todo.length === 0 && <Empty>{bi('All delivered.', 'ಎಲ್ಲ ತಲುಪಿಸಲಾಗಿದೆ.')}</Empty>}
      {todo.map((d) => (
        <div className="card" key={d.id}>
          <div className="bar" style={{ justifyContent: 'space-between' }}>
            <span className="name">{d.name}</span>
            <Status s={d.status} label={statusWord(d.status, lang)} />
          </div>
          <div>{d.address}</div>
          {d.landmark && <div className="muted">📍 {d.landmark}</div>}
          <div className="bar" style={{ margin: '8px 0' }}>
            <a className="btn" href={'tel:' + d.phone}>
              📞 {bi('Call', 'ಕರೆ')}
            </a>
            <a className="btn" target="_blank" rel="noreferrer" href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(d.address + (d.landmark ? ' ' + d.landmark : ''))}>
              🗺 {bi('Map', 'ನಕ್ಷೆ')}
            </a>
          </div>
          <ul className="lines">
            {d.lines.map((l, i) => (
              <li key={i}>
                {l.ink && !l.text ? <InkView ink={l.ink} height={24} /> : l.text} · {l.qty}
              </li>
            ))}
          </ul>
          {d.amountDue > 0 && (
            <div className="banner warn">
              {bi('Collect', 'ವಸೂಲಿ ಮಾಡಿ')} <Money v={d.amountDue} />
            </div>
          )}
          <div className="bar" style={{ marginTop: 10 }}>
            {(d.status === 'pending' || d.status === 'failed') && (
              <button className="btn primary" onClick={() => setStatus(d, 'out')}>
                {bi('Leaving now', 'ಹೊರಡುತ್ತಿದ್ದೇನೆ')}
              </button>
            )}
            {d.status === 'out' && (
              <>
                <button className="btn primary" onClick={() => setStatus(d, 'delivered')}>
                  ✓ {bi('Delivered', 'ತಲುಪಿಸಿದೆ')}
                </button>
                <button className="btn danger" onClick={() => setStatus(d, 'failed')}>
                  {bi('Could not deliver', 'ತಲುಪಿಸಲಾಗಲಿಲ್ಲ')}
                </button>
              </>
            )}
          </div>
        </div>
      ))}
      {done.length > 0 && <h2 className="subtitle">{bi('Delivered', 'ತಲುಪಿಸಿದ್ದು')}</h2>}
      {done.map((d) => (
        <div className="card muted" key={d.id}>
          {d.name} · {bi('bill', 'ಬಿಲ್')} #{d.billNo} · {d.times.delivered ? when(d.times.delivered, lang) : ''}
        </div>
      ))}
    </>
  );
}

// ================================================================ customer

interface CBill {
  no: number;
  at: string;
  total: number;
  paid: number;
  balance: number;
  cancelled: boolean;
  lines: { name: string; ink?: Ink; qty: number; amount: number }[];
}
interface CItem {
  id: string;
  nameEn: string;
  nameKn: string;
  category: string;
  units: { code: string; label: string; labelKn: string; price: number }[];
  available: boolean;
}

export function CustomerHome() {
  const bi = useBi();
  const { lang } = useSession();
  const [tab, setTab] = useState<'bills' | 'items' | 'order'>('bills');
  const [version, setVersion] = useState(0);
  const live = useLive('bills', 'orders', 'items', 'stock');
  const bills = useLoad(() => http.get<{ name: string; balance: number; bills: CBill[] }>('/customer/bills'), [version, live]);
  const cat = useLoad(() => http.get<CItem[]>('/customer/catalogue'), [live]);
  const orders = useLoad(() => http.get<OrderRequest[]>('/customer/orders'), [version, live]);
  const [q, setQ] = useState('');
  const [cart, setCart] = useState<Record<string, { unit: string; qty: number }>>({});
  const [note, setNote] = useState('');
  const [sent, setSent] = useState('');
  const [written, setWritten] = useState<WrittenResult[]>([]);
  const items = cat.value ?? [];
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const placeOrder = async () => {
    const lines = [
      ...Object.entries(cart).map(([itemId, v]) => ({ itemId, unit: v.unit, qty: v.qty })),
      // A written line goes as the writing itself, what it was read as, and the item when sure.
      ...written.map((w) => ({ ink: w.ink, ...(w.readText ? { text: w.readText } : {}), ...(w.matches[0] && w.matches[0].confidence >= 0.85 ? { itemId: w.matches[0].itemId } : {}), ...(w.qty ? { qty: w.qty } : {}), ...(w.unit ? { unit: w.unit } : {}) })),
    ];
    await http.post('/customer/orders', { lines, ...(note ? { note } : {}) });
    setCart({});
    setWritten([]);
    setNote('');
    setSent(bi('Sent to the shop. You will see it here when it is billed.', 'ಅಂಗಡಿಗೆ ಕಳುಹಿಸಲಾಗಿದೆ. ಬಿಲ್ ಆದಾಗ ಇಲ್ಲಿ ಕಾಣುತ್ತದೆ.'));
    setVersion((v) => v + 1);
  };

  return (
    <>
      {bills.value && (
        <div className={'banner ' + (bills.value.balance > 0 ? 'warn' : 'ok')}>
          {bi('Namaskara', 'ನಮಸ್ಕಾರ')}, {bills.value.name} · {bi('Balance due', 'ಬಾಕಿ')}: <Money v={bills.value.balance} />
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'bills', label: bi('My bills', 'ನನ್ನ ಬಿಲ್‌ಗಳು') },
          { key: 'items', label: bi('Shop items', 'ಅಂಗಡಿ ಸಾಮಾನು') },
          { key: 'order', label: bi('Order', 'ಆರ್ಡರ್') + (Object.keys(cart).length ? ' (' + Object.keys(cart).length + ')' : '') },
        ]}
      />
      {tab === 'bills' &&
        (bills.value ? (
          bills.value.bills.map((b) => (
            <div className="card slip" key={b.no}>
              <div className="bar" style={{ justifyContent: 'space-between' }}>
                <b>
                  {bi('Bill', 'ಬಿಲ್')} #{b.no}
                </b>
                <span className="muted">{when(b.at, lang)}</span>
              </div>
              {b.lines.map((l, i) => (
                <div className="slip-line" key={i}>
                  <span className="muted">{i + 1}</span>
                  <span className="grow">{l.ink ? <InkView ink={l.ink} height={30} /> : l.name}</span>
                  <span className="num">{formatRupees(l.amount)}</span>
                </div>
              ))}
              <div className="slip-total">
                <span>{bi('Total', 'ಒಟ್ಟು')}</span>
                <b className="num">{formatRupees(b.total)}</b>
              </div>
              {b.balance > 0 && (
                <div className="muted">
                  {bi('Paid', 'ಪಾವತಿ')} {formatRupees(b.paid)} · {bi('Balance', 'ಬಾಕಿ')} {formatRupees(b.balance)}
                </div>
              )}
            </div>
          ))
        ) : (
          <Loading />
        ))}
      {tab === 'items' && (
        <>
          <input placeholder={bi('Search in Kannada or English', 'ಕನ್ನಡ ಅಥವಾ ಇಂಗ್ಲಿಷ್‌ನಲ್ಲಿ ಹುಡುಕಿ')} value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
          {items
            .filter((i) => !q.trim() || itemMatches(i, q))
            .map((i) => (
              <div className="card item-row" key={i.id}>
                <div className="grow">
                  <div className="name">{pickName(i.nameEn, i.nameKn, lang)}</div>
                  <div className="muted">
                    {i.units.map((u) => ((lang === 'kn' && u.labelKn) || u.label) + ' ' + formatRupees(u.price)).join(' · ')}
                  </div>
                </div>
                {i.available ? (
                  <button className="btn small" onClick={() => setCart({ ...cart, [i.id]: { unit: i.units[0]!.code, qty: (cart[i.id]?.qty ?? 0) + 1 } })}>
                    + {bi('Add', 'ಸೇರಿಸಿ')} {cart[i.id] ? '(' + cart[i.id]!.qty + ')' : ''}
                  </button>
                ) : (
                  <span className="pill">{bi('Not in the shop now', 'ಈಗ ಅಂಗಡಿಯಲ್ಲಿಲ್ಲ')}</span>
                )}
              </div>
            ))}
        </>
      )}
      {tab === 'order' && (
        <>
          {sent && <div className="msg ok">{sent}</div>}
          <div className="bar" style={{ marginBottom: 10 }}>
            <WriteToFind label={bi('Write a line by hand', 'ಕೈಯಿಂದ ಬರೆಯಿರಿ')} onResult={(r) => setWritten((w) => [...w, r])} />
          </div>
          {written.map((w, i) => (
            <div className="card bar" key={i}>
              <InkView ink={w.ink} height={30} />
              <span className="grow muted">{w.readText}</span>
              <button className="btn ghost small" onClick={() => setWritten(written.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          {Object.keys(cart).length === 0 && written.length === 0 ? (
            <Empty>{bi('Add items from “Shop items”.', '“ಅಂಗಡಿ ಸಾಮಾನು” ನಿಂದ ಸೇರಿಸಿ.')}</Empty>
          ) : (
            <div className="card">
              {Object.entries(cart).map(([id, v]) => {
                const it = byId.get(id);
                return (
                  <div className="bar" key={id} style={{ marginBottom: 6 }}>
                    <span className="grow name">{it ? pickName(it.nameEn, it.nameKn, lang) : id}</span>
                    <select value={v.unit} onChange={(e) => setCart({ ...cart, [id]: { ...v, unit: e.target.value } })} style={{ width: 'auto' }}>
                      {it?.units.map((u) => (
                        <option key={u.code} value={u.code}>
                          {(lang === 'kn' && u.labelKn) || u.label}
                        </option>
                      ))}
                    </select>
                    <input inputMode="decimal" value={v.qty} onChange={(e) => setCart({ ...cart, [id]: { ...v, qty: Number(e.target.value) || 0 } })} style={{ width: 70 }} />
                  </div>
                );
              })}
              <label className="field" style={{ marginTop: 10 }}>
                <span>{bi('Note for the shop', 'ಅಂಗಡಿಗೆ ಟಿಪ್ಪಣಿ')}</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
              <button className="btn primary" onClick={placeOrder}>
                {bi('Send to the shop', 'ಅಂಗಡಿಗೆ ಕಳುಹಿಸಿ')}
              </button>
            </div>
          )}
          <h2 className="subtitle">{bi('My requests', 'ನನ್ನ ಬೇಡಿಕೆಗಳು')}</h2>
          {(orders.value ?? []).map((o) => (
            <div className="card" key={o.id}>
              <div className="bar" style={{ justifyContent: 'space-between' }}>
                <span className="muted">{when(o.at, lang)}</span>
                <Status s={o.status} label={statusWord(o.status, lang)} />
              </div>
              <ul className="lines">
                {o.lines.map((l, i) => {
                  const it = l.itemId ? byId.get(l.itemId) : undefined;
                  return (
                    <li key={i}>
                      {l.ink && <InkView ink={l.ink} height={24} />} {it ? pickName(it.nameEn, it.nameKn, lang) : l.text}
                      {l.qty != null && ' · ' + l.qty + ' ' + (l.unit ?? '')}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </>
      )}
    </>
  );
}

/** A godown receiving: what was sent, and what actually arrived, counted here. */
function ReceiveCard({ t, nm, dq, onDone }: { t: Transfer; nm: (id: string) => string; dq: (id: string, q: number) => string; onDone: () => void }) {
  const bi = useBi();
  const { lang } = useSession();
  const [got, setGot] = useState<Record<string, string>>(() => Object.fromEntries(t.lines.map((l) => [l.itemId, String(l.sent ?? l.qty)])));
  const [error, setError] = useState('');
  const receive = async () => {
    setError('');
    try {
      await http.post('/transfers/' + t.id + '/receive', { received: Object.fromEntries(Object.entries(got).map(([k, v]) => [k, Number(v) || 0])) });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="card">
      <div className="bar" style={{ justifyContent: 'space-between' }}>
        <span className="name">#{t.no}</span>
        <span className="muted">
          {t.times.sent ? when(t.times.sent, lang) : ''} {t.vehicle ? '· 🚚 ' + t.vehicle : ''} {t.driver ? '· ' + t.driver : ''}
        </span>
      </div>
      {error && <div className="msg err">{error}</div>}
      <table className="list plain">
        <thead>
          <tr>
            <th>{bi('Item', 'ಸಾಮಾನು')}</th>
            <th className="num">{bi('Sent', 'ಕಳುಹಿಸಿದ್ದು')}</th>
            <th className="num">{bi('Arrived', 'ಬಂದದ್ದು')}</th>
          </tr>
        </thead>
        <tbody>
          {t.lines.map((l) => {
            const sent = l.sent ?? l.qty;
            const short = Number(got[l.itemId]) < sent;
            return (
              <tr key={l.itemId}>
                <td className="name">{nm(l.itemId)}</td>
                <td className="num">{dq(l.itemId, sent)}</td>
                <td className={'num ' + (short ? 'qty-neg' : '')}>
                  <input inputMode="decimal" value={got[l.itemId] ?? ''} onChange={(e) => setGot({ ...got, [l.itemId]: e.target.value })} style={{ width: 80 }} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button className="btn primary" onClick={receive}>
        {bi('Received', 'ಬಂದಿದೆ')}
      </button>
    </div>
  );
}
