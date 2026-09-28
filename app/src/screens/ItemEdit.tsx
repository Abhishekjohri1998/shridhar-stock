import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import {
  blankItemForm,
  blankUnit,
  formToInput,
  itemToForm,
  pickName,
  type Item,
  type ItemForm,
  type Location,
  type UnitForm,
} from '@stock/core';
import type { Nav } from '../../App';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { C, R, SP } from '../theme';
import { Btn, Card, Field, Loading, Msg, Page, Row, Section, Title, s } from '../ui';

export function ItemEditScreen({ nav, id }: { nav: Nav; id?: string }) {
  const { t, lang, changed } = useSession();
  const [form, setForm] = useState<ItemForm>(blankItemForm);
  const [item, setItem] = useState<Item | null>(null);
  const [locs, setLocs] = useState<Location[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    api.locations().then(setLocs).catch((e: Error) => setError(e.message));
    if (id) {
      api
        .item(id)
        .then((it) => {
          setItem(it);
          setForm(itemToForm(it));
        })
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoaded(true));
    }
  }, [id]);

  const set = (patch: Partial<ItemForm>) => setForm((f) => ({ ...f, ...patch }));
  const setUnit = (i: number, patch: Partial<UnitForm>) =>
    setForm((f) => ({ ...f, units: f.units.map((u, j) => (j === i ? { ...u, ...patch } : u)) }));
  const setSlab = (i: number, k: number, patch: Partial<UnitForm['slabs'][number]>) =>
    setForm((f) => ({
      ...f,
      units: f.units.map((u, j) => (j === i ? { ...u, slabs: u.slabs.map((x, m) => (m === k ? { ...x, ...patch } : x)) } : u)),
    }));

  const save = async (active?: boolean) => {
    setBusy(true);
    setError('');
    try {
      const input = formToInput(form, active);
      if (item) await api.saveItem(item.id, input);
      else await api.addItem(input);
      changed();
      nav.back();
    } catch (err) {
      setError((err as Error).message === 'offline' ? t('common.offline') : (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <Loading />;
  const base = form.units[0]?.code || 'pc';
  const num = { keyboardType: 'decimal-pad' as const };

  return (
    <Page>
      <Title>{item ? pickName(item.nameEn, item.nameKn, lang) : t('items.new')}</Title>
      {error ? <Msg kind="err">{error}</Msg> : null}

      <Card>
        <Row>
          <Field label={t('items.nameKn')} value={form.nameKn} onChangeText={(v) => set({ nameKn: v })} />
          <Field label={t('items.nameEn')} value={form.nameEn} onChangeText={(v) => set({ nameEn: v })} />
        </Row>
        <Field label={t('items.category')} value={form.category} onChangeText={(v) => set({ category: v })} />
      </Card>

      <Card>
        <Section>{t('items.units')}</Section>
        <Text style={[s.muted, { marginBottom: SP.sm }]}>{t('items.unitHint')}</Text>
        {form.units.map((u, i) => (
          <View key={i} style={{ borderWidth: 1, borderColor: C.line, borderRadius: R.sm, padding: SP.sm, marginBottom: SP.sm, backgroundColor: C.bg }}>
            <Row style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={s.name}>{i === 0 ? u.code || '—' : (u.code || '?') + ' = ' + (u.perBase || '?') + ' ' + base}</Text>
              {i > 0 && <Btn title={t('common.remove')} kind="ghost" small onPress={() => set({ units: form.units.filter((_, j) => j !== i) })} />}
            </Row>
            <Row>
              <Field label={t('items.code')} value={u.code} onChangeText={(v) => setUnit(i, { code: v })} autoCapitalize="none" />
              <Field label={t('items.label')} value={u.label} onChangeText={(v) => setUnit(i, { label: v })} />
              <Field label={t('items.labelKn')} value={u.labelKn} onChangeText={(v) => setUnit(i, { labelKn: v })} />
              {i > 0 && <Field label={t('items.perBase')} value={u.perBase} onChangeText={(v) => setUnit(i, { perBase: v })} keyboardType="number-pad" />}
              <Field label={t('items.price') + ' ₹'} value={u.price} onChangeText={(v) => setUnit(i, { price: v })} {...num} />
              <Field label={t('items.min') + ' ₹'} value={u.min} onChangeText={(v) => setUnit(i, { min: v })} {...num} />
              <Field label={t('items.max') + ' ₹'} value={u.max} onChangeText={(v) => setUnit(i, { max: v })} {...num} />
              <Field label={t('items.cost') + ' ₹'} value={u.cost} onChangeText={(v) => setUnit(i, { cost: v })} {...num} />
            </Row>
            {u.slabs.length > 0 && <Text style={[s.muted, { marginBottom: 4 }]}>{t('items.slabs')}</Text>}
            {u.slabs.map((sl, k) => (
              <Row key={k}>
                <Field label={t('items.slabFrom') + ' (' + u.code + ')'} value={sl.minQty} onChangeText={(v) => setSlab(i, k, { minQty: v })} {...num} />
                <Field label={t('items.slabRate') + ' ₹'} value={sl.rate} onChangeText={(v) => setSlab(i, k, { rate: v })} {...num} />
                <Btn title="×" kind="ghost" small onPress={() => setUnit(i, { slabs: u.slabs.filter((_, m) => m !== k) })} />
              </Row>
            ))}
            <Btn title={'+ ' + t('items.addSlab')} kind="ghost" small onPress={() => setUnit(i, { slabs: [...u.slabs, { minQty: '', rate: '' }] })} />
          </View>
        ))}
        <Btn title={'+ ' + t('items.addUnit')} onPress={() => set({ units: [...form.units, blankUnit(false)] })} />
      </Card>

      <Card>
        <Field label={t('items.otherNames')} value={form.aliases} onChangeText={(v) => set({ aliases: v })} multiline style={{ flexBasis: 'auto' }} />
        <Text style={s.muted}>{t('items.otherNamesHint')}</Text>
      </Card>

      <Card>
        {locs.map((l) => (
          <Row key={l.id}>
            <Field
              label={t('items.rack', { place: pickName(l.name, l.nameKn, lang) })}
              value={form.racks[l.id] ?? ''}
              onChangeText={(v) => set({ racks: { ...form.racks, [l.id]: v } })}
            />
            <Field
              label={t('items.reorder', { place: pickName(l.name, l.nameKn, lang) })}
              value={form.reorderAt[l.id] ?? ''}
              onChangeText={(v) => set({ reorderAt: { ...form.reorderAt, [l.id]: v } })}
              {...num}
            />
          </Row>
        ))}
      </Card>

      <Row>
        <Btn title={t('common.save')} kind="primary" onPress={() => save()} disabled={busy} />
        <Btn title={t('common.cancel')} onPress={nav.back} />
        {item && (
          <Btn
            title={item.active ? t('items.deactivate') : t('items.activate')}
            kind={item.active ? 'danger' : 'plain'}
            onPress={() => save(!item.active)}
            disabled={busy}
          />
        )}
      </Row>
    </Page>
  );
}
