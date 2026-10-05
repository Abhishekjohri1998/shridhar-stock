import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { defaultUnitOf, findUnit, itemMatches, pickName, toBase, type Item, type Location, type Refill, type Transfer } from '@stock/core';
import { http } from '../../lib/api';
import { itemName, placeName, qtyText, useCatalog } from '../../lib/catalog';
import { useLive } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { statusWord } from '../../lib/words';
import { Empty, InkView, Loading, Status, useBi, when, Table, Select } from '../../components/ui';

/**
 * A quantity typed in any of the item's units, held in base units: "2 pack" of Parle-G is 48.
 * The unit starts on the biggest one that divides the amount, as the shop would count it.
 */
function QtyInput({ item, base, onChange }: { item: Item | undefined; base: number; onChange: (base: number) => void }) {
  const { lang } = useSession();
  const pickUnit = () => {
    if (!item) return 'pc';
    // The item's default unit when the amount is a whole number of it; else the biggest that fits.
    const d = defaultUnitOf(item);
    if (item.defaultUnit && (base === 0 || base % d.perBase === 0)) return d.code;
    const fits = [...item.units].sort((a, b) => b.perBase - a.perBase).find((u) => base > 0 && base % u.perBase === 0);
    return (fits ?? item.units[0]!).code;
  };
  const [unit, setUnit] = useState(pickUnit);
  const per = item ? findUnit(item, unit)?.perBase ?? 1 : 1;
  const [text, setText] = useState(String(Math.round((base / per) * 1000) / 1000));
  useEffect(() => {
    setText(String(Math.round((base / per) * 1000) / 1000));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit]);
  return (
    <span className="qty-input">
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (item && Number.isFinite(n) && n >= 0) onChange(toBase(item, unit, n));
        }} className="in-qty"
      />
      {item && item.units.length > 1 ? (
        <Select value={unit} onChange={setUnit} className="w-auto" aria-label="unit" options={item.units.map((u) => ({ value: u.code, label: (lang === 'kn' && u.labelKn) || u.code }))} />
      ) : (
        <span className="muted"> {item?.units[0]?.code}</span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- refill: plan trips

export function RefillPage() {
  const bi = useBi();
  const nav = useNavigate();
  const { lang } = useSession();
  const [version, setVersion] = useState(0);
  const live = useLive('stock', 'items', 'transfers');
  const { items, locs } = useCatalog(version);
  const { value, error } = useLoad(async () => {
    const [refill, transfers] = await Promise.all([http.get<Refill>('/admin/refill'), http.get<Transfer[]>('/admin/transfers')]);
    return { refill, transfers };
  }, [version, live]);
  // What the admin changed: quantity per godown per item, and lines taken off.
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState('');
  const [error2, setError2] = useState('');
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const shop = locs.find((l) => l.kind === 'shop');
  // Items already asked for and not yet arrived are not proposed twice.
  const pending = new Set(value.transfers.filter((t) => t.to === shop?.id && (t.status === 'requested' || t.status === 'sent')).flatMap((t) => t.lines.map((l) => l.itemId)));
  const key = (g: string, i: string) => g + '|' + i;

  const send = async (from: string, lines: { itemId: string; qty: number }[]) => {
    setError2('');
    try {
      const t = await http.post<Transfer>('/admin/transfers', { from, to: shop!.id, lines });
      setMsg(bi('Request sent to ', 'ಬೇಡಿಕೆ ಕಳುಹಿಸಲಾಗಿದೆ: ') + placeName(locs, from, lang) + ' · ' + bi('transfer', 'ಸಾಗಣೆ') + ' #' + t.no + ' · ' + lines.length + bi(' items. The godown sees it on their screen now.', ' ಸಾಮಾನು. ಗೋದಾಮಿನವರ ಪರದೆಯಲ್ಲಿ ಈಗ ಕಾಣುತ್ತದೆ.'));
      setEdits({});
      setOff({});
      setVersion((v) => v + 1);
    } catch (e) {
      setError2((e as Error).message);
    }
  };

  const trips = value.refill.trips
    .map((t) => ({ ...t, lines: t.lines.filter((l) => !pending.has(l.itemId)) }))
    .filter((t) => t.lines.length);

  return (
    <>
      <h1 className="title">{bi('Bring from godown', 'ಗೋದಾಮಿನಿಂದ ತರಿಸಿ')}</h1>
      <p className="muted" data-tour="refill-intro">
        {bi(
          'Everything short on the shop shelf, grouped by the godown that has most of it, so one trip brings it all. Quantities top the shelf up to twice the item’s running-out level; change any of them before asking.',
          'ಅಂಗಡಿಯಲ್ಲಿ ಕಡಿಮೆ ಇರುವುದೆಲ್ಲ, ಹೆಚ್ಚು ಇರುವ ಗೋದಾಮಿನಂತೆ ಗುಂಪು: ಒಂದೇ ಬಾರಿಗೆ ಎಲ್ಲ. ಕೇಳುವ ಮೊದಲು ಪ್ರಮಾಣ ಬದಲಿಸಬಹುದು.',
        )}
      </p>
      {msg && <div className="msg ok">{msg}</div>}
      {error2 && <div className="msg err">{error2}</div>}
      {pending.size > 0 && (
        <p className="muted">
          {pending.size} {bi('low items are already asked for or on the way, and are not shown again.', 'ಕಡಿಮೆ ಸಾಮಾನು ಈಗಾಗಲೇ ಕೇಳಲಾಗಿದೆ ಅಥವಾ ದಾರಿಯಲ್ಲಿದೆ.')}
        </p>
      )}
      {trips.length === 0 && value.refill.buy.length === 0 && (
        <Empty tour="refill-trip">
          {bi('Nothing is running low. When an item goes below its level, it shows here, ready to bring from a godown.', 'ಏನೂ ಮುಗಿಯುತ್ತಿಲ್ಲ. ಸಾಮಾನು ಮಿತಿಗಿಂತ ಕಡಿಮೆಯಾದಾಗ, ಗೋದಾಮಿನಿಂದ ತರಿಸಲು ಇಲ್ಲಿ ಕಾಣುತ್ತದೆ.')}
        </Empty>
      )}
      {trips.map((trip) => {
        const lines = trip.lines.filter((l) => !off[key(trip.from, l.itemId)]).map((l) => ({ itemId: l.itemId, qty: edits[key(trip.from, l.itemId)] ?? l.qty }));
        return (
          <div className="card" key={trip.from} data-tour="refill-trip">
            <div className="bar between">
              <span className="name">
                🚚 {bi('From', 'ಇಂದ')} {placeName(locs, trip.from, lang)} · {lines.length} {bi('items', 'ಸಾಮಾನು')}
              </span>
              <button className="btn primary" data-tour="refill-send" disabled={!lines.length || lines.some((l) => !(l.qty > 0))} onClick={() => send(trip.from, lines)}>
                {bi('Send request', 'ಬೇಡಿಕೆ ಕಳುಹಿಸಿ')}
              </button>
            </div>
            <div className="scroll">
              <Table className="list plain">
                <thead>
                  <tr>
                    <th>{bi('Item', 'ಸಾಮಾನು')}</th>
                    <th className="num">{bi('Shop has', 'ಅಂಗಡಿಯಲ್ಲಿ')}</th>
                    <th className="num">{bi('Godown has', 'ಗೋದಾಮಿನಲ್ಲಿ')}</th>
                    <th>{bi('Bring', 'ತನ್ನಿ')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {trip.lines.map((l) => {
                    const k = key(trip.from, l.itemId);
                    const removed = !!off[k];
                    const it = items.get(l.itemId);
                    return (
                      <tr key={l.itemId} className={removed ? 'muted' : ''}>
                        <td>
                          {itemName(items, l.itemId, lang)}
                          {it?.racks[trip.from] && <div className="muted">📍 {it.racks[trip.from]}</div>}
                        </td>
                        <td className={'num ' + (l.shopQty < 0 ? 'qty-neg' : 'qty-low')}>{qtyText(items, l.itemId, l.shopQty, lang)}</td>
                        <td className="num">{qtyText(items, l.itemId, l.godownQty, lang)}</td>
                        <td data-tour="refill-qty">{removed ? '—' : <QtyInput item={it} base={edits[k] ?? l.qty} onChange={(b) => setEdits({ ...edits, [k]: Math.min(b, l.godownQty) })} />}</td>
                        <td>
                          <button className="btn ghost small" data-tour="refill-remove" aria-label={removed ? undefined : bi('Leave this out', 'ಇದನ್ನು ಬಿಡಿ')} onClick={() => setOff({ ...off, [k]: !removed })}>
                            {removed ? bi('Add back', 'ಮತ್ತೆ ಸೇರಿಸಿ') : '✕'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          </div>
        );
      })}
      {value.refill.buy.filter((b) => !pending.has(b.itemId)).length > 0 && (
        <div className="card" data-tour="refill-buy">
          <div className="bar between">
            <span className="name">🛒 {bi('Low in all places together: buy from a supplier', 'ಎಲ್ಲಾ ಕಡೆ ಸೇರಿ ಕಡಿಮೆ: ಸರಬರಾಜುದಾರರಿಂದ ಖರೀದಿಸಿ')}</span>
            <button className="btn primary" onClick={() => nav('/admin/purchases?new=buy')}>
              {bi('Order these', 'ಇವನ್ನು ಆರ್ಡರ್ ಮಾಡಿ')}
            </button>
          </div>
          {value.refill.buy
            .filter((b) => !pending.has(b.itemId))
            .map((b) => (
              <div key={b.itemId} className="muted">
                {itemName(items, b.itemId, lang)} · {bi('all places', 'ಎಲ್ಲಾ ಕಡೆ')} {qtyText(items, b.itemId, b.total, lang)} · {bi('buy', 'ಖರೀದಿ')} {qtyText(items, b.itemId, b.qty, lang)}
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
  const live = useLive('transfers', 'items');
  const { items, locs } = useCatalog(version);
  const { value, error } = useLoad(() => http.get<Transfer[]>('/admin/transfers'), [version, live]);
  const [making, setMaking] = useState(false);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const act = async (path: string, body: unknown = {}, done = '') => {
    setErr('');
    setNote('');
    try {
      await http.post(path, body);
      setNote(done);
      setVersion((v) => v + 1);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const shown = value.filter((t) => filter === 'all' || t.status === 'requested' || t.status === 'sent');
  return (
    <>
      <h1 className="title">{bi('Transfers between places', 'ಸ್ಥಳಗಳ ನಡುವೆ ಸಾಗಣೆ')}</h1>
      <div className="bar">
        <button className="btn primary" data-tour="transfers-new" onClick={() => setMaking(!making)}>
          + {bi('New transfer', 'ಹೊಸ ಸಾಗಣೆ')}
        </button>
        <div className="chips" data-tour="transfers-filter">
          <button className={'chip ' + (filter === 'open' ? 'on' : '')} onClick={() => setFilter('open')}>
            {bi('Open', 'ತೆರೆದವು')}
          </button>
          <button className={'chip ' + (filter === 'all' ? 'on' : '')} onClick={() => setFilter('all')}>
            {bi('All', 'ಎಲ್ಲ')}
          </button>
        </div>
      </div>
      {err && <div className="msg err">{err}</div>}
      {note && <div className="msg ok">{note}</div>}
      {making && (
        <NewTransfer
          items={items}
          locs={locs}
          onDone={() => {
            setMaking(false);
            setVersion((v) => v + 1);
          }}
        />
      )}
      {shown.length === 0 && (
        <Empty tour="transfers-card">
          {bi('No transfers yet. Tap “Bring from godown” when the shop runs low.', 'ಇನ್ನೂ ಸಾಗಣೆ ಇಲ್ಲ. ಅಂಗಡಿಯಲ್ಲಿ ಕಡಿಮೆಯಾದಾಗ “ಗೋದಾಮಿನಿಂದ ತರಿಸಿ” ಒತ್ತಿ.')}
        </Empty>
      )}
      {shown.map((t) => (
        <TransferCard key={t.id} t={t} items={items} locs={locs} act={act} bi={bi} lang={lang} />
      ))}
    </>
  );
}

function TransferCard({
  t,
  items,
  locs,
  act,
  bi,
  lang,
}: {
  t: Transfer;
  items: Map<string, Item>;
  locs: Location[];
  act: (path: string, body?: unknown, done?: string) => Promise<void>;
  bi: (en: string, kn: string) => string;
  lang: 'en' | 'kn';
}) {
  const [got, setGot] = useState<Record<string, number>>({});
  const toShop = locs.find((l) => l.id === t.to)?.kind === 'shop';
  return (
    <div className="card" data-tour="transfers-card">
      <div className="bar between">
        <span className="name">
          #{t.no} · {placeName(locs, t.from, lang)} → {placeName(locs, t.to, lang)}
        </span>
        <Status s={t.status} label={statusWord(t.status, lang)} />
      </div>
      <div className="muted">
        {bi('Asked', 'ಕೇಳಿದ್ದು')} {when(t.times.requested ?? t.at, lang)}
        {t.times.sent && ' · ' + bi('sent', 'ಕಳುಹಿಸಿದ್ದು') + ' ' + when(t.times.sent, lang)}
        {t.times.received && ' · ' + bi('received', 'ತಲುಪಿದ್ದು') + ' ' + when(t.times.received, lang)}
        {t.vehicle && ' · 🚚 ' + t.vehicle}
        {t.driver && ' · ' + t.driver}
      </div>
      {t.note && <div className="muted">“{t.note}”</div>}
      {t.noteInk && <InkView ink={t.noteInk} height={28} />}
      <Table className="list plain">
        <thead>
          <tr>
            <th>{bi('Item', 'ಸಾಮಾನು')}</th>
            <th className="num">{bi('Asked', 'ಕೇಳಿದ್ದು')}</th>
            <th className="num">{bi('Sent', 'ಕಳುಹಿಸಿದ್ದು')}</th>
            <th>{bi('Received', 'ತಲುಪಿದ್ದು')}</th>
          </tr>
        </thead>
        <tbody>
          {t.lines.map((l) => {
            const short = l.received != null && l.received < (l.sent ?? l.qty);
            const underSent = l.sent != null && l.sent < l.qty;
            return (
              <tr key={l.itemId}>
                <td>{itemName(items, l.itemId, lang)}</td>
                <td className="num">{qtyText(items, l.itemId, l.qty, lang)}</td>
                <td className={'num ' + (underSent ? 'qty-low' : '')}>{l.sent != null ? qtyText(items, l.itemId, l.sent, lang) : '—'}</td>
                <td className={short ? 'qty-neg' : ''}>
                  {t.status === 'sent' && toShop ? (
                    <QtyInput item={items.get(l.itemId)} base={got[l.itemId] ?? l.sent ?? l.qty} onChange={(b) => setGot({ ...got, [l.itemId]: b })} />
                  ) : l.received != null ? (
                    qtyText(items, l.itemId, l.received, lang) + (short ? ' · ' + bi('short', 'ಕೊರತೆ') + ' ' + qtyText(items, l.itemId, (l.sent ?? l.qty) - l.received, lang) : '')
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div className="bar mt-8">
        {t.status === 'sent' && toShop && (
          <button
            className="btn primary"
            data-tour="transfers-receive"
            onClick={() =>
              act(
                '/transfers/' + t.id + '/receive',
                { received: Object.fromEntries(t.lines.map((l) => [l.itemId, got[l.itemId] ?? l.sent ?? l.qty])) },
                placeName(locs, t.to, lang) + ': ' + t.lines.map((l) => itemName(items, l.itemId, lang) + ' +' + qtyText(items, l.itemId, got[l.itemId] ?? l.sent ?? l.qty, lang)).join(', '),
              )
            }
          >
            {bi('Mark received', 'ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಿ')}
          </button>
        )}
        {t.status === 'requested' && (
          <button className="btn" data-tour="transfers-cancel" onClick={() => act('/transfers/' + t.id + '/cancel', {}, bi('Request cancelled. No stock moved.', 'ಬೇಡಿಕೆ ರದ್ದಾಗಿದೆ. ಸ್ಟಾಕ್ ಬದಲಾಗಿಲ್ಲ.'))}>
            {bi('Cancel request', 'ಬೇಡಿಕೆ ರದ್ದು')}
          </button>
        )}
      </div>
    </div>
  );
}

function NewTransfer({ items, locs, onDone }: { items: Map<string, Item>; locs: Location[]; onDone: () => void }) {
  const bi = useBi();
  const { lang } = useSession();
  const active = locs.filter((l) => l.active);
  const [from, setFrom] = useState(active.find((l) => l.kind === 'godown')?.id ?? '');
  const [to, setTo] = useState(active.find((l) => l.kind === 'shop')?.id ?? '');
  const [lines, setLines] = useState<{ itemId: string; qty: number }[]>([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const found = q.trim() ? [...items.values()].filter((i) => i.active && itemMatches(i, q) && !lines.some((l) => l.itemId === i.id)).slice(0, 6) : [];
  const save = async () => {
    setErr('');
    try {
      await http.post('/admin/transfers', { from, to, lines });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="card">
      {err && <div className="msg err">{err}</div>}
      <div className="grid2">
        <label className="field">
          <span>{bi('From', 'ಇಂದ')}</span>
          <Select value={from} onChange={setFrom} aria-label={bi('From', 'ಇಂದ')} options={active.map((l) => ({ value: l.id, label: pickName(l.name, l.nameKn, lang) }))} />
        </label>
        <label className="field">
          <span>{bi('To', 'ಗೆ')}</span>
          <Select value={to} onChange={setTo} aria-label={bi('To', 'ಗೆ')} options={active.map((l) => ({ value: l.id, label: pickName(l.name, l.nameKn, lang) }))} />
        </label>
      </div>
      <input placeholder={bi('Add an item…', 'ಸಾಮಾನು ಸೇರಿಸಿ…')} value={q} onChange={(e) => setQ(e.target.value)} />
      {found.length > 0 && (
        <div className="chips mt-6">
          {found.map((i) => (
            <button
              key={i.id}
              className="chip"
              onClick={() => {
                setLines([...lines, { itemId: i.id, qty: defaultUnitOf(i).perBase }]);
                setQ('');
              }}
            >
              {pickName(i.nameEn, i.nameKn, lang)}
            </button>
          ))}
        </div>
      )}
      {lines.map((l, idx) => (
        <div className="bar mt-6" key={l.itemId}>
          <span className="grow name">{itemName(items, l.itemId, lang)}</span>
          <QtyInput item={items.get(l.itemId)} base={l.qty} onChange={(b) => setLines(lines.map((x, j) => (j === idx ? { ...x, qty: b } : x)))} />
          <button className="btn ghost small" onClick={() => setLines(lines.filter((_, j) => j !== idx))}>
            ✕
          </button>
        </div>
      ))}
      <div className="bar mt-10">
        <button className="btn primary" disabled={!lines.length || from === to || lines.some((l) => !(l.qty > 0))} onClick={save}>
          {bi('Ask for it', 'ಕೇಳಿ')}
        </button>
        <button className="btn" onClick={onDone}>
          {bi('Cancel', 'ರದ್ದು')}
        </button>
      </div>
    </div>
  );
}
