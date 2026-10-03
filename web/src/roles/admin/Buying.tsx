import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { formatRupees, itemMatches, pickName, type Item, type PurchaseOrder, type Refill, type Supplier } from '@stock/core';
import { http } from '../../lib/api';
import { itemName, placeName, useCatalog } from '../../lib/catalog';
import { useLive } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { statusWord } from '../../lib/words';
import { Empty, Loading, Money, Status, useBi, when, Table } from '../../components/ui';

interface Line {
  itemId: string;
  unit: string;
  qty: number;
  cost: number;
}

/** The unit an item is bought in: the biggest one, which is how suppliers sell. */
function buyUnit(item: Item) {
  return [...item.units].sort((a, b) => b.perBase - a.perBase)[0]!;
}

export function PurchasesPage() {
  const bi = useBi();
  const { lang } = useSession();
  const [params, setParams] = useSearchParams();
  const [version, setVersion] = useState(0);
  const live = useLive('pos', 'items');
  const { items, locs } = useCatalog(version);
  const { value, error } = useLoad(async () => {
    const [pos, sups] = await Promise.all([http.get<PurchaseOrder[]>('/admin/pos'), http.get<Supplier[]>('/admin/suppliers')]);
    return { pos, sups };
  }, [version, live]);
  const [making, setMaking] = useState(params.get('new') === 'buy');
  const [tab, setTab] = useState<'open' | 'all' | 'suppliers'>('open');
  const [err, setErr] = useState('');
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const act = async (path: string, body: unknown = {}) => {
    setErr('');
    try {
      await http.post(path, body);
      setVersion((v) => v + 1);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const shown = value.pos.filter((p) => tab === 'all' || (p.status !== 'received' && p.status !== 'cancelled'));
  return (
    <>
      <h1 className="title">{bi('Buying', 'ಖರೀದಿ')}</h1>
      <div className="bar">
        <button className="btn primary" onClick={() => setMaking(!making)}>
          + {bi('New purchase order', 'ಹೊಸ ಖರೀದಿ ಆರ್ಡರ್')}
        </button>
        <div className="chips">
          {(['open', 'all', 'suppliers'] as const).map((k) => (
            <button key={k} className={'chip ' + (tab === k ? 'on' : '')} onClick={() => setTab(k)}>
              {k === 'open' ? bi('Open', 'ತೆರೆದವು') : k === 'all' ? bi('All', 'ಎಲ್ಲ') : bi('Suppliers', 'ಸರಬರಾಜುದಾರರು')}
            </button>
          ))}
        </div>
      </div>
      {err && <div className="msg err">{err}</div>}
      {making && (
        <NewOrder
          items={items}
          locs={locs}
          sups={value.sups.filter((s) => s.active)}
          fromBuyList={params.get('new') === 'buy'}
          onDone={() => {
            setMaking(false);
            setParams({});
            setVersion((v) => v + 1);
          }}
        />
      )}
      {tab === 'suppliers' ? (
        <Suppliers sups={value.sups} onDone={() => setVersion((v) => v + 1)} />
      ) : (
        <>
          {shown.length === 0 && <Empty>{bi('No open orders.', 'ತೆರೆದ ಆರ್ಡರ್ ಇಲ್ಲ.')}</Empty>}
          {shown.map((p) => (
            <OrderCard key={p.id} p={p} supplier={value.sups.find((s) => s.id === p.supplierId)} items={items} to={placeName(locs, p.to, lang)} act={act} />
          ))}
        </>
      )}
    </>
  );
}

function OrderCard({ p, supplier, items, to, act }: { p: PurchaseOrder & { received?: { itemId: string; qty: number; cost: number }[] }; supplier?: Supplier; items: Map<string, Item>; to: string; act: (path: string, body?: unknown) => Promise<void> }) {
  const bi = useBi();
  const { lang } = useSession();
  const [got, setGot] = useState<Record<string, { qty: string; cost: string }>>(() => Object.fromEntries(p.lines.map((l) => [l.itemId, { qty: String(l.qty), cost: String(l.cost) }])));
  const [receiving, setReceiving] = useState(false);
  const [updateCost, setUpdateCost] = useState(true);
  const total = p.lines.reduce((s, l) => s + l.qty * l.cost, 0);
  const rec = new Map((p.received ?? []).map((r) => [r.itemId, r]));
  return (
    <div className="card">
      <div className="bar between">
        <span className="name">
          #{p.no} · {supplier?.name ?? p.supplierId} → {to}
        </span>
        <Status s={p.status} label={statusWord(p.status, lang)} />
      </div>
      <div className="muted">
        {bi('Ordered', 'ಆರ್ಡರ್')} {when(p.times.ordered ?? p.at, lang)}
        {p.times.confirmed && ' · ' + bi('confirmed', 'ಒಪ್ಪಿಗೆ') + ' ' + when(p.times.confirmed, lang)}
        {p.times.dispatched && ' · ' + bi('dispatched', 'ಕಳುಹಿಸಿದ್ದು') + ' ' + when(p.times.dispatched, lang)}
        {p.invoiceNo && ' · ' + bi('invoice', 'ಇನ್‌ವಾಯ್ಸ್') + ' ' + p.invoiceNo}
        {p.vehicle && ' · 🚚 ' + p.vehicle}
        {p.eta && ' · ' + bi('arrives', 'ತಲುಪುವುದು') + ' ' + p.eta}
      </div>
      <Table className="list plain">
        <thead>
          <tr>
            <th>{bi('Item', 'ಸಾಮಾನು')}</th>
            <th className="num">{bi('Ordered', 'ಆರ್ಡರ್')}</th>
            <th className="num">{bi('Cost', 'ಬೆಲೆ')}</th>
            {(receiving || p.status === 'received') && <th>{bi('Arrived', 'ಬಂದದ್ದು')}</th>}
          </tr>
        </thead>
        <tbody>
          {p.lines.map((l) => {
            const r = rec.get(l.itemId);
            return (
              <tr key={l.itemId}>
                <td>{itemName(items, l.itemId, lang)}</td>
                <td className="num">
                  {l.qty} {l.unit}
                </td>
                <td className="num">{formatRupees(l.cost)}</td>
                {receiving && (
                  <td>
                    <input inputMode="decimal" value={got[l.itemId]!.qty} onChange={(e) => setGot({ ...got, [l.itemId]: { ...got[l.itemId]!, qty: e.target.value } })} className="in-qty" aria-label="qty" />{' '}
                    ₹<input inputMode="decimal" value={got[l.itemId]!.cost} onChange={(e) => setGot({ ...got, [l.itemId]: { ...got[l.itemId]!, cost: e.target.value } })} className="in-price" aria-label="cost" />
                  </td>
                )}
                {!receiving && p.status === 'received' && (
                  <td className={r && r.qty < l.qty ? 'qty-neg' : ''}>
                    {r ? r.qty + ' ' + l.unit + (r.cost !== l.cost ? ' @ ' + formatRupees(r.cost) : '') : '—'}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div className="bar mt-8">
        <b className="grow">
          <Money v={total} />
        </b>
        {receiving ? (
          <>
            <label className="check">
              <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />
              {bi('Use these as the items’ cost', 'ಇದನ್ನೇ ಖರೀದಿ ಬೆಲೆ ಮಾಡಿ')}
            </label>
            <button
              className="btn primary"
              onClick={() =>
                act('/admin/pos/' + p.id + '/receive', {
                  updateCost,
                  got: Object.fromEntries(Object.entries(got).map(([k, v]) => [k, { qty: Number(v.qty) || 0, cost: Number(v.cost) || 0 }])),
                })
              }
            >
              ✓ {bi('Goods received', 'ಸಾಮಾನು ಬಂದಿದೆ')}
            </button>
            <button className="btn" onClick={() => setReceiving(false)}>
              {bi('Back', 'ಹಿಂದೆ')}
            </button>
          </>
        ) : (
          <>
            {p.status !== 'received' && p.status !== 'cancelled' && (
              <button className="btn primary" onClick={() => setReceiving(true)}>
                {bi('Receive goods', 'ಸಾಮಾನು ಸ್ವೀಕರಿಸಿ')}
              </button>
            )}
            {(p.status === 'ordered' || p.status === 'confirmed') && (
              <button className="btn" onClick={() => act('/admin/pos/' + p.id + '/cancel')}>
                {bi('Cancel order', 'ಆರ್ಡರ್ ರದ್ದು')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NewOrder({ items, locs, sups, fromBuyList, onDone }: { items: Map<string, Item>; locs: { id: string; name: string; nameKn: string; kind: string; active: boolean }[]; sups: Supplier[]; fromBuyList: boolean; onDone: () => void }) {
  const bi = useBi();
  const { lang } = useSession();
  const [supplierId, setSupplier] = useState(sups[0]?.id ?? '');
  const [to, setTo] = useState(locs.find((l) => l.kind === 'godown' && l.active)?.id ?? locs[0]?.id ?? '');
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');

  // From "buy from a supplier" on Refill: everything short, in the unit suppliers sell it in.
  useEffect(() => {
    if (!fromBuyList || items.size === 0) return;
    http.get<Refill>('/admin/refill').then((r) => {
      setLines(
        r.buy
          .map((b) => {
            const it = items.get(b.itemId);
            if (!it) return null;
            const u = buyUnit(it);
            return { itemId: it.id, unit: u.code, qty: Math.max(1, Math.ceil(b.qty / u.perBase)), cost: u.cost ?? 0 };
          })
          .filter((x): x is Line => !!x),
      );
    });
  }, [fromBuyList, items]);

  const add = (it: Item) => {
    const u = buyUnit(it);
    setLines([...lines, { itemId: it.id, unit: u.code, qty: 1, cost: u.cost ?? 0 }]);
    setQ('');
  };
  const found = q.trim() ? [...items.values()].filter((i) => i.active && itemMatches(i, q) && !lines.some((l) => l.itemId === i.id)).slice(0, 6) : [];
  const set = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const save = async () => {
    setErr('');
    try {
      await http.post('/admin/pos', { supplierId, to, lines });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  if (!sups.length) return <div className="msg err">{bi('Add a supplier first (Suppliers tab).', 'ಮೊದಲು ಸರಬರಾಜುದಾರರನ್ನು ಸೇರಿಸಿ.')}</div>;
  return (
    <div className="card">
      {err && <div className="msg err">{err}</div>}
      <div className="grid2">
        <label className="field">
          <span>{bi('Supplier', 'ಸರಬರಾಜುದಾರ')}</span>
          <select value={supplierId} onChange={(e) => setSupplier(e.target.value)}>
            {sups.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{bi('Deliver to', 'ತಲುಪಿಸುವುದು')}</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {locs
              .filter((l) => l.active)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {pickName(l.name, l.nameKn, lang)}
                </option>
              ))}
          </select>
        </label>
      </div>
      <input placeholder={bi('Add an item…', 'ಸಾಮಾನು ಸೇರಿಸಿ…')} value={q} onChange={(e) => setQ(e.target.value)} />
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
        const it = items.get(l.itemId);
        return (
          <div className="bar mt-6" key={l.itemId}>
            <span className="grow name">{itemName(items, l.itemId, lang)}</span>
            <input inputMode="decimal" value={l.qty} onChange={(e) => set(i, { qty: Number(e.target.value) || 0 })} className="in-qty" aria-label="qty" />
            <select
              value={l.unit}
              onChange={(e) => {
                const u = it?.units.find((x) => x.code === e.target.value);
                set(i, { unit: e.target.value, cost: u?.cost ?? l.cost });
              }} className="w-auto"
            >
              {it?.units.map((u) => (
                <option key={u.code} value={u.code}>
                  {(lang === 'kn' && u.labelKn) || u.label}
                </option>
              ))}
            </select>
            ₹<input inputMode="decimal" value={l.cost} onChange={(e) => set(i, { cost: Number(e.target.value) || 0 })} className="in-price" aria-label="cost" />
            <button className="btn ghost small" onClick={() => setLines(lines.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        );
      })}
      <div className="bar mt-10">
        <b className="grow">
          <Money v={lines.reduce((s, l) => s + l.qty * l.cost, 0)} />
        </b>
        <button className="btn primary" disabled={!lines.length || lines.some((l) => !(l.qty > 0))} onClick={save}>
          {bi('Send order to supplier', 'ಆರ್ಡರ್ ಕಳುಹಿಸಿ')}
        </button>
        <button className="btn" onClick={onDone}>
          {bi('Cancel', 'ರದ್ದು')}
        </button>
      </div>
    </div>
  );
}

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
      {sups.map((s) => (
        <div className="card clickable" key={s.id} onClick={() => setEditing(s)}>
          <span className="name">{s.name}</span> <span className="muted">· {s.phone}</span>
          {!s.active && <span className="pill bad"> {bi('Switched off', 'ನಿಲ್ಲಿಸಲಾಗಿದೆ')}</span>}
          {s.address && <div className="muted">{s.address}</div>}
        </div>
      ))}
      <p className="muted">
        {bi('To let a supplier see and dispatch their orders, add them under People with the role Vendor.', 'ಸರಬರಾಜುದಾರರು ತಮ್ಮ ಆರ್ಡರ್ ನೋಡಲು, “ಜನರು” ನಲ್ಲಿ ಸರಬರಾಜುದಾರ ಪಾತ್ರದೊಂದಿಗೆ ಸೇರಿಸಿ.')}
      </p>
    </>
  );
}

function SupplierForm({ s, onDone }: { s: Supplier | null; onDone: () => void }) {
  const bi = useBi();
  const [name, setName] = useState(s?.name ?? '');
  const [phone, setPhone] = useState(s?.phone ?? '');
  const [address, setAddress] = useState(s?.address ?? '');
  const [err, setErr] = useState('');
  const save = async (active?: boolean) => {
    setErr('');
    try {
      const body = { name, phone, address, ...(active != null ? { active } : {}) };
      if (s) {
        const r = await fetch('/api/admin/suppliers/' + s.id, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('stock.token') ?? '') }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? 'Could not save');
      } else await http.post('/admin/suppliers', body);
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
        <span>{bi('Address', 'ವಿಳಾಸ')}</span>
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
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
