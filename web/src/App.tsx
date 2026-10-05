import { useCallback, useEffect, useRef, useState } from 'react';
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
import { BillsPage, RequestsPage, SettingsPage } from './roles/admin/Flows';
import { DeliveriesPage } from './roles/admin/Deliver';
import { ReportsPage } from './roles/Reports';
import { PurchasesPage } from './roles/admin/Buying';
import { RefillPage, TransfersPage } from './roles/admin/Moving';
import { CustomerHome, DeliveryHome, GodownHome, OwnerHome, WorkerHome } from './roles/RoleScreens';
import { InventoryPage } from './pages/admin/Inventory';
import { InventoryItemPage } from './pages/admin/InventoryItem';
import { LowToast } from './components/LowToast';
import { PlacesPage } from './pages/admin/Places';
import { PeoplePage } from './pages/admin/People';
import { FilesPage } from './pages/admin/Files';
import { VehiclesPage } from './pages/admin/Vehicles';

type NavItem = { to: string; en: string; kn: string; icon: IconName };
type NavGroup = { en: string; kn: string; items: NavItem[] };
const item = (to: string, en: string, kn: string, icon: IconName): NavItem => ({ to, en, kn, icon });

/** Each role's menu, grouped for the sidebar. The same routes as before, in the same order. */
const NAV: Record<Role, NavGroup[]> = {
  admin: [
    {
      en: 'Today',
      kn: 'ಇಂದು',
      items: [item('/admin', 'Home', 'ಮುಖಪುಟ', 'home'), item('/admin/confirm', 'To confirm', 'ಖಚಿತಪಡಿಸಿ', 'checkCircle'), item('/admin/bills', 'Bills', 'ಬಿಲ್‌ಗಳು', 'receipt')],
    },
    {
      en: 'Inventory',
      kn: 'ಸಾಮಾನು ಮತ್ತು ಸ್ಟಾಕ್',
      items: [item('/admin/inventory', 'Inventory', 'ಸಾಮಾನು', 'box'), item('/admin/refill', 'Refill', 'ತರಿಸಿ', 'refill')],
    },
    {
      en: 'Moving',
      kn: 'ಸಾಗಣೆ',
      items: [item('/admin/transfers', 'Transfers', 'ಸಾಗಣೆ', 'transfer'), item('/admin/deliveries', 'Deliveries', 'ಡೆಲಿವರಿ', 'truck'), item('/admin/requests', 'Requests', 'ಬೇಡಿಕೆ', 'inbox')],
    },
    { en: 'Buying', kn: 'ಖರೀದಿ', items: [item('/admin/purchases', 'Purchases', 'ಖರೀದಿ', 'cart'), item('/admin/reports', 'Reports', 'ವರದಿ', 'chart')] },
    {
      en: 'People & setup',
      kn: 'ಜನರು ಮತ್ತು ಸೆಟಪ್',
      items: [
        item('/admin/places', 'Places', 'ಸ್ಥಳಗಳು', 'pin'),
        item('/admin/people', 'People', 'ಜನರು', 'people'),
        item('/admin/vehicles', 'Vehicles', 'ವಾಹನಗಳು', 'truck'),
        item('/admin/files', 'Excel', 'ಎಕ್ಸೆಲ್', 'file'),
        item('/admin/settings', 'Settings', 'ಸೆಟ್ಟಿಂಗ್ಸ್', 'settings'),
      ],
    },
  ],
  owner: [
    { en: 'Today', kn: 'ಇಂದು', items: [item('/owner', 'Overview', 'ಸಾರಾಂಶ', 'home'), item('/owner/bills', 'Bills', 'ಬಿಲ್‌ಗಳು', 'receipt')] },
    {
      en: 'Stock',
      kn: 'ಸ್ಟಾಕ್',
      items: [item('/owner/reports', 'Reports', 'ವರದಿ', 'chart'), item('/owner/inventory', 'Inventory', 'ಸಾಮಾನು', 'box'), item('/owner/files', 'Excel', 'ಎಕ್ಸೆಲ್', 'file')],
    },
  ],
  worker: [{ en: 'Today', kn: 'ಇಂದು', items: [item('/worker', 'Pick list', 'ಪಟ್ಟಿ', 'list'), item('/worker/screen', 'TV screen', 'ಟಿವಿ ಪರದೆ', 'tv')] }],
  godown: [{ en: 'Today', kn: 'ಇಂದು', items: [item('/godown', 'My godown', 'ನನ್ನ ಗೋದಾಮು', 'warehouse')] }],
  // Suppliers no longer sign in; the role is kept only so old records read.
  vendor: [],
  delivery: [{ en: 'Today', kn: 'ಇಂದು', items: [item('/delivery', 'Deliveries', 'ಡೆಲಿವರಿ', 'truck')] }],
  customer: [{ en: 'Today', kn: 'ಇಂದು', items: [item('/customer', 'My shop', 'ನನ್ನ ಅಂಗಡಿ', 'store')] }],
};

