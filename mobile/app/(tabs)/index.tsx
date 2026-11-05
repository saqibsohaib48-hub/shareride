import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app';
import { Button, Card, Place, PlacePicker, T, useColors } from '@/ui';
import { DayPicker, todayKey } from '@/DayPicker';

/** Home (screen 7) + passenger & driver dashboards (spec §58–59). */
export default function Home() {
  const { t, me, country, money, lang } = useApp();
  const c = useColors();
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [date, setDate] = useState(todayKey());
  const [seats, setSeats] = useState(1);
  const [popular, setPopular] = useState<any[]>([]);
  const [trip, setTrip] = useState<any>(null);
  const [drive, setDrive] = useState<any>(null);
  const [earn, setEarn] = useState<any>(null);

  useEffect(() => { if (country) api('/routes/popular', { query: { country: country.code } }).then(setPopular).catch(() => {}); }, [country?.code]);
  useEffect(() => {
    if (!me) return;
    api('/bookings', { query: { tab: 'upcoming' } }).then((b) => setTrip(b[0] ?? null)).catch(() => {});
    api('/rides/mine', { query: { tab: 'upcoming' } }).then((r) => setDrive(r[0] ?? null)).catch(() => {});
    api('/earnings').then((e) => setEarn(e.totals[0] ?? null)).catch(() => {});
  }, [me?.id]);

  const search = (f: Place, d: Place) => router.push({ pathname: '/(tabs)/search', params: { fn: f.name, fa: f.lat, fo: f.lng, tn: d.name, ta: d.lat, to: d.lng, date, seats } });
  const when = (iso: string) => new Intl.DateTimeFormat(lang, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      {me && <T variant="muted">{t('home.greeting', { name: me.name.split(' ')[0] })}</T>}
      <Card>
        <T variant="h1">{t('home.where')}</T>
        <PlacePicker label={t('home.from')} value={from} onChange={setFrom} />
        <PlacePicker label={t('home.to')} value={to} onChange={setTo} />
        <T variant="body" style={{ fontWeight: '600' }}>{t('home.date')}</T>
        <DayPicker value={date} onChange={setDate} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <T style={{ flex: 1, fontWeight: '600' }}>{t('search.passengers')}: {seats}</T>
          <Button title="−" kind="outline" onPress={() => setSeats(Math.max(1, seats - 1))} />
          <Button title="+" kind="outline" onPress={() => setSeats(Math.min(6, seats + 1))} />
        </View>
        <Button title={t('home.search')} disabled={!from || !to} onPress={() => from && to && search(from, to)} />
        <T variant="small" style={{ textAlign: 'center' }}>{t('home.or')}</T>
        <Button title={`＋ ${t('home.create')}`} kind="accent" onPress={() => router.push('/(tabs)/create')} />
      </Card>

      {drive && (
        <Card>
          <T variant="small">Your next drive</T>
          <T variant="h2">{drive.origin.name} → {drive.destination.name}</T>
          <T variant="muted">{when(drive.departureAt)} · {t('ride.passengers', { count: drive.confirmedPassengers })} · {t('search.seatsLeft', { count: drive.seatsAvailable })}</T>
          {earn && <T variant="muted">{t('earnings.today')}: {money(earn.todayMinor, earn.currency)} · {t('earnings.month')}: {money(earn.monthMinor, earn.currency)} · ★ {me?.rating.toFixed(1)}</T>}
          <Button title="Manage ride" kind="outline" onPress={() => router.push(`/ride/${drive.id}`)} />
        </Card>
      )}
      {trip && (
        <Card>
          <T variant="small">{t('home.upcoming')}</T>
          <T variant="h2">{trip.ride.originName} → {trip.ride.destName}</T>
          <T variant="muted">{when(trip.ride.departureAt)} · Driver {trip.driver.name} ★ {trip.driver.rating.toFixed(1)}</T>
          <T variant="muted">{t('ride.pickup')}: {trip.pickup.name}</T>
          <Button title={t('search.viewRide')} kind="outline" onPress={() => router.push(`/ride/${trip.rideId}`)} />
        </Card>
      )}

      {popular.length > 0 && <T variant="h2">{t('home.popular')}</T>}
      {popular.map((p) => (
        <Card key={`${p.from}-${p.to}`}>
          <T variant="body" style={{ fontWeight: '700' }}>{p.from} → {p.to}</T>
          <T variant="small">{t('home.routeMeta', { count: p.rides, price: money(p.fromPriceMinor, p.currency) })}</T>
          <Button title={t('home.search')} kind="outline" onPress={() => search({ name: p.from, lat: p.fromLat, lng: p.fromLng }, { name: p.to, lat: p.toLat, lng: p.toLng })} />
        </Card>
      ))}
    </ScrollView>
  );
}
