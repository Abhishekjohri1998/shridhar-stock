import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatRupees, pickName, poStage, type Item, type Location, type PurchaseOrder, type Refill, type Supplier } from '@stock/core';
import { api, http } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { statusWord } from '../../lib/words';
import { Empty, Loading, Money, Select, Status, useBi, when, Table } from '../../components/ui';

/** An item as the orders page needs it: names and units, never the whole catalogue. */
type ItemBrief = Pick<Item, 'id' | 'nameEn' | 'nameKn'> & { units: { code: string; label: string; labelKn: string; perBase: number; cost?: number }[] };

interface Page {
  orders: (PurchaseOrder & { received?: { itemId: string; qty: number; cost: number }[] })[];
  items: ItemBrief[];
  open: number;
  total: number;
  next: number | null;
}

interface Line {
  itemId: string;
  unit: string;
  qty: string;
  cost: string;
}

/** The unit an item is bought in: the biggest one, which is how suppliers sell. */
function buyUnit(item: ItemBrief) {
  return [...item.units].sort((a, b) => b.perBase - a.perBase)[0]!;
}

const briefName = (it: ItemBrief | undefined, id: string, lang: 'en' | 'kn') => (it ? pickName(it.nameEn, it.nameKn, lang) : id);

/**
 * Buying, for the admin only: one short form (supplier, items, save), then each order is either
 * received, with what actually came, or cancelled. Orders come a page at a time, open ones first,
 * and items are found by the server's search, so the page stays quick however long the history.
 */
