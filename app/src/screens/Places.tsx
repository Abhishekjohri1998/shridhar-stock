import { useState } from 'react';
import { Text } from 'react-native';
import type { Location } from '@stock/core';
import { api } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { Btn, Card, Field, Loading, Msg, Page, Pill, Row, s } from '../ui';

export function PlacesScreen() {
  const { t, version, changed } = useSession();
  const { value: locs, error, busy, reload } = useLoad(() => api.locations(), [version]);
  const [editing, setEditing] = useState<Location | 'new' | null>(null);

  return (
    <Page onRefresh={reload} busy={busy}>
      {error ? <Msg kind="err">{error === 'offline' ? t('common.offline') : error}</Msg> : null}
      <Row style={{ marginBottom: 8 }}>
        <Btn title={'+ ' + t('places.new')} kind="primary" onPress={() => setEditing('new')} />
      </Row>
      {editing && (
        <PlaceForm
          place={editing === 'new' ? null : editing}
          onDone={() => {
            setEditing(null);
            changed();
          }}
        />
      )}
      {!locs && !error && <Loading />}
      {(locs ?? []).map((l) => (
        <Card key={l.id} onPress={() => setEditing(l)}>
          <Row>
            <Text style={s.name}>{l.name}</Text>
            {l.nameKn ? <Text style={s.muted}>{l.nameKn}</Text> : null}
            <Pill>{l.kind === 'shop' ? t('places.shop') : t('places.godown')}</Pill>
            {!l.active && <Pill kind="bad">{t('people.off')}</Pill>}
          </Row>
          {l.address ? <Text style={s.muted}>{l.address}</Text> : null}
        </Card>
      ))}
    </Page>
  );
}

function PlaceForm({ place, onDone }: { place: Location | null; onDone: () => void }) {
  const { t } = useSession();
  const [name, setName] = useState(place?.name ?? '');
  const [nameKn, setNameKn] = useState(place?.nameKn ?? '');
  const [address, setAddress] = useState(place?.address ?? '');
  const [error, setError] = useState('');

  const save = async (active?: boolean) => {
    setError('');
    try {
      const body = { name, nameKn, address, ...(active != null ? { active } : {}) };
      if (place) await api.updateLocation(place.id, body);
      else await api.addLocation(body);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Card>
      {error ? <Msg kind="err">{error}</Msg> : null}
      <Row>
        <Field label={t('places.name')} value={name} onChangeText={setName} />
        <Field label={t('places.nameKn')} value={nameKn} onChangeText={setNameKn} />
      </Row>
      <Field label={t('places.address')} value={address} onChangeText={setAddress} />
      <Row>
        <Btn title={t('common.save')} kind="primary" onPress={() => save()} />
        <Btn title={t('common.cancel')} onPress={onDone} />
        {place && place.kind === 'godown' && (
          <Btn title={place.active ? t('people.switchOff') : t('people.switchOn')} onPress={() => save(!place.active)} />
        )}
      </Row>
    </Card>
  );
}
