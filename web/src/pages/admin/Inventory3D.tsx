import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { describeQty, layoutFor, pickName, rackContents, rackStatus, type Location, type PlaceLayout, type RackBox, type RackLine, type RackStatus } from '@stock/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { api } from '../../lib/api';
import { useLive } from '../../lib/live';
import { useLoad, useSession } from '../../lib/session';
import { Loading, useBi } from '../../components/ui';

/*
 * Inventory → 3D view. Loaded only when opened (App.tsx lazy-loads this file), so three.js stays
 * out of the main bundle. Each place's racks stand as shelving units, coloured by how their items
 * stand; tap one to fly to it and list what is on it. Without WebGL a flat plan is drawn instead.
 */

const reduced = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** The app's own tokens, read from the stylesheet, so the scene uses no colour of its own. */
function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
  return {
    paper0: v('--paper-0', '#f5f1e8'),
    paper1: v('--paper-1', '#fffdf8'),
    paper2: v('--paper-2', '#efe9dc'),
    line: v('--line-strong', '#d6cdbb'),
    ink: v('--ink-900', '#1f1e1b'),
    brand: v('--brand-600', '#c96442'),
    ok: v('--ok-700', '#3f6b45'),
    gold: v('--gold-600', '#9a6a14'),
    danger: v('--danger-600', '#b03a26'),
    grey: v('--ink-400', '#8f8a80'),
  };
}
type Tokens = ReturnType<typeof tokens>;
const statusColour = (t: Tokens, s: RackStatus) => (s === 'ok' ? t.ok : s === 'getting-low' ? t.gold : s === 'low' ? t.danger : t.grey);

const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

interface Placed {
  box: RackBox;
  status: RackStatus;
}

/** A text label as a flat sprite, drawn on a canvas. */
function label(text: string, t: Tokens) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = t.paper1;
  g.globalAlpha = 0.92;
  const r = 40;
  g.beginPath();
  g.roundRect(8, 16, 496, 96, r);
  g.fill();
  g.globalAlpha = 1;
  g.fillStyle = t.ink;
  g.font = '600 52px Georgia, serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text.length > 16 ? text.slice(0, 15) + '…' : text, 256, 66);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  s.scale.set(1.6, 0.4, 1);
  return s;
}

/** One shelving unit: two sides, four shelves, a coloured status strip on top. */
function shelving(p: Placed, t: Tokens) {
  const { w, d, h } = p.box;
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: t.paper2, roughness: 0.85 });
  const tint = new THREE.MeshStandardMaterial({ color: statusColour(t, p.status), roughness: 0.6 });
  const side = new THREE.BoxGeometry(0.06, h, d);
  for (const sx of [-w / 2 + 0.03, w / 2 - 0.03]) {
    const m = new THREE.Mesh(side, wood);
    m.position.set(sx, h / 2, 0);
    m.castShadow = true;
    g.add(m);
  }
  const shelf = new THREE.BoxGeometry(w, 0.05, d);
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(shelf, i === 3 ? tint : wood);
    m.position.set(0, 0.1 + (i * (h - 0.15)) / 3, 0);
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
  }
  // Boxes on the shelves, in the status colour, so a rack reads at a glance from far away.
  const crate = new THREE.BoxGeometry(w / 5, (h - 0.3) / 3 - 0.12, d * 0.7);
  if (p.status !== 'empty') {
    const fill = p.status === 'low' ? 1 : p.status === 'getting-low' ? 2 : 4;
    for (let i = 0; i < 3; i++)
      for (let k = 0; k < fill; k++) {
        const m = new THREE.Mesh(crate, tint);
        m.position.set(-w / 2 + w / 8 + k * (w / 4.4), 0.125 + (i * (h - 0.15)) / 3 + ((h - 0.3) / 3 - 0.12) / 2, 0);
        m.castShadow = true;
        g.add(m);
      }
  }
  // An invisible box to tap.
  const hit = new THREE.Mesh(new THREE.BoxGeometry(w, h, d + 0.2), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = h / 2;
  hit.userData.rack = p.box.name;
  g.add(hit);
  const l = label(p.box.name, t);
  l.position.set(0, h + 0.35, 0);
  g.add(l);
  g.position.set(p.box.x, 0, p.box.z);
  g.rotation.y = (p.box.rot * Math.PI) / 180;
  g.userData.hit = hit;
  return g;
}

