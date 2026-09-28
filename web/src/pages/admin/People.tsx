import { useState, type FormEvent } from 'react';
import { ROLES, pickName, type MsgKey, type Person, type Role } from '@stock/core';
import { api } from '../../lib/api';
import { useLoad, useSession } from '../../lib/session';

export function PeoplePage() {
  const { t, me } = useSession();
  const { value, error, reload } = useLoad(async () => {
    const [people, locs] = await Promise.all([api.people(), api.locations()]);
    return { people, godowns: locs.filter((l) => l.kind === 'godown') };
  });
  const [editing, setEditing] = useState<Person | 'new' | null>(null);
  const [msg, setMsg] = useState('');

  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <p className="muted">{t('common.loading')}</p>;

  return (
    <>
      <h1 className="title">{t('people.title')}</h1>
      {msg && <div className="msg ok">{msg}</div>}
      <div className="bar">
        <button className="btn primary" onClick={() => setEditing('new')}>
          + {t('people.new')}
        </button>
      </div>
      {editing && (
        <PersonForm
          person={editing === 'new' ? null : editing}
          godowns={value.godowns}
          onDone={(m) => {
            setEditing(null);
            setMsg(m ?? '');
            reload();
          }}
        />
      )}
      <div className="scroll">
        <table className="list">
          <tbody>
            {value.people.map((p) => (
              <tr key={p.id} className="link" onClick={() => setEditing(p)}>
                <td>
                  <div className="name">
                    {p.name} {p.id === me?.id && <span className="pill">{t('people.you')}</span>}
                  </div>
                  <div className="muted">{p.phone}</div>
                </td>
                <td>
                  {t(('role.' + p.role) as MsgKey)}
                  {p.linkedId && <div className="muted">{value.godowns.find((g) => g.id === p.linkedId)?.name}</div>}
                </td>
                <td>{!p.active && <span className="pill bad">{t('people.off')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PersonForm({
  person,
  godowns,
  onDone,
}: {
  person: Person | null;
  godowns: { id: string; name: string; nameKn: string }[];
  onDone: (msg?: string) => void;
}) {
  const { t, lang } = useSession();
  const [name, setName] = useState(person?.name ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [role, setRole] = useState<Role>(person?.role ?? 'worker');
  const [linkedId, setLinkedId] = useState(person?.linkedId ?? godowns[0]?.id ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    setError('');
    try {
      await fn();
      onDone(msg);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const link = role === 'godown' ? { linkedId } : {};
    run(() =>
      person ? api.updatePerson(person.id, { name, role, ...link }) : api.addPerson({ name, phone, role, pin, ...link }),
    );
  };

  return (
    <form className="card" onSubmit={save}>
      {error && <div className="msg err">{error}</div>}
      <div className="grid2">
        <label className="field">
          <span>{t('people.name')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('people.phone')}</span>
          <input inputMode="tel" value={phone} disabled={!!person} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field">
          <span>{t('people.role')}</span>
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(('role.' + r) as MsgKey)}
              </option>
            ))}
          </select>
        </label>
        {role === 'godown' && (
          <label className="field">
            <span>{t('people.link')}</span>
            <select value={linkedId} onChange={(e) => setLinkedId(e.target.value)}>
              {godowns.map((g) => (
                <option key={g.id} value={g.id}>
                  {pickName(g.name, g.nameKn, lang)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>{person ? t('people.resetPin') : t('people.pin')}</span>
          <input inputMode="numeric" value={pin} maxLength={6} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        </label>
      </div>
      <div className="bar">
        <button className="btn primary">{t('common.save')}</button>
        {person && (
          <button type="button" className="btn" disabled={pin.length < 4} onClick={() => run(() => api.resetPin(person.id, pin), t('common.saved'))}>
            {t('people.resetPin')}
          </button>
        )}
        {person && (
          <button
            type="button"
            className={person.active ? 'btn danger' : 'btn'}
            onClick={() => run(() => api.updatePerson(person.id, { active: !person.active }))}
          >
            {person.active ? t('people.switchOff') : t('people.switchOn')}
          </button>
        )}
        <button type="button" className="btn" onClick={() => onDone()}>
          {t('common.cancel')}
        </button>
      </div>
    </form>
  );
}
