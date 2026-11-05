import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { router } from 'expo-router';
import { LANGUAGES } from '@share-ride/shared';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app';
import { Button, Card, ErrorBox, Field, Pill, T, useColors } from '@/ui';

/** Profile (screen 25) + Vehicles (24) + Settings (29). */
export default function Profile() {
  const { t, me, logout, lang, setLang, countries, country, setCountry } = useApp();
  const c = useColors();
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [v, setV] = useState({ make: '', model: '', color: '', licensePlate: '', seats: '5' });
  const [adding, setAdding] = useState(false);
  const [del, setDel] = useState(false);
  const [pw, setPw] = useState('');
  const [error, setError] = useState<unknown>(null);
  const load = () => api('/vehicles').then(setVehicles).catch(() => {});
  useEffect(() => { if (me) load(); }, [me?.id]);

  if (!me) return (
    <View style={{ flex: 1, padding: 24, gap: 12, backgroundColor: c.bg }}>
      <T variant="h2">{t('nav.profile')}</T>
      <Button title={t('auth.login')} onPress={() => router.push('/login')} />
      <Button title={t('auth.register')} kind="outline" onPress={() => router.push('/register')} />
    </View>
  );
  const chips = <T,>(items: T[], key: (x: T) => string, label: (x: T) => string, sel: (x: T) => boolean, on: (x: T) => void) => (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{items.map((x) => (
      <Pressable key={key(x)} accessibilityRole="radio" accessibilityState={{ selected: sel(x) }} onPress={() => on(x)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1.5, borderColor: sel(x) ? c.brand : c.line }}>
        <Text style={{ color: c.ink }}>{label(x)}</Text>
      </Pressable>
    ))}</View>
  );
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Card>
        <T variant="h1">{me.name}</T>
        <T variant="muted">★ {me.rating ? me.rating.toFixed(1) : 'New'} ({me.ratingCount}) · {me.ridesAsDriver} rides given · {me.tripsAsPassenger} trips</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {me.badges.phone && <Pill text={`✓ ${t('verify.phone')}`} tone="brand" />}
          {me.badges.email && <Pill text={`✓ ${t('verify.email')}`} tone="brand" />}
          {me.badges.identity && <Pill text={`✓ ${t('verify.identity')}`} tone="brand" />}
          {me.badges.driver && <Pill text={`✓ ${t('verify.driver')}`} tone="brand" />}
          {me.isDemo && <Pill text={t('common.demo')} tone="accent" />}
        </View>
        {!me.badges.phone && <Button title="Verify phone" kind="outline" onPress={() => router.push('/verify-phone')} />}
      </Card>
      <Card>
        <T variant="h2">{t('profile.vehicles')}</T>
        {vehicles.map((x) => <T key={x.id} variant="muted">{x.color} {x.make} {x.model} · {x.licensePlate} · {x.verificationStatus.toLowerCase()}</T>)}
        {adding ? (
          <View style={{ gap: 10 }}>
            <Field label="Make" value={v.make} onChangeText={(s) => setV({ ...v, make: s })} />
            <Field label="Model" value={v.model} onChangeText={(s) => setV({ ...v, model: s })} />
            <Field label="Color" value={v.color} onChangeText={(s) => setV({ ...v, color: s })} />
            <Field label="License plate" value={v.licensePlate} onChangeText={(s) => setV({ ...v, licensePlate: s })} autoCapitalize="characters" />
            <Field label="Total seats (incl. driver)" value={v.seats} onChangeText={(s) => setV({ ...v, seats: s.replace(/\D/g, '') })} keyboardType="number-pad" />
            <ErrorBox error={error} />
            <Button title="Save vehicle" onPress={async () => { setError(null); try { await api('/vehicles', { method: 'POST', body: { ...v, seats: Number(v.seats), vehicleType: 'sedan' } }); setAdding(false); load(); } catch (e) { setError(e); } }} />
          </View>
        ) : <Button title={`＋ ${t('create.addVehicle')}`} kind="outline" onPress={() => setAdding(true)} />}
      </Card>
      <Card>
        <T variant="h2">{t('profile.settings')}</T>
        <T style={{ fontWeight: '600' }}>{t('profile.language')}</T>
        {chips([...LANGUAGES], (l) => l.code, (l) => l.name, (l) => l.code === lang, (l) => { setLang(l.code); api('/profile', { method: 'PATCH', body: { language: l.code } }).catch(() => {}); })}
        <T style={{ fontWeight: '600' }}>{t('auth.country')}</T>
        {chips(countries, (x) => x.code, (x) => `${x.code} · ${x.currency}`, (x) => x.code === country?.code, (x) => { setCountry(x.code); api('/profile', { method: 'PATCH', body: { countryCode: x.code, preferredCurrency: x.currency } }).catch(() => {}); })}
      </Card>
      <Card>
        <Button title={t('nav.earnings')} kind="outline" onPress={() => router.push('/earnings')} />
        <Button title={t('nav.notifications')} kind="outline" onPress={() => router.push('/notifications')} />
        <Button title="Safety Center" kind="outline" onPress={() => router.push('/safety')} />
        <Button title={t('nav.logout')} kind="outline" onPress={logout} />
      </Card>
      <Card>
        <T variant="h2">{t('profile.deleteAccount')}</T>
        {!del ? <Button title={`${t('profile.deleteAccount')}…`} kind="danger" onPress={() => setDel(true)} /> : (
          <>
            <T variant="muted">Removes your personal data. Pending rides, bookings and earnings must be settled first.</T>
            <Field label={t('auth.password')} value={pw} onChangeText={setPw} secureTextEntry />
            <ErrorBox error={error} />
            <Button title="Permanently delete" kind="danger" onPress={async () => { setError(null); try { await api('/profile/delete', { method: 'POST', body: { password: pw || undefined } }); await logout(); router.replace('/welcome'); } catch (e) { setError(e); } }} />
          </>
        )}
      </Card>
    </ScrollView>
  );
}
