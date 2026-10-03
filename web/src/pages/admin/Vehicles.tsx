import { useState, type FormEvent } from 'react';
import type { Vehicle } from '@stock/core';
import { http } from '../../lib/api';
import { useLoad, useSession } from '../../lib/session';
import { Empty, Loading, useBi } from '../../components/ui';

/** The shop's vehicles. Transfer, dispatch and delivery forms offer these, and still take any text. */
export function VehiclesPage() {
  const bi = useBi();
  const { t } = useSession();
  const { value, error, reload } = useLoad(() => http.get<Vehicle[]>('/admin/vehicles'));
  const [editing, setEditing] = useState<Vehicle | 'new' | null>(null);

  if (error) return <div className="msg err">{error}</div>;
  if (!value) return <Loading />;
  return (
    <>
      <h1 className="title">{bi('Vehicles', 'ವಾಹನಗಳು')}</h1>
      <div className="bar">
        <button className="btn primary" onClick={() => setEditing('new')}>
          + {bi('New vehicle', 'ಹೊಸ ವಾಹನ')}
        </button>
      </div>
      {editing && (
        <VehicleForm
          vehicle={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
      {value.length === 0 && <Empty>{bi('No vehicles yet.', 'ಇನ್ನೂ ವಾಹನಗಳಿಲ್ಲ.')}</Empty>}
      {value.map((v) => (
        <div className="card clickable" key={v.id} onClick={() => setEditing(v)}>
          <span className="name">{v.number}</span> {v.type && <span className="pill">{v.type}</span>}
          {!v.active && <span className="pill bad"> {t('people.off')}</span>}
          {(v.driverName || v.driverPhone) && <div className="muted">{[v.driverName, v.driverPhone].filter(Boolean).join(' · ')}</div>}
        </div>
      ))}
    </>
  );
}

function VehicleForm({ vehicle, onDone }: { vehicle: Vehicle | null; onDone: () => void }) {
  const bi = useBi();
  const { t } = useSession();
  const [number, setNumber] = useState(vehicle?.number ?? '');
  const [type, setType] = useState(vehicle?.type ?? '');
  const [driverName, setDriverName] = useState(vehicle?.driverName ?? '');
  const [driverPhone, setDriverPhone] = useState(vehicle?.driverPhone ?? '');
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const save = (e: FormEvent | null, active?: boolean) => {
    e?.preventDefault();
    const body = { number, type, driverName, driverPhone, ...(active != null ? { active } : {}) };
    return run(() => (vehicle ? http.put('/admin/vehicles/' + vehicle.id, body) : http.post('/admin/vehicles', body)));
  };

  return (
    <form className="card" onSubmit={(e) => save(e)}>
      {error && <div className="msg err">{error}</div>}
      <div className="grid2">
        <label className="field">
          <span>{bi('Vehicle number', 'ವಾಹನ ಸಂಖ್ಯೆ')}</span>
          <input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="KA-17 AB 1234" />
        </label>
        <label className="field">
          <span>{bi('Type', 'ಬಗೆ')}</span>
          <input value={type} onChange={(e) => setType(e.target.value)} placeholder={bi('Tempo, auto, scooter', 'ಟೆಂಪೋ, ಆಟೋ, ಸ್ಕೂಟರ್')} />
        </label>
        <label className="field">
          <span>{bi('Driver', 'ಚಾಲಕ')}</span>
          <input value={driverName} onChange={(e) => setDriverName(e.target.value)} />
        </label>
        <label className="field">
          <span>{bi('Driver’s phone', 'ಚಾಲಕನ ಫೋನ್')}</span>
          <input inputMode="tel" value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} />
        </label>
      </div>
      <div className="bar">
        <button className="btn primary">{t('common.save')}</button>
        <button type="button" className="btn" onClick={onDone}>
          {t('common.cancel')}
        </button>
        {vehicle && (
          <>
            <button type="button" className="btn" onClick={() => save(null, !vehicle.active)}>
              {vehicle.active ? t('people.switchOff') : t('people.switchOn')}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => confirm(bi('Remove this vehicle? Past trips keep its number.', 'ಈ ವಾಹನ ತೆಗೆಯಬೇಕೆ? ಹಿಂದಿನ ಓಡಾಟಗಳಲ್ಲಿ ಸಂಖ್ಯೆ ಉಳಿಯುತ್ತದೆ.')) && run(() => http.del('/admin/vehicles/' + vehicle.id))}
            >
              {bi('Remove', 'ತೆಗೆಯಿರಿ')}
            </button>
          </>
        )}
      </div>
    </form>
  );
}
