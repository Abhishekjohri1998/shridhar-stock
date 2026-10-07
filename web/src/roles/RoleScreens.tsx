import { useEffect, useMemo, useState } from 'react';
import { describeQty, formatRupees, groupPick, itemMatches, pickName, type Delivery, type Ink, type ItemUnit, type OrderRequest, type Transfer } from '@stock/core';
import { http } from '../lib/api';
import { useLive } from '../lib/live';
import { useLoad, useSession } from '../lib/session';
import { statusWord } from '../lib/words';
import { Empty, Greeting, InkView, Loading, Money, Status, Tabs, Tile, useBi, useWeekSales, VehicleInput, WeekChart, when, Table, Select } from '../components/ui';
import type { IconName } from '../components/Icon';

/** A slow safety net under the live stream, for a phone whose stream quietly stalled. */
function useTick(ms: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return n;
}


interface WorkerLine {
  i: number;
  name: string;
  ink?: Ink;
  qty: number;
  readText?: string;
  itemId?: string;
  itemName: string;
  unit?: string;
  /** Where it is kept: the shop's rack, else the first godown's that has one. */
  place?: string;
  placeOrder?: number;
  rack: string;
  fetched: boolean;
}
interface WorkerBill {
  /** 0 while the bill is still being written; then draftId says which. */
  no: number;
  draftId?: string;
  at: string;
  customer: string;
  total: number;
  rounded: number;
  roundOff: number;
  lines: WorkerLine[];
}

/**
 * The pick list: a bill as soon as it is saved in billing, its lines grouped by where they are
 * kept, so the worker walks the shop once. Handwritten lines show the writing itself, for the worker to read. A bill still being written at the counter shows as
 * "Being written", and can be fetched and ticked before it is saved.
 */
