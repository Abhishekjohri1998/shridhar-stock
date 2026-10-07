import { useState, type FormEvent } from 'react';
import { isActiveRole, PEOPLE_ROLES, ROLES, pickName, type MsgKey, type Person, type Role } from '@stock/core';
import { api, http } from '../../lib/api';
import { useLoad, useSession } from '../../lib/session';
import { Select, Table, useBi } from '../../components/ui';

export function PeoplePage() {
  const { t, me } = useSession();
  const { value, error, reload } = useLoad(async () => {
    const [people, locs, suppliers] = await Promise.all([api.people(), api.locations(), http.get<{ id: string; name: string; active: boolean }[]>('/admin/suppliers')]);
    return { people, godowns: locs.filter((l) => l.kind === 'godown'), suppliers: suppliers.filter((s) => s.active) };
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
        <button className="btn primary" data-tour="people-new" onClick={() => setEditing('new')}>
          + {t('people.new')}
        </button>
      </div>
      {editing && (
        <PersonForm
          person={editing === 'new' ? null : editing}
          godowns={value.godowns}
          suppliers={value.suppliers}
          onDone={(m) => {
            setEditing(null);
            setMsg(m ?? '');
            reload();
          }}
        />
      )}
      <div className="scroll" data-tour="people-list">
        <Table className="list">
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
                  {p.linkedId && <div className="muted">{value.godowns.find((g) => g.id === p.linkedId)?.name ?? value.suppliers.find((s) => s.id === p.linkedId)?.name}</div>}
                </td>
                <td>{!p.active && <span className="pill bad">{t('people.off')}</span>}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  );
}

function PersonForm({
  person,
  godowns,
  suppliers,
  onDone,
}: {
  person: Person | null;
  godowns: { id: string; name: string; nameKn: string }[];
  suppliers: { id: string; name: string }[];
  onDone: (msg?: string) => void;
}) {
  const { t, lang } = useSession();
  const bi = useBi();
  const [name, setName] = useState(person?.name ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [role, setRole] = useState<Role>(person?.role ?? 'worker');
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
    run(() => (person ? api.updatePerson(person.id, { name, role }) : api.addPerson({ name, phone, role, pin })));
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
          {/* Admin and Worker, plus an old role for someone who still has it. */}
          <Select
            value={role}
            onChange={setRole}
            aria-label={t('people.role')}
            options={ROLES.filter((r) => (PEOPLE_ROLES as readonly string[]).includes(r) || person?.role === r).map((r) => ({ value: r, label: t(('role.' + r) as MsgKey) }))}
          />
        </label>
        {role === 'vendor' && (
          <p className="muted field">
            {bi('A supplier from before. Suppliers do not sign in any more: they are kept under Purchases.', 'ಹಿಂದಿನ ಸರಬರಾಜುದಾರ. ಸರಬರಾಜುದಾರರು ಈಗ ಒಳಗೆ ಬರುವುದಿಲ್ಲ: ಅವರು ಖರೀದಿಯಲ್ಲಿ ಇದ್ದಾರೆ.')}
            {person?.linkedId && suppliers.find((x) => x.id === person.linkedId) && ' · ' + suppliers.find((x) => x.id === person.linkedId)!.name}
          </p>
        )}
        {role !== 'vendor' && !isActiveRole(role) && (
          <p className="muted field">
            {bi('This login is no longer used, so this person cannot sign in. Choose Admin or Worker to let them in again.', 'ಈ ಲಾಗಿನ್ ಈಗ ಬಳಕೆಯಲ್ಲಿಲ್ಲ, ಹಾಗಾಗಿ ಇವರು ಒಳಗೆ ಬರಲಾಗದು. ಮತ್ತೆ ಒಳಗೆ ಬರಲು ಆಡ್ಮಿನ್ ಅಥವಾ ಕೆಲಸಗಾರ ಆರಿಸಿ.')}
          </p>
        )}
        {role === 'godown' && (
          <p className="muted field">
            {bi('An old godown login: it signs in as a worker. The godown job is the Godown tab of the worker screen now.', 'ಹಳೆಯ ಗೋದಾಮು ಲಾಗಿನ್: ಕೆಲಸಗಾರರಾಗಿ ಒಳಗೆ ಬರುತ್ತಾರೆ. ಗೋದಾಮಿನ ಕೆಲಸ ಈಗ ಕೆಲಸಗಾರರ ಪರದೆಯ ಗೋದಾಮು ಟ್ಯಾಬ್.')}
          </p>
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
