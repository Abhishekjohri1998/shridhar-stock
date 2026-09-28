import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Nav } from '../../App';
import { api } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { C, R, SP, shadow } from '../theme';
import { Loading, Msg, Page } from '../ui';

export function HomeScreen({ nav }: { nav: Nav }) {
  const { t, version } = useSession();
  const { value, error, busy, reload } = useLoad(async () => {
    const [items, stock, locs] = await Promise.all([api.items(), api.stock(), api.locations()]);
    const shop = locs.find((l) => l.kind === 'shop');
    const qty = new Map(stock.map((x) => [x.itemId + '|' + x.locationId, x.qty]));
    const low = shop
      ? items.filter((i) => i.reorderAt[shop.id] != null && (qty.get(i.id + '|' + shop.id) ?? 0) < i.reorderAt[shop.id]!).length
      : 0;
    const negative = new Set(stock.filter((x) => x.qty < 0).map((x) => x.itemId)).size;
    return { items: items.length, low, negative, places: locs.length };
  }, [version]);

  const tile = (n: number, label: string, onPress: () => void, tone?: 'warn' | 'bad') => (
    <Pressable onPress={onPress} style={({ pressed }) => [st.tile, pressed && { backgroundColor: C.accentWash }]}>
      <Text style={[st.n, tone === 'warn' && n > 0 && { color: C.gold }, tone === 'bad' && n > 0 && { color: C.danger }]}>{n}</Text>
      <Text style={st.label}>{label}</Text>
    </Pressable>
  );

  return (
    <Page onRefresh={reload} busy={busy}>
      {error ? <Msg kind="err">{error === 'offline' ? t('common.offline') : error}</Msg> : null}
      {!value && !error && <Loading />}
      {value && (
        <View style={st.grid}>
          {tile(value.items, t('home.items'), () => nav.go({ name: 'items' }))}
          {tile(value.low, t('home.low'), () => nav.go({ name: 'stock', onlyLow: true }), 'warn')}
          {tile(value.negative, t('home.negative'), () => nav.go({ name: 'stock' }), 'bad')}
          {tile(value.places, t('home.places'), () => nav.go({ name: 'places' }))}
        </View>
      )}
    </Page>
  );
}

const st = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm },
  tile: {
    flexGrow: 1,
    flexBasis: 150,
    backgroundColor: C.card,
    borderRadius: R.md,
    borderWidth: 1,
    borderColor: C.line,
    padding: SP.lg,
    ...shadow(1),
  },
  n: { fontSize: 32, fontWeight: '800', color: C.ink },
  label: { color: C.ink700, marginTop: 4 },
});
