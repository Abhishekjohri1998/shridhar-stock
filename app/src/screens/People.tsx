import { useState } from 'react';
import { Text, View } from 'react-native';
import { ROLES, pickName, type Location, type MsgKey, type Person, type Role } from '@stock/core';
import { api } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { Btn, Card, Choice, Field, Loading, Msg, Page, Pill, Row, s } from '../ui';

export function PeopleScreen() {
  const { t, me, version, changed } = useSession();
  const { value, error, busy, reload } = useLoad(async () => {
    const [people, locs] = await Promise.all([api.people(), api.locations()]);
    return { people, godowns: locs.filter((l) => l.kind === 'godown') };
  }, [version]);
  const [editing, setEditing] = useState<Person | 'new' | null>(null);
  const [msg, setMsg] = useState('');

  return (
    <Page onRefresh={reload} busy={busy}>
      {error ? <Msg kind="err">{error === 'offline' ? t('common.offline') : error}</Msg> : null}
      {msg ? <Msg kind="ok">{msg}</Msg> : null}
      <Row style={{ marginBottom: 8 }}>
        <Btn title={'+ ' + t('people.new')} kind="primary" onPress={() => setEditing('new')} />
      </Row>
      {editing && value && (
        <PersonForm
          person={editing === 'new' ? null : editing}
          godowns={value.godowns}
          onDone={(m) => {
            setEditing(null);
            setMsg(m ?? '');
            changed();
          }}
        />
      )}
      {!value && !error && <Loading />}
      {(value?.people ?? []).map((p) => (
        <Card key={p.id} onPress={() => setEditing(p)}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <Text style={s.name}>
                {p.name} {p.id === me?.id ? <Text style={s.muted}>({t('people.you')})</Text> : null}
              </Text>
              <Text style={s.muted}>{p.phone}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text>{t(('role.' + p.role) as MsgKey)}</Text>
              {p.linkedId ? <Text style={s.muted}>{value?.godowns.find((g) => g.id === p.linkedId)?.name}</Text> : null}
              {!p.active && <Pill kind="bad">{t('people.off')}</Pill>}
            </View>
          </Row>
        </Card>
      ))}
    </Page>
  );
}

function PersonForm({ person, godowns, onDone }: { person: Person | null; godowns: Location[]; onDone: (msg?: string) => void }) {
  const { t, lang } = useSession();
  const [name, setName] = useState(person?.name ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [role, setRole] = useState<Role>(person?.role ?? 'worker');
  const [linkedId, setLinkedId] = useState(person?.linkedId ?? godowns[0]?.id ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    setError('');
    try {
      await fn();
      onDone(msg);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const link = role === 'godown' ? { linkedId } : {};

  return (
    <Card>
      {error ? <Msg kind="err">{error}</Msg> : null}
      <Row>
        <Field label={t('people.name')} value={name} onChangeText={setName} />
        <Field label={t('people.phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" editable={!person} />
      </Row>
      <Text style={[s.muted, { marginBottom: 4 }]}>{t('people.role')}</Text>
      <Choice options={ROLES.map((r) => ({ value: r, label: t(('role.' + r) as MsgKey) }))} value={role} onChange={setRole} />
      {role === 'godown' && (
        <>
          <Text style={[s.muted, { marginBottom: 4 }]}>{t('people.link')}</Text>
          <Choice options={godowns.map((g) => ({ value: g.id, label: pickName(g.name, g.nameKn, lang) }))} value={linkedId} onChange={setLinkedId} />
        </>
      )}
      <Field
        label={person ? t('people.resetPin') : t('people.pin')}
        value={pin}
        onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
      />
      <Row>
        <Btn
          title={t('common.save')}
          kind="primary"
          onPress={() => run(() => (person ? api.updatePerson(person.id, { name, role, ...link }) : api.addPerson({ name, phone, role, pin, ...link })))}
        />
        {person && <Btn title={t('people.resetPin')} disabled={pin.length < 4} onPress={() => run(() => api.resetPin(person.id, pin), t('common.saved'))} />}
        {person && (
          <Btn
            title={person.active ? t('people.switchOff') : t('people.switchOn')}
            kind={person.active ? 'danger' : 'plain'}
            onPress={() => run(() => api.updatePerson(person.id, { active: !person.active }))}
          />
        )}
        <Btn title={t('common.cancel')} onPress={() => onDone()} />
      </Row>
    </Card>
  );
}
