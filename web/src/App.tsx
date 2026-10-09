import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { Icon, type IconName } from './components/Icon';
import { ROLE_HOME, type MsgKey, type Role } from '@stock/core';
import { useSession } from './lib/session';
import { stopLive, useLiveStatus } from './lib/live';
import { LoginPage } from './pages/Login';
import { PinPage } from './pages/Pin';
import { WalkthroughPage } from './pages/Walkthrough';
import { AdminHome } from './roles/admin/Home';
import { ConfirmPage } from './roles/admin/Confirm';
import { BillsPage, SettingsPage } from './roles/admin/Flows';
import { RefillPage, TransfersPage } from './roles/admin/Moving';
import { DeliveriesHome, GodownHome, WorkerHome } from './roles/RoleScreens';
import { InventoryPage } from './pages/admin/Inventory';
import { InventoryItemPage } from './pages/admin/InventoryItem';
import { LowToast } from './components/LowToast';
import { DeliveryToast } from './components/DeliveryToast';
import { firstTourSeen, markFirstTourSeen, TourButton, TourProvider, useTour } from './components/Tour';
import { FIRST_TOUR, tourForPath } from './tours';
import { ExplainerModal, explainerOffered, markExplainerOffered } from './explainer/entry';
import { Loading } from './components/ui';

/*
 * Screens opened now and then load when first opened, so the first screen downloads much less:
 * Setup (places, people, vehicles, Excel), Purchases, Reports, Help and the explainer's recorder.
 */
const named = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const HelpPage = named(() => import('./pages/Help'), 'HelpPage');
const ReportsPage = named(() => import('./roles/Reports'), 'ReportsPage');
const PurchasesPage = named(() => import('./roles/admin/Buying'), 'PurchasesPage');
const PlacesPage = named(() => import('./pages/admin/Places'), 'PlacesPage');
const PeoplePage = named(() => import('./pages/admin/People'), 'PeoplePage');
const FilesPage = named(() => import('./pages/admin/Files'), 'FilesPage');
const VehiclesPage = named(() => import('./pages/admin/Vehicles'), 'VehiclesPage');
/** three.js is big: the 3D view is its own chunk, fetched only when the tab is opened. */
const Inventory3DPage = named(() => import('./pages/admin/Inventory3D'), 'Inventory3DPage');
const DeliveriesPage = named(() => import('./pages/admin/Deliveries'), 'DeliveriesPage');
const RecordPage = named(() => import('./explainer/Record'), 'RecordPage');
/** The customer's pages, opened from a WhatsApp link with no sign-in. */
const TrackPage = named(() => import('./pages/public/Track'), 'TrackPage');
const ShareLocationPage = named(() => import('./pages/public/ShareLocation'), 'ShareLocationPage');

/** A screen inside one menu place, shown as a tab. */
type Tab = { to: string; en: string; kn: string };
/** One menu place: where it opens, and the screens (tabs) that belong to it. */
type Place = { to: string; en: string; kn: string; icon: IconName; tour: string; tabs: Tab[] };
const tab = (to: string, en: string, kn: string): Tab => ({ to, en, kn });

/**
 * The admin's menu: five places instead of sixteen. Each place is one screen with tabs; the tabs
 * keep their old addresses, so every bookmark still lands.
 */
