import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { describeQty, formatRate, sellPriceOf, isLow, itemMatches, lowAtOf, pickName, sortItems, totalsByItem, DEFAULT_SORT_DIR, ITEM_SORTS, type Item, type ItemSort, type Lang, type PriceVolatility, type SortDir } from '@stock/core';
import { api, http } from '../../lib/api';
import { Select } from '../../components/Select';
import { useLive } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { Loading, Table, useBi } from '../../components/ui';

/** "5 box", the way the running-out level was typed, in the shop's words. */
export function lowWords(item: Item, lang: Lang): string {
  const l = lowAtOf(item);
  if (!l) return '';
  const u = item.units.find((x) => x.code === l.unit);
  return l.qty + ' ' + ((lang === 'kn' && u?.labelKn) || l.unit);
}

/**
 * Items and stock in one list: what each item is, where it is kept, how much each place has,
 * the total, and whether that total is running low. Tapping an item opens its page, with its
 * details and its stock on two tabs.
 */
export function InventoryPage({ readOnly = false }: { readOnly?: boolean }) {
  const { t, lang } = useSession();
  const bi = useBi();
  const nav = useNavigate();
  const base = '/admin/inventory';
  const [params, setParams] = useSearchParams();
  const onlyLow = params.get('low') === '1';
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [note, setNote] = useState('');
  const live = useLive('stock', 'items');
  const { value, error, reload } = useLoad(async () => {
    const [items, stock, locs, facts] = await Promise.all([
      api.items(true),
      api.stock(),
      api.locations(),
      // What the sorts need: 30-day sold and the soonest expiry. The list works without them.
      http
        .get<{ sold: Record<string, number>; expiry: Record<string, string>; volatility?: Record<string, PriceVolatility> }>('/admin/list-facts')
        .catch(() => ({ sold: {} as Record<string, number>, expiry: {} as Record<string, string>, volatility: {} as Record<string, PriceVolatility> })),
    ]);
    return { items, stock, locs: locs.filter((l) => l.active), facts };
  }, [live]);
  const sortBy: ItemSort = (ITEM_SORTS as readonly string[]).includes(params.get('sort') ?? '') ? (params.get('sort') as ItemSort) : 'name';
  const dirParam = params.get('dir');
  const sortDir: SortDir = dirParam === 'asc' || dirParam === 'desc' ? dirParam : DEFAULT_SORT_DIR[sortBy];
  // A new sort starts in its own direction; the 🔽/🔼 button flips it. Both live in the URL.
  const setSort = (v: ItemSort) => {
    const next = new URLSearchParams(params);
    if (v === 'name') next.delete('sort');
    else next.set('sort', v);
    next.delete('dir');
    next.delete('cat');
    next.delete('place');
    setParams(next, { replace: true });
  };
  const flipDir = () => {
    const next = new URLSearchParams(params);
    const flipped: SortDir = sortDir === 'asc' ? 'desc' : 'asc';
    if (flipped === DEFAULT_SORT_DIR[sortBy]) next.delete('dir');
    else next.set('dir', flipped);
    setParams(next, { replace: true });
  };

  // Sort = Storage place: first the places with their item counts; one tapped opens it (?place=).
  const placeId = sortBy === 'place' ? params.get('place') : null;
  const [placeData, setPlaceData] = useState<{ id: string; now: { itemId: string; qty: number }[]; before: { itemId: string; lastAt: string }[] } | null>(null);
  const [placeErr, setPlaceErr] = useState('');
  useEffect(() => {
    if (!placeId) return;
    let gone = false;
    setPlaceErr('');
    http
      .get<{ now: { itemId: string; qty: number }[]; before: { itemId: string; lastAt: string }[] }>('/admin/places/' + encodeURIComponent(placeId) + '/items')
      .then((r) => {
        if (!gone) setPlaceData({ id: placeId, ...r });
      })
      .catch((e: unknown) => {
        if (!gone) setPlaceErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      gone = true;
    };
  }, [placeId, live]);

  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const { items, stock, locs, facts } = value;
  const totals = totalsByItem(stock);
  const low = (i: Item) => isLow(i, totals.get(i.id) ?? 0);
  const shop = locs.find((l) => l.kind === 'shop');
  const expiry = new Map(Object.entries(facts.expiry));
  const volatility = new Map(Object.entries(facts.volatility ?? {}));
  // Sort = Category: first the categories with their counts; one tapped opens its items (?cat=).
  const NO_CAT = '-';
  const catOf = (i: Item) => (i.category ?? '').trim();
  const cat = sortBy === 'category' ? params.get('cat') : null;
  const showCats = sortBy === 'category' && cat == null && !q.trim();
  const showPlaces = sortBy === 'place' && placeId == null && !q.trim();
  const inPlace = sortBy === 'place' && placeId != null && !q.trim();
  const openPlace = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id == null) next.delete('place');
    else next.set('place', id);
    setParams(next);
  };
  const openCat = (c: string | null) => {
    const next = new URLSearchParams(params);
    if (c == null) next.delete('cat');
    else next.set('cat', c);
    setParams(next);
  };
  const visible = items.filter((i) => (showAll || i.active) && (!onlyLow || (i.active && low(i))));
  const catRows = (() => {
    const counts = new Map<string, number>();
    for (const i of visible) counts.set(catOf(i), (counts.get(catOf(i)) ?? 0) + 1);
    const named = [...counts.entries()].filter(([c]) => c).sort((a, b) => (sortDir === 'desc' ? -1 : 1) * a[0].localeCompare(b[0]));
    return counts.has('') ? [...named, ['', counts.get('')!] as [string, number]] : named;
  })();
  const shown = sortItems(
    visible.filter((i) => (!q.trim() || itemMatches(i, q)) && (cat == null || catOf(i) === (cat === NO_CAT ? '' : cat))),
    sortBy,
    { total: totals, sold: new Map(Object.entries(facts.sold)), expiry, price: (i) => sellPriceOf(i).rate, volatility, lang },
    sortDir,
  );
  const SORT_WORDS: Record<ItemSort, [string, string]> = {
    name: ['Name', 'ಹೆಸರು'],
    price: ['Price', 'ಬೆಲೆ'],
    stock: ['Stock level', 'ಸ್ಟಾಕ್ ಮಟ್ಟ'],
    selling: ['Selling', 'ಮಾರಾಟ'],
    expiry: ['Expiry', 'ಅವಧಿ'],
    category: ['Category', 'ವರ್ಗ'],
    volatility: ['Price volatility', 'ಬೆಲೆ ಏರಿಳಿತ'],
    place: ['Storage place', 'ಸಂಗ್ರಹ ಸ್ಥಳ'],
  };
  const byId = new Map(items.map((i) => [i.id, i]));
  const placeCounts = new Map<string, number>();
  for (const s of stock) if (s.qty > 0 && byId.get(s.itemId)?.active) placeCounts.set(s.locationId, (placeCounts.get(s.locationId) ?? 0) + 1);
  const place = placeId ? locs.find((l) => l.id === placeId) : undefined;
  const pd = placeData && placeData.id === placeId ? placeData : null;
  const dirSign = sortDir === 'desc' ? -1 : 1;
  const keep = (id: string) => byId.has(id) && (showAll || byId.get(id)!.active);
  const placeNow = pd ? pd.now.filter((r) => keep(r.itemId)).sort((a, b) => dirSign * (a.qty - b.qty)) : [];
  const placeBefore = pd ? pd.before.filter((r) => keep(r.itemId)) : [];
  const nameCell = (i: Item) => (
    <td>
      <div className="name">{pickName(i.nameEn, i.nameKn, lang)}</div>
      <div className="muted">{[lang === 'kn' ? i.nameEn : i.nameKn, place && i.racks[place.id]].filter(Boolean).join(' · ')}</div>
      {!i.active && <span className="pill">{t('items.inactive')}</span>}
    </td>
  );
  const lowCount = items.filter((i) => i.active && low(i)).length;

  const recount = async () => {
    const r = await api.recount();
    setNote(t('stock.recountDone', { n: r.checked, d: r.fixed.length }));
    reload();
  };

  return (
    <>
      <h1 className="title">{bi('Inventory', 'ಸಾಮಾನು ಮತ್ತು ಸ್ಟಾಕ್')}</h1>
      {note && <div className="msg ok">{note}</div>}
      <div className="bar">
        <input className="grow" data-tour="inventory-search" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        {!readOnly && (
          <Link className="btn primary" to="/admin/inventory/new" data-tour="inventory-new">
            + {t('items.new')}
          </Link>
        )}
        {!readOnly && (
          <button className="btn" onClick={recount} data-tour="inventory-recount">
            {t('stock.recount')}
          </button>
        )}
      </div>
      <div className="bar">
        <label className="check" data-tour="inventory-low">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setParams(e.target.checked ? { low: '1' } : {})} />
          {t('stock.onlyLow')} ({lowCount})
        </label>
        <label className="check">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          {t('items.showInactive')}
        </label>
        <label className="inv-sort" data-tour="inventory-sort">
          <span className="muted">{bi('Sort', 'ವಿಂಗಡಿಸಿ')}</span>
          <Select value={sortBy} onChange={setSort} className="w-auto" aria-label={bi('Sort by', 'ವಿಂಗಡಿಸುವುದು')} options={ITEM_SORTS.map((k) => ({ value: k, label: bi(...SORT_WORDS[k]) }))} />
          <button
            type="button"
            className="btn small"
            onClick={(e) => {
              e.preventDefault();
              flipDir();
            }}
            aria-label={sortDir === 'desc' ? bi('Descending: tap for ascending', 'ಇಳಿಕೆ: ಏರಿಕೆಗೆ ಒತ್ತಿ') : bi('Ascending: tap for descending', 'ಏರಿಕೆ: ಇಳಿಕೆಗೆ ಒತ್ತಿ')}
            title={sortDir === 'desc' ? bi('Descending', 'ಇಳಿಕೆ') : bi('Ascending', 'ಏರಿಕೆ')}
            data-dir={sortDir}
          >
            {sortDir === 'desc' ? '🔽' : '🔼'}
          </button>
        </label>
      </div>
      {cat != null && (
        <div className="bar">
          <button type="button" className="btn small" onClick={() => openCat(null)}>
            ← {bi('All categories', 'ಎಲ್ಲಾ ವರ್ಗಗಳು')}
          </button>
          <b>{cat === NO_CAT ? bi('No category', 'ವರ್ಗ ಇಲ್ಲ') : cat}</b>
        </div>
      )}
      {placeId != null && sortBy === 'place' && (
        <div className="bar">
          <button type="button" className="btn small" onClick={() => openPlace(null)}>
            ← {bi('All places', 'ಎಲ್ಲಾ ಸ್ಥಳಗಳು')}
          </button>
          <b>{place ? pickName(place.name, place.nameKn, lang) : placeId}</b>
        </div>
      )}
      {showPlaces && (
        <div className="scroll" data-tour="inventory-list">
          <Table className="list">
            <thead>
              <tr>
                <th>{bi('Storage place', 'ಸಂಗ್ರಹ ಸ್ಥಳ')}</th>
                <th className="num">{bi('Products', 'ಸಾಮಾನುಗಳು')}</th>
              </tr>
            </thead>
            <tbody>
              {locs.map((l) => (
                <tr key={l.id} className="link" data-place={l.id} onClick={() => openPlace(l.id)}>
                  <td>
                    <div className="name">{pickName(l.name, l.nameKn, lang)}</div>
                  </td>
                  <td className="num">
                    <b>{placeCounts.get(l.id) ?? 0}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {inPlace && placeErr && <div className="msg err">{placeErr}</div>}
      {inPlace && !pd && !placeErr && <Loading />}
      {inPlace && pd && (
        <>
          <h2 className="subtitle">{bi('In stock here', 'ಇಲ್ಲಿ ಸ್ಟಾಕ್ ಇದೆ')}</h2>
          {placeNow.length === 0 ? (
            <div className="card">{bi('No items here.', 'ಇಲ್ಲಿ ಸಾಮಾನು ಇಲ್ಲ.')}</div>
          ) : (
            <div className="scroll" data-tour="inventory-list">
              <Table className="list">
                <thead>
                  <tr>
                    <th>{t('stock.item')}</th>
                    <th className="num">{bi('Here', 'ಇಲ್ಲಿ')}</th>
                  </tr>
                </thead>
                <tbody>
                  {placeNow.map((r) => {
                    const i = byId.get(r.itemId)!;
                    return (
                      <tr key={r.itemId} className="link" onClick={() => nav(base + '/' + i.id)}>
                        {nameCell(i)}
                        <td className="num">
                          <b>{describeQty(i, r.qty, lang)}</b>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
          <h2 className="subtitle">{bi('Was here before', 'ಹಿಂದೆ ಇಲ್ಲಿ ಇತ್ತು')}</h2>
          {placeBefore.length === 0 ? (
            <div className="card">{bi('Nothing.', 'ಏನೂ ಇಲ್ಲ.')}</div>
          ) : (
            <div className="scroll">
              <Table className="list">
                <thead>
                  <tr>
                    <th>{t('stock.item')}</th>
                    <th className="num">{bi('Last here', 'ಕೊನೆಯದಾಗಿ ಇಲ್ಲಿ')}</th>
                  </tr>
                </thead>
                <tbody>
                  {placeBefore.map((r) => {
                    const i = byId.get(r.itemId)!;
                    return (
                      <tr key={r.itemId} className="link" onClick={() => nav(base + '/' + i.id)}>
                        {nameCell(i)}
                        <td className="num muted">{new Date(r.lastAt).toLocaleDateString(lang === 'kn' ? 'kn-IN' : 'en-IN')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
          )}
        </>
      )}
      {showCats && catRows.length > 0 && (
        <div className="scroll" data-tour="inventory-list">
          <Table className="list">
            <thead>
              <tr>
                <th>{bi('Category', 'ವರ್ಗ')}</th>
                <th className="num">{bi('Products', 'ಸಾಮಾನುಗಳು')}</th>
              </tr>
            </thead>
            <tbody>
              {catRows.map(([c, n]) => (
                <tr key={c || NO_CAT} className="link" onClick={() => openCat(c || NO_CAT)}>
                  <td>
                    <div className="name">{c || bi('No category', 'ವರ್ಗ ಇಲ್ಲ')}</div>
                  </td>
                  <td className="num">
                    <b>{n}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
      {!showCats && !showPlaces && !inPlace && items.length === 0 && <div className="card" data-tour="inventory-list">{t('items.empty')}</div>}
      {showCats && items.length > 0 && catRows.length === 0 && <div className="card">{bi('No items here.', 'ಇಲ್ಲಿ ಸಾಮಾನು ಇಲ್ಲ.')}</div>}
      {!showCats && !showPlaces && !inPlace && items.length > 0 && shown.length === 0 && (
        <div className="card" data-tour="inventory-list">
          {onlyLow ? bi('Nothing is running low. Good.', 'ಏನೂ ಮುಗಿಯುತ್ತಿಲ್ಲ. ಒಳ್ಳೆಯದು.') : bi('No item matches. Try another name, or add it with “New item”.', 'ಯಾವ ಸಾಮಾನೂ ಹೊಂದುತ್ತಿಲ್ಲ. ಬೇರೆ ಹೆಸರು ನೋಡಿ, ಅಥವಾ “ಹೊಸ ಸಾಮಾನು” ಒತ್ತಿ ಸೇರಿಸಿ.')}
        </div>
      )}
      {!showCats && !showPlaces && !inPlace && shown.length > 0 && (
        <div className="scroll" data-tour="inventory-list">
          <Table className="list">
            <thead>
              <tr>
                <th>{t('stock.item')}</th>
                <th className="num">{t('stock.total')}</th>
                <th className="num inv-price">{bi('Price', 'ಬೆಲೆ')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((i) => {
                const total = totals.get(i.id) ?? 0;
                const isLowNow = i.active && low(i);
                return (
                  <tr key={i.id} className="link" onClick={() => nav(base + '/' + i.id)}>
                    <td>
                      <div className="name">{pickName(i.nameEn, i.nameKn, lang)}</div>
                      <div className="muted">
                        {[lang === 'kn' ? i.nameEn : i.nameKn, i.units.map((u) => u.code).join(' · '), shop && i.racks[shop.id]].filter(Boolean).join(' · ')}
                      </div>
                      <div className="inv-price-under">
                        <PriceOf i={i} lang={lang} />
                      </div>
                      {!i.active && <span className="pill">{t('items.inactive')}</span>}
                      {sortBy === 'expiry' && expiry.get(i.id) && <span className="pill warn">{bi('expires', 'ಅವಧಿ')} {expiry.get(i.id)}</span>}
                      {sortBy === 'selling' && (facts.sold[i.id] ?? 0) > 0 && <span className="muted"> {bi('sold in 30 days', '30 ದಿನದಲ್ಲಿ ಮಾರಾಟ')}: {describeQty(i, facts.sold[i.id]!, lang)}</span>}
                      {sortBy === 'volatility' && (volatility.get(i.id)?.changes ?? 0) > 0 && (
                        <div className="muted">
                          {bi('price changed', 'ಬೆಲೆ ಬದಲಾಯಿತು')} {volatility.get(i.id)!.changes}× {bi('in 90 days', '90 ದಿನದಲ್ಲಿ')} · ±{Math.round(volatility.get(i.id)!.spread * 100)}%
                        </div>
                      )}
                    </td>
                    <td className={'num ' + (total < 0 ? 'qty-neg' : isLowNow ? 'qty-low' : '')}>
                      <b>{describeQty(i, total, lang)}</b>
                      {isLowNow && (
                        <div>
                          <span className="pill warn">
                            {t('stock.low')} · {bi('below', 'ಕಡಿಮೆ:')} {lowWords(i, lang)}
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="num inv-price">
                      <PriceOf i={i} lang={lang} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}

/** "₹170 / Pkt": one of the selling unit, with a "range" hint when slabs lower it for more. */
function PriceOf({ i, lang }: { i: Item; lang: Lang }) {
  const bi = useBi();
  const p = sellPriceOf(i);
  const code = lang === 'kn' && p.unit.labelKn ? p.unit.labelKn : p.unit.code;
  const tip = p.slabs.map((s) => s.minQty + '+ ' + code + ': ' + formatRate(s.rate)).join(' · ');
  return (
    <span>
      {formatRate(p.rate)} / {code}
      {p.slabs.length > 0 && (
        <span className="muted" title={tip}>
          {' '}
          · {bi('range', 'ಶ್ರೇಣಿ')}
        </span>
      )}
    </span>
  );
}
