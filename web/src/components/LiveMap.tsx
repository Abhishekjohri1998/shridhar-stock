import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A small map of our own, with no map library: OpenStreetMap's tiles laid on a layer that pans by
 * drag, zooms by wheel, pinch or the ± buttons, and carries markers. Only the tiles in view are
 * asked for, which keeps within OSM's fair use; the credit OSM asks for is always shown.
 *
 * Moving markers (a worker on the way) glide from where they were to where they are now, eased,
 * and draw their trail behind them; a delivery can also carry the road still ahead, dashed.
 *
 * Once a person has moved the map (drag, wheel, pinch, ±), it stays where they put it: the live
 * page re-renders every second and every position, and none of that may pull the view back. Only
 * ⤢, or the caller changing fitKey, fits it again.
 *
 * ◎ (when `locate` is on) asks the device where it is, flies the view there and shows a pulsing
 * dot for "you"; `onLocate` gets the position too (PinPicker uses it to set the pin).
 */
export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapMarker extends LatLng {
  id: string;
  /** An emoji: 🏍, 🚚, 🏪, 📍. */
  icon: string;
  label?: string;
  /** Movers glide between updates; the rest jump. */
  moving?: boolean;
  /** The route so far, oldest first. */
  trail?: LatLng[];
  /** The road still ahead (from the server's router), drawn dashed beneath the trail. */
  route?: LatLng[];
  /** A quieter marker, for something already over. */
  faded?: boolean;
  /** Just arrived (a customer's shared pin): drops in. */
  fresh?: boolean;
}

const TILE = 256;
const MIN_Z = 3;
const MAX_Z = 19;
const GLIDE_MS = 1800;
const TILE_URL = (z: number, x: number, y: number) => 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png';

const clampZ = (z: number) => Math.max(MIN_Z, Math.min(MAX_Z, z));
const worldX = (lng: number, z: number) => ((lng + 180) / 360) * TILE * 2 ** z;
function worldY(lat: number, z: number): number {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
}
const lngOf = (x: number, z: number) => (x / (TILE * 2 ** z)) * 360 - 180;
function latOf(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / (TILE * 2 ** z);
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** How long the fly to "you" takes. */
const FLY_MS = 700;
const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface View extends LatLng {
  z: number;
}

/** The zoom at which all the points fit in a box of this size, with some room. */
function fitView(points: LatLng[], w: number, h: number): View | null {
  if (!points.length || !w || !h) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const c = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 };
  for (let z = 17; z > MIN_Z; z--) {
    const dx = worldX(Math.max(...lngs), z) - worldX(Math.min(...lngs), z);
    const dy = worldY(Math.min(...lats), z) - worldY(Math.max(...lats), z);
    if (dx <= w - 80 && dy <= h - 80) return { ...c, z };
  }
  return { ...c, z: MIN_Z };
}

interface Glide {
  from: LatLng;
  to: LatLng;
  start: number;
}