export function PurchasesPage() {
  const bi = useBi();
  const { lang } = useSession();
  const [params, setParams] = useSearchParams();
  const [version, setVersion] = useState(0);
  const live = useLive('pos');
  const [tab, setTab] = useState<'open' | 'all' | 'suppliers'>('open');
  const [shown, setShown] = useState(30);
  const { value, error } = useLoad(async () => {
    const [page, sups, locs] = await Promise.all([
      http.get<Page>('/admin/pos?limit=' + shown + (tab === 'open' ? '&open=1' : '')),
      http.get<Supplier[]>('/admin/suppliers'),
      api.locations(),
    ]);
    return { page, sups, locs: locs.filter((l) => l.active) };
  }, [version, live, tab, shown]);
  const [making, setMaking] = useState(params.get('new') === 'buy');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const items = new Map(value.page.items.map((i) => [i.id, i]));
  const act = async (path: string, body: unknown, done: string) => {
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
  return (
    <>
      <h1 className="title">{bi('Purchases', 'ಖರೀದಿ')}</h1>
      <div className="bar">
        <button className="btn primary" onClick={() => setMaking(!making)}>
          + {bi('New order', 'ಹೊಸ ಆರ್ಡರ್')}
        </button>
        <div className="chips">
          {(['open', 'all', 'suppliers'] as const).map((k) => (
            <button
              key={k}
              className={'chip ' + (tab === k ? 'on' : '')}
              onClick={() => {
                setTab(k);
                setShown(30);
              }}
            >
              {k === 'open' ? bi('Open', 'ತೆರೆದವು') + ' · ' + value.page.open : k === 'all' ? bi('All', 'ಎಲ್ಲ') : bi('Suppliers', 'ಸರಬರಾಜುದಾರರು')}
            </button>
          ))}
        </div>
      </div>
      {err && <div className="msg err">{err}</div>}
      {note && <div className="msg ok">{note}</div>}
      {making && (
        <NewOrder
          locs={value.locs}
          sups={value.sups.filter((s) => s.active)}
          fromBuyList={params.get('new') === 'buy'}
          onDone={(saved) => {
            setMaking(false);
            setParams({});
            if (saved) setNote(bi('Order saved.', 'ಆರ್ಡರ್ ಉಳಿಸಲಾಗಿದೆ.'));
            setVersion((v) => v + 1);
          }}
        />
      )}
      {tab === 'suppliers' ? (
        <Suppliers sups={value.sups} onDone={() => setVersion((v) => v + 1)} />
      ) : (
        <>
          {value.page.orders.length === 0 && <Empty>{tab === 'open' ? bi('No open orders.', 'ತೆರೆದ ಆರ್ಡರ್ ಇಲ್ಲ.') : bi('No orders yet.', 'ಇನ್ನೂ ಆರ್ಡರ್ ಇಲ್ಲ.')}</Empty>}
          {value.page.orders.map((p) => (
            <OrderCard key={p.id + ':' + p.status} p={p} supplier={value.sups.find((s) => s.id === p.supplierId)} items={items} locs={value.locs} lang={lang} act={act} />
          ))}
          {value.page.next != null && (
            <button className="btn" onClick={() => setShown((n) => n + 30)}>
              {bi('Show more', 'ಇನ್ನಷ್ಟು ತೋರಿಸಿ')} ({value.page.total - value.page.orders.length})
            </button>
          )}
        </>
      )}
    </>
  );
}

function OrderCard({
  p,
  supplier,
  items,
  locs,
  lang,
  act,
}: {
  p: Page['orders'][number];
  supplier?: Supplier;
  items: Map<string, ItemBrief>;
  locs: Location[];
  lang: 'en' | 'kn';
  act: (path: string, body: unknown, done: string) => Promise<void>;
}) {
  const bi = useBi();
  const stage = poStage(p.status);
  const [got, setGot] = useState<Record<string, { qty: string; cost: string }>>(() => Object.fromEntries(p.lines.map((l) => [l.itemId, { qty: String(l.qty), cost: String(l.cost) }])));
  const [receiving, setReceiving] = useState(false);
  const [to, setTo] = useState(p.to);
  const [updateCost, setUpdateCost] = useState(true);
  const total = p.lines.reduce((s, l) => s + l.qty * l.cost, 0);
  const rec = new Map((p.received ?? []).map((r) => [r.itemId, r]));
  const placeOf = (id: string) => {
    const l = locs.find((x) => x.id === id);
    return l ? pickName(l.name, l.nameKn, lang) : id;
  };
  const unitWord = (itemId: string, code: string) => {
    const u = items.get(itemId)?.units.find((x) => x.code === code);
    return (u && ((lang === 'kn' && u.labelKn) || u.code)) || code;
  };
  return (
    <div className="card">
      <div className="bar between">
        <span className="name">
          #{p.no} · {supplier?.name ?? p.supplierId} → {placeOf(p.to)}
        </span>
        <Status s={stage} label={statusWord(stage, lang)} />
      </div>
      <div className="muted">
        {bi('Ordered', 'ಆರ್ಡರ್')} {when(p.times.ordered ?? p.at, lang)}
        {p.times.received && ' · ' + bi('received', 'ಬಂದಿದೆ') + ' ' + when(p.times.received, lang)}
        {p.times.cancelled && ' · ' + bi('cancelled', 'ರದ್ದು') + ' ' + when(p.times.cancelled, lang)}
        {p.invoiceNo && ' · ' + bi('invoice', 'ಇನ್‌ವಾಯ್ಸ್') + ' ' + p.invoiceNo}
      </div>
      <Table className="list plain">
        <thead>
          <tr>
            <th>{bi('Item', 'ಸಾಮಾನು')}</th>
            <th className="num">{bi('Ordered', 'ಆರ್ಡರ್')}</th>
            <th className="num">{bi('Cost', 'ಬೆಲೆ')}</th>
            {(receiving || stage === 'received') && <th>{bi('Arrived', 'ಬಂದದ್ದು')}</th>}
          </tr>
        </thead>
        <tbody>
          {p.lines.map((l) => {
            const r = rec.get(l.itemId);
            return (
              <tr key={l.itemId}>
                <td>{briefName(items.get(l.itemId), l.itemId, lang)}</td>
                <td className="num">
                  {l.qty} {unitWord(l.itemId, l.unit)}
                </td>
                <td className="num">{l.cost ? formatRupees(l.cost) : '—'}</td>
                {receiving && (
                  <td>
                    <input inputMode="decimal" value={got[l.itemId]!.qty} onChange={(e) => setGot({ ...got, [l.itemId]: { ...got[l.itemId]!, qty: e.target.value } })} className="in-qty" aria-label={bi('Arrived', 'ಬಂದದ್ದು')} />{' '}
                    ₹<input inputMode="decimal" value={got[l.itemId]!.cost} onChange={(e) => setGot({ ...got, [l.itemId]: { ...got[l.itemId]!, cost: e.target.value } })} className="in-price" aria-label={bi('Cost', 'ಬೆಲೆ')} />
                  </td>
                )}
                {!receiving && stage === 'received' && (
                  <td className={r && r.qty < l.qty ? 'qty-neg' : ''}>
                    {r ? r.qty + ' ' + unitWord(l.itemId, l.unit) + (r.cost !== l.cost ? ' @ ' + formatRupees(r.cost) : '') : '—'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </Table>
      {receiving && (
        <div className="grid2 mt-8">
          <label className="field">
            <span>{bi('Put the goods in', 'ಸಾಮಾನು ಇಡುವುದು')}</span>
            <Select value={to} onChange={setTo} aria-label={bi('Put the goods in', 'ಸಾಮಾನು ಇಡುವುದು')} options={locs.map((l) => ({ value: l.id, label: pickName(l.name, l.nameKn, lang) }))} />
          </label>
          <label className="check">
            <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />
            {bi('Use these as the items’ cost', 'ಇದನ್ನೇ ಖರೀದಿ ಬೆಲೆ ಮಾಡಿ')}
          </label>
        </div>
      )}
      <div className="bar mt-8">
        <b className="grow">{total > 0 && <Money v={total} />}</b>
        {receiving ? (
          <>
            <button
              className="btn primary"
              onClick={() =>
                act(
                  '/admin/pos/' + p.id + '/receive',
                  { updateCost, to, got: Object.fromEntries(Object.entries(got).map(([k, v]) => [k, { qty: Number(v.qty) || 0, cost: Number(v.cost) || 0 }])) },
                  bi('Received: the stock is added to ', 'ಬಂದಿದೆ: ಸ್ಟಾಕ್ ಸೇರಿಸಲಾಗಿದೆ, ') + placeOf(to) + '.',
                )
              }
            >
              ✓ {bi('Save received', 'ಬಂದಿದೆ ಎಂದು ಉಳಿಸಿ')}
            </button>
            <button className="btn" onClick={() => setReceiving(false)}>
              {bi('Back', 'ಹಿಂದೆ')}
            </button>
          </>
        ) : (
          stage === 'ordered' && (
            <>
              <button className="btn primary" onClick={() => setReceiving(true)}>
                {bi('Mark received', 'ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಿ')}
              </button>
              <button className="btn" onClick={() => act('/admin/pos/' + p.id + '/cancel', {}, bi('Order cancelled.', 'ಆರ್ಡರ್ ರದ್ದಾಗಿದೆ.'))}>
                {bi('Cancel order', 'ಆರ್ಡರ್ ರದ್ದು')}
              </button>
            </>
          )
        )}
      </div>
    </div>
  );
}

/** The server's item search, a moment after typing stops. */
function useItemSearch(q: string) {
  const [found, setFound] = useState<Item[]>([]);
  useEffect(() => {
    const text = q.trim();
    if (!text) {
      setFound([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      http
        .get<Item[]>('/items?q=' + encodeURIComponent(text))
        .then((list) => live && setFound(list.slice(0, 8)))
        .catch(() => undefined);
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  return found;
}

function NewOrder({ locs, sups, fromBuyList, onDone }: { locs: Location[]; sups: Supplier[]; fromBuyList: boolean; onDone: (saved: boolean) => void }) {
  const bi = useBi();
  const { lang } = useSession();
  const [supplierId, setSupplier] = useState(sups[0]?.id ?? '');
  const [to, setTo] = useState(locs.find((l) => l.kind === 'godown')?.id ?? locs[0]?.id ?? '');
  const [lines, setLines] = useState<Line[]>([]);
  const [known, setKnown] = useState<Map<string, ItemBrief>>(new Map());
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const found = useItemSearch(q).filter((i) => !lines.some((l) => l.itemId === i.id));

  // "Order these" from the buy list: what is low in all places together, in the unit suppliers
  // sell it in, enough to bring the total back to twice its level.
  useEffect(() => {
    if (!fromBuyList) return;
    http
      .get<Refill>('/admin/refill')
      .then(async (r) => {
        const got = (await Promise.all(r.buy.map((b) => api.item(b.itemId).catch(() => null)))).filter((x): x is Item => !!x);
        setKnown(new Map(got.map((i) => [i.id, i])));
        setLines(
          r.buy.flatMap((b) => {
            const it = got.find((i) => i.id === b.itemId);
            if (!it) return [];
            const u = buyUnit(it);
            return [{ itemId: it.id, unit: u.code, qty: String(Math.max(1, Math.ceil(b.qty / u.perBase))), cost: u.cost != null ? String(u.cost) : '' }];
          }),
        );
      })
      .catch((e: Error) => setErr(e.message));
  }, [fromBuyList]);

  const add = (it: Item) => {
    const u = buyUnit(it);
    setKnown(new Map(known).set(it.id, it));
    setLines([...lines, { itemId: it.id, unit: u.code, qty: '1', cost: u.cost != null ? String(u.cost) : '' }]);
    setQ('');
  };
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const ok = lines.length > 0 && lines.every((l) => Number(l.qty) > 0 && (l.cost.trim() === '' || Number(l.cost) >= 0));
  const save = async () => {
    setErr('');
    setBusy(true);
    try {
      await http.post('/admin/pos', { supplierId, to, lines: lines.map((l) => ({ itemId: l.itemId, unit: l.unit, qty: Number(l.qty), cost: Number(l.cost) || 0 })) });
      onDone(true);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  if (!sups.length) return <div className="msg err">{bi('Add a supplier first (Suppliers tab).', 'ಮೊದಲು ಸರಬರಾಜುದಾರರನ್ನು ಸೇರಿಸಿ.')}</div>;
  return (
    <div className="card">
      {err && <div className="msg err">{err}</div>}
      <div className="grid2">
        <label className="field">
          <span>{bi('Supplier', 'ಸರಬರಾಜುದಾರ')}</span>
          <Select value={supplierId} onChange={setSupplier} aria-label={bi('Supplier', 'ಸರಬರಾಜುದಾರ')} options={sups.map((s) => ({ value: s.id, label: s.name, hint: s.phone }))} />
        </label>
        <label className="field">
          <span>{bi('Goods go to', 'ಸಾಮಾನು ಹೋಗುವುದು')}</span>
          <Select value={to} onChange={setTo} aria-label={bi('Goods go to', 'ಸಾಮಾನು ಹೋಗುವುದು')} options={locs.map((l) => ({ value: l.id, label: pickName(l.name, l.nameKn, lang) }))} />
        </label>
      </div>
      <input placeholder={bi('Search an item to add…', 'ಸೇರಿಸಲು ಸಾಮಾನು ಹುಡುಕಿ…')} value={q} onChange={(e) => setQ(e.target.value)} />
      {found.length > 0 && (
        <div className="chips mt-6">
          {found.map((i) => (
            <button key={i.id} className="chip" onClick={() => add(i)}>
              {pickName(i.nameEn, i.nameKn, lang)}
            </button>
          ))}
        </div>
      )}
      {lines.map((l, i) => {
        const it = known.get(l.itemId);
        return (
          <div className="bar mt-6" key={l.itemId}>
            <span className="grow name">{briefName(it, l.itemId, lang)}</span>
            <input inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} className="in-qty" aria-label={bi('Quantity', 'ಪ್ರಮಾಣ')} />
            <Select
              value={l.unit}
              onChange={(unit) => {
                const u = it?.units.find((x) => x.code === unit);
                set(i, { unit, cost: u?.cost != null ? String(u.cost) : l.cost });
              }}
              className="w-auto"
              aria-label={bi('Unit', 'ಘಟಕ')}
              options={(it?.units ?? []).map((u) => ({ value: u.code, label: (lang === 'kn' && u.labelKn) || u.label }))}
            />
            ₹<input inputMode="decimal" value={l.cost} placeholder={bi('cost', 'ಬೆಲೆ')} onChange={(e) => set(i, { cost: e.target.value })} className="in-price" aria-label={bi('Cost, if known', 'ಬೆಲೆ, ಗೊತ್ತಿದ್ದರೆ')} />
            <button className="btn ghost small" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label={bi('Remove', 'ತೆಗೆಯಿರಿ')}>
              ✕
            </button>
          </div>
        );
      })}
      <div className="bar mt-10">
        <b className="grow">
          <Money v={lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.cost) || 0), 0)} />
        </b>
        <button className="btn primary" disabled={!ok || busy} onClick={save}>
          {bi('Save order', 'ಆರ್ಡರ್ ಉಳಿಸಿ')}
        </button>
        <button className="btn" onClick={() => onDone(false)}>
          {bi('Cancel', 'ರದ್ದು')}
        </button>
      </div>
    </div>
  );
}

/** Suppliers are contacts: who to call, and anything worth remembering about them. */
function Suppliers({ sups, onDone }: { sups: Supplier[]; onDone: () => void }) {
  const bi = useBi();
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  return (
    <>
      <button className="btn mb-10" onClick={() => setEditing('new')}>
        + {bi('New supplier', 'ಹೊಸ ಸರಬರಾಜುದಾರ')}
      </button>
      {editing && (
        <SupplierForm
          s={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null);
            onDone();
          }}
        />
      )}
      {sups.length === 0 && <Empty>{bi('No suppliers yet.', 'ಇನ್ನೂ ಸರಬರಾಜುದಾರರಿಲ್ಲ.')}</Empty>}
      {sups.map((s) => (
        <div className="card clickable" key={s.id} onClick={() => setEditing(s)}>
          <span className="name">{s.name}</span>{' '}
          {s.phone && (
            <a href={'tel:' + s.phone} onClick={(e) => e.stopPropagation()}>
              {s.phone}
            </a>
          )}
          {!s.active && <span className="pill bad"> {bi('Switched off', 'ನಿಲ್ಲಿಸಲಾಗಿದೆ')}</span>}
          {s.notes && <div className="muted">{s.notes}</div>}
        </div>
      ))}
    </>
  );
}

function SupplierForm({ s, onDone }: { s: Supplier | null; onDone: () => void }) {
  const bi = useBi();
  const [name, setName] = useState(s?.name ?? '');
  const [phone, setPhone] = useState(s?.phone ?? '');
  const [notes, setNotes] = useState(s?.notes ?? '');
  const [err, setErr] = useState('');
  const save = async (active?: boolean) => {
    setErr('');
    try {
      const body = { name, phone, notes, ...(active != null ? { active } : {}) };
      if (s) await http.put('/admin/suppliers/' + s.id, body);
      else await http.post('/admin/suppliers', body);
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
          <span>{bi('Name', 'ಹೆಸರು')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{bi('Phone', 'ಫೋನ್')}</span>
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>{bi('Notes', 'ಟಿಪ್ಪಣಿ')}</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={bi('What they supply, when they come', 'ಏನು ಕೊಡುತ್ತಾರೆ, ಯಾವಾಗ ಬರುತ್ತಾರೆ')} />
      </label>
      <div className="bar">
        <button className="btn primary" onClick={() => save()}>
          {bi('Save', 'ಉಳಿಸಿ')}
        </button>
        {s && (
          <button className="btn" onClick={() => save(!s.active)}>
            {s.active ? bi('Switch off', 'ನಿಲ್ಲಿಸಿ') : bi('Switch on', 'ಆರಂಭಿಸಿ')}
          </button>
        )}
        <button className="btn" onClick={onDone}>
          {bi('Cancel', 'ರದ್ದು')}
        </button>
      </div>
    </div>
  );
}
