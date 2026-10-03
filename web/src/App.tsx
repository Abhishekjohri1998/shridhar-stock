import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
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
import { CustomerHome, DeliveryHome, GodownHome, OwnerHome, VendorHome, WorkerHome } from './roles/RoleScreens';
import { ItemsPage } from './pages/admin/Items';
import { ItemEditor } from './pages/admin/ItemEditor';
import { StockPage } from './pages/admin/Stock';
import { PlacesPage } from './pages/admin/Places';
import { PeoplePage } from './pages/admin/People';
import { FilesPage } from './pages/admin/Files';
import { VehiclesPage } from './pages/admin/Vehicles';

/** Each role's menu. [path, English, Kannada] */
const NAV: Record<Role, [string, string, string][]> = {
  admin: [
    ['/admin', 'Home', 'ಮುಖಪುಟ'],
    ['/admin/confirm', 'To confirm', 'ಖಚಿತಪಡಿಸಿ'],
    ['/admin/bills', 'Bills', 'ಬಿಲ್‌ಗಳು'],
    ['/admin/stock', 'Stock', 'ಸ್ಟಾಕ್'],
    ['/admin/refill', 'Refill', 'ತರಿಸಿ'],
    ['/admin/transfers', 'Transfers', 'ಸಾಗಣೆ'],
    ['/admin/purchases', 'Purchases', 'ಖರೀದಿ'],
    ['/admin/deliveries', 'Deliveries', 'ಡೆಲಿವರಿ'],
    ['/admin/requests', 'Requests', 'ಬೇಡಿಕೆ'],
    ['/admin/reports', 'Reports', 'ವರದಿ'],
    ['/admin/items', 'Items', 'ಸಾಮಾನು'],
    ['/admin/places', 'Places', 'ಸ್ಥಳಗಳು'],
    ['/admin/people', 'People', 'ಜನರು'],
    ['/admin/vehicles', 'Vehicles', 'ವಾಹನಗಳು'],
    ['/admin/files', 'Excel', 'ಎಕ್ಸೆಲ್'],
    ['/admin/settings', 'Settings', 'ಸೆಟ್ಟಿಂಗ್ಸ್'],
  ],
  owner: [
    ['/owner', 'Overview', 'ಸಾರಾಂಶ'],
    ['/owner/bills', 'Bills', 'ಬಿಲ್‌ಗಳು'],
    ['/owner/reports', 'Reports', 'ವರದಿ'],
    ['/owner/stock', 'Stock', 'ಸ್ಟಾಕ್'],
    ['/owner/files', 'Excel', 'ಎಕ್ಸೆಲ್'],
  ],
  worker: [
    ['/worker', 'Pick list', 'ಪಟ್ಟಿ'],
    ['/worker/screen', 'TV screen', 'ಟಿವಿ ಪರದೆ'],
  ],
  godown: [['/godown', 'My godown', 'ನನ್ನ ಗೋದಾಮು']],
  vendor: [['/vendor', 'Orders', 'ಆರ್ಡರ್‌ಗಳು']],
  delivery: [['/delivery', 'Deliveries', 'ಡೆಲಿವರಿ']],
  customer: [['/customer', 'My shop', 'ನನ್ನ ಅಂಗಡಿ']],
};

function LiveDot() {
  const s = useLiveStatus();
  const { lang } = useSession();
  if (s === 'off') return null;
  const label = s === 'live' ? (lang === 'kn' ? 'ನೇರ' : 'Live') : lang === 'kn' ? 'ಸಂಪರ್ಕಿಸುತ್ತಿದೆ' : 'Connecting';
  return (
    <span className={'live-dot ' + s} title={label}>
      ● {label}
    </span>
  );
}

function Top() {
  const { me, t, lang, setLang, signOut } = useSession();
  return (
    <header className="top">
      <span className="brand">{t('app.name')}</span>
      <button className="btn ghost small" onClick={() => setLang(lang === 'kn' ? 'en' : 'kn')}>
        {t('common.lang')}
      </button>
      {me && <LiveDot />}
      {me && (
        <span className="who">
          {me.name} · {t(('role.' + me.role) as MsgKey)}
          <br />
          <NavLink to="/walkthrough" className="muted">
            {lang === 'kn' ? 'ಪರಿಚಯ' : 'Walkthrough'}
          </NavLink>{' '}
          ·{' '}
          <NavLink to="/pin" className="muted">
            {t('login.changePin')}
          </NavLink>{' '}
          ·{' '}
          <a href="#" className="muted" onClick={(e) => (e.preventDefault(), stopLive(), signOut())}>
            {t('common.signOut')}
          </a>
        </span>
      )}
    </header>
  );
}

function RoleNav({ role }: { role: Role }) {
  const { lang } = useSession();
  const tabs = NAV[role];
  if (tabs.length < 2) return null;
  return (
    <nav className="nav">
      {tabs.map(([to, en, kn]) => (
        <NavLink key={to} to={to} end={to === ROLE_HOME[role]}>
          {lang === 'kn' ? kn : en}
        </NavLink>
      ))}
    </nav>
  );
}

export function App() {
  const { ready, me, t } = useSession();
  const loc = useLocation();
  if (!ready) return <div className="page muted">{t('common.loading')}</div>;
  if (loc.pathname === '/walkthrough') {
    return (
      <>
        <Top />
        <WalkthroughPage />
      </>
    );
  }
  if (!me) {
    return (
      <>
        <Top />
        <LoginPage />
      </>
    );
  }
  const home = ROLE_HOME[me.role];
  const r = me.role;
  return (
    <>
      <Top />
      <RoleNav role={r} />
      <main className={'page role-' + r}>
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
              <Route path="/admin/items" element={<ItemsPage />} />
              <Route path="/admin/items/new" element={<ItemEditor />} />
              <Route path="/admin/items/:id" element={<ItemEditor />} />
              <Route path="/admin/stock" element={<StockPage />} />
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
              <Route path="/owner/stock" element={<StockPage readOnly />} />
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
          {r === 'vendor' && <Route path="/vendor" element={<VendorHome />} />}
          {r === 'delivery' && <Route path="/delivery" element={<DeliveryHome />} />}
          {r === 'customer' && <Route path="/customer" element={<CustomerHome />} />}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </>
  );
}
