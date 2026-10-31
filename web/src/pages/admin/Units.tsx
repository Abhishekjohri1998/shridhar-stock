import { useState } from 'react';
import { Link } from 'react-router-dom';
import { pickName } from '@stock/core';
import { http } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { Empty, Loading, useBi } from '../../components/ui';

/** One unit code as the items use it (GET /admin/units). */
interface UnitUse {
  code: string;
  label: string;
  labelKn: string;
  count: number;
  items: { id: string; nameEn: string; nameKn: string; perBase: number; base: string; active: boolean }[];
  otherLabels: string[];
}

/**
 * Setup → Units: every unit the items use, in one place, with how big it is in each item
 * ("Box = 60 pc in Wheel"). Edit renames it on every item at once.
 */
export function UnitsPage() {
  const bi = useBi();
  const live = useLive('items');
  const [version, setVersion] = useState(0);
  const { value, error } = useLoad(() => http.get<UnitUse[]>('/admin/units'), [version, live]);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState('');
  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  return (
    <>
      <h1 className="title">{bi('Units', 'ಘಟಕಗಳು')}</h1>
      <p className="muted">{bi('Every unit your items use. Tap one to see its size in each item, or edit its name for all items at once.', 'ನಿಮ್ಮ ಸಾಮಾನುಗಳು ಬಳಸುವ ಎಲ್ಲಾ ಘಟಕಗಳು. ಪ್ರತಿ ಸಾಮಾನಿನಲ್ಲಿ ಗಾತ್ರ ನೋಡಲು ಒತ್ತಿ, ಅಥವಾ ಎಲ್ಲಾ ಸಾಮಾನಿಗೂ ಹೆಸರು ಬದಲಿಸಿ.')}</p>
      {note && <div className="msg ok">{note}</div>}
      {value.length === 0 && <Empty>{bi('No items yet.', 'ಇನ್ನೂ ಸಾಮಾನುಗಳಿಲ್ಲ.')}</Empty>}
      {value.map((u) => (
        <div className="card" key={u.code} data-unit={u.code}>
          <div className="bar clickable" onClick={() => setOpen(open === u.code ? null : u.code)}>
            <span className="grow">
              <span className="name">{u.label || u.code}</span> {u.labelKn && <span>· {u.labelKn}</span>} <span className="muted">· {u.code}</span>
            </span>
            <span className="pill">
              {u.count} {bi('items', 'ಸಾಮಾನು')}
            </span>
            <button
              className="btn small"
              onClick={(e) => {
                e.stopPropagation();
                setNote('');
                setEditing(editing === u.code ? null : u.code);
              }}
            >
              {bi('Edit', 'ಬದಲಿಸಿ')}
            </button>
          </div>
          {u.otherLabels.length > 0 && <div className="muted">{bi('Also named: ', 'ಬೇರೆ ಹೆಸರು: ') + u.otherLabels.join(', ')}</div>}
          {editing === u.code && (
            <UnitForm
              u={u}
              onDone={(msg) => {
                setEditing(null);
                if (msg) setNote(msg);
                setVersion((v) => v + 1);
              }}
            />
          )}
          {open === u.code && <UnitItems u={u} />}
        </div>
      ))}
    </>
  );
}

function UnitItems({ u }: { u: UnitUse }) {
  const bi = useBi();
  const { lang } = useSession();
  return (
    <div className="mt-6">
      {u.items.map((i) => (
        <div className="bar mt-6" key={i.id}>
          <Link className="grow name" to={'/admin/inventory/' + i.id}>
            {pickName(i.nameEn, i.nameKn, lang)}
          </Link>
          {!i.active && <span className="pill bad">{bi('Off', 'ಆಫ್')}</span>}
          <span className="muted">{i.perBase === 1 ? bi('base unit', 'ಮೂಲ ಘಟಕ') : '1 ' + (u.label || u.code) + ' = ' + i.perBase + ' ' + i.base}</span>
        </div>
      ))}
    </div>
  );
}

function UnitForm({ u, onDone }: { u: UnitUse; onDone: (msg?: string) => void }) {
  const bi = useBi();
  const [label, setLabel] = useState(u.label);
  const [labelKn, setLabelKn] = useState(u.labelKn);
  const [code, setCode] = useState(u.code);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setErr('');
    const codeChanged = code.trim() !== u.code;
    if (codeChanged && !window.confirm(bi('Change the code "' + u.code + '" to "' + code.trim() + '" on all ' + u.count + ' items and their orders?', '"' + u.code + '" ಕೋಡ್ ಅನ್ನು ಎಲ್ಲಾ ' + u.count + ' ಸಾಮಾನು ಮತ್ತು ಆರ್ಡರ್‌ಗಳಲ್ಲಿ "' + code.trim() + '" ಆಗಿ ಬದಲಿಸಬೇಕೆ?'))) return;
    setBusy(true);
    try {
      const r = await http.put<{ items: number }>('/admin/units/' + encodeURIComponent(u.code), { label, labelKn, ...(codeChanged ? { code, confirm: true } : {}) });
      onDone(bi('Unit changed on ' + r.items + ' items.', r.items + ' ಸಾಮಾನುಗಳಲ್ಲಿ ಘಟಕ ಬದಲಿಸಲಾಗಿದೆ.'));
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="mt-6">
      {err && <div className="msg err">{err}</div>}
      <div className="grid2">
        <label className="field">
          <span>{bi('Name', 'ಹೆಸರು')}</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <label className="field">
          <span>{bi('Name in Kannada', 'ಕನ್ನಡದಲ್ಲಿ ಹೆಸರು')}</span>
          <input value={labelKn} onChange={(e) => setLabelKn(e.target.value)} />
        </label>
        <label className="field">
          <span>{bi('Code (changes every item)', 'ಕೋಡ್ (ಎಲ್ಲಾ ಸಾಮಾನಿನಲ್ಲಿ ಬದಲಾಗುತ್ತದೆ)')}</span>
          <input value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
      </div>
      <div className="bar mt-6">
        <button className="btn primary" disabled={busy || !label.trim() || !code.trim()} onClick={save}>
          {bi('Save for all items', 'ಎಲ್ಲಾ ಸಾಮಾನಿಗೂ ಉಳಿಸಿ')}
        </button>
        <button className="btn" onClick={() => onDone()}>
          {bi('Cancel', 'ರದ್ದು')}
        </button>
      </div>
    </div>
  );
}
