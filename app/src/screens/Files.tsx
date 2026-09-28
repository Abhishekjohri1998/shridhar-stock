import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Text } from 'react-native';
import { downloadCsv, serverUrl } from '../lib/api';
import { useSession } from '../lib/session';
import { Btn, Card, Field, Msg, Page, Row, Title, s } from '../ui';

const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Each file is made on the server, saved here, then handed to the share sheet (WhatsApp, Drive, email). */
export function FilesScreen() {
  const { t } = useSession();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const share = async (path: string, name: string) => {
    setBusy(true);
    setError('');
    try {
      const uri = await downloadCsv(path, name);
      await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: name, UTI: 'public.comma-separated-values-text' });
    } catch (err) {
      setError((err as Error).message === 'offline' ? t('common.offline') : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <Title>{t('files.title')}</Title>
      <Text style={[s.muted, { marginBottom: 12 }]}>{t('files.hint')}</Text>
      {error ? <Msg kind="err">{error}</Msg> : null}
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={s.name}>{t('files.items')}</Text>
          <Btn title={t('files.share')} disabled={busy} onPress={() => share('/export/items.csv', 'items.csv')} />
        </Row>
      </Card>
      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={s.name}>{t('files.stock')}</Text>
          <Btn title={t('files.share')} disabled={busy} onPress={() => share('/export/stock.csv', 'stock.csv')} />
        </Row>
      </Card>
      <Card>
        <Text style={s.name}>{t('files.ledger')}</Text>
        <Row>
          <Field label={t('files.from') + ' (YYYY-MM-DD)'} value={from} onChangeText={setFrom} />
          <Field label={t('files.to') + ' (YYYY-MM-DD)'} value={to} onChangeText={setTo} />
        </Row>
        <Btn
          title={t('files.share')}
          disabled={busy}
          onPress={() => share('/export/ledger.csv?from=' + from.trim() + '&to=' + to.trim(), 'ledger-' + from.trim() + '-' + to.trim() + '.csv')}
        />
      </Card>
      <Text style={[s.muted, { marginTop: 12 }]}>{t('files.importOnWeb', { url: serverUrl() })}</Text>
    </Page>
  );
}
