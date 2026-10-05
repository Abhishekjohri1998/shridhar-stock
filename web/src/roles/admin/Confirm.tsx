import { useState } from 'react';
import { formatRupees, itemMatches, pickName, priceFor, searchKey, type Item, type MirrorLine } from '@stock/core';
import { http } from '../../lib/api';
import { useLive } from '../../lib/live';
import { itemName, useCatalog } from '../../lib/catalog';
import { useLoad, useSession } from '../../lib/session';
import { Empty, InkView, Loading, useBi, when, Select } from '../../components/ui';
import { WriteToFind } from '../../components/WriteToFind';

interface Pending {
  billNo: number;
  at: string;
  customer: string;
  line: MirrorLine;
}

/** One bill's lines waiting for a person, in bill order. */
interface BillGroup {
  billNo: number;
  at: string;
  customer: string;
  lines: MirrorLine[];
}

/** What the admin has chosen for a line so far: filled in from the reading, changed by a tap. */
interface Answer {
  itemId: string;
  unit: string;
  qty: string;
}

const ready = (a: Answer | undefined, items: Map<string, Item>) => !!a && !!items.get(a.itemId)?.units.some((u) => u.code === a.unit) && Number(a.qty) > 0;

function firstAnswer(line: MirrorLine, items: Map<string, Item>): Answer {
  const r = line.reading;
  const item = r?.itemId ? items.get(r.itemId) : undefined;
  return { itemId: item ? item.id : '', unit: r?.unit ?? item?.units[0]?.code ?? '', qty: String(r?.qty ?? line.qty) };
}

/**
 * Handwritten or unmatched bill lines, grouped under their bill: the writing as it was written,
 * what the reader made of it, and one tap to say it was right, or one tap for the whole bill when
 * every line already has its item, unit and quantity. Every answer is remembered as a name for
 * the item, so the same writing is read on its own next time.
 */