interface Scene {
  show: (racks: Placed[], first: boolean) => void;
  focus: (name: string | null) => void;
  dispose: () => void;
}

function makeScene(host: HTMLDivElement, onPick: (name: string | null) => void): Scene {
  const t = tokens();
  const still = reduced();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(t.paper0);
  scene.fog = new THREE.Fog(t.paper0, 30, 70);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  camera.position.set(8, 9, 12);

  scene.add(new THREE.HemisphereLight(0xffffff, t.paper2, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(6, 12, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.radius = 6;
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20 });
  scene.add(sun);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: t.paper1, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(60, 60, t.line, t.line);
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = !still;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.15;
  controls.minDistance = 2;
  controls.maxDistance = 45;
  controls.enablePan = true;

  let group = new THREE.Group();
  scene.add(group);
  let units: { g: any; born: number; delay: number }[] = [];
  let fly: { from: any; to: any; fromT: any; toT: any; start: number; dur: number } | null = null;
  let overview = { pos: new THREE.Vector3(8, 9, 12), target: new THREE.Vector3() };

  const flyTo = (pos: any, target: any) => {
    if (still) {
      camera.position.copy(pos);
      controls.target.copy(target);
      controls.update();
      return;
    }
    fly = { from: camera.position.clone(), to: pos, fromT: controls.target.clone(), toT: target, start: performance.now(), dur: 900 };
  };

  const show = (racks: Placed[], first: boolean) => {
    scene.remove(group);
    group.traverse((o: any) => {
      o.geometry?.dispose?.();
      o.material?.map?.dispose?.();
      o.material?.dispose?.();
    });
    group = new THREE.Group();
    scene.add(group);
    const now = performance.now();
    units = racks.map((p, i) => {
      const g = shelving(p, t);
      if (!still) g.scale.y = 0.001;
      group.add(g);
      return { g, born: now, delay: i * 60 };
    });
    const box = new THREE.Box3();
    for (const u of units) box.expandByObject(u.g);
    const c = racks.length ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
    const size = racks.length ? box.getSize(new THREE.Vector3()) : new THREE.Vector3(6, 2, 6);
    const r = Math.max(5, Math.max(size.x, size.z) * 0.9 + 3) * Math.max(1, 0.9 / camera.aspect);
    c.y = 0.8;
    overview = { pos: new THREE.Vector3(c.x + r * 0.55, r * 0.75, c.z + r), target: c };
    if (first || still) {
      camera.position.copy(overview.pos);
      controls.target.copy(overview.target);
      controls.update();
    } else flyTo(overview.pos.clone(), overview.target.clone());
  };

  const focus = (name: string | null) => {
    if (!name) return flyTo(overview.pos.clone(), overview.target.clone());
    const u = units.find((x) => x.g.userData.hit.userData.rack === name);
    if (!u) return;
    const target = new THREE.Vector3(u.g.position.x, 1, u.g.position.z);
    const facing = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), u.g.rotation.y);
    flyTo(target.clone().add(facing.multiplyScalar(6.5)).add(new THREE.Vector3(0, 2.6, 0)), target);
  };

  // A tap, not a drag, picks the rack under it.
  const ray = new THREE.Raycaster();
  let down: { x: number; y: number } | null = null;
  const el = renderer.domElement;
  const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
  const onUp = (e: PointerEvent) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    down = null;
    const r = el.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hits = ray.intersectObjects(units.map((u) => u.g.userData.hit));
    onPick(hits[0]?.object.userData.rack ?? null);
  };
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);

  const resize = () => {
    const w = host.clientWidth;
    const h = host.clientHeight;
    renderer.setSize(w, h, false);
    el.style.width = w + 'px';
    el.style.height = h + 'px';
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let raf = 0;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    const now = performance.now();
    for (const u of units) {
      if (u.g.scale.y >= 1) continue;
      const k = Math.min(1, Math.max(0, (now - u.born - u.delay) / 700));
      u.g.scale.y = Math.max(0.001, ease(k));
    }
    if (fly) {
      const k = Math.min(1, (now - fly.start) / fly.dur);
      const e = ease(k);
      camera.position.lerpVectors(fly.from, fly.to, e);
      controls.target.lerpVectors(fly.fromT, fly.toT, e);
      if (k >= 1) fly = null;
    }
    controls.update();
    renderer.render(scene, camera);
  };
  tick();

  return {
    show,
    focus,
    dispose: () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      controls.dispose();
      scene.traverse((o: any) => {
        o.geometry?.dispose?.();
        o.material?.map?.dispose?.();
        o.material?.dispose?.();
      });
      renderer.dispose();
      el.remove();
    },
  };
}

