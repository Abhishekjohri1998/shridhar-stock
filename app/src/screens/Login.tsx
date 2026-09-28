import { useState } from 'react';
import { View } from 'react-native';
import { serverUrl } from '../lib/api';
import { NotAdminError, useSession } from '../lib/session';
import { Btn, Card, Field, Msg, Page, Title, s } from '../ui';
import { Text } from 'react-native';

export function LoginScreen({ onServer }: { onServer: () => void }) {
  const { t, signIn } = useSession();
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await signIn(phone, pin);
    } catch (err) {
      if (err instanceof NotAdminError) setError(t('app.adminOnly', { url: serverUrl() }));
      else setError((err as Error).message === 'offline' ? t('common.offline') : (err as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page>
      <View style={{ maxWidth: 420, width: '100%', alignSelf: 'center', marginTop: 40 }}>
        <Card>
          <Title>{t('login.title')}</Title>
          {error ? <Msg kind="err">{error}</Msg> : null}
          <Field label={t('login.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoComplete="tel" />
          <Field
            label={t('login.pin')}
            value={pin}
            onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))}
            keyboardType="number-pad"
            secureTextEntry
            onSubmitEditing={go}
          />
          <Btn title={t('login.go')} kind="primary" onPress={go} disabled={busy || !phone || pin.length < 4} />
        </Card>
        <Text style={[s.muted, { textAlign: 'center', marginVertical: 8 }]}>{serverUrl()}</Text>
        <Btn title={t('server.change')} kind="ghost" onPress={onServer} />
      </View>
    </Page>
  );
}