export function ConfirmPage() {
  const bi = useBi();
  const [version, setVersion] = useState(0);
  const { items } = useCatalog(version);
  const live = useLive('bills');
  const { value, error } = useLoad(() => http.get<Pending[]>('/admin/confirm'), [version, live]);
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [newest, setNewest] = useState(false);

  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  const groups: BillGroup[] = [];
  for (const p of value) {
    const g = groups[groups.length - 1];
    if (g && g.billNo === p.billNo) g.lines.push(p.line);
    else groups.push({ billNo: p.billNo, at: p.at, customer: p.customer, lines: [p.line] });
  }
  // "Ningappa", "#75" or "75": a customer, or a bill number.
  const text = q.trim().replace(/^#/, '');
  const shown = groups
    .filter((g) => !text || String(g.billNo) === text || searchKey(g.customer).includes(searchKey(text)) || g.lines.some((l) => searchKey(l.name || l.reading?.readText || '').includes(searchKey(text))))
    .sort((a, b) => (newest ? b.billNo - a.billNo : a.billNo - b.billNo));
  const done = (msg: string) => {
    setNote(msg);
    setVersion((v) => v + 1);
  };
  return (
    <>
      <h1 className="title">{bi('Bill lines to confirm', 'ಖಚಿತಪಡಿಸಬೇಕಾದ ಬಿಲ್ ಸಾಲುಗಳು')}</h1>
      <p className="muted">
        {bi(
          'Lines the reader was not sure about, or typed names that match no item, bill by bill. Your answer moves the stock and teaches the reader.',
          'ಓದುವಿಕೆಗೆ ಖಚಿತವಾಗದ ಸಾಲುಗಳು, ಅಥವಾ ಯಾವ ಸಾಮಾನಿಗೂ ಹೊಂದದ ಹೆಸರುಗಳು, ಬಿಲ್ ಪ್ರಕಾರ. ನಿಮ್ಮ ಉತ್ತರ ಸ್ಟಾಕ್ ಬದಲಿಸುತ್ತದೆ ಮತ್ತು ಓದುವಿಕೆಗೆ ಕಲಿಸುತ್ತದೆ.',
        )}
      </p>
      {groups.length > 0 && (
        <div className="bar">
          <input className="grow" placeholder={bi('Customer or bill number: Ningappa, #75', 'ಗ್ರಾಹಕ ಅಥವಾ ಬಿಲ್ ಸಂಖ್ಯೆ: ನಿಂಗಪ್ಪ, #75')} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="chips">
            <button className={'chip ' + (!newest ? 'on' : '')} onClick={() => setNewest(false)}>
              {bi('Oldest first', 'ಹಳೆಯದು ಮೊದಲು')}
            </button>
            <button className={'chip ' + (newest ? 'on' : '')} onClick={() => setNewest(true)}>
              {bi('Newest first', 'ಹೊಸದು ಮೊದಲು')}
            </button>
          </div>
        </div>
      )}
      {note && <div className="msg ok">{note}</div>}
      {value.length === 0 && <Empty>{bi('All caught up. Nothing to confirm.', 'ಎಲ್ಲಾ ಮುಗಿದಿದೆ. ಖಚಿತಪಡಿಸಲು ಏನೂ ಇಲ್ಲ.')}</Empty>}
      {value.length > 0 && shown.length === 0 && <Empty>{bi('No bill matches.', 'ಯಾವ ಬಿಲ್ಲೂ ಹೊಂದುತ್ತಿಲ್ಲ.')}</Empty>}
      {shown.map((g) => (
        <BillCard key={g.billNo + ':' + g.lines.map((l) => l.i).join()} g={g} items={items} onDone={done} />
      ))}
    </>
  );
}

function BillCard({ g, items, onDone }: { g: BillGroup; items: Map<string, Item>; onDone: (msg: string) => void }) {
  const bi = useBi();
  const { lang } = useSession();
  const [open, setOpen] = useState(true);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [failed, setFailed] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  // Until the catalogue has loaded, a line's answer is worked out from its reading each time.
  const answer = (l: MirrorLine) => answers[l.i] ?? firstAnswer(l, items);
  const filled = g.lines.filter((l) => ready(answer(l), items));
  const blank = g.lines.length - filled.length;

  const confirmAll = async () => {
    setBusy(true);
    setFailed({});
    try {
      const r = await http.post<{ done: { i: number }[]; failed: { i: number; error: string }[] }>('/admin/confirm/bill', {
        billNo: g.billNo,
        lines: filled.map((l) => {
          const a = answer(l);
          return { i: l.i, itemId: a.itemId, unit: a.unit, qty: Number(a.qty) };
        }),
      });
      setFailed(Object.fromEntries(r.failed.map((f) => [f.i, f.error])));
      onDone(
        bi('Bill ', 'ಬಿಲ್ ') +
          '#' +
          g.billNo +
          ': ' +
          r.done.length +
          (r.done.length === 1 ? bi(' line confirmed', ' ಸಾಲು ಖಚಿತವಾಗಿದೆ') : bi(' lines confirmed', ' ಸಾಲುಗಳು ಖಚಿತವಾಗಿವೆ')) +
          (blank ? ' · ' + blank + bi(' still need you', ' ಇನ್ನೂ ನಿಮ್ಮ ಗಮನ ಬೇಕು') : '') +
          (r.failed.length ? ' · ' + r.failed.length + bi(' could not be done', ' ಆಗಲಿಲ್ಲ') : ''),
      );
    } catch (e) {
      onDone((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card bill-group">
      <div className="bar between mb-0">
        <button type="button" className="bill-head" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="name">
            {bi('Bill', 'ಬಿಲ್')} #{g.billNo} · {g.customer || bi('walk-in', 'ಗ್ರಾಹಕ')}
          </span>
          <span className="muted">
            {' '}
            · {when(g.at, lang)} · {g.lines.length} {g.lines.length === 1 ? bi('line to confirm', 'ಸಾಲು ಖಚಿತಪಡಿಸಬೇಕು') : bi('lines to confirm', 'ಸಾಲುಗಳು ಖಚಿತಪಡಿಸಬೇಕು')}
          </span>
        </button>
        <button className="btn primary" disabled={busy || filled.length === 0} onClick={confirmAll}>
          ✓ {bi('Confirm all on this bill', 'ಈ ಬಿಲ್‌ನ ಎಲ್ಲಾ ಖಚಿತಪಡಿಸಿ')}
          {blank > 0 && filled.length > 0 && ' (' + filled.length + ')'}
        </button>
      </div>
      {blank > 0 && open && (
        <p className="muted mt-6 mb-0">
          {blank} {bi('marked lines still need an item, unit or quantity, and are left for you.', 'ಗುರುತಿಸಿದ ಸಾಲುಗಳಿಗೆ ಇನ್ನೂ ಸಾಮಾನು, ಘಟಕ ಅಥವಾ ಪ್ರಮಾಣ ಬೇಕು.')}
        </p>
      )}
      {open &&
        g.lines.map((l) => (
          <ConfirmLine
            key={l.i}
            billNo={g.billNo}
            line={l}
            items={items}
            answer={answer(l)}
            blank={!ready(answer(l), items)}
            failed={failed[l.i]}
            onAnswer={(a) => setAnswers((x) => ({ ...x, [l.i]: a }))}
            onDone={onDone}
          />
        ))}
    </div>
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

function ConfirmLine({
  billNo,
  line,
  items,
  answer,
  blank,
  failed,
  onAnswer,
  onDone,
}: {
  billNo: number;
  line: MirrorLine;
  items: Map<string, Item>;
  answer: Answer;
  blank: boolean;
  failed?: string;
  onAnswer: (a: Answer) => void;
  onDone: (msg: string) => void;
}) {
  const bi = useBi();
  const { lang } = useSession();
  const r = line.reading;
  const item = items.get(answer.itemId);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const choices = [r?.itemId, ...(r?.alternatives ?? []).map((a) => a.itemId)].filter((x): x is string => !!x && items.has(x));
  const conf = (id: string) => (id === r?.itemId ? r.confidence : r?.alternatives.find((a) => a.itemId === id)?.confidence ?? 0);
  const found = q.trim() ? [...items.values()].filter((i) => i.active && itemMatches(i, q)).slice(0, 6) : [];

  const pick = (id: string) => {
    const it = items.get(id);
    onAnswer({ ...answer, itemId: id, unit: it && !it.units.some((u) => u.code === answer.unit) ? it.units[0]!.code : answer.unit });
    setQ('');
  };

  const send = async (notItem: boolean) => {
    setBusy(true);
    setError('');
    try {
      const out = await http.post<{ learnt?: string }>(
        '/admin/confirm',
        notItem ? { billNo, i: line.i, notItem: true } : { billNo, i: line.i, itemId: answer.itemId, unit: answer.unit, qty: Number(answer.qty) },
      );
      onDone(
        notItem
          ? bi('Marked as not stock.', 'ಸ್ಟಾಕ್ ಅಲ್ಲ ಎಂದು ಗುರುತಿಸಲಾಗಿದೆ.')
          : bi('Stock updated for bill ', 'ಬಿಲ್ ') + billNo + (out.learnt ? bi('. Learnt the name “', '. ಹೊಸ ಹೆಸರು ಕಲಿತಿದೆ “') + out.learnt + '”' : '.'),
      );
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className={'confirm-line' + (blank ? ' blank' : '')}>
      <div className="bar between">
        <span className="muted">
          {bi('line', 'ಸಾಲು')} {line.i + 1}
        </span>
        <span className="pill warn">{blank ? bi('Needs you', 'ನಿಮ್ಮ ಗಮನ ಬೇಕು') : why(line, items.get(r?.itemId ?? ''), bi)}</span>
      </div>
      <div className="confirm-ink">
        {line.ink ? <InkView ink={line.ink} height={64} /> : <span className="typed">{line.name}</span>}
        <span className="num confirm-price">
          {line.qty} × {formatRupees(line.rate)} = <b>{formatRupees(line.amount)}</b>
        </span>
      </div>
      {r && (
        <p>
          {bi('Read as', 'ಓದಿದ್ದು')}: <b>“{r.readText}”</b>
        </p>
      )}
      {(error || failed) && <div className="msg err">{error || failed}</div>}
      {choices.length > 0 && (
        <div className="chips">
          {choices.map((id) => (
            <button key={id} className={'chip ' + (id === answer.itemId ? 'on' : '')} onClick={() => pick(id)}>
              {itemName(items, id, lang)} <span className="muted">{Math.round(conf(id) * 100)}%</span>
            </button>
          ))}
        </div>
      )}
      <div className="bar">
        <input className="grow" placeholder={bi('Or search another item…', 'ಅಥವಾ ಬೇರೆ ಸಾಮಾನು ಹುಡುಕಿ…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <WriteToFind onResult={(w) => w.matches[0] && pick(w.matches[0].itemId)} />
      </div>
      {found.length > 0 && (
        <div className="chips mt-6">
          {found.map((i) => (
            <button key={i.id} className="chip" onClick={() => pick(i.id)}>
              {pickName(i.nameEn, i.nameKn, lang)}
            </button>
          ))}
        </div>
      )}
      {item && (
        <div className="bar mt-10">
          <b className="grow">{pickName(item.nameEn, item.nameKn, lang)}</b>
          <Select
            value={answer.unit}
            onChange={(unit) => onAnswer({ ...answer, unit })}
            className="w-auto"
            aria-label={bi('Unit', 'ಘಟಕ')}
            options={item.units.map((u) => ({ value: u.code, label: (lang === 'kn' && u.labelKn) || u.label }))}
          />
          <input inputMode="decimal" value={answer.qty} onChange={(e) => onAnswer({ ...answer, qty: e.target.value })} className="in-qty" aria-label={bi('Quantity', 'ಪ್ರಮಾಣ')} />
        </div>
      )}
      <div className="bar mt-10">
        <button className="btn" disabled={busy || blank} onClick={() => send(false)}>
          ✓ {bi('This line is right', 'ಈ ಸಾಲು ಸರಿ')}
        </button>
        <button className="btn" disabled={busy} onClick={() => send(true)}>
          {bi('Not stock (service, note)', 'ಸ್ಟಾಕ್ ಅಲ್ಲ (ಸೇವೆ, ಟಿಪ್ಪಣಿ)')}
        </button>
      </div>
    </div>
  );
}
