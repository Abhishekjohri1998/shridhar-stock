import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { formatRupees, itemMatches, pickName } from '@stock/core';
import { api } from '../../lib/api';
import { useLoad, useSession } from '../../lib/session';
import { Table } from '../../components/ui';

export function ItemsPage() {
  const { t, lang } = useSession();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const { value: items, error } = useLoad(() => api.items(true));

  if (error) return <div className="msg err">{error}</div>;
  const shown = (items ?? []).filter((i) => (showAll || i.active) && (!q.trim() || itemMatches(i, q)));

  return (
    <>
      <h1 className="title">{t('items.title')}</h1>
      <div className="bar">
        <input className="grow" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} />
        <Link className="btn primary" to="/admin/items/new">
          + {t('items.new')}
        </Link>
      </div>
      <label className="check mb-10">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        {t('items.showInactive')}
      </label>
      {!items && <p className="muted">{t('common.loading')}</p>}
      {items && items.length === 0 && <div className="card">{t('items.empty')}</div>}
      {shown.length > 0 && (
        <div className="scroll">
          <Table className="list">
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} className="link" onClick={() => nav('/admin/items/' + i.id)}>
                  <td>
                    <div className="name">{pickName(i.nameEn, i.nameKn, lang)}</div>
                    <div className="muted">{lang === 'kn' ? i.nameEn : i.nameKn}</div>
                    {!i.active && <span className="pill">{t('items.inactive')}</span>}
                  </td>
                  <td className="num">
                    {i.units.map((u) => (
                      <div key={u.code}>
                        {(lang === 'kn' && u.labelKn) || u.label} {formatRupees(u.price)}
                        {u.perBase > 1 && <span className="muted"> · {u.perBase} {i.units[0]!.code}</span>}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}
