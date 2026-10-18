import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatRate, formatRupees, landedUnitCost, pickName, poStage, splitCharge, type CarrierTrip, type Item, type SupplierContact, type ItemSupplierRow, type Location, type PurchaseOrder, type Refill, type Supplier } from '@stock/core';
import { api, http } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { statusWord } from '../../lib/words';
import { Empty, Loading, Money, Select, Status, useBi, when, Table } from '../../components/ui';

/** An item as the orders page needs it: names and units, never the whole catalogue. */
type ItemBrief = Pick<Item, 'id' | 'nameEn' | 'nameKn' | 'defaultUnit'> & { units: { code: string; label: string; labelKn: string; perBase: number; cost?: number }[] };

interface Page {
  orders: (PurchaseOrder & { received?: { itemId: string; qty: number; cost: number; delivery?: number; landed?: number; expiry?: string; places?: { placeId: string; qty: number }[] }[] })[];
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

/**
 * The unit an item is bought in: its default unit when the shop chose one, else the biggest one,
 * which is how suppliers sell.
 */
function buyUnit(item: ItemBrief) {
  const chosen = item.defaultUnit ? item.units.find((u) => u.code === item.defaultUnit) : undefined;
  return chosen ?? [...item.units].sort((a, b) => b.perBase - a.perBase)[0]!;
}

/** The cost to start a line with: the last one paid in that unit (this supplier's first), else the item's own. */
function startCost(rows: ItemSupplierRow[] | undefined, supplierId: string, unit: ItemBrief['units'][number]): string {
  const r = (rows ?? []).find((x) => x.supplierId === supplierId && x.lastUnit === unit.code && x.lastCost != null) ?? (rows ?? []).find((x) => x.lastUnit === unit.code && x.lastCost != null);
  const c = r?.lastCost ?? unit.cost;
  return c != null ? String(c) : '';
}

const NO_USUAL = '';

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
        <button className="btn primary" data-tour="purchases-new" onClick={() => setMaking(!making)}>
          + {bi('New order', 'ಹೊಸ ಆರ್ಡರ್')}
        </button>
        <div className="chips" data-tour="purchases-filter">
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
            if (saved) setNote(bi('Order saved. Stock goes up when you tap “Mark received”.', 'ಆರ್ಡರ್ ಉಳಿಸಲಾಗಿದೆ. “ಬಂದಿದೆ ಎಂದು ಗುರುತಿಸಿ” ಒತ್ತಿದಾಗ ಸ್ಟಾಕ್ ಹೆಚ್ಚುತ್ತದೆ.'));
            setVersion((v) => v + 1);
          }}
        />
      )}
      {tab === 'suppliers' ? (
        <Suppliers sups={value.sups} onDone={() => setVersion((v) => v + 1)} />
      ) : (
        <>
          {value.page.orders.length === 0 && (
            <Empty tour="purchases-card">
              {tab === 'open'
                ? bi('No open orders. Tap “+ New order” when you buy from a supplier.', 'ತೆರೆದ ಆರ್ಡರ್ ಇಲ್ಲ. ಸರಬರಾಜುದಾರರಿಂದ ಕೊಳ್ಳುವಾಗ “+ ಹೊಸ ಆರ್ಡರ್” ಒತ್ತಿ.')
                : bi('No orders yet. Tap “+ New order” to make the first one.', 'ಇನ್ನೂ ಆರ್ಡರ್ ಇಲ್ಲ. ಮೊದಲನೆಯದಕ್ಕೆ “+ ಹೊಸ ಆರ್ಡರ್” ಒತ್ತಿ.')}
            </Empty>
          )}
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
  // Delivery (B): a charge typed in, or a carrier trip linked, spread into the landed cost.
  const [delivery, setDelivery] = useState('');
  const [tripId, setTripId] = useState('');
  const [trips, setTrips] = useState<CarrierTrip[]>([]);
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  // Per line: absent = all to the chosen place; else the qty typed for each place (a split).
  const [split, setSplit] = useState<Record<string, Record<string, string>>>({});
  const splitSum = (itemId: string) => Object.values(split[itemId] ?? {}).reduce((n, v) => n + (Number(v) || 0), 0);
  const splitBad = (itemId: string) => !!split[itemId] && Math.abs(splitSum(itemId) - (Number(got[itemId]?.qty) || 0)) > 1e-6;
  const anySplitBad = p.lines.some((l) => splitBad(l.itemId));
  useEffect(() => {
    if (!receiving) return;
    http
      .get<CarrierTrip[]>('/admin/trips/open')
      .then((t) => setTrips(t.sort((a, b) => Number(b.supplierId === p.supplierId) - Number(a.supplierId === p.supplierId))))
      .catch(() => undefined);
  }, [receiving, p.supplierId]);
  const trip = trips.find((t) => t.id === tripId);
  const charge = delivery.trim() !== '' ? Number(delivery) || 0 : (trip?.charge ?? 0);
  const arrivedNow = p.lines.map((l) => ({ itemId: l.itemId, qty: Number(got[l.itemId]?.qty) || 0, cost: Number(got[l.itemId]?.cost) || 0 })).filter((g) => g.qty > 0);
  const shareList = splitCharge(arrivedNow.map((g) => ({ qty: g.qty, value: g.qty * g.cost })), charge);
  const landedOf = new Map(arrivedNow.map((g, i) => [g.itemId, landedUnitCost(g.cost, g.qty, shareList[i]!)]));
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
    <div className="card" data-tour="purchases-card">
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
                <td className="num">{l.cost ? formatRate(l.cost) : '—'}</td>
                {receiving && (
                  <td>
                    <input inputMode="decimal" value={got[l.itemId]!.qty} onChange={(e) => setGot({ ...got, [l.itemId]: { ...got[l.itemId]!, qty: e.target.value } })} className="in-qty" aria-label={bi('Arrived', 'ಬಂದದ್ದು')} />{' '}
                    ₹<input inputMode="decimal" value={got[l.itemId]!.cost} onChange={(e) => setGot({ ...got, [l.itemId]: { ...got[l.itemId]!, cost: e.target.value } })} className="in-price" aria-label={bi('Cost', 'ಬೆಲೆ')} />
                    {charge > 0 && landedOf.has(l.itemId) && (
                      <div className="muted landed-note">
                        {bi('with delivery', 'ಸಾಗಣೆ ಸೇರಿ')} {formatRate(landedOf.get(l.itemId)!)} / {unitWord(l.itemId, l.unit)}
                      </div>
                    )}
                    <div className="chips mt-6" role="group" aria-label={bi('Where it goes', 'ಎಲ್ಲಿ ಇಡುವುದು')}>
                      <button type="button" className={'chip' + (split[l.itemId] ? '' : ' on')} onClick={() => setSplit(Object.fromEntries(Object.entries(split).filter(([k]) => k !== l.itemId)))}>
                        {bi('All to', 'ಎಲ್ಲಾ')} {placeOf(to)}
                      </button>
                      <button type="button" className={'chip' + (split[l.itemId] ? ' on' : '')} onClick={() => !split[l.itemId] && setSplit({ ...split, [l.itemId]: Object.fromEntries(locs.map((x) => [x.id, x.id === to ? got[l.itemId]!.qty : ''])) })}>
                        {bi('Split', 'ಹಂಚಿ')}
                      </button>
                    </div>
                    {split[l.itemId] && (
                      <div className="split-places">
                        {locs.map((x) => (
                          <label key={x.id} className="bar mb-0">
                            <span className="grow">{pickName(x.name, x.nameKn, lang)}</span>
                            <input inputMode="decimal" className="in-qty" value={split[l.itemId]![x.id] ?? ''} onChange={(e) => setSplit({ ...split, [l.itemId]: { ...split[l.itemId]!, [x.id]: e.target.value } })} aria-label={pickName(x.name, x.nameKn, lang)} /> {unitWord(l.itemId, l.unit)}
                          </label>
                        ))}
                        <div className={splitBad(l.itemId) ? 'msg err' : 'muted'} aria-live="polite">
                          {splitSum(l.itemId)} / {Number(got[l.itemId]?.qty) || 0} {unitWord(l.itemId, l.unit)}
                          {splitBad(l.itemId) && ' · ' + bi('must add up to what arrived', 'ಬಂದದ್ದಕ್ಕೆ ಸಮ ಆಗಬೇಕು')}
                        </div>
                      </div>
                    )}
                    <label className="expiry-in">
                      <span className="muted">{bi('Expiry (optional)', 'ಅವಧಿ ಮುಗಿಯುವ ದಿನ (ಬೇಕಿದ್ದರೆ)')}</span>
                      <input type="date" value={expiry[l.itemId] ?? ''} onChange={(e) => setExpiry({ ...expiry, [l.itemId]: e.target.value })} />
                    </label>
                  </td>
                )}
                {!receiving && stage === 'received' && (
                  <td className={r && r.qty < l.qty ? 'qty-neg' : ''}>
                    {r ? r.qty + ' ' + unitWord(l.itemId, l.unit) + (r.cost !== l.cost ? ' @ ' + formatRate(r.cost) : '') : '—'}
                    {r?.landed != null && <div className="muted">{bi('landed', 'ಸಾಗಣೆ ಸೇರಿ')} {formatRate(r.landed)}</div>}
                    {r?.expiry && <div className="muted">{bi('expires', 'ಅವಧಿ')} {r.expiry}</div>}
                    {r?.places && <div className="muted">{r.places.map((x) => placeOf(x.placeId) + ' ' + x.qty).join(' · ')}</div>}
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
          <label className="field">
            <span>{bi('Carrier trip (delivery charge)', 'ಸಾಗಣೆ ಓಡಾಟ (ಬಾಡಿಗೆ)')}</span>
            <Select
              value={tripId}
              onChange={setTripId}
              aria-label={bi('Carrier trip', 'ಸಾಗಣೆ ಓಡಾಟ')}
              options={[{ value: '', label: bi('None', 'ಇಲ್ಲ') }, ...trips.map((t) => ({ value: t.id, label: t.date + ' · ₹' + t.charge, hint: t.supplierId === p.supplierId ? bi('this supplier', 'ಇದೇ ಸರಬರಾಜುದಾರ') : undefined }))]}
            />
          </label>
          <label className="field">
            <span>{bi('Or delivery charge ₹', 'ಅಥವಾ ಸಾಗಣೆ ಬಾಡಿಗೆ ₹')}</span>
            <input inputMode="decimal" value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder={trip ? String(trip.charge) : '0'} />
          </label>
        </div>
      )}
      <div className="bar mt-8">
        <b className="grow">{total > 0 && <Money v={total} />}</b>
        {receiving ? (
          <>
            <button
              className="btn primary"
              disabled={anySplitBad}
              onClick={() =>
                act(
                  '/admin/pos/' + p.id + '/receive',
                  {
                    updateCost,
                    to,
                    got: Object.fromEntries(
                      Object.entries(got).map(([k, v]) => [
                        k,
                        { qty: Number(v.qty) || 0, cost: Number(v.cost) || 0, ...(split[k] ? { places: Object.entries(split[k]!).map(([placeId, q]) => ({ placeId, qty: Number(q) || 0 })).filter((x) => x.qty > 0) } : {}) },
                      ]),
                    ),
                    ...(tripId ? { tripId } : {}),
                    ...(delivery.trim() !== '' ? { delivery: Number(delivery) || 0 } : {}),
                    expiry: Object.fromEntries(Object.entries(expiry).filter(([, v]) => /^\d{4}-\d{2}-\d{2}$/.test(v))),
                  },
                  placeOf(to) + ': ' + p.lines.map((l) => briefName(items.get(l.itemId), l.itemId, lang) + ' +' + (Number(got[l.itemId]?.qty) || 0) + ' ' + unitWord(l.itemId, l.unit)).join(', '),
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
              <button className="btn primary" data-tour="purchases-receive" onClick={() => setReceiving(true)}>
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
export function useItemSearch(q: string) {
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
  // Who supplies each item, the usual one first: added by hand on the item, or from past orders.
  const [whoSupplies, setWho] = useState<Record<string, ItemSupplierRow[]>>({});
  /* The buy list, grouped by each item's usual supplier: one order is one supplier, so the shop
     orders one group at a time. */
  const [buyAll, setBuyAll] = useState<(Line & { usual: string })[]>([]);
  const [group, setGroup] = useState<string | null>(null);
  useEffect(() => {
    api.itemSuppliers().then(setWho).catch(() => undefined);
  }, []);
  const supName = (id: string) => sups.find((s) => s.id === id)?.name ?? '';

  // "Order these" from the buy list: what is low in all places together, in the unit suppliers
  // sell it in, enough to bring the total back to twice its level.
  useEffect(() => {
    if (!fromBuyList) return;
    Promise.all([http.get<Refill>('/admin/refill'), api.itemSuppliers().catch(() => ({}) as Record<string, ItemSupplierRow[]>)])
      .then(async ([r, who]) => {
        const got = (await Promise.all(r.buy.map((b) => api.item(b.itemId).catch(() => null)))).filter((x): x is Item => !!x);
        setKnown(new Map(got.map((i) => [i.id, i])));
        const live = new Set(sups.map((s) => s.id));
        const all = r.buy.flatMap((b) => {
          const it = got.find((i) => i.id === b.itemId);
          if (!it) return [];
          const u = buyUnit(it);
          const usual = (who[it.id] ?? []).find((x) => live.has(x.supplierId))?.supplierId ?? NO_USUAL;
          return [{ itemId: it.id, unit: u.code, qty: String(Math.max(1, Math.ceil(b.qty / u.perBase))), cost: startCost(who[it.id], usual, u), usual }];
        });
        setBuyAll(all);
        const first = all.find((l) => l.usual !== NO_USUAL)?.usual ?? NO_USUAL;
        pickGroup(first, all);
      })
      .catch((e: Error) => setErr(e.message));
  }, [fromBuyList]);

  /** One supplier's share of the buy list becomes the order, with that supplier chosen. */
  function pickGroup(g: string, all = buyAll) {
    setGroup(g);
    if (g !== NO_USUAL) setSupplier(g);
    setLines(all.filter((l) => l.usual === g).map(({ usual: _u, ...l }) => l));
  }
  const groups = [...new Set(buyAll.map((l) => l.usual))];

  const add = (it: Item) => {
    const u = buyUnit(it);
    setKnown(new Map(known).set(it.id, it));
    setLines([...lines, { itemId: it.id, unit: u.code, qty: '1', cost: startCost(whoSupplies[it.id], supplierId, u) }]);
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
      {groups.length > 0 && (
        <div className="field" data-tour="purchases-groups">
          <span>{bi('The buy list, by usual supplier: one order each', 'ಖರೀದಿ ಪಟ್ಟಿ, ಯಾವಾಗಲೂ ಕೊಡುವವರ ಪ್ರಕಾರ: ಒಬ್ಬರಿಗೆ ಒಂದು ಆರ್ಡರ್')}</span>
          <div className="chips">
            {groups.map((g) => (
              <button key={g || 'none'} type="button" className={'chip' + (group === g ? ' on' : '')} onClick={() => pickGroup(g)}>
                {(g ? supName(g) : bi('No usual supplier', 'ಯಾವಾಗಲೂ ಕೊಡುವವರಿಲ್ಲ')) + ' · ' + buyAll.filter((l) => l.usual === g).length}
              </button>
            ))}
          </div>
        </div>
      )}
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
        // The item's own suppliers, so the shop sees who usually brings it before saving.
        const others = (whoSupplies[l.itemId] ?? []).filter((x) => sups.some((s) => s.id === x.supplierId)).slice(0, 3);
        return (
          <div key={l.itemId}>
          <div className="bar mt-6">
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
          {others.length > 0 && (
            <div className="chips mt-6" data-tour="purchases-item-suppliers">
              <span className="muted">{bi('Supplied by', 'ಕೊಡುವವರು')}:</span>
              {others.map((x) => (
                <button
                  key={x.supplierId}
                  type="button"
                  className={'chip' + (x.supplierId === supplierId ? ' on' : '')}
                  title={x.lastAt ? when(x.lastAt, lang) : ''}
                  onClick={() => setSupplier(x.supplierId)}
                >
                  {supName(x.supplierId)}
                  {x.lastCost != null && ' · ' + formatRate(x.lastCost) + '/' + x.lastUnit}
                </button>
              ))}
            </div>
          )}
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
  // An accordion: one supplier open at a time, its details right under it. "new" is the form on top.
  const [openId, setOpenId] = useState<string | 'new' | null>(null);
  const list = useRef<HTMLDivElement>(null);
  // A tap outside the list closes whatever is open.
  useEffect(() => {
    if (!openId) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t || !document.contains(t) || list.current?.contains(t) || t.closest('[role="listbox"], .sheet-wrap, .top')) return;
      setOpenId(null);
    };
    document.addEventListener('pointerdown', down);
    return () => document.removeEventListener('pointerdown', down);
  }, [openId]);
  const done = () => {
    setOpenId(null);
    onDone();
  };
  return (
    <div ref={list} data-tour="suppliers-list">
      <button className="btn mb-10" onClick={() => setOpenId(openId === 'new' ? null : 'new')}>
        + {bi('New supplier', 'ಹೊಸ ಸರಬರಾಜುದಾರ')}
      </button>
      {openId === 'new' && <SupplierForm s={null} onDone={done} />}
      {sups.length === 0 && <Empty>{bi('No suppliers yet.', 'ಇನ್ನೂ ಸರಬರಾಜುದಾರರಿಲ್ಲ.')}</Empty>}
      {sups.map((s) => (
        <div key={s.id}>
          <div className={'card clickable' + (openId === s.id ? ' on' : '')} aria-expanded={openId === s.id} onClick={() => setOpenId(openId === s.id ? null : s.id)}>
            <span className="name">{s.name}</span>{' '}
            {s.phone && (
              <a href={'tel:' + s.phone} onClick={(e) => e.stopPropagation()}>
                {s.phone}
              </a>
            )}
            {!s.active && <span className="pill bad"> {bi('Switched off', 'ನಿಲ್ಲಿಸಲಾಗಿದೆ')}</span>}
            {s.gst && <span className="muted"> · GST {s.gst}</span>}
            {(s.contacts ?? []).length > 0 && (
              <div className="muted">
                {s.contacts!.map((c, i) => (
                  <span key={i} className="supplier-contact">
                    {c.name}
                    {c.role && ' (' + c.role + ')'}
                    {c.phone && (
                      <>
                        {' '}
                        <a href={'tel:' + c.phone} onClick={(e) => e.stopPropagation()}>
                          {c.phone}
                        </a>
                      </>
                    )}
                  </span>
                ))}
              </div>
            )}
            {s.notes && <div className="muted">{s.notes}</div>}
          </div>
          {openId === s.id && <SupplierForm key={s.id} s={s} onDone={done} />}
        </div>
      ))}
    </div>
  );
}

type ItemPick = { id: string; nameEn: string; nameKn: string };

function SupplierForm({ s, onDone }: { s: Supplier | null; onDone: () => void }) {
  const bi = useBi();
  const { lang } = useSession();
  const [name, setName] = useState(s?.name ?? '');
  const [phone, setPhone] = useState(s?.phone ?? '');
  const [gst, setGst] = useState(s?.gst ?? '');
  const [notes, setNotes] = useState(s?.notes ?? '');
  const [contacts, setContacts] = useState<SupplierContact[]>(s?.contacts ?? []);
  // Items supplied: read from the items, saved back onto them, so the item page agrees.
  const [supplied, setSupplied] = useState<ItemPick[] | null>(s ? null : []);
  useEffect(() => {
    if (!s) return;
    http
      .get<ItemPick[]>('/admin/suppliers/' + s.id + '/items')
      .then(setSupplied)
      .catch(() => setSupplied([]));
  }, [s]);
  const [q, setQ] = useState('');
  // A new supplier starts with the item picker open; an existing one shows its items first.
  const [editItems, setEditItems] = useState(!s);
  const found = useItemSearch(q).filter((i) => !(supplied ?? []).some((x) => x.id === i.id));
  const [err, setErr] = useState('');
  const setContact = (i: number, patch: Partial<SupplierContact>) => setContacts(contacts.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const save = async (active?: boolean) => {
    setErr('');
    try {
      const body = {
        name,
        phone,
        gst,
        notes,
        contacts: contacts.filter((c) => c.name.trim()),
        ...(supplied ? { itemIds: supplied.map((i) => i.id) } : {}),
        ...(active != null ? { active } : {}),
      };
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
          <span>{bi('Company name', 'ಕಂಪನಿ ಹೆಸರು')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{bi('Company phone (optional)', 'ಕಂಪನಿ ಫೋನ್ (ಬೇಕಿದ್ದರೆ)')}</span>
          <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field">
          <span>{bi('GST (optional)', 'ಜಿಎಸ್‌ಟಿ (ಬೇಕಿದ್ದರೆ)')}</span>
          <input value={gst} onChange={(e) => setGst(e.target.value)} placeholder="29ABCDE1234F1Z5" />
        </label>
        <label className="field">
          <span>{bi('Notes', 'ಟಿಪ್ಪಣಿ')}</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={bi('When they come, how they deliver', 'ಯಾವಾಗ ಬರುತ್ತಾರೆ, ಹೇಗೆ ತಲುಪಿಸುತ್ತಾರೆ')} />
        </label>
      </div>
      <div className="field">
        <span>{bi('Contact people', 'ಸಂಪರ್ಕ ವ್ಯಕ್ತಿಗಳು')}</span>
        {contacts.map((c, i) => (
          <div className="bar supplier-contact-row" key={i}>
            <input className="grow" value={c.name} onChange={(e) => setContact(i, { name: e.target.value })} placeholder={bi('Name', 'ಹೆಸರು')} aria-label={bi('Name', 'ಹೆಸರು')} />
            <input value={c.role ?? ''} onChange={(e) => setContact(i, { role: e.target.value })} placeholder={bi('Role or relation', 'ಹುದ್ದೆ ಅಥವಾ ಸಂಬಂಧ')} aria-label={bi('Role or relation', 'ಹುದ್ದೆ ಅಥವಾ ಸಂಬಂಧ')} />
            <input inputMode="tel" value={c.phone ?? ''} onChange={(e) => setContact(i, { phone: e.target.value })} placeholder={bi('Phone (optional)', 'ಫೋನ್ (ಬೇಕಿದ್ದರೆ)')} aria-label={bi('Phone', 'ಫೋನ್')} />
            <button className="btn ghost small" onClick={() => setContacts(contacts.filter((_, j) => j !== i))} aria-label={bi('Remove', 'ತೆಗೆಯಿರಿ')}>
              ✕
            </button>
          </div>
        ))}
        <div>
          <button className="btn small" onClick={() => setContacts([...contacts, { name: '' }])}>
            + {bi('Contact', 'ಸಂಪರ್ಕ')}
          </button>
        </div>
      </div>
      <div className="field" data-tour="supplier-items">
        <div className="bar mb-0">
          <b>{bi('Items supplied', 'ಕೊಡುವ ಸಾಮಾನು')}</b>
          {!editItems && (
            <button type="button" className="btn small" onClick={() => setEditItems(true)}>
              ✎ {bi('Edit items', 'ಸಾಮಾನು ಬದಲಿಸಿ')}
            </button>
          )}
        </div>
        {supplied == null ? (
          <Loading />
        ) : (
          <>
            <div className="chips">
              {supplied.map((i) =>
                editItems ? (
                  <button key={i.id} type="button" className="chip on" onClick={() => setSupplied(supplied.filter((x) => x.id !== i.id))} title={bi('Remove', 'ತೆಗೆಯಿರಿ')}>
                    {pickName(i.nameEn, i.nameKn, lang)} ✕
                  </button>
                ) : (
                  <span key={i.id} className="chip">
                    {pickName(i.nameEn, i.nameKn, lang)}
                  </span>
                ),
              )}
              {supplied.length === 0 && <span className="muted">{bi('None yet', 'ಇನ್ನೂ ಇಲ್ಲ')}</span>}
            </div>
            {editItems && <input className="mt-6" placeholder={bi('Search an item to add…', 'ಸೇರಿಸಲು ಸಾಮಾನು ಹುಡುಕಿ…')} value={q} onChange={(e) => setQ(e.target.value)} />}
            {editItems && found.length > 0 && (
              <div className="chips mt-6">
                {found.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    className="chip"
                    onClick={() => {
                      setSupplied([...supplied, { id: i.id, nameEn: i.nameEn, nameKn: i.nameKn }]);
                      setQ('');
                    }}
                  >
                    + {pickName(i.nameEn, i.nameKn, lang)}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <div className="bar">
        <button className="btn primary" onClick={() => save()} disabled={supplied == null}>
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