/** The four a phone's bottom bar shows for each role; the rest go under "More". */
const PRIMARY: Record<Role, string[]> = {
  admin: ['/admin', '/admin/confirm', '/admin/inventory', '/admin/bills'],
  owner: ['/owner', '/owner/bills', '/owner/reports', '/owner/inventory'],
  worker: ['/worker', '/worker/screen'],
  godown: ['/godown'],
  vendor: [],
  delivery: ['/delivery'],
  customer: ['/customer'],
};

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
      <button className="user-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
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
          <NavLink to="/walkthrough" role="menuitem" className="menu-item">
            <Icon name="book" /> {lang === 'kn' ? 'ಪರಿಚಯ' : 'Walkthrough'}
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

function NavItemLink({ it, role, onClick }: { it: NavItem; role: Role; onClick?: () => void }) {
  const { lang } = useSession();
  const label = lang === 'kn' ? it.kn : it.en;
  return (
    <NavLink to={it.to} end={it.to === ROLE_HOME[role]} title={label} onClick={onClick}>
      <Icon name={it.icon} />
      <span className="nav-label">{label}</span>
    </NavLink>
  );
}

function Sidebar({ role }: { role: Role }) {
  const { lang } = useSession();
  return (
    <nav className="side" aria-label={lang === 'kn' ? 'ಮೆನು' : 'Menu'}>
      {NAV[role].map((g) => (
        <div className="side-group" key={g.en}>
          <div className="side-head">{lang === 'kn' ? g.kn : g.en}</div>
          {g.items.map((it) => (
            <NavItemLink key={it.to} it={it} role={role} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function TabBar({ role, onMore, moreOpen }: { role: Role; onMore: () => void; moreOpen: boolean }) {
  const { lang } = useSession();
  const all = NAV[role].flatMap((g) => g.items);
  const primary = PRIMARY[role].map((to) => all.find((i) => i.to === to)!).filter(Boolean);
  const rest = all.filter((i) => !PRIMARY[role].includes(i.to));
  const loc = useLocation();
  const inRest = rest.some((i) => loc.pathname === i.to || loc.pathname.startsWith(i.to + '/'));
  return (
    <nav className="tabbar" aria-label={lang === 'kn' ? 'ಮುಖ್ಯ ಮೆನು' : 'Main menu'}>
      {primary.map((it) => (
        <NavItemLink key={it.to} it={it} role={role} />
      ))}
      {rest.length > 0 && (
        <button className={'tabbar-more' + (inRest || moreOpen ? ' active' : '')} onClick={onMore} aria-expanded={moreOpen}>
          <Icon name="more" />
          <span className="nav-label">{lang === 'kn' ? 'ಇನ್ನಷ್ಟು' : 'More'}</span>
        </button>
      )}
    </nav>
  );
}

function MoreSheet({ role, onClose }: { role: Role; onClose: () => void }) {
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
          <span className="subtitle m-0">{lang === 'kn' ? 'ಎಲ್ಲಾ ಪುಟಗಳು' : 'Everything'}</span>
          <button className="icon-btn" onClick={onClose} aria-label={lang === 'kn' ? 'ಮುಚ್ಚಿ' : 'Close'}>
            <Icon name="close" />
          </button>
        </div>
        {NAV[role].map((g) => (
          <div className="sheet-group" key={g.en}>
            <div className="side-head">{lang === 'kn' ? g.kn : g.en}</div>
            <div className="sheet-grid">
              {g.items.map((it) => (
                <NavItemLink key={it.to} it={it} role={role} onClick={onClose} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** An old Items or Stock link, to the same place in Inventory: an item's page, or the list with its filter. */
function ToInventory({ base }: { base: string }) {
  const { id } = useParams();
  const loc = useLocation();
  return <Navigate to={base + (id ? '/' + id : '') + loc.search} replace />;
}

export function App() {
  const { ready, me, t } = useSession();
  const loc = useLocation();
  const [more, setMore] = useState(false);
  const closeMore = useCallback(() => setMore(false), []);
  useEffect(() => setMore(false), [loc.pathname]);
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
  const home = ROLE_HOME[me.role];
  const r = me.role;
  const hasNav = NAV[r].flatMap((g) => g.items).length > 1;
  return (
    <div className={'shell' + (hasNav ? ' has-nav' : '')}>
      {hasNav && <Sidebar role={r} />}
      <div className="main-col">
      <Top onMenu={hasNav ? () => setMore(true) : undefined} />
      <main className={'page role-' + r + (loc.pathname === '/worker/screen' ? ' tv' : '')}>
        <Routes>
          <Route path="/pin" element={<PinPage />} />
          {r === 'admin' && (
            <>
              <Route path="/admin" element={<AdminHome />} />
              <Route path="/admin/confirm" element={<ConfirmPage />} />
              <Route path="/admin/bills" element={<BillsPage />} />
              <Route path="/admin/refill" element={<RefillPage />} />
              <Route path="/admin/transfers" element={<TransfersPage />} />
              <Route path="/admin/purchases" element={<PurchasesPage />} />
              <Route path="/admin/deliveries" element={<DeliveriesPage />} />
              <Route path="/admin/requests" element={<RequestsPage />} />
              <Route path="/admin/settings" element={<SettingsPage />} />
              <Route path="/admin/reports" element={<ReportsPage />} />
              <Route path="/admin/inventory" element={<InventoryPage />} />
              <Route path="/admin/inventory/new" element={<InventoryItemPage />} />
              <Route path="/admin/inventory/:id" element={<InventoryItemPage />} />
              {/* Items and Stock became Inventory: old links and bookmarks still land. */}
              <Route path="/admin/items" element={<Navigate to="/admin/inventory" replace />} />
              <Route path="/admin/items/:id" element={<ToInventory base="/admin/inventory" />} />
              <Route path="/admin/stock" element={<ToInventory base="/admin/inventory" />} />
              <Route path="/admin/places" element={<PlacesPage />} />
              <Route path="/admin/people" element={<PeoplePage />} />
              <Route path="/admin/vehicles" element={<VehiclesPage />} />
              <Route path="/admin/files" element={<FilesPage />} />
            </>
          )}
          {r === 'owner' && (
            <>
              <Route path="/owner" element={<OwnerHome />} />
              <Route path="/owner/bills" element={<BillsPage />} />
              <Route path="/owner/reports" element={<ReportsPage />} />
              <Route path="/owner/inventory" element={<InventoryPage readOnly />} />
              <Route path="/owner/inventory/:id" element={<InventoryItemPage readOnly />} />
              <Route path="/owner/stock" element={<ToInventory base="/owner/inventory" />} />
              <Route path="/owner/files" element={<FilesPage readOnly />} />
            </>
          )}
          {(r === 'worker' || r === 'admin') && (
            <>
              <Route path="/worker" element={<WorkerHome />} />
              <Route path="/worker/screen" element={<WorkerHome screen />} />
            </>
          )}
          {r === 'godown' && <Route path="/godown" element={<GodownHome />} />}
          {r === 'delivery' && <Route path="/delivery" element={<DeliveryHome />} />}
          {r === 'customer' && <Route path="/customer" element={<CustomerHome />} />}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
      </div>
      {hasNav && <TabBar role={r} onMore={() => setMore(!more)} moreOpen={more} />}
      {hasNav && more && <MoreSheet role={r} onClose={closeMore} />}
      {r === 'admin' && <LowToast />}
    </div>
  );
}
