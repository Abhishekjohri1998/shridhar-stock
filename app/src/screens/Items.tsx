import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { formatRupees, itemMatches, pickName } from '@stock/core';
import type { Nav } from '../../App';
import { api } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { C } from '../theme';
import { Btn, Card, Loading, Msg, Page, Pill, Row, s } from '../ui';

export function ItemsScreen({ nav }: { nav: Nav }) {
  const { t, lang, version } = useSession();
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const { value: items, error, busy, reload } = useLoad(() => api.items(true), [version]);

  const shown = (items ?? []).filter((i) => (showAll || i.active) && (!q.trim() || itemMatches(i, q)));
  return (
    <Page onRefresh={reload} busy={busy}>
      <Row style={{ marginBottom: 8 }}>
        <TextInput
          style={[s.input, { flex: 1, minWidth: 180 }]}
          placeholder={t('common.search')}
          placeholderTextColor={C.faint}
          value={q}
          onChangeText={setQ}
        />
        <Btn title={'+ ' + t('items.new')} kind="primary" onPress={() => nav.go({ name: 'item' })} />
      </Row>
      <Btn title={(showAll ? '☑ ' : '☐ ') + t('items.showInactive')} kind="ghost" small onPress={() => setShowAll(!showAll)} />
      {error ? <Msg kind="err">{error === 'offline' ? t('common.offline') : error}</Msg> : null}
      {!items && !error && <Loading />}
      {items && items.length === 0 && <Card><Text>{t('items.empty')}</Text></Card>}
      {shown.map((i) => (
        <Card key={i.id} onPress={() => nav.go({ name: 'item', id: i.id })}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={s.name}>{pickName(i.nameEn, i.nameKn, lang)}</Text>
              <Text style={s.muted}>{lang === 'kn' ? i.nameEn : i.nameKn}</Text>
              {!i.active && <Pill>{t('items.inactive')}</Pill>}
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {i.units.map((u) => (
                <Text key={u.code}>
                  {(lang === 'kn' && u.labelKn) || u.label} {formatRupees(u.price)}
                  {u.perBase > 1 ? <Text style={s.muted}> · {u.perBase} {i.units[0]!.code}</Text> : null}
                </Text>
              ))}
            </View>
          </Row>
        </Card>
      ))}
    </Page>
  );
}
