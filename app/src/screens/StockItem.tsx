import { useState } from 'react';
import { Text, View } from 'react-native';
import { ADJUST_REASONS, describeQty, pickName, type AdjustReason, type MsgKey } from '@stock/core';
import type { Nav } from '../../App';
import { api, requestId } from '../lib/api';
import { useLoad, useSession } from '../lib/session';
import { C } from '../theme';
import { Btn, Card, Choice, Field, Loading, Msg, Page, Section, Title, s } from '../ui';

/** One item: what each place has, an opening count or a correction, and the last changes. */
export function StockItemScreen({ nav, id }: { nav: Nav; id: string }) {
  const { t, lang, changed } = useSession();
  const { value, error, reload } = useLoad(async () => {
    const [item, locs, stock, moves] = await Promise.all([api.item(id), api.locations(), api.stock(), api.moves(id)]);
    return { item, locs: locs.filter((l) => l.active), stock: stock.filter((x) => x.itemId === id), moves };
  }, [id]);
  const [loc, setLoc] = useState('');
  const [actual, setActual] = useState('');
  const [reason, setReason] = useState<AdjustReason>('counted');
  const [note, setNote] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  if (error) return <Page><Msg kind="err">{error === 'offline' ? t('common.offline') : error}</Msg></Page>;
  if (!value) return <Loading />;
  const { item, locs, stock, moves } = value;
  const here = loc || locs[0]?.id || '';
  const placeName = (lid?: string) => {
    const l = locs.find((x) => x.id === lid);
    return l ? pickName(l.name, l.nameKn, lang) : '';
  };
  const isFirst = moves.every((m) => m.from !== here && m.to !== here);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setMsg('');
    try {
      await fn();
      setActual('');
      setNote('');
      changed();
      reload();
    } catch (err) {
      setMsg((err as Error).message === 'offline' ? t('common.offline') : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    isFirst
      ? run(() => api.openStock(item.id, here, Number(actual)))
      : run(() =>
          api.adjust({ itemId: item.id, locationId: here, actual: Number(actual), reason, ...(note.trim() ? { note } : {}), requestId: requestId() }),
        );

  return (
    <Page>
      <Title>{pickName(item.nameEn, item.nameKn, lang)}</Title>
      <Card>
        {locs.map((l) => {
          const v = stock.find((x) => x.locationId === l.id)?.qty ?? 0;
          const low = item.reorderAt[l.id] != null && v < item.reorderAt[l.id]!;
          return (
            <View key={l.id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
              <Text>
                {pickName(l.name, l.nameKn, lang)}
                {item.racks[l.id] ? <Text style={s.muted}> · {item.racks[l.id]}</Text> : null}
              </Text>
              <Text style={{ fontWeight: '700', color: v < 0 ? C.danger : low ? C.gold : C.ink }}>
                {describeQty(item, v, lang)}
                {v < 0 ? '  ' + t('stock.countThis') : ''}
              </Text>
            </View>
          );
        })}
      </Card>

      <Card>
        <Section>{isFirst ? t('stock.open') : t('stock.adjust')}</Section>
        {msg ? <Msg kind="err">{msg}</Msg> : null}
        <Choice options={locs.map((l) => ({ value: l.id, label: pickName(l.name, l.nameKn, lang) }))} value={here} onChange={setLoc} />
        <Field label={t('stock.actual') + ' · ' + item.units[0]!.code} value={actual} onChangeText={setActual} keyboardType="decimal-pad" />
        {!isFirst && (
          <>
            <Text style={[s.muted, { marginBottom: 4 }]}>{t('stock.reason')}</Text>
            <Choice options={ADJUST_REASONS.map((r) => ({ value: r, label: t(('stock.reason.' + r) as MsgKey) }))} value={reason} onChange={setReason} />
            <Field label={t('stock.note')} value={note} onChangeText={setNote} />
          </>
        )}
        <Btn title={isFirst ? t('stock.open') : t('stock.adjust')} kind="primary" onPress={submit} disabled={busy || actual.trim() === ''} />
      </Card>

      <Section>{t('stock.moves')}</Section>
      {moves.length === 0 && <Text style={s.muted}>{t('common.none')}</Text>}
      {moves.map((m) => (
        <Text key={m.id} style={[s.muted, { paddingVertical: 4, borderBottomWidth: 1, borderColor: C.line }]}>
          {new Date(m.at).toLocaleString('en-IN')} · <Text style={{ fontWeight: '700', color: C.ink700 }}>{t(('stock.kind.' + m.kind) as MsgKey)}</Text> ·{' '}
          {m.from ? placeName(m.from) + ' −' : placeName(m.to) + ' +'}
          {describeQty(item, m.qty, lang)}
          {m.kind === 'adjust' ? ' · ' + t(('stock.reason.' + m.ref) as MsgKey) : ''}
          {m.note ? ' · ' + m.note : ''}
        </Text>
      ))}
      <View style={{ marginTop: 16 }}>
        <Btn title={t('common.back')} onPress={nav.back} />
      </View>
    </Page>
  );
}