/** The flat plan, for devices without WebGL: the same racks, seen from above. */
function FlatPlan({ racks, picked, onPick }: { racks: Placed[]; picked: string | null; onPick: (n: string) => void }) {
  const t = useMemo(tokens, []);
  if (!racks.length) return null;
  const pad = 1;
  const xs = racks.flatMap((p) => [p.box.x - p.box.w / 2, p.box.x + p.box.w / 2]);
  const zs = racks.flatMap((p) => [p.box.z - p.box.d / 2, p.box.z + p.box.d / 2]);
  const minX = Math.min(...xs) - pad;
  const minZ = Math.min(...zs) - pad - 0.6;
  const w = Math.max(...xs) + pad - minX;
  const h = Math.max(...zs) + pad - minZ;
  return (
    <svg className="plan3d-flat" viewBox={`${minX} ${minZ} ${w} ${h}`} role="img">
      {racks.map((p) => (
        <g key={p.box.name} transform={`translate(${p.box.x} ${p.box.z}) rotate(${p.box.rot})`} onClick={() => onPick(p.box.name)} style={{ cursor: 'pointer' }}>
          <rect x={-p.box.w / 2} y={-p.box.d / 2} width={p.box.w} height={p.box.d} rx={0.08} fill={statusColour(t, p.status)} stroke={picked === p.box.name ? t.ink : 'none'} strokeWidth={0.06} />
          <text y={-p.box.d / 2 - 0.15} textAnchor="middle" fontSize={0.35} fill={t.ink}>
            {p.box.name}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function Inventory3DPage() {
  const { lang } = useSession();
  const bi = useBi();
  const live = useLive('stock', 'items');
  const { value, error } = useLoad(async () => {
    const [items, stock, locs] = await Promise.all([api.items(true), api.stock(), api.locations()]);
    return { items, stock, locs: locs.filter((l) => l.active) };
  }, [live]);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [gl] = useState(hasWebGL);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const shown = useRef<string | null>(null);

  const place: Location | undefined = value?.locs.find((l) => l.id === placeId) ?? value?.locs[0];
  const view = useMemo(() => {
    if (!value || !place) return null;
    const contents = rackContents(value.items, value.stock, place.id);
    const stocked = new Set(value.stock.filter((s) => s.locationId === place.id && s.qty > 0).map((s) => s.itemId));
    const layout: PlaceLayout = layoutFor(place, value.items, stocked);
    const racks: Placed[] = layout.racks.map((box) => ({ box, status: rackStatus(contents.get(box.name.toLowerCase()) ?? []) }));
    return { racks, contents };
  }, [value, place]);

  useEffect(() => {
    if (!gl || !host.current) return;
    const s = makeScene(host.current, setPicked);
    scene.current = s;
    return () => {
      s.dispose();
      scene.current = null;
      shown.current = null;
    };
  }, [gl, !!view]);

  useEffect(() => {
    if (!view || !place || !scene.current) return;
    const first = shown.current === null;
    const moved = shown.current !== place.id;
    shown.current = place.id;
    scene.current.show(view.racks, first);
    if (!moved && picked) scene.current.focus(picked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    scene.current?.focus(picked);
  }, [picked]);

  if (error) return <div className="msg err">{error}</div>;
  if (!value || !view || !place) return <Loading />;

  const lines: RackLine[] = picked ? (view.contents.get(picked.toLowerCase()) ?? []) : [];
  const word = (s: RackStatus) =>
    s === 'ok' ? bi('Fine', 'ಸರಿ') : s === 'getting-low' ? bi('Getting low', 'ಕಡಿಮೆಯಾಗುತ್ತಿದೆ') : s === 'low' ? bi('Running out', 'ಮುಗಿಯುತ್ತಿದೆ') : bi('Empty', 'ಖಾಲಿ');
  const placeName = (l: Location) => (lang === 'kn' && l.nameKn) || l.name;

  return (
    <>
      <h1 className="title">{bi('3D view', '3D ನೋಟ')}</h1>
      <div className="chips" data-tour="inventory-3d-places">
        {value.locs.map((l) => (
          <button
            type="button"
            key={l.id}
            className={'chip ' + (l.id === place.id ? 'on' : '')}
            onClick={() => {
              setPicked(null);
              setPlaceId(l.id);
            }}
          >
            {placeName(l)}
          </button>
        ))}
      </div>
      <div className="plan3d-legend">
        {(['ok', 'getting-low', 'low', 'empty'] as RackStatus[]).map((s) => (
          <span key={s} className={'plan3d-key ' + s}>
            {word(s)}
          </span>
        ))}
      </div>
      <div className="plan3d" data-tour="inventory-3d">
        {view.racks.length === 0 ? (
          <div className="plan3d-none">{bi('No racks here yet. Give items a rack at this place and they appear.', 'ಇಲ್ಲಿ ಇನ್ನೂ ರ‍್ಯಾಕ್ ಇಲ್ಲ. ಸಾಮಾನಿಗೆ ಈ ಸ್ಥಳದ ರ‍್ಯಾಕ್ ಕೊಡಿ, ಅವು ಕಾಣುತ್ತವೆ.')}</div>
        ) : gl ? (
          <div className="plan3d-canvas" ref={host} aria-label={bi('3D view of the racks', 'ರ‍್ಯಾಕ್‌ಗಳ 3D ನೋಟ')} />
        ) : (
          <FlatPlan racks={view.racks} picked={picked} onPick={setPicked} />
        )}
        {picked && (
          <aside className="card plan3d-card">
            <div className="plan3d-card-head">
              <strong>{picked}</strong>
              <button type="button" className="btn ghost" onClick={() => setPicked(null)} aria-label={bi('Close', 'ಮುಚ್ಚಿ')}>
                ✕
              </button>
            </div>
            <div className="hint">{placeName(place)}</div>
            {lines.length === 0 && <div className="hint">{bi('Nothing on this rack.', 'ಈ ರ‍್ಯಾಕ್‌ನಲ್ಲಿ ಏನೂ ಇಲ್ಲ.')}</div>}
            <ul className="plan3d-items">
              {lines.map((l) => (
                <li key={l.item.id}>
                  <span className={'plan3d-dot ' + l.status} />
                  <Link to={'/admin/inventory/' + l.item.id}>{pickName(l.item.nameEn, l.item.nameKn, lang)}</Link>
                  <span className="plan3d-qty">{describeQty(l.item, l.qty, lang)}</span>
                  {l.status === 'low' || l.status === 'getting-low' ? (
                    place.kind === 'shop' ? (
                      <Link className="plan3d-bring" to="/admin/refill">
                        {bi('Bring from godown', 'ಗೋದಾಮಿನಿಂದ ತರಿಸಿ')}
                      </Link>
                    ) : null
                  ) : null}
                </li>
              ))}
            </ul>
          </aside>
        )}
      </div>
      <p className="hint">{gl ? bi('Drag to turn, pinch or scroll to zoom, tap a rack to see what is on it.', 'ತಿರುಗಿಸಲು ಎಳೆಯಿರಿ, ಜೂಮ್‌ಗೆ ಪಿಂಚ್ ಅಥವಾ ಸ್ಕ್ರೋಲ್, ರ‍್ಯಾಕ್ ಒತ್ತಿದರೆ ಅದರಲ್ಲಿರುವುದು ಕಾಣುತ್ತದೆ.') : bi('This device cannot show 3D, so the plan is flat. Tap a rack.', 'ಈ ಸಾಧನದಲ್ಲಿ 3D ಇಲ್ಲ, ಆದ್ದರಿಂದ ಸಮತಟ್ಟಾದ ನಕ್ಷೆ. ರ‍್ಯಾಕ್ ಒತ್ತಿ.')}</p>
    </>
  );
}
