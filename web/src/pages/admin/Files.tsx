import { useState } from 'react';
import { api, download, type ImportReport } from '../../lib/api';
import { useSession } from '../../lib/session';

const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export function FilesPage() {
  const { t } = useSession();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [csv, setCsv] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const guard = async (fn: () => Promise<void>) => {
    setError('');
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const pick = async (file: File | undefined) => {
    setReport(null);
    setDone('');
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    guard(async () => setReport(await api.importItems(text, true)));
  };

  const apply = () =>
    guard(async () => {
      const r = await api.importItems(csv, false);
      setReport(null);
      setCsv('');
      setDone(t('files.done', { n: r.added, c: r.changed }));
    });

  return (
    <>
      <h1 className="title">{t('files.title')}</h1>
      <p className="muted">{t('files.hint')}</p>
      {error && <div className="msg err">{error}</div>}

      <div className="card">
        <div className="bar">
          <span className="grow name">{t('files.items')}</span>
          <button className="btn" onClick={() => guard(() => download('/export/items.csv', 'items.csv'))}>
            {t('files.download')}
          </button>
        </div>
        <div className="bar">
          <span className="grow name">{t('files.stock')}</span>
          <button className="btn" onClick={() => guard(() => download('/export/stock.csv', 'stock.csv'))}>
            {t('files.download')}
          </button>
        </div>
        <div className="bar">
          <span className="grow name">{t('files.ledger')}</span>
          <label className="check">
            {t('files.from')} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="check">
            {t('files.to')} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <button
            className="btn"
            onClick={() => guard(() => download('/export/ledger.csv?from=' + from + '&to=' + to, 'ledger-' + from + '-' + to + '.csv'))}
          >
            {t('files.download')}
          </button>
        </div>
      </div>

      <div className="card">
        <h2 className="subtitle" style={{ marginTop: 0 }}>{t('files.import')}</h2>
        {done && <div className="msg ok">{done}</div>}
        <label className="field">
          <span>{t('files.pick')}</span>
          <input type="file" accept=".csv,text/csv" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {report && (
          <>
            <p>{t('files.preview', { n: report.added, c: report.changed, u: report.unchanged })}</p>
            {report.errors.length > 0 ? (
              <div className="msg err">
                <b>{t('files.errors')}</b>
                {report.errors.map((e, i) => (
                  <div key={i}>
                    {e.row ? t('files.row', { n: e.row }) + ': ' : ''}
                    {e.message}
                  </div>
                ))}
              </div>
            ) : (
              <button className="btn primary" disabled={report.added + report.changed === 0} onClick={apply}>
                {t('files.apply')}
              </button>
            )}
          </>
        )}
      </div>
    </>
  );
}
