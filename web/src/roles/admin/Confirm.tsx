import { useState } from 'react';
import { formatRupees, itemMatches, pickName, priceFor, type Item, type MirrorLine } from '@stock/core';
import { http } from '../../lib/api';
import { useLive } from '../../lib/live';
import { itemName, useCatalog } from '../../lib/catalog';
import { useLoad, useSession } from '../../lib/session';
import { Empty, InkView, Loading, useBi, when } from '../../components/ui';
import { WriteToFind } from '../../components/WriteToFind';

interface Pending {
  billNo: number;
  at: string;
  customer: string;
  line: MirrorLine;
}

/**
 * Handwritten or unmatched bill lines, one card each: the writing as it was written, what the
 * reader made of it, and one tap to say it was right. Every answer is remembered as a name for
 * the item, so the same writing is read on its own next time.
 */
export function ConfirmPage() {
  const bi = useBi();
  const [version, setVersion] = useState(0);
  const { items } = useCatalog(version);
  const live = useLive('bills');
  const { value, error } = useLoad(() => http.get<Pending[]>('/admin/confirm'), [version, live]);
  const [note, setNote] = useState('');

  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  return (
    <>
      <h1 className="title">{bi('Bill lines to confirm', 'ಖಚಿತಪಡಿಸಬೇಕಾದ ಬಿಲ್ ಸಾಲುಗಳು')}</h1>
      <p className="muted">
        {bi(
          'Lines the reader was not sure about, or typed names that match no item. Your answer moves the stock and teaches the reader.',
          'ಓದುವಿಕೆಗೆ ಖಚಿತವಾಗದ ಸಾಲುಗಳು, ಅಥವಾ ಯಾವ ಸಾಮಾನಿಗೂ ಹೊಂದದ ಹೆಸರುಗಳು. ನಿಮ್ಮ ಉತ್ತರ ಸ್ಟಾಕ್ ಬದಲಿಸುತ್ತದೆ ಮತ್ತು ಓದುವಿಕೆಗೆ ಕಲಿಸುತ್ತದೆ.',
        )}
      </p>
      {note && <div className="msg ok">{note}</div>}
      {value.length === 0 && <Empty>{bi('All caught up. Nothing to confirm.', 'ಎಲ್ಲಾ ಮುಗಿದಿದೆ. ಖಚಿತಪಡಿಸಲು ಏನೂ ಇಲ್ಲ.')}</Empty>}
      {value.map((p) => (
        <ConfirmCard
          key={p.billNo + ':' + p.line.i}
          p={p}
          items={items}
          onDone={(msg) => {
            setNote(msg);
            setVersion((v) => v + 1);
          }}
        />
      ))}
    </>
  );
}

function why(line: MirrorLine, item: Item | undefined, bi: (en: string, kn: string) => string): string {
  if (!line.ink) return bi('Typed name matches no item', 'ಟೈಪ್ ಮಾಡಿದ ಹೆಸರು ಯಾವ ಸಾಮಾನಿಗೂ ಹೊಂದುತ್ತಿಲ್ಲ');
  if (!line.reading) return bi('Not read yet', 'ಇನ್ನೂ ಓದಿಲ್ಲ');
  if (item && line.reading.unit) {
    try {
      const p = priceFor(item, line.reading.unit, line.qty);
      if (Math.abs(line.rate - p.rate) > p.rate * 0.15) {
        return bi('Price does not fit: billed ', 'ಬೆಲೆ ಹೊಂದುತ್ತಿಲ್ಲ: ಬಿಲ್ ') + formatRupees(line.rate) + bi(', usually ', ', ಸಾಮಾನ್ಯವಾಗಿ ') + formatRupees(p.rate);
      }
    } catch {
      /* unit not on item */
    }
  }
  if (line.reading.confidence < 0.85) return bi('Reader is only ', 'ಓದುವಿಕೆ ಕೇವಲ ') + Math.round(line.reading.confidence * 100) + bi('% sure', '% ಖಚಿತ');
  return bi('Needs a look', 'ಒಮ್ಮೆ ನೋಡಿ');
}

