import { useState } from 'react';
import { http } from '../lib/api';
import { useBi } from './ui';
import { LiveMap, type LatLng } from './LiveMap';

/**
 * A pin on the map for a home (or the shop): search an address (OpenStreetMap's Nominatim, asked
 * through our server), pick a result, then tap the map to put the pin exactly on the door.
 */
export function PinPicker({ value, onChange, search, near, icon = '📍' }: { value: LatLng | null; onChange: (p: LatLng) => void; search?: string; near?: LatLng | null; icon?: string }) {
  const bi = useBi();
  const [q, setQ] = useState(search ?? '');
  const [found, setFound] = useState<{ name: string; lat: number; lng: number }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [fitKey, setFitKey] = useState('start');
  const find = async () => {
    setErr('');
    setBusy(true);
    try {
      const r = await http.get<{ name: string; lat: number; lng: number }[]>('/admin/geocode?q=' + encodeURIComponent(q));
      setFound(r);
      if (r.length === 1) pick(r[0]!);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  const pick = (p: LatLng) => {
    onChange({ lat: p.lat, lng: p.lng });
    setFound(null);
    setFitKey(p.lat + ',' + p.lng);
  };
  const fit = value ? [value] : near ? [near] : [];
  return (
    <div className="pin-picker" data-tour="delivery-pin">
      <div className="bar">
        <input
          className="grow"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void find();
            }
          }}
          placeholder={bi('Search the address or area', 'ವಿಳಾಸ ಅಥವಾ ಪ್ರದೇಶ ಹುಡುಕಿ')}
        />
        <button type="button" className="btn" disabled={busy || q.trim().length < 3} onClick={find}>
          {bi('Find', 'ಹುಡುಕಿ')}
        </button>
      </div>
      {err && <div className="msg err">{err}</div>}
      {found && found.length === 0 && <div className="muted mb-10">{bi('Nothing found. Move the map and tap the home.', 'ಏನೂ ಸಿಗಲಿಲ್ಲ. ನಕ್ಷೆ ಸರಿಸಿ ಮನೆಯ ಮೇಲೆ ಒತ್ತಿ.')}</div>}
      {found && found.length > 1 && (
        <div className="pin-results">
          {found.map((f, i) => (
            <button type="button" key={i} className="pin-result" onClick={() => pick(f)}>
              {f.name}
            </button>
          ))}
        </div>
      )}
      <LiveMap
        className="map-small"
        markers={value ? [{ id: 'pin', ...value, icon }] : []}
        fit={fit}
        fitKey={fitKey}
        onPick={(p) => onChange(p)}
        locate
        locateLabel={bi('Use my location', 'ನನ್ನ ಸ್ಥಳ ಬಳಸಿ')}
        onLocate={(p) => onChange({ lat: p.lat, lng: p.lng })}
      />
      <p className="muted">{value ? bi('Pin placed. Tap the map to move it.', 'ಪಿನ್ ಇಟ್ಟಾಯಿತು. ಸರಿಸಲು ನಕ್ಷೆಯ ಮೇಲೆ ಒತ್ತಿ.') : bi('Tap the map on the home to drop the pin.', 'ಮನೆಯ ಮೇಲೆ ನಕ್ಷೆ ಒತ್ತಿ ಪಿನ್ ಇಡಿ.')}</p>
    </div>
  );
}