const ADMIN: Place[] = [
  { to: '/admin', en: 'Home', kn: 'ಮುಖಪುಟ', icon: 'home', tour: 'nav-home', tabs: [tab('/admin', 'Today', 'ಇಂದು'), tab('/admin/reports', 'Reports', 'ವರದಿ')] },
  { to: '/admin/bills', en: 'Bills', kn: 'ಬಿಲ್‌ಗಳು', icon: 'receipt', tour: 'nav-bills', tabs: [tab('/admin/bills', 'Bills', 'ಬಿಲ್‌ಗಳು'), tab('/admin/confirm', 'To digitise', 'ಡಿಜಿಟೈಸ್ ಮಾಡಿ')] },
  {
    to: '/admin/inventory',
    en: 'Inventory',
    kn: 'ಸಾಮಾನು',
    icon: 'box',
    tour: 'nav-inventory',
    tabs: [tab('/admin/inventory', 'Items & stock', 'ಸಾಮಾನು ಮತ್ತು ಸ್ಟಾಕ್'), tab('/admin/refill', 'Bring from godown', 'ಗೋದಾಮಿನಿಂದ ತರಿಸಿ'), tab('/admin/inventory-3d', '3D view', '3D ನೋಟ')],
  },
  {
    to: '/admin/purchases',
    en: 'Buy & move',
    kn: 'ಖರೀದಿ ಮತ್ತು ಸಾಗಣೆ',
    icon: 'cart',
    tour: 'nav-move',
    tabs: [tab('/admin/purchases', 'Purchases', 'ಖರೀದಿ'), tab('/admin/transfers', 'Transfers', 'ಸಾಗಣೆ'), tab('/admin/deliveries', 'Deliveries', 'ಡೆಲಿವರಿ')],
  },
  {
    to: '/admin/places',
    en: 'Setup',
    kn: 'ಸೆಟಪ್',
    icon: 'settings',
    tour: 'nav-setup',
    tabs: [
      tab('/admin/places', 'Places', 'ಸ್ಥಳಗಳು'),
      tab('/admin/people', 'People', 'ಜನರು'),
      tab('/admin/vehicles', 'Vehicles', 'ವಾಹನಗಳು'),
      tab('/admin/files', 'Excel', 'ಎಕ್ಸೆಲ್'),
      tab('/admin/settings', 'Settings', 'ಸೆಟ್ಟಿಂಗ್ಸ್'),
    ],
  },
];
/** The phone's bottom bar: these, then "More" for the rest. */
const PRIMARY = ['/admin', '/admin/bills', '/admin/inventory'];

/** The worker's three views, as tabs. The godown job is the middle one. */
const WORKER_TABS: Tab[] = [tab('/worker', 'Pick list', 'ಪಟ್ಟಿ'), tab('/worker/godown', 'Godown', 'ಗೋದಾಮು'), tab('/worker/deliveries', 'Deliveries', 'ಡೆಲಿವರಿ'), tab('/worker/screen', 'TV screen', 'ಟಿವಿ ಪರದೆ')];

const inTab = (path: string, t: Tab) => path === t.to || (t.to === '/admin/inventory' && path.startsWith('/admin/inventory/'));
const placeOf = (path: string) => ADMIN.find((p) => p.tabs.some((t) => inTab(path, t)));

// ---- light and dark --------------------------------------------------------
const THEME_KEY = 'stock.theme';
type Theme = 'light' | 'dark';
function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}
function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === 'light' || v === 'dark') return v;
    } catch {
      /* private window: follow the system */
    }
    return systemTheme();
  });
  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* not remembered; still applied */
    }
    setTheme(next);
  }, [theme]);
  return [theme, toggle];
}

function LiveDot() {
  const s = useLiveStatus();
  const { lang } = useSession();
  if (s === 'off') return null;
  const label = s === 'live' ? (lang === 'kn' ? 'ನೇರ' : 'Live') : lang === 'kn' ? 'ಸಂಪರ್ಕಿಸುತ್ತಿದೆ' : 'Connecting';
  return (
    <span className={'live-dot ' + s} title={label}>
      <span className="dot" aria-hidden="true" /> <span className="live-word">{label}</span>
    </span>
  );
}

