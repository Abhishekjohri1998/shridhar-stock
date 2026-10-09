import { useEffect, useMemo, useRef, useState } from 'react';
import { describeQty, formatRupees, groupPick, itemMatches, PAID_BY, pickName, type Delivery, type Ink, type ItemUnit, type OrderRequest, type PaidBy, type Transfer } from '@stock/core';
import { LiveMap, type MapMarker } from '../components/LiveMap';
import { openLink, paidWord, trackMessage, waLink } from '../lib/share';
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

// ---------------------------------------------------------------- deliveries (any worker)

type WorkerDelivery = Omit<Delivery, 'track' | 'otp' | 'otpTries'> & { links?: { track: string } };

/**
 * A photo from the camera, made small in the browser before it is sent: at most 1024 px on the
 * long side, JPEG at 0.7 — about 100 KB, inside the normal JSON request.
 */
export async function shrinkPhoto(file: File, max = 1024, quality = 0.7): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read the photo'));
      i.src = url;
    });
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k));
    c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Four big boxes for the door code; typing moves to the next box. Shakes when `wrong` changes. */
function OtpBoxes({ value, onChange, wrong }: { value: string; onChange: (v: string) => void; wrong: number }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(4, ' ').slice(0, 4).split('');
  const set = (i: number, ch: string) => {
    const d = ch.replace(/\D/g, '');
    if (d.length > 1) {
      // A pasted code.
      onChange(d.slice(0, 4));
      refs.current[Math.min(3, d.length)]?.focus();
      return;
    }
    const next = digits.map((x, j) => (j === i ? d || ' ' : x)).join('').trimEnd();
    onChange(next.replace(/ /g, ''));
    if (d && i < 3) refs.current[i + 1]?.focus();
  };
  return (
    <div key={wrong} className={'otp-boxes' + (wrong ? ' shake' : '')} data-tour="worker-otp">
      {digits.map((c, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={4}
          aria-label={'Digit ' + (i + 1)}
          value={c.trim()}
          onChange={(e) => set(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !c.trim() && i > 0) refs.current[i - 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}

/**
 * Inside the tablet/phone app the stock screen is a WebView: the app asks Android for location
 * permission when the page says so, and answers with a 'location-permission' event. In a plain
 * browser the browser asks by itself, so there is nothing to wait for.
 */
function askLocationPermission(): Promise<'granted' | 'denied' | 'unknown'> {
  const rn = (window as unknown as { ReactNativeWebView?: { postMessage: (s: string) => void } }).ReactNativeWebView;
  if (!rn) return Promise.resolve('unknown');
  return new Promise((resolve) => {
    const done = (r: 'granted' | 'denied' | 'unknown') => {
      clearTimeout(timer);
      window.removeEventListener('location-permission', onAnswer);
      resolve(r);
    };
    const onAnswer = (e: Event) => done((e as CustomEvent<{ granted?: boolean }>).detail?.granted ? 'granted' : 'denied');
    const timer = setTimeout(() => done('unknown'), 10_000);
    window.addEventListener('location-permission', onAnswer);
    rn.postMessage(JSON.stringify({ type: 'need-location' }));
  });
}

/** How often the phone sends where it is. */
const SEND_EVERY_MS = 10_000;

/**
 * While a delivery is on the way and this screen is open: watch the phone's position and send the
 * latest one every ~10 s. Keeps the screen awake where the browser allows.
 */
function useSharePosition(id: string | null, onProblem: (msg: string) => void) {
  const bi = useBi();
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (!id) return;
    let stopped = false;
    let watch: number | null = null;
    let latest: { lat: number; lng: number; accuracy?: number } | null = null;
    let sentKey = '';
    let lock: { release: () => Promise<void> } | null = null;
    const send = () => {
      if (!latest || stopped) return;
      const key = latest.lat.toFixed(6) + ',' + latest.lng.toFixed(6);
      if (key === sentKey) return;
      sentKey = key;
      http.post('/worker/deliveries/' + id + '/position', latest).catch(() => {
        sentKey = '';
      });
    };
    const timer = setInterval(send, SEND_EVERY_MS);
    void (async () => {
      const perm = await askLocationPermission();
      if (stopped) return;
      if (perm === 'denied') {
        onProblem(bi('Location is not allowed. Allow it for this app in the phone’s Settings, then open this screen again.', 'ಸ್ಥಳ ಅನುಮತಿ ಇಲ್ಲ. ಫೋನಿನ ಸೆಟ್ಟಿಂಗ್ಸ್‌ನಲ್ಲಿ ಈ ಆ್ಯಪ್‌ಗೆ ಅನುಮತಿಸಿ, ಈ ಪರದೆ ಮತ್ತೆ ತೆರೆಯಿರಿ.'));
        return;
      }
      if (!navigator.geolocation) {
        onProblem(bi('This phone cannot share its location.', 'ಈ ಫೋನ್ ಸ್ಥಳ ಹಂಚಲು ಆಗುವುದಿಲ್ಲ.'));
        return;
      }
      let first = true;
      watch = navigator.geolocation.watchPosition(
        (p) => {
          latest = { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Number.isFinite(p.coords.accuracy) ? Math.round(p.coords.accuracy) : undefined };
          setSending(true);
          onProblem('');
          if (first) {
            first = false;
            send();
          }
        },
        (e) => {
          setSending(false);
          onProblem(
            e.code === e.PERMISSION_DENIED
              ? bi('Location is not allowed. Allow it in the phone’s Settings, then open this screen again.', 'ಸ್ಥಳ ಅನುಮತಿ ಇಲ್ಲ. ಫೋನಿನ ಸೆಟ್ಟಿಂಗ್ಸ್‌ನಲ್ಲಿ ಅನುಮತಿಸಿ, ಈ ಪರದೆ ಮತ್ತೆ ತೆರೆಯಿರಿ.')
              : bi('Cannot find the location right now. Turn on GPS.', 'ಈಗ ಸ್ಥಳ ಸಿಗುತ್ತಿಲ್ಲ. GPS ಆನ್ ಮಾಡಿ.'),
          );
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 30_000 },
      );
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (wl) lock = await wl.request('screen');
      } catch {
        /* the screen may sleep; the banner says to keep it open */
      }
    })();
    return () => {
      stopped = true;
      clearInterval(timer);
      if (watch != null) navigator.geolocation.clearWatch(watch);
      void lock?.release().catch(() => undefined);
      setSending(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return sending;
}

/** The phone's own map app: geo: inside the tablet app, Google Maps directions in a browser. */
function mapsLink(d: WorkerDelivery): string {
  const inApp = !!(window as unknown as { ReactNativeWebView?: unknown }).ReactNativeWebView;
  if (d.lat != null && d.lng != null) {
    return inApp ? 'geo:' + d.lat + ',' + d.lng + '?q=' + d.lat + ',' + d.lng + '(' + encodeURIComponent(d.name) + ')' : 'https://www.google.com/maps/dir/?api=1&destination=' + d.lat + ',' + d.lng;
  }
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(d.address);
}

/** Worker → Deliveries: their own deliveries, Start (shares location), Delivered or Couldn't deliver. */
export function DeliveriesHome() {
  const bi = useBi();
  const { lang } = useSession();
  const live = useLive('delivery');
  const { value, error, reload } = useLoad(() => http.get<WorkerDelivery[]>('/worker/deliveries'), [live]);
  const [problem, setProblem] = useState('');
  const [msg, setMsg] = useState('');
  const [closing, setClosing] = useState<{ id: string; ok: boolean } | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [otp, setOtp] = useState('');
  const [wrong, setWrong] = useState(0);
  const [locked, setLocked] = useState(false);
  const [paidBy, setPaidBy] = useState<PaidBy | ''>('');
  const [photo, setPhoto] = useState('');
  const [busy, setBusy] = useState(false);
  const onWay = value?.find((d) => d.status === 'out') ?? null;
  const sending = useSharePosition(onWay?.id ?? null, setProblem);

  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;

  const act = async (fn: () => Promise<unknown>) => {
    setMsg('');
    setBusy(true);
    try {
      await fn();
      setClosing(null);
      reload();
    } catch (e) {
      const m = (e as Error).message;
      setMsg(m);
      // A wrong door code shakes the boxes; too many and only the shop can help.
      if (/code/i.test(m)) {
        setWrong((w) => w + 1);
        setOtp('');
      }
      if (/Call the shop/i.test(m)) setLocked(true);
    }
    setBusy(false);
  };
  const openClose = (d: WorkerDelivery) => {
    setClosing({ id: d.id, ok: true });
    setAmount(String(d.amountDue || ''));
    setOtp('');
    setWrong(0);
    setLocked(false);
    setPaidBy(d.amountDue > 0 ? '' : 'paid');
    setPhoto('');
    setMsg('');
  };
  const takePhoto = async (file: File | undefined) => {
    if (!file) return;
    try {
      setPhoto(await shrinkPhoto(file));
    } catch (e) {
      setMsg((e as Error).message);
    }
  };

  // The map: where to go, and ◎ for where the worker is now.
  const target = onWay ?? value.find((d) => d.status === 'pending' && d.lat != null) ?? null;
  const mapMarkers: MapMarker[] = target && target.lat != null && target.lng != null ? [{ id: 'to-' + target.id, lat: target.lat, lng: target.lng, icon: '🏠', label: target.name }] : [];

  return (
    <>
      <h1 className="title">{bi('Deliveries', 'ಡೆಲಿವರಿ')}</h1>
      {onWay && (
        <div className={'share-banner' + (sending ? ' on' : '')} data-tour="worker-share" role="status">
          <span className="share-dot" aria-hidden />
          <div>
            <b>{bi('Sharing your location: keep this screen open', 'ನಿಮ್ಮ ಸ್ಥಳ ಹಂಚಲಾಗುತ್ತಿದೆ: ಈ ಪರದೆ ತೆರೆದೇ ಇಡಿ')}</b>
            <div className="muted">{bi('If the phone locks, the shop stops seeing you. It stops by itself when you mark it done.', 'ಫೋನ್ ಲಾಕ್ ಆದರೆ ಅಂಗಡಿಗೆ ಕಾಣುವುದಿಲ್ಲ. ಮುಗಿಸಿದಾಗ ತಾನೇ ನಿಲ್ಲುತ್ತದೆ.')}</div>
          </div>
        </div>
      )}
      {problem && <div className="msg err">{problem}</div>}
      {msg && !closing && <div className="msg err">{msg}</div>}
      {mapMarkers.length > 0 && <LiveMap className="map-small" markers={mapMarkers} locate locateLabel={bi('Show where I am', 'ನಾನು ಎಲ್ಲಿದ್ದೇನೆ')} />}
      {value.length === 0 && <Empty tour="worker-deliveries">{bi('No deliveries for you right now. The shop assigns them; they appear here by themselves.', 'ಈಗ ನಿಮಗೆ ಡೆಲಿವರಿ ಇಲ್ಲ. ಅಂಗಡಿ ಕೊಟ್ಟಾಗ ಇಲ್ಲಿ ತಾನಾಗಿ ಬರುತ್ತದೆ.')}</Empty>}
      {value.map((d) => {
        const active = d.status === 'pending' || d.status === 'out';
        return (
          <div key={d.id} className={'card' + (active ? '' : ' faded')} data-tour="worker-deliveries">
            <div className="bar between">
              <span className="name">
                {d.vehicleKind === 'car' ? '🚚' : '🏍'} {d.name}
                {d.billNo ? <span className="muted"> · #{d.billNo}</span> : null}
              </span>
              <Status s={d.status} label={d.status === 'pending' ? bi('Assigned', 'ನೇಮಿಸಲಾಗಿದೆ') : statusWord(d.status, lang)} />
            </div>
            <div>{d.address}</div>
            {d.landmark && <div className="muted">{d.landmark}</div>}
            <p className="muted">
              {d.itemCount != null && d.itemCount + bi(' item lines', ' ಸಾಲು')}
              {d.amountDue > 0 && (
                <>
                  {' · '}
                  {bi('Collect', 'ಪಡೆಯಬೇಕು')} <b>{formatRupees(d.amountDue)}</b>
                </>
              )}
              {d.collected != null && ' · ' + bi('Collected', 'ಪಡೆದದ್ದು') + ' ' + formatRupees(d.collected)}
              {d.paidBy && ' · ' + paidWord(d.paidBy, bi)}
              {d.reason && ' · “' + d.reason + '”'}
            </p>
            {active && (
              <div className="bar">
                {d.phone && (
                  <a className="btn" href={'tel:' + d.phone}>
                    📞 {bi('Call', 'ಕರೆ')}
                  </a>
                )}
                <a className="btn" href={mapsLink(d)} target="_blank" rel="noreferrer" data-tour="worker-maps">
                  🧭 {bi('Open in Maps', 'ನಕ್ಷೆಯಲ್ಲಿ ತೆರೆಯಿರಿ')}
                </a>
                {d.links && d.phone && (
                  <button className="btn" data-tour="worker-share-tracking" onClick={() => openLink(waLink(d.phone, trackMessage('', d.links!.track)))}>
                    💬 {bi('Share tracking', 'ಟ್ರ್ಯಾಕಿಂಗ್ ಕಳುಹಿಸಿ')}
                  </button>
                )}
                {d.lat == null && <span className="muted">{bi('Waiting for the customer’s location', 'ಗ್ರಾಹಕರ ಸ್ಥಳಕ್ಕಾಗಿ ಕಾಯುತ್ತಿದೆ')}</span>}
                {d.status === 'pending' && (
                  <button
                    className="btn primary"
                    disabled={!!onWay || d.lat == null}
                    onClick={() => {
                      setProblem('');
                      void act(() => http.post('/worker/deliveries/' + d.id + '/start', {}));
                    }}
                    data-tour="worker-start"
                  >
                    ▶ {bi('Start delivery', 'ಡೆಲಿವರಿ ಶುರು')}
                  </button>
                )}
                {d.status === 'out' && (
                  <>
                    <button
                      className="btn primary"
                      onClick={() => openClose(d)}
                    >
                      ✓ {bi('Delivered', 'ತಲುಪಿಸಿದೆ')}
                    </button>
                    <button
                      className="btn danger"
                      onClick={() => {
                        setClosing({ id: d.id, ok: false });
                        setReason('');
                      }}
                    >
                      ✕ {bi('Couldn’t deliver', 'ತಲುಪಿಸಲಾಗಲಿಲ್ಲ')}
                    </button>
                  </>
                )}
              </div>
            )}
            {closing?.id === d.id && closing.ok && (
              <div className="deliver-close">
                {!d.otpSkipped && (
                  <div className="field">
                    <span>{bi('Ask the customer for the 4-digit code', 'ಗ್ರಾಹಕರಿಂದ 4 ಅಂಕಿಯ ಕೋಡ್ ಕೇಳಿ')}</span>
                    {locked ? <div className="msg err">{bi('Too many wrong codes. Call the shop.', 'ತುಂಬಾ ತಪ್ಪು ಕೋಡ್. ಅಂಗಡಿಗೆ ಕರೆ ಮಾಡಿ.')}</div> : <OtpBoxes value={otp} onChange={setOtp} wrong={wrong} />}
                  </div>
                )}
                <div className="grid2">
                  <label className="field">
                    <span>{bi('Amount collected ₹', 'ಪಡೆದ ಮೊತ್ತ ₹')}</span>
                    <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </label>
                  <div className="field">
                    <span>{bi('Photo at the door (optional)', 'ಬಾಗಿಲಲ್ಲಿ ಫೋಟೋ (ಬೇಕಿದ್ದರೆ)')}</span>
                    <label className="btn photo-btn">
                      📷 {photo ? bi('Retake', 'ಮತ್ತೆ ತೆಗೆಯಿರಿ') : bi('Take photo', 'ಫೋಟೋ ತೆಗೆಯಿರಿ')}
                      <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => void takePhoto(e.target.files?.[0])} />
                    </label>
                    {photo && <img className="photo-preview" src={photo} alt="" />}
                  </div>
                </div>
                <div className="field" data-tour="worker-paid-by">
                  <span>{bi('How did they pay?', 'ಹೇಗೆ ಪಾವತಿಸಿದರು?')}</span>
                  <div className="chips">
                    {PAID_BY.map((p) => (
                      <button type="button" key={p} className={'chip' + (paidBy === p ? ' on' : '')} onClick={() => setPaidBy(p)}>
                        {paidWord(p, bi)}
                      </button>
                    ))}
                  </div>
                </div>
                {msg && <div className="msg err">{msg}</div>}
                <div className="bar">
                  <button
                    className="btn primary"
                    disabled={busy || locked || (!d.otpSkipped && otp.length !== 4) || !paidBy}
                    onClick={() =>
                      act(() =>
                        http.post('/worker/deliveries/' + d.id + '/delivered', {
                          collected: Math.max(0, Number(amount) || 0),
                          ...(d.otpSkipped ? {} : { otp }),
                          ...(paidBy ? { paidBy } : {}),
                          ...(photo ? { photo } : {}),
                        }),
                      )
                    }
                  >
                    ✓ {bi('Save', 'ಉಳಿಸಿ')}
                  </button>
                  <button className="btn ghost" onClick={() => setClosing(null)}>
                    {bi('Cancel', 'ರದ್ದು')}
                  </button>
                </div>
              </div>
            )}
            {closing?.id === d.id && !closing.ok && (
              <div className="bar">
                <label className="field grow">
                  <span>{bi('Why?', 'ಏಕೆ?')}</span>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={bi('Door locked, wrong address…', 'ಬಾಗಿಲು ಬೀಗ, ತಪ್ಪು ವಿಳಾಸ…')} />
                </label>
                <button className="btn danger" disabled={!reason.trim()} onClick={() => act(() => http.post('/worker/deliveries/' + d.id + '/failed', { reason }))}>
                  {bi('Save', 'ಉಳಿಸಿ')}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
