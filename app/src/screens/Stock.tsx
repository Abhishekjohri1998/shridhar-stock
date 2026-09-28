import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { describeQty, itemMatches, pickName, type Item, type Location } from '@stock/core';
import type { Nav } from '../../App';
import { api } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { C } from '../theme';
import { Btn, Card, Loading, Msg, Page, Row, s } from '../ui';

export function StockScreen({ nav, onlyLow: startLow }: { nav: Nav; onlyLow: boolean }) {
  const { t, lang, version, changed } = useSession();
  const [q, setQ] = useState('');
  const [onlyLow, setOnlyLow] = useState(startLow);
  const [note, setNote] = useState('');
  const { value, error, busy, reload } = useLoad(async () => {
    const [items, stock, locs] = await Promise.all([api.items(), api.stock(), api.locations()]);
    return { items, stock, locs: locs.filter((l) => l.active) };
  }, [version]);

  const recount = async () => {
    try {
      const r = await api.recount();
      setNote(t('stock.recountDone', { n: r.checked, d: r.fixed.length }));
      changed();
    } catch (err) {
      setNote((err as Error).message);
    }
  };

  if (error) return <Page onRefresh={reload}><Msg kind="err">{error === 'offline' ? t('common.offline') : error}</Msg></Page>;
  if (!value) return <Loading />;
  const qty = new Map(value.stock.map((x) => [x.itemId + '|' + x.locationId, x.qty]));
  const qtyOf = (i: Item, l: Location) => qty.get(i.id + '|' + l.id) ?? 0;
  const isLow = (i: Item, l: Location) => i.reorderAt[l.id] != null && qtyOf(i, l) < i.reorderAt[l.id]!;
  const shop = value.locs.find((l) => l.kind === 'shop');
  const shown = value.items.filter((i) => (!q.trim() || itemMatches(i, q)) && (!onlyLow || (shop && isLow(i, shop))));

  return (
    <Page onRefresh={reload} busy={busy}>
      {note ? <Msg kind="ok">{note}</Msg> : null}
      <Row style={{ marginBottom: 8 }}>
        <TextInput
          style={[s.input, { flex: 1, minWidth: 180 }]}
          placeholder={t('common.search')}
          placeholderTextColor={C.faint}
          value={q}
          onChangeText={setQ}
        />
        <Btn title={(onlyLow ? '☑ ' : '☐ ') + t('stock.onlyLow')} kind="ghost" small onPress={() => setOnlyLow(!onlyLow)} />
        <Btn title={t('stock.recount')} small onPress={recount} />
      </Row>
      {shown.length === 0 && <Card><Text>{t('common.none')}</Text></Card>}
      {shown.map((i) => (
        <Card key={i.id} onPress={() => nav.go({ name: 'stockItem', id: i.id })}>
          <Text style={s.name}>{pickName(i.nameEn, i.nameKn, lang)}</Text>
          <Row style={{ marginTop: 6, gap: 16 }}>
            {value.locs.map((l) => {
              const v = qtyOf(i, l);
              return (
                <View key={l.id}>
                  <Text style={s.muted}>
                    {pickName(l.name, l.nameKn, lang)}
                    {i.racks[l.id] ? ' · ' + i.racks[l.id] : ''}
                  </Text>
                  <Text style={{ fontWeight: '700', color: v < 0 ? C.danger : isLow(i, l) ? C.gold : C.ink }}>
                    {describeQty(i, v, lang)}
                  </Text>
                </View>
              );
            })}
          </Row>
        </Card>
      ))}
    </Page>
  );
}