function UserMenu() {
  const { me, t, lang, signOut } = useSession();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  if (!me) return null;
  return (
    <div className="user-menu" ref={box}>
      <button className="user-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} data-tour="user-menu">
        <span className="avatar" aria-hidden="true">
          {me.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="who">
          <span className="who-name">{me.name}</span>
          <span className="who-role">{t(('role.' + me.role) as MsgKey)}</span>
        </span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head">
            <b>{me.name}</b>
            <span className="muted">{t(('role.' + me.role) as MsgKey)}</span>
          </div>
          <NavLink to="/help" role="menuitem" className="menu-item">
            <Icon name="help" /> {lang === 'kn' ? 'ಇದೆಲ್ಲ ಹೇಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ' : 'How it all works'}
          </NavLink>
          <NavLink to="/walkthrough" role="menuitem" className="menu-item">
            <Icon name="book" /> {lang === 'kn' ? 'ಡೆಮೊ ಪರಿಚಯ' : 'Demo walkthrough'}
          </NavLink>
          <NavLink to="/pin" role="menuitem" className="menu-item">
            <Icon name="key" /> {t('login.changePin')}
          </NavLink>
          <a href="#" role="menuitem" className="menu-item" onClick={(e) => (e.preventDefault(), stopLive(), signOut())}>
            <Icon name="logout" /> {t('common.signOut')}
          </a>
        </div>
      )}
    </div>
  );
}

function Top({ onMenu }: { onMenu?: () => void }) {
  const { me, t, lang, setLang } = useSession();
  const [theme, toggleTheme] = useTheme();
  const loc = useLocation();
  return (
    <header className="top">
      {onMenu && (
        <button className="icon-btn top-menu" onClick={onMenu} aria-label={lang === 'kn' ? 'ಮೆನು' : 'Menu'}>
          <Icon name="menu" />
        </button>
      )}
      <span className="brand">{t('app.name')}</span>
      {me && <LiveDot />}
      <span className="top-gap" />
      {me && <TourButton tourId={tourForPath(loc.pathname)} />}
      <button className="icon-btn" onClick={() => setLang(lang === 'kn' ? 'en' : 'kn')} title={t('common.lang')}>
        <Icon name="globe" />
        <span className="lang-word">{t('common.lang')}</span>
      </button>
      <button
        className="icon-btn"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? (lang === 'kn' ? 'ಬೆಳಕಿನ ನೋಟ' : 'Light mode') : lang === 'kn' ? 'ಕತ್ತಲೆ ನೋಟ' : 'Dark mode'}
        title={theme === 'dark' ? 'Light' : 'Dark'}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
      </button>
      <UserMenu />
    </header>
  );
}

/** A menu place: active on any of its tabs, not only its first screen. */
function PlaceLink({ p, onClick }: { p: Place; onClick?: () => void }) {
  const { lang } = useSession();
  const loc = useLocation();
  const label = lang === 'kn' ? p.kn : p.en;
  const on = placeOf(loc.pathname) === p;
  return (
    <NavLink to={p.to} end title={label} onClick={onClick} className={on ? 'active' : ''} aria-current={on ? 'page' : undefined} data-tour={p.tour}>
      <Icon name={p.icon} />
      <span className="nav-label">{label}</span>
    </NavLink>
  );
}

function Sidebar() {
  const { lang } = useSession();
  return (
    <nav className="side" aria-label={lang === 'kn' ? 'ಮೆನು' : 'Menu'}>
      <div className="side-group">
        <div className="side-head">{lang === 'kn' ? 'ಮೆನು' : 'Menu'}</div>
        {ADMIN.map((p) => (
          <PlaceLink key={p.to} p={p} />
        ))}
      </div>
    </nav>
  );
}

