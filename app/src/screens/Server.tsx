import { useState } from 'react';
import { Text } from 'react-native';
import type { Nav } from '../../App';
import { api, cleanUrl, defaultServerUrl, serverUrl, setServerUrl } from '../lib/api';
import { useSession } from '../lib/session';
import { Btn, Card, Field, Msg, Page, Row, Title, s } from '../ui';

/** Which stock server this tablet talks to. Checked before it is saved. */
export function ServerScreen({ nav }: { nav: Nav }) {
  const { t } = useSession();
  const [url, setUrl] = useState(serverUrl());
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  const check = async () => {
    setError('');
    setOk(false);
    const before = serverUrl();
    try {
      await setServerUrl(url);
      await api.health();
      setUrl(cleanUrl(url));
      setOk(true);
    } catch (err) {
      await setServerUrl(before);
      setError((err as Error).message === 'offline' ? t('common.offline') : (err as Error).message);
    }
  };

  return (
    <Page>
      <Card>
        <Title>{t('server.title')}</Title>
        {error ? <Msg kind="err">{error}</Msg> : null}
        {ok ? <Msg kind="ok">{t('server.ok')}</Msg> : null}
        <Field label={t('server.url')} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        <Text style={[s.muted, { marginBottom: 12 }]}>{t('server.hint')}</Text>
        <Row>
          <Btn title={t('server.check')} kind="primary" onPress={check} />
          <Btn title={t('common.back')} onPress={nav.back} />
          {url !== defaultServerUrl() && <Btn title={defaultServerUrl()} kind="ghost" small onPress={() => setUrl(defaultServerUrl())} />}
        </Row>
      </Card>
    </Page>
  );
}
