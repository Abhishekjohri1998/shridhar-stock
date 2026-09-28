import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { C, R, SP, TYPE, shadow } from './theme';

/** A scrolling page with pull-to-refresh when `onRefresh` is given. */
export function Page({ children, onRefresh, busy }: { children: ReactNode; onRefresh?: () => void; busy?: boolean }) {
  return (
    <ScrollView
      style={s.page}
      contentContainerStyle={s.pageInner}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!busy} onRefresh={onRefresh} colors={[C.accent]} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={[TYPE.title, { marginBottom: SP.md }]}>{children}</Text>;
}

export function Section({ children }: { children: ReactNode }) {
  return <Text style={[TYPE.section, { marginTop: SP.lg, marginBottom: SP.sm }]}>{children}</Text>;
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => [s.card, style, pressed && { backgroundColor: C.accentWash }]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[s.card, style]}>{children}</View>;
}

export function Field({ label, style, ...input }: TextInputProps & { label: string; style?: ViewStyle }) {
  return (
    <View style={[s.field, style]}>
      <Text style={s.label}>{label}</Text>
      <TextInput placeholderTextColor={C.faint} style={[s.input, input.editable === false && { opacity: 0.6 }]} {...input} />
    </View>
  );
}

export function Btn({
  title,
  onPress,
  kind = 'plain',
  disabled,
  small,
}: {
  title: string;
  onPress: () => void;
  kind?: 'primary' | 'plain' | 'danger' | 'ghost';
  disabled?: boolean;
  small?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        small && s.btnSmall,
        kind === 'primary' && s.btnPrimary,
        kind === 'danger' && s.btnDanger,
        kind === 'ghost' && s.btnGhost,
        disabled && { opacity: 0.45 },
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      <Text
        style={[
          s.btnText,
          kind === 'primary' && { color: C.accentInk },
          kind === 'danger' && { color: C.danger },
          kind === 'ghost' && { color: C.accentDeep },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

/** One of a few choices, as a row of chips. */
export function Choice<V extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <View style={s.chips}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => onChange(o.value)} style={[s.chip, o.value === value && s.chipOn]}>
          <Text style={[s.chipText, o.value === value && { color: C.accentDeep }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Msg({ kind, children }: { kind: 'err' | 'ok'; children: ReactNode }) {
  return (
    <View style={[s.msg, kind === 'err' ? s.msgErr : s.msgOk]}>
      <Text style={{ color: kind === 'err' ? C.danger : C.accentDeep }}>{children}</Text>
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.row, style]}>{children}</View>;
}

export function Loading() {
  return <ActivityIndicator color={C.accent} style={{ marginTop: SP.xl }} />;
}

export function Pill({ children, kind }: { children: ReactNode; kind?: 'warn' | 'bad' }) {
  return (
    <Text style={[s.pill, kind === 'warn' && { backgroundColor: C.goldWash, color: C.gold }, kind === 'bad' && { backgroundColor: C.dangerWash, color: C.danger }]}>
      {children}
    </Text>
  );
}

export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  pageInner: { padding: SP.lg, paddingBottom: 60, maxWidth: 900, width: '100%', alignSelf: 'center' },
  card: { backgroundColor: C.card, borderRadius: R.md, borderWidth: 1, borderColor: C.line, padding: SP.md, marginBottom: SP.sm, ...shadow(1) },
  field: { marginBottom: SP.sm, flexGrow: 1, flexBasis: 150 },
  label: { fontSize: 13, fontWeight: '600', color: C.soft, marginBottom: 4 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: C.lineStrong,
    borderRadius: R.sm,
    backgroundColor: C.well,
    paddingHorizontal: 12,
    fontSize: 16,
    color: C.ink,
  },
  btn: {
    minHeight: 46,
    paddingHorizontal: 16,
    borderRadius: R.sm,
    borderWidth: 1,
    borderColor: C.lineStrong,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSmall: { minHeight: 36, paddingHorizontal: 10 },
  btnPrimary: { backgroundColor: C.accent, borderColor: C.accentDeep },
  btnDanger: { backgroundColor: C.dangerWash, borderColor: C.dangerEdge },
  btnGhost: { backgroundColor: 'transparent', borderColor: 'transparent' },
  btnText: { fontSize: 15, fontWeight: '700', color: C.ink700 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.xs, marginBottom: SP.sm },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: R.pill, borderWidth: 1, borderColor: C.line, backgroundColor: C.card },
  chipOn: { backgroundColor: C.accentWash, borderColor: C.accentEdge },
  chipText: { fontWeight: '600', color: C.soft },
  msg: { padding: SP.md, borderRadius: R.sm, borderWidth: 1, marginBottom: SP.sm },
  msgErr: { backgroundColor: C.dangerWash, borderColor: C.dangerEdge },
  msgOk: { backgroundColor: C.accentWash, borderColor: C.accentEdge },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, alignItems: 'center' },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill, backgroundColor: C.well, color: C.soft, fontSize: 12, overflow: 'hidden' },
  name: { fontSize: 16, fontWeight: '700', color: C.ink },
  muted: { color: C.faint, fontSize: 13 },
});