function TabBar({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const { lang } = useSession();
  const loc = useLocation();
  const here = placeOf(loc.pathname);
  const inRest = !!here && !PRIMARY.includes(here.to);
  return (
    <nav className="tabbar" aria-label={lang === 'kn' ? 'ಮುಖ್ಯ ಮೆನು' : 'Main menu'}>
      {ADMIN.filter((p) => PRIMARY.includes(p.to)).map((p) => (
        <PlaceLink key={p.to} p={p} />
      ))}
      <button className={'tabbar-more' + (inRest || moreOpen ? ' active' : '')} onClick={onMore} aria-expanded={moreOpen} data-tour="nav-more">
        <Icon name="more" />
        <span className="nav-label">{lang === 'kn' ? 'ಇನ್ನಷ್ಟು' : 'More'}</span>
      </button>
    </nav>
  );
}

function MoreSheet({ onClose }: { onClose: () => void }) {
  const { lang } = useSession();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-top">
          <span className="subtitle m-0">{lang === 'kn' ? 'ಎಲ್ಲಾ ಭಾಗಗಳು' : 'Everything'}</span>
          <button className="icon-btn" onClick={onClose} aria-label={lang === 'kn' ? 'ಮುಚ್ಚಿ' : 'Close'}>
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-group">
          <div className="sheet-grid">
            {ADMIN.map((p) => (
              <PlaceLink key={p.to} p={p} onClick={onClose} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The tabs of the place you are in: Bills · To digitise, Purchases · Transfers, and so on. */
function SectionTabs({ tabs }: { tabs: Tab[] }) {
  const { lang } = useSession();
  const loc = useLocation();
  if (tabs.length < 2) return null;
  return (
    <nav className="tabs" aria-label={lang === 'kn' ? 'ಈ ಭಾಗದ ಪುಟಗಳು' : 'Screens here'} data-tour="section-tabs">
      {tabs.map((t) => {
        const on = inTab(loc.pathname, t);
        return (
          <NavLink key={t.to} to={t.to} end className={on ? 'tab on' : 'tab'} aria-current={on ? 'page' : undefined}>
            {lang === 'kn' ? t.kn : t.en}
          </NavLink>
        );
      })}
    </nav>
  );
}

/** An old Items or Stock link, to the same place in Inventory: an item's page, or the list with its filter. */
function ToInventory({ base }: { base: string }) {
  const { id } = useParams();
  const loc = useLocation();
  return <Navigate to={base + (id ? '/' + id : '') + loc.search} replace />;
}

/**
 * The first time a person signs in, their role's tour plays by itself, once per device. The admin
 * is first offered the explainer video, once; the tour follows when it is closed.
 */
function FirstTour() {
  const { me } = useSession();
  const { start } = useTour();
  const loc = useLocation();
  const [offer, setOffer] = useState(false);
  useEffect(() => {
    if (!me || offer) return;
    const id = FIRST_TOUR[me.role];
    if (!id || loc.pathname !== ROLE_HOME[me.role] || firstTourSeen(me.id, me.role)) return;
    if (me.role === 'admin' && !explainerOffered(me.id)) {
      setOffer(true);
      return;
    }
    const timer = setTimeout(() => start(id, () => markFirstTourSeen(me.id, me.role)), 400);
    return () => clearTimeout(timer);
  }, [me, loc.pathname, start, offer]);
  if (!offer || !me) return null;
  return (
    <ExplainerModal
      offer
      onClose={() => {
        markExplainerOffered(me.id);
        setOffer(false);
      }}
    />
  );
}

export function App() {
  return (
    <TourProvider>
      <Shell />
    </TourProvider>
  );
}

function Shell() {
  const { ready, me, t } = useSession();
  const loc = useLocation();
  const [more, setMore] = useState(false);
  const closeMore = useCallback(() => setMore(false), []);
  useEffect(() => setMore(false), [loc.pathname]);
  // A customer's link: no sign-in, no menu, whoever (if anyone) is signed in on this phone.
  if (/^\/(t|l)\//.test(loc.pathname))
    return (
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/t/:id/:tok" element={<TrackPage />} />
          <Route path="/l/:id/:tok" element={<ShareLocationPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    );
  if (!ready) return <div className="page muted">{t('common.loading')}</div>;
  if (loc.pathname === '/walkthrough') {
    return (
      <>
        <Top />
        <main className="plain-col">
          <WalkthroughPage />
        </main>
      </>
    );
  }
  if (!me) {
    return (
      <>
        <Top />
        <main className="plain-col">
          <LoginPage />
        </main>
      </>
    );
  }
  // The explainer's recording page: the bare canvas, for the admin only.
  if (loc.pathname === '/explainer/record' && me.role === 'admin')
    return (
      <Suspense fallback={<Loading />}>
        <RecordPage />
      </Suspense>
    );
  // An old godown login works as a worker: the godown job is a tab of the worker screen.
  const r: Role = me.role === 'godown' ? 'worker' : me.role;
  const home = ROLE_HOME[r];
  const hasNav = r === 'admin';
  const tabs = r === 'admin' ? (placeOf(loc.pathname)?.tabs ?? []) : r === 'worker' ? WORKER_TABS : [];
  return (
    <div className={'shell' + (hasNav ? ' has-nav' : '')}>
      {hasNav && <Sidebar />}
      <div className="main-col">
        <Top onMenu={hasNav ? () => setMore(true) : undefined} />
        <main className={'page role-' + r + (loc.pathname === '/worker/screen' ? ' tv' : '')}>
          <SectionTabs tabs={tabs} />
          <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/pin" element={<PinPage />} />
            <Route path="/help" element={<HelpPage />} />
            {r === 'admin' && (
              <>
                <Route path="/admin" element={<AdminHome />} />
                <Route path="/admin/reports" element={<ReportsPage />} />
                <Route path="/admin/bills" element={<BillsPage />} />
                <Route path="/admin/confirm" element={<ConfirmPage />} />
                <Route path="/admin/inventory" element={<InventoryPage />} />
                <Route path="/admin/inventory/new" element={<InventoryItemPage />} />
                <Route path="/admin/inventory/:id" element={<InventoryItemPage />} />
                <Route path="/admin/inventory-3d" element={<Inventory3DPage />} />
                <Route path="/admin/refill" element={<RefillPage />} />
                <Route path="/admin/purchases" element={<PurchasesPage />} />
                <Route path="/admin/transfers" element={<TransfersPage />} />
                <Route path="/admin/deliveries" element={<DeliveriesPage />} />
                <Route path="/admin/places" element={<PlacesPage />} />
                <Route path="/admin/people" element={<PeoplePage />} />
                <Route path="/admin/vehicles" element={<VehiclesPage />} />
                <Route path="/admin/files" element={<FilesPage />} />
                <Route path="/admin/settings" element={<SettingsPage />} />
                <Route path="/explainer/record" element={<RecordPage />} />
                {/* Old links and bookmarks still land somewhere sensible. */}
                <Route path="/admin/setup" element={<Navigate to="/admin/places" replace />} />
                <Route path="/admin/move" element={<Navigate to="/admin/purchases" replace />} />
                <Route path="/admin/requests" element={<Navigate to="/admin" replace />} />
                <Route path="/admin/items" element={<Navigate to="/admin/inventory" replace />} />
                <Route path="/admin/items/:id" element={<ToInventory base="/admin/inventory" />} />
                <Route path="/admin/stock" element={<ToInventory base="/admin/inventory" />} />
              </>
            )}
            {(r === 'worker' || r === 'admin') && (
              <>
                <Route path="/worker" element={<WorkerHome />} />
                <Route path="/worker/godown" element={<GodownHome />} />
                <Route path="/worker/deliveries" element={<DeliveriesHome />} />
                <Route path="/worker/screen" element={<WorkerHome screen />} />
                <Route path="/godown" element={<Navigate to="/worker/godown" replace />} />
              </>
            )}
            <Route path="*" element={<Navigate to={home} replace />} />
          </Routes>
          </Suspense>
        </main>
      </div>
      {hasNav && <TabBar onMore={() => setMore(!more)} moreOpen={more} />}
      {hasNav && more && <MoreSheet onClose={closeMore} />}
      {r === 'admin' && <LowToast />}
      {r === 'admin' && <DeliveryToast role="admin" />}
      {r === 'worker' && <DeliveryToast role="worker" />}
      <FirstTour />
    </div>
  );
}
