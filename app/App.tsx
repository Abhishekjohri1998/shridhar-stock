import { useState } from 'react';
import { BackHandler, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useEffect } from 'react';
import type { MsgKey } from '@stock/core';
import { SessionProvider, useSession } from './src/lib/session';
import { C, SP } from './src/theme';
import { LoginScreen } from './src/screens/Login';
import { ServerScreen } from './src/screens/Server';
import { HomeScreen } from './src/screens/Home';
import { ItemsScreen } from './src/screens/Items';
import { ItemEditScreen } from './src/screens/ItemEdit';
import { StockScreen } from './src/screens/Stock';
import { StockItemScreen } from './src/screens/StockItem';
import { PlacesScreen } from './src/screens/Places';
import { PeopleScreen } from './src/screens/People';
import { FilesScreen } from './src/screens/Files';

/**
 * Where the admin is. Tabs are the top level; an item being edited or counted sits on top of its
 * tab and the Android back button takes it off. No navigation library: this is all it needs.
 */
export type Route =
  | { name: 'home' }
  | { name: 'items' }
  | { name: 'item'; id?: string }
  | { name: 'stock'; onlyLow?: boolean }
  | { name: 'stockItem'; id: string }
  | { name: 'places' }
  | { name: 'people' }
  | { name: 'files' }
  | { name: 'server' };

export interface Nav {
  go: (r: Route) => void;
  back: () => void;
}

const TABS: { name: Route['name']; key: MsgKey }[] = [
  { name: 'home', key: 'nav.home' },
  { name: 'items', key: 'nav.items' },
  { name: 'stock', key: 'nav.stock' },
  { name: 'places', key: 'nav.places' },
  { name: 'people', key: 'nav.people' },
  { name: 'files', key: 'nav.files' },
];

function Screen({ route, nav }: { route: Route; nav: Nav }) {
  switch (route.name) {
    case 'home':
      return <HomeScreen nav={nav} />;
    case 'items':
      return <ItemsScreen nav={nav} />;
    case 'item':
      return <ItemEditScreen nav={nav} id={route.id} />;
    case 'stock':
      return <StockScreen nav={nav} onlyLow={!!route.onlyLow} />;
    case 'stockItem':
      return <StockItemScreen nav={nav} id={route.id} />;
    case 'places':
      return <PlacesScreen />;
    case 'people':
      return <PeopleScreen />;
    case 'files':
      return <FilesScreen />;
    case 'server':
      return <ServerScreen nav={nav} />;
  }
}

function Shell() {
  const { ready, me, t, lang, setLang, signOut } = useSession();
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);
  const [signedOutRoute, setSignedOutRoute] = useState<'login' | 'server'>('login');
  const route = stack[stack.length - 1]!;

  const nav: Nav = {
    go: (r) => setStack((s) => (TABS.some((tab) => tab.name === r.name) ? [r] : [...s, r])),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length > 1) {
        nav.back();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  });

  if (!ready) return <View style={{ flex: 1, backgroundColor: C.bg }} />;

  const top = (
    <View style={st.top}>
      <Text style={st.brand}>{t('app.name')}</Text>
      <Pressable onPress={() => setLang(lang === 'kn' ? 'en' : 'kn')} hitSlop={8}>
        <Text style={st.link}>{t('common.lang')}</Text>
      </Pressable>
      {me && (
        <Pressable onPress={signOut} hitSlop={8} style={{ marginLeft: 'auto' }}>
          <Text style={st.link}>
            {me.name} · {t('common.signOut')}
          </Text>
        </Pressable>
      )}
    </View>
  );

  if (!me) {
    return (
      <>
        {top}
        {signedOutRoute === 'server' ? (
          <ServerScreen nav={{ go: () => undefined, back: () => setSignedOutRoute('login') }} />
        ) : (
          <LoginScreen onServer={() => setSignedOutRoute('server')} />
        )}
      </>
    );
  }

  const tab = stack[0]!.name;
  return (
    <>
      {top}
      <ScrollView horizontal style={st.tabs} contentContainerStyle={st.tabsInner} showsHorizontalScrollIndicator={false}>
        {TABS.map((x) => (
          <Pressable key={x.name} onPress={() => nav.go({ name: x.name } as Route)} style={[st.tab, tab === x.name && st.tabOn]}>
            <Text style={[st.tabText, tab === x.name && { color: C.accentDeep }]}>{t(x.key)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Screen route={route} nav={nav} />
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: C.card }} edges={['top', 'left', 'right']}>
        <StatusBar barStyle="dark-content" backgroundColor={C.card} />
        <SessionProvider>
          <View style={{ flex: 1, backgroundColor: C.bg }}>
            <Shell />
          </View>
        </SessionProvider>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const st = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.md,
    paddingHorizontal: SP.lg,
    paddingVertical: SP.sm,
    backgroundColor: C.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  brand: { fontSize: 18, fontWeight: '800', color: C.accentDeep },
  link: { color: C.accentDeep, fontWeight: '600' },
  tabs: { flexGrow: 0, backgroundColor: C.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  tabsInner: { paddingHorizontal: SP.md, paddingVertical: SP.xs, gap: 4 },
  tab: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10 },
  tabOn: { backgroundColor: C.accentWash },
  tabText: { fontWeight: '700', color: C.soft },
});
