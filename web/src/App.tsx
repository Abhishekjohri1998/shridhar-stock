import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { ROLE_HOME, type MsgKey } from '@stock/core';
import { useSession } from './lib/session';
import { LoginPage } from './pages/Login';
import { SoonPage } from './pages/Soon';
import { AdminHome } from './pages/admin/Home';
import { ItemsPage } from './pages/admin/Items';
import { ItemEditor } from './pages/admin/ItemEditor';
import { StockPage } from './pages/admin/Stock';
import { PlacesPage } from './pages/admin/Places';
import { PeoplePage } from './pages/admin/People';
import { FilesPage } from './pages/admin/Files';
import { PinPage } from './pages/Pin';

const ADMIN_TABS: { to: string; key: MsgKey }[] = [
  { to: '/admin', key: 'nav.home' },
  { to: '/admin/items', key: 'nav.items' },
  { to: '/admin/stock', key: 'nav.stock' },
  { to: '/admin/places', key: 'nav.places' },
  { to: '/admin/people', key: 'nav.people' },
  { to: '/admin/files', key: 'nav.files' },
];

function Top() {
  const { me, t, lang, setLang, signOut } = useSession();
  return (
    <header className="top">
      <span className="brand">{t('app.name')}</span>
      <button className="btn ghost small" onClick={() => setLang(lang === 'kn' ? 'en' : 'kn')}>
        {t('common.lang')}
      </button>
      {me && (
        <span className="who">
          {me.name} · {t(('role.' + me.role) as MsgKey)}
          <br />
          <NavLink to="/pin" className="muted">
            {t('login.changePin')}
          </NavLink>{' '}
          ·{' '}
          <a href="#" className="muted" onClick={(e) => (e.preventDefault(), signOut())}>
            {t('common.signOut')}
          </a>
        </span>
      )}
    </header>
  );
}

export function App() {
  const { ready, me, t } = useSession();
  if (!ready) return <div className="page muted">{t('common.loading')}</div>;
  if (!me) {
    return (
      <>
        <Top />
        <LoginPage />
      </>
    );
  }
  const home = ROLE_HOME[me.role];
  return (
    <>
      <Top />
      {me.role === 'admin' && (
        <nav className="nav">
          {ADMIN_TABS.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.to === '/admin'}>
              {t(tab.key)}
            </NavLink>
          ))}
        </nav>
      )}
      <main className="page">
        <Routes>
          <Route path="/pin" element={<PinPage />} />
          {me.role === 'admin' && (
            <>
              <Route path="/admin" element={<AdminHome />} />
              <Route path="/admin/items" element={<ItemsPage />} />
              <Route path="/admin/items/new" element={<ItemEditor />} />
              <Route path="/admin/items/:id" element={<ItemEditor />} />
              <Route path="/admin/stock" element={<StockPage />} />
              <Route path="/admin/places" element={<PlacesPage />} />
              <Route path="/admin/people" element={<PeoplePage />} />
              <Route path="/admin/files" element={<FilesPage />} />
            </>
          )}
          {me.role !== 'admin' && <Route path={home} element={<SoonPage />} />}
          <Route path="*" element={<Navigate to={home} replace />} />
        </Routes>
      </main>
    </>
  );
}