export function LiveMap({
  markers,
  fit,
  onPick,
  className,
  children,
  fitKey,
  locate,
  onLocate,
  locateLabel = 'Show where I am',
}: {
  markers: MapMarker[];
  /** What to show when the map first opens (and on ⤢). Defaults to every marker. */
  fit?: LatLng[];
  /** A tap (not a drag) on the map, for dropping a pin. */
  onPick?: (p: LatLng) => void;
  className?: string;
  children?: ReactNode;
  /** Change it to fit the view again, e.g. after a search result is picked. */
  fitKey?: string;
  /** Show the ◎ button: centre on the device's own position. */
  locate?: boolean;
  /** Called with the device's position after ◎. */
  onLocate?: (p: LatLng & { accuracy?: number }) => void;
  /** The ◎ button's name, in the reader's language. */
  locateLabel?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [, setFrame] = useState(0);
  const glides = useRef(new Map<string, Glide>());
  const raf = useRef(0);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fitPoints = fit && fit.length ? fit : markers;
  const refit = useCallback(() => {
    // Nothing to show yet: India, until a pin is dropped or searched.
    const v = fitPoints.length ? fitView(fitPoints, size.w, size.h) : size.w ? { lat: 20.6, lng: 78.9, z: 4 } : null;
    if (v) setView(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(fitPoints.map((p) => [p.lat, p.lng])), size.w, size.h]);
  // The first time there is something to show, and whenever the caller asks (a new fitKey) —
  // but never over a view the person has moved themselves.
  const fitted = useRef(false);
  const userMoved = useRef(false);
  const lastFitKey = useRef(fitKey);
  useEffect(() => {
    if (!size.w) return;
    const asked = fitKey !== lastFitKey.current;
    lastFitKey.current = fitKey;
    if (asked) userMoved.current = false;
    if (!view || asked || (!fitted.current && !userMoved.current)) {
      refit();
      if (fitPoints.length) fitted.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w > 0, fitPoints.length > 0, fitKey]);

  // New positions start a glide from wherever the marker is drawn now.
  const now = performance.now();
  const shown = (m: MapMarker): LatLng => {
    const g = glides.current.get(m.id);
    if (!g || !m.moving) return m;
    const t = Math.min(1, (now - g.start) / GLIDE_MS);
    const k = ease(t);
    return { lat: g.from.lat + (g.to.lat - g.from.lat) * k, lng: g.from.lng + (g.to.lng - g.from.lng) * k };
  };
  useEffect(() => {
    let any = false;
    const t = performance.now();
    for (const m of markers) {
      if (!m.moving) continue;
      const g = glides.current.get(m.id);
      if (!g) glides.current.set(m.id, { from: m, to: m, start: t - GLIDE_MS });
      else if (g.to.lat !== m.lat || g.to.lng !== m.lng) {
        const k = ease(Math.min(1, (t - g.start) / GLIDE_MS));
        const from = { lat: g.from.lat + (g.to.lat - g.from.lat) * k, lng: g.from.lng + (g.to.lng - g.from.lng) * k };
        glides.current.set(m.id, { from, to: { lat: m.lat, lng: m.lng }, start: t });
        any = true;
      }
    }
    if (!any) return;
    const step = () => {
      setFrame((f) => f + 1);
      const busy = [...glides.current.values()].some((g) => performance.now() - g.start < GLIDE_MS);
      if (busy) raf.current = requestAnimationFrame(step);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
  }, [markers]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  // ---- moving the map
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(0);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toLatLng = useCallback(
    (x: number, y: number, v: View): LatLng => ({
      lng: lngOf(worldX(v.lng, v.z) + x - size.w / 2, v.z),
      lat: latOf(worldY(v.lat, v.z) + y - size.h / 2, v.z),
    }),
    [size.w, size.h],
  );
  /** Zoom by dz keeping the point under (x, y) where it is. */
  const zoomAt = useCallback(
    (x: number, y: number, dz: number) => {
      userMoved.current = true;
      setView((v) => {
        if (!v) return v;
        const z = clampZ(v.z + dz);
        const p = toLatLng(x, y, v);
        const cx = worldX(p.lng, z) - (x - size.w / 2);
        const cy = worldY(p.lat, z) - (y - size.h / 2);
        return { z, lng: lngOf(cx, z), lat: latOf(cy, z) };
      });
    },
    [toLatLng, size.w, size.h],
  );
  const panBy = (dx: number, dy: number) => {
    userMoved.current = true;
    setView((v) => (v ? { z: v.z, lng: lngOf(worldX(v.lng, v.z) - dx, v.z), lat: latOf(worldY(v.lat, v.z) - dy, v.z) } : v));
  };
  const showAll = () => {
    userMoved.current = false;
    refit();
  };

  // ---- ◎: where am I, with a short fly there
  const [me, setMe] = useState<LatLng | null>(null);
  const [finding, setFinding] = useState(false);
  const fly = useRef(0);
  const flyTo = (to: View) => {
    cancelAnimationFrame(fly.current);
    const from = view;
    if (!from || reducedMotion()) return setView(to);
    const start = performance.now();
    const step = () => {
      const k = ease(Math.min(1, (performance.now() - start) / FLY_MS));
      setView({ lat: from.lat + (to.lat - from.lat) * k, lng: from.lng + (to.lng - from.lng) * k, z: from.z + (to.z - from.z) * k });
      if (k < 1) fly.current = requestAnimationFrame(step);
    };
    fly.current = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(fly.current), []);
  const findMe = () => {
    if (!navigator.geolocation || finding) return;
    setFinding(true);
    navigator.geolocation.getCurrentPosition(
      (g) => {
        setFinding(false);
        const p = { lat: g.coords.latitude, lng: g.coords.longitude };
        setMe(p);
        userMoved.current = true;
        flyTo({ ...p, z: Math.max(view?.z ?? 16, 16) });
        onLocate?.({ ...p, ...(Number.isFinite(g.coords.accuracy) ? { accuracy: Math.round(g.coords.accuracy) } : {}) });
      },
      () => setFinding(false),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
    );
  };

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      zoomAt(p.x, p.y, -e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [zoomAt]);

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A new gesture starts with its primary pointer: forget any finger whose "up" never came
    // (a lost capture, a cancelled touch), or the next one-finger drag would be read as a pinch.
    if (e.isPrimary) pointers.current.clear();
    try {
      box.current?.setPointerCapture?.(e.pointerId);
    } catch {
      /* the pointer is already gone; the drag still works while it is over the map */
    }
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 1) moved.current = 0;
  };
  const move = (e: React.PointerEvent) => {
    const before = pointers.current.get(e.pointerId);
    if (!before) return;
    const p = local(e);
    if (pointers.current.size === 1) {
      moved.current += Math.abs(p.x - before.x) + Math.abs(p.y - before.y);
      panBy(p.x - before.x, p.y - before.y);
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.entries()];
      const other = a![0] === e.pointerId ? b![1] : a![1];
      const d0 = Math.hypot(before.x - other.x, before.y - other.y);
      const d1 = Math.hypot(p.x - other.x, p.y - other.y);
      moved.current += 100;
      if (d0 > 0 && d1 > 0) zoomAt((p.x + other.x) / 2, (p.y + other.y) / 2, Math.log2(d1 / d0));
    }
    pointers.current.set(e.pointerId, p);
  };
  const up = (e: React.PointerEvent) => {
    const was = pointers.current.size;
    pointers.current.delete(e.pointerId);
    if (was === 1 && moved.current < 6 && onPick && view) {
      const p = local(e);
      onPick(toLatLng(p.x, p.y, view));
    }
  };

  // ---- drawing
  const tiles: ReactNode[] = [];
  const pos = (p: LatLng) => {
    if (!view) return { x: -9999, y: -9999 };
    return { x: worldX(p.lng, view.z) - worldX(view.lng, view.z) + size.w / 2, y: worldY(p.lat, view.z) - worldY(view.lat, view.z) + size.h / 2 };
  };
  if (view && size.w) {
    const tz = Math.round(view.z);
    const scale = 2 ** (view.z - tz);
    const cx = worldX(view.lng, tz);
    const cy = worldY(view.lat, tz);
    const n = 2 ** tz;
    const x0 = Math.floor((cx - size.w / 2 / scale) / TILE);
    const x1 = Math.floor((cx + size.w / 2 / scale) / TILE);
    const y0 = Math.max(0, Math.floor((cy - size.h / 2 / scale) / TILE));
    const y1 = Math.min(n - 1, Math.floor((cy + size.h / 2 / scale) / TILE));
    const sz = TILE * scale;
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const wx = ((x % n) + n) % n;
        tiles.push(
          <img
            key={tz + '/' + x + '/' + y}
            className="map-tile"
            src={TILE_URL(tz, wx, y)}
            alt=""
            draggable={false}
            style={{ left: (x * TILE - cx) * scale + size.w / 2, top: (y * TILE - cy) * scale + size.h / 2, width: Math.ceil(sz) + 1, height: Math.ceil(sz) + 1 }}
          />,
        );
      }
  }

  return (
    <div
      ref={box}
      className={'map' + (onPick ? ' map-pick' : '') + (className ? ' ' + className : '')}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={(e) => pointers.current.delete(e.pointerId)}
    >
      <div className="map-tiles">{tiles}</div>
      <svg className="map-trails" width={size.w} height={size.h} aria-hidden>
        {markers.map((m) =>
          m.route && m.route.length > 1 ? (
            <polyline key={'r-' + m.id} className="map-route" points={m.route.map(pos).map((p) => p.x + ',' + p.y).join(' ')} />
          ) : null,
        )}
        {markers.map((m) =>
          m.trail && m.trail.length ? (
            <polyline key={'t-' + m.id} className="map-trail" points={[...m.trail, shown(m)].map(pos).map((p) => p.x + ',' + p.y).join(' ')} />
          ) : null,
        )}
      </svg>
      {me && (
        <div className="map-marker" style={{ transform: 'translate(' + pos(me).x + 'px,' + pos(me).y + 'px)' }} aria-label="You">
          <span className="map-me" />
        </div>
      )}
      {markers.map((m) => {
        const p = pos(shown(m));
        return (
          <div key={m.id} className={'map-marker' + (m.moving ? ' moving' : '') + (m.faded ? ' faded' : '') + (m.fresh ? ' fresh' : '')} style={{ transform: 'translate(' + p.x + 'px,' + p.y + 'px)' }}>
            <span className="map-icon">{m.icon}</span>
            {m.label && <span className="map-label">{m.label}</span>}
          </div>
        );
      })}
      <div className="map-buttons" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => zoomAt(size.w / 2, size.h / 2, 1)}>
          +
        </button>
        <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => zoomAt(size.w / 2, size.h / 2, -1)}>
          −
        </button>
        <button type="button" className="icon-btn" aria-label="Show all" onClick={showAll}>
          ⤢
        </button>
        {locate && (
          <button type="button" className={'icon-btn' + (finding ? ' map-finding' : '')} aria-label={locateLabel} title={locateLabel} onClick={findMe} data-tour="map-locate">
            ◎
          </button>
        )}
      </div>
      {children}
      <div className="map-credit" onPointerDown={(e) => e.stopPropagation()}>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap contributors
        </a>
      </div>
    </div>
  );
}
