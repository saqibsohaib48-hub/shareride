import { useCallback, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { api } from '@/lib/api';
import { cached } from '@/lib/cache';
import { useApp } from '@/lib/app';
import { Button, Card, ErrorBox, Pill, T, useColors } from '@/ui';

const TABS = ['upcoming', 'active', 'completed', 'cancelled'] as const;

/** Trips (screen 21) — cached for offline viewing. */
export default function Trips() {
  const { t, me, money, lang } = useApp();
  const c = useColors();
  const [role, setRole] = useState<'passenger' | 'driver'>('passenger');
  const [tab, setTab] = useState<(typeof TABS)[number]>('upcoming');
  const [items, setItems] = useState<any[] | null>(null);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useFocusEffect(useCallback(() => {
    if (!me) return;
    setItems(null); setError(null);
    const path = role === 'passenger' ? '/bookings' : '/rides/mine';
    cached(`${path}:${tab}`, () => api(path, { query: { tab } })).then((r) => { setItems(r.data as any[]); setStale(r.fromCache); }).catch(setError);
  }, [me?.id, role, tab]));

  if (!me) return <View style={{ flex: 1, padding: 24, gap: 12, backgroundColor: c.bg }}><T variant="muted">Log in to see your trips.</T><Button title={t('auth.login')} onPress={() => router.push('/login')} /></View>;
  const when = (iso: string) => new Intl.DateTimeFormat(lang, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const chip = (label: string, sel: boolean, on: () => void) => (
    <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: sel }} onPress={on} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: sel ? c.ink : c.surface, borderWidth: 1.5, borderColor: sel ? c.ink : c.line }}>
      <Text style={{ color: sel ? c.bg : c.ink2, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ padding: 16, gap: 8 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>{chip(t('trips.asPassenger'), role === 'passenger', () => setRole('passenger'))}{chip(t('trips.asDriver'), role === 'driver', () => setRole('driver'))}</View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>{TABS.map((x) => chip(t(`trips.${x}` as any), tab === x, () => setTab(x)))}</View>
        {stale && <Pill text="Showing saved trips (offline)" tone="accent" />}
        <ErrorBox error={error} />
      </View>
      <FlatList data={items ?? []} keyExtractor={(x) => x.id} contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12 }}
        ListEmptyComponent={<T variant="muted">{items ? t('trips.empty') : t('common.loading')}</T>}
        renderItem={({ item: x }) => role === 'passenger' ? (
          <Pressable onPress={() => router.push(x.status === 'RESERVED' ? `/checkout/${x.id}` : `/ride/${x.rideId}`)}>
            <Card>
              <T variant="h2">{x.ride.originName} → {x.ride.destName}</T>
              <T variant="muted">{when(x.ride.departureAt)} · {x.seats} seat(s) · {money(x.breakdown.passengerTotalMinor, x.breakdown.currency)}</T>
              <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}><Pill text={x.status.replace(/_/g, ' ')} tone={x.status === 'CONFIRMED' ? 'brand' : 'default'} />{x.paymentStatus && <Pill text={x.paymentStatus} />}{x.status === 'COMPLETED' && !x.rated && <Pill text={t('trips.rate')} tone="accent" />}</View>
            </Card>
          </Pressable>
        ) : (
          <Pressable onPress={() => router.push(`/ride/${x.id}`)}>
            <Card>
              <T variant="h2">{x.origin.name} → {x.destination.name}</T>
              <T variant="muted">{when(x.departureAt)} · {t('ride.passengers', { count: x.confirmedPassengers })} · {t('search.seatsLeft', { count: x.seatsAvailable })}</T>
              <View style={{ flexDirection: 'row', gap: 6 }}><Pill text={x.status.replace(/_/g, ' ')} />{x.pendingRequests > 0 && <Pill text={`${x.pendingRequests} request(s)`} tone="accent" />}</View>
            </Card>
          </Pressable>
        )} />
    </View>
  );
}