function ConfirmCard({ p, items, onDone }: { p: Pending; items: Map<string, Item>; onDone: (msg: string) => void }) {
  const bi = useBi();
  const { lang } = useSession();
  const r = p.line.reading;
  const first = r?.itemId ?? '';
  const [itemId, setItemId] = useState(first);
  const item = items.get(itemId);
  const [unit, setUnit] = useState(r?.unit ?? item?.units[0]?.code ?? '');
  const [qty, setQty] = useState(String(r?.qty ?? p.line.qty));
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const choices = [r?.itemId, ...(r?.alternatives ?? []).map((a) => a.itemId)].filter((x): x is string => !!x && items.has(x));
  const conf = (id: string) => (id === r?.itemId ? r.confidence : r?.alternatives.find((a) => a.itemId === id)?.confidence ?? 0);
  const found = q.trim() ? [...items.values()].filter((i) => i.active && itemMatches(i, q)).slice(0, 6) : [];

  const pick = (id: string) => {
    setItemId(id);
    const it = items.get(id);
    if (it && !it.units.some((u) => u.code === unit)) setUnit(it.units[0]!.code);
    setQ('');
  };

  const send = async (notItem: boolean) => {
    setBusy(true);
    setError('');
    try {
      const out = await http.post<{ learnt?: string }>('/admin/confirm', notItem ? { billNo: p.billNo, i: p.line.i, notItem: true } : { billNo: p.billNo, i: p.line.i, itemId, unit, qty: Number(qty) });
      onDone(
        notItem
          ? bi('Marked as not stock.', 'ಸ್ಟಾಕ್ ಅಲ್ಲ ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ.')
          : bi('Stock updated for bill ', 'ಬಿಲ್ ') + p.billNo + (out.learnt ? bi('. Learnt the name “', '. ಹೊಸ ಹೆಸರು ಕಲಿತಿದೆ “') + out.learnt + '”' : '.'),
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="card confirm">
      <div className="bar" style={{ justifyContent: 'space-between' }}>
        <span className="muted">
          {bi('Bill', 'ಬಿಲ್')} #{p.billNo} · {bi('line', 'ಸಾಲು')} {p.line.i + 1} · {p.customer || bi('walk-in', 'ಗ್ರಾಹಕ')} · {when(p.at, lang)}
        </span>
        <span className="pill warn">{why(p.line, items.get(first), bi)}</span>
      </div>
      <div className="confirm-ink">
        {p.line.ink ? <InkView ink={p.line.ink} height={64} /> : <span className="typed">{p.line.name}</span>}
        <span className="num confirm-price">
          {p.line.qty} × {formatRupees(p.line.rate)} = <b>{formatRupees(p.line.amount)}</b>
        </span>
      </div>
      {r && (
        <p>
          {bi('Read as', 'ಓದಿದ್ದು')}: <b>“{r.readText}”</b>
        </p>
      )}
      {error && <div className="msg err">{error}</div>}
      {choices.length > 0 && (
        <div className="chips">
          {choices.map((id) => (
            <button key={id} className={'chip ' + (id === itemId ? 'on' : '')} onClick={() => pick(id)}>
              {itemName(items, id, lang)} <span className="muted">{Math.round(conf(id) * 100)}%</span>
            </button>
          ))}
        </div>
      )}
      <div className="bar">
        <input className="grow" placeholder={bi('Or search another item…', 'ಅಥವಾ ಬೇರೆ ಸಾಮಾನು ಹುಡುಕಿ…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <WriteToFind onResult={(r) => r.matches[0] && pick(r.matches[0].itemId)} />
      </div>
      {found.length > 0 && (
        <div className="chips" style={{ marginTop: 6 }}>
          {found.map((i) => (
            <button key={i.id} className="chip" onClick={() => pick(i.id)}>
              {pickName(i.nameEn, i.nameKn, lang)}
            </button>
          ))}
        </div>
      )}
      {item && (
        <div className="bar" style={{ marginTop: 10 }}>
          <b className="grow">{pickName(item.nameEn, item.nameKn, lang)}</b>
          <select value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: 'auto' }}>
            {item.units.map((u) => (
              <option key={u.code} value={u.code}>
                {(lang === 'kn' && u.labelKn) || u.label}
              </option>
            ))}
          </select>
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 90 }} aria-label={bi('Quantity', 'ಪ್ರಮಾಣ')} />
        </div>
      )}
      <div className="bar" style={{ marginTop: 10 }}>
        <button className="btn primary" disabled={busy || !item || !(Number(qty) > 0)} onClick={() => send(false)}>
          ✓ {bi('This is right', 'ಇದು ಸರಿ')}
        </button>
        <button className="btn" disabled={busy} onClick={() => send(true)}>
          {bi('Not stock (service, note)', 'ಸ್ಟಾಕ್ ಅಲ್ಲ (ಸೇವೆ, ಟಿಪ್ಪಣಿ)')}
        </button>
      </div>
    </div>
  );
}