export function WorkerHome({ screen = false }: { screen?: boolean }) {
  const bi = useBi();
  const { lang } = useSession();
  const live = useLive('bills', 'items');
  const tick = useTick(60_000);
  const [version, setVersion] = useState(0);
  const { value, error } = useLoad(() => http.get<WorkerBill[]>('/worker/bills'), [live, tick, version]);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  if (value.length === 0) return <Empty tour="worker-bill">{bi('No bills yet today. New bills appear here by themselves.', 'ಇಂದು ಇನ್ನೂ ಬಿಲ್ ಇಲ್ಲ. ಹೊಸ ಬಿಲ್‌ಗಳು ತಾವಾಗಿ ಇಲ್ಲಿ ಬರುತ್ತವೆ.')}</Empty>;
  const keyOf = (b: WorkerBill) => b.draftId ?? String(b.no);
  const bill = value.find((b) => keyOf(b) === open) ?? value[0]!;
  const base = bill.draftId ? '/worker/drafts/' + encodeURIComponent(bill.draftId) : '/worker/bills/' + bill.no;
  const label = (b: WorkerBill) => (b.draftId ? bi('Being written', 'ಬರೆಯಲಾಗುತ್ತಿದೆ') : '#' + b.no);
  // The shop's racks first, then each godown's, then anything with no rack.
  const groups = groupPick(bill.lines);
  const done = bill.lines.filter((l) => l.fetched).length;
  const tickLine = async (l: WorkerLine) => {
    await http.post(base + '/lines/' + l.i + '/fetched', { fetched: !l.fetched });
    setVersion((v) => v + 1);
  };
  const tickAll = async (fetched: boolean) => {
    await http.post(base + '/fetched', { fetched });
    setVersion((v) => v + 1);
  };
  return (
    <div className={screen ? 'worker screen' : 'worker'}>
      {!screen && value.length > 1 && (
        <div className="chips mb-10" data-tour="worker-bills">
          {value.map((b) => (
            <button key={keyOf(b)} className={'chip ' + (keyOf(b) === keyOf(bill) ? 'on' : '')} onClick={() => setOpen(keyOf(b))}>
              {label(b)} · {b.customer || bi('walk-in', 'ಗ್ರಾಹಕ')} · {b.lines.filter((l) => l.fetched).length}/{b.lines.length}
            </button>
          ))}
        </div>
      )}
      <div className="bar between">
        <h1 className="title m-0" data-tour="worker-bill">
          {bill.draftId ? bi('Being written', 'ಬರೆಯಲಾಗುತ್ತಿದೆ') : bi('Bill', 'ಬಿಲ್') + ' #' + bill.no} · {bill.customer || bi('walk-in', 'ಗ್ರಾಹಕ')}
        </h1>
        <span className={'pill ' + (done === bill.lines.length ? 'ok' : 'warn')} data-tour="worker-count">
          {done} {bi('of', '/')} {bill.lines.length} {bi('fetched', 'ತಂದಿದೆ')}
        </span>
      </div>
      <p className="muted" data-tour="worker-total">
        {when(bill.at, lang)} · {bi('Total', 'ಒಟ್ಟು')} <b>{formatRupees(bill.rounded)}</b>
        {bill.roundOff !== 0 && ' (' + formatRupees(bill.total) + ' ' + bi('round off', 'ರೌಂಡ್ ಆಫ್') + ' ' + (bill.roundOff > 0 ? '+' : '−') + formatRupees(Math.abs(bill.roundOff)) + ')'}
      </p>
      {bill.draftId && (
        <div className="banner warn">{bi('Not saved yet: lines may still change at the counter.', 'ಇನ್ನೂ ಉಳಿಸಿಲ್ಲ: ಕೌಂಟರ್‌ನಲ್ಲಿ ಸಾಲುಗಳು ಬದಲಾಗಬಹುದು.')}</div>
      )}
      {!screen && bill.lines.length > 1 && (
        <div className="bar" data-tour="worker-select-all">
          <button className="btn small" disabled={done === bill.lines.length} onClick={() => tickAll(true)}>
            ✓ {bi('Select all', 'ಎಲ್ಲ ಆಯ್ಕೆ')}
          </button>
          <button className="btn small" disabled={done === 0} onClick={() => tickAll(false)}>
            {bi('Select none', 'ಯಾವುದೂ ಬೇಡ')}
          </button>
        </div>
      )}
      {done === bill.lines.length && (
        <div className="banner ok">✓ {bi('Everything on this bill is fetched.', 'ಈ ಬಿಲ್‌ನ ಎಲ್ಲವನ್ನೂ ತರಲಾಗಿದೆ.')}</div>
      )}
      {groups.map(({ key, place, rack, other, lines }) => (
        <div key={key} className="card" data-tour="worker-rack">
          <div className="rack">📍 {other ? bi('Other place', 'ಬೇರೆ ಸ್ಥಳ') : (place ? place + ' · ' : '') + rack}</div>
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
                <button className={'fetch ' + (l.fetched ? 'on' : '')} data-tour="worker-fetch" onClick={() => tickLine(l)} aria-pressed={l.fetched}>
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

/**
 * The worker's Godown tab: what the shop asks a godown to send, and what is coming in. Any worker
 * may do it; with more than one godown, a picker chooses which.
 */
export function GodownHome() {
  const bi = useBi();
  const { lang, me } = useSession();
  const [tab, setTab] = useState<'requests' | 'incoming' | 'stock'>('requests');
  const [version, setVersion] = useState(0);
  const live = useLive('transfers', 'stock', 'items');
  const places = useLoad(() => http.get<{ id: string; name: string; nameKn?: string }[]>('/godown/places'), []);
  const [picked, setPicked] = useState('');
  const godowns = places.value ?? [];
  // An old godown login opens on its own godown; everyone else on the first.
  const g = godowns.find((x) => x.id === picked)?.id ?? godowns.find((x) => x.id === me?.linkedId)?.id ?? godowns[0]?.id ?? '';
  const { value, error } = useLoad(async () => {
    if (!g) return null;
    const q = '?g=' + encodeURIComponent(g);
    const [transfers, stock] = await Promise.all([http.get<Transfer[]>('/godown/transfers' + q), http.get<GItem[]>('/godown/stock' + q)]);
    return { transfers, stock };
  }, [version, live, g]);
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  if (places.error || error) return <div className="msg err">{places.error || error}</div>;
  if (places.value && !godowns.length) return <Empty>{bi('There is no godown yet. The admin adds one under Setup → Places.', 'ಇನ್ನೂ ಗೋದಾಮು ಇಲ್ಲ. ಆಡ್ಮಿನ್ ಸೆಟಪ್ → ಸ್ಥಳಗಳಲ್ಲಿ ಸೇರಿಸುತ್ತಾರೆ.')}</Empty>;
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
  const outgoing = value.transfers.filter((t) => t.from === g && t.status === 'requested');
  const incoming = value.transfers.filter((t) => t.to === g && t.status === 'sent');
  const history = value.transfers.filter((t) => t.status === 'received' || (t.from === g && t.status === 'sent'));

  const done = (msg: string) => {
    setNote(msg);
    setVersion((v) => v + 1);
  };
  return (
    <>
      <h1 className="title">{bi('Godown', 'ಗೋದಾಮು')}</h1>
      {godowns.length > 1 && (
        <div className="mb-10" data-tour="godown-pick">
          <Select value={g} onChange={setPicked} aria-label={bi('Which godown', 'ಯಾವ ಗೋದಾಮು')} options={godowns.map((x) => ({ value: x.id, label: pickName(x.name, x.nameKn ?? '', lang) }))} />
        </div>
      )}
      {note && <div className="msg ok">{note}</div>}
      <div data-tour="godown-tabs">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'requests', label: bi('To send', 'ಕಳುಹಿಸಬೇಕು') + (outgoing.length ? ' (' + outgoing.length + ')' : '') },
          { key: 'incoming', label: bi('Coming in', 'ಬರುತ್ತಿದೆ') + (incoming.length ? ' (' + incoming.length + ')' : '') },
          { key: 'stock', label: bi('Stock here', 'ಇಲ್ಲಿನ ಸ್ಟಾಕ್') },
        ]}
      />
      </div>
      {tab === 'requests' && (
        <>
          {outgoing.length === 0 && (
            <Empty tour="godown-send-card">
              {bi('Nothing to send right now. When the shop asks for goods, the request shows here by itself.', 'ಈಗ ಕಳುಹಿಸಲು ಏನೂ ಇಲ್ಲ. ಅಂಗಡಿ ಕೇಳಿದಾಗ, ಬೇಡಿಕೆ ಇಲ್ಲಿ ತಾನಾಗಿ ಬರುತ್ತದೆ.')}
            </Empty>
          )}
          {outgoing.map((t) => (
            <SendCard key={t.id} t={t} nm={nm} dq={dq} rack={(id) => byId.get(id)?.rack ?? ''} have={(id) => byId.get(id)?.qty ?? 0} onDone={done} />
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
          {incoming.length === 0 && <Empty>{bi('Nothing on the way to this godown. Goods bought or sent here show up in this tab.', 'ಈ ಗೋದಾಮಿಗೆ ಏನೂ ಬರುತ್ತಿಲ್ಲ. ಇಲ್ಲಿಗೆ ಕಳುಹಿಸಿದ ಸಾಮಾನು ಈ ಟ್ಯಾಬ್‌ನಲ್ಲಿ ಕಾಣುತ್ತದೆ.')}</Empty>}
          {incoming.map((t) => (
            <ReceiveCard key={t.id} t={t} nm={nm} dq={dq} onDone={done} />
          ))}
        </>
      )}
      {tab === 'stock' && (
        <>
          <input placeholder={bi('Search', 'ಹುಡುಕಿ')} value={q} onChange={(e) => setQ(e.target.value)} className="mb-10" data-tour="godown-stock" />
          <Table className="list">
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
          </Table>
        </>
      )}
    </>
  );
}

function SendCard({ t, nm, dq, rack, have, onDone }: { t: Transfer; nm: (id: string) => string; dq: (id: string, q: number) => string; rack: (id: string) => string; have: (id: string) => number; onDone: (msg: string) => void }) {
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
      onDone(
        bi('Sent to the shop: ', 'ಅಂಗಡಿಗೆ ಕಳುಹಿಸಲಾಗಿದೆ: ') +
          t.lines
            .filter((l) => (Number(sent[l.itemId]) || 0) > 0)
            .map((l) => nm(l.itemId) + ' −' + dq(l.itemId, Number(sent[l.itemId]) || 0))
            .join(', '),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="card" data-tour="godown-send-card">
      <div className="bar between">
        <span className="name">
          #{t.no} · {bi('for the shop', 'ಅಂಗಡಿಗೆ')}
        </span>
        <span className="muted">{when(t.at, lang)}</span>
      </div>
      {error && <div className="msg err">{error}</div>}
      <Table className="list plain">
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
              <td className="num" data-tour="godown-sending">
                <input inputMode="decimal" value={sent[l.itemId] ?? ''} onChange={(e) => setSent({ ...sent, [l.itemId]: e.target.value })} className="in-price" />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="grid2 mt-10" data-tour="godown-vehicle">
        <label className="field">
          <span>{bi('Vehicle', 'ವಾಹನ')}</span>
          <VehicleInput value={vehicle} onChange={setVehicle} placeholder="KA-17 AB 1234" />
        </label>
        <label className="field">
          <span>{bi('Driver', 'ಚಾಲಕ')}</span>
          <input value={driver} onChange={(e) => setDriver(e.target.value)} />
        </label>
      </div>
      <button className="btn primary" onClick={send} data-tour="godown-send">
        🚚 {bi('Send to shop', 'ಅಂಗಡಿಗೆ ಕಳುಹಿಸಿ')}
      </button>
    </div>
  );
}

/** A godown receiving: what was sent, and what actually arrived, counted here. */
function ReceiveCard({ t, nm, dq, onDone }: { t: Transfer; nm: (id: string) => string; dq: (id: string, q: number) => string; onDone: (msg: string) => void }) {
  const bi = useBi();
  const { lang } = useSession();
  const [got, setGot] = useState<Record<string, string>>(() => Object.fromEntries(t.lines.map((l) => [l.itemId, String(l.sent ?? l.qty)])));
  const [error, setError] = useState('');
  const receive = async () => {
    setError('');
    try {
      await http.post('/transfers/' + t.id + '/receive', { received: Object.fromEntries(Object.entries(got).map(([k, v]) => [k, Number(v) || 0])) });
      onDone(bi('Received here: ', 'ಇಲ್ಲಿಗೆ ಬಂದಿದೆ: ') + t.lines.map((l) => nm(l.itemId) + ' +' + dq(l.itemId, Number(got[l.itemId]) || 0)).join(', '));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="card">
      <div className="bar between">
        <span className="name">#{t.no}</span>
        <span className="muted">
          {t.times.sent ? when(t.times.sent, lang) : ''} {t.vehicle ? '· 🚚 ' + t.vehicle : ''} {t.driver ? '· ' + t.driver : ''}
        </span>
      </div>
      {error && <div className="msg err">{error}</div>}
      <Table className="list plain">
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
                  <input inputMode="decimal" value={got[l.itemId] ?? ''} onChange={(e) => setGot({ ...got, [l.itemId]: e.target.value })} className="in-price" />
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <button className="btn primary" onClick={receive} data-tour="godown-receive">
        {bi('Mark received', 'ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಿ')}
      </button>
    </div>
  );
}
