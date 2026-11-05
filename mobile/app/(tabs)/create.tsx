import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { calculateBooking, toMajor } from '@share-ride/shared';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app';
import { Button, Card, ErrorBox, Field, Place, PlacePicker, RouteMapView, T, useColors } from '@/ui';
import { DayPicker, todayKey } from '@/DayPicker';

/** Create Ride → Route → Price calculation (screens 11–13). */
export default function Create() {
  const { t, me, country, money, distance, online } = useApp();
  const c = useColors();
  const [origin, setOrigin] = useState<Place | null>(null);
  const [dest, setDest] = useState<Place | null>(null);
  const [date, setDate] = useState(todayKey());
  const [time, setTime] = useState('17:00');
  const [seats, setSeats] = useState(3);
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [instant, setInstant] = useState(true);
  const [luggage, setLuggage] = useState(true);
  const [notes, setNotes] = useState('');
  const [quote, setQuote] = useState<any>(null);
  const [price, setPrice] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => { if (me) api('/vehicles').then((v) => { setVehicles(v); if (v[0]) setVehicleId(v[0].id); }).catch(() => {}); }, [me?.id]);
  useEffect(() => { setQuote(null); }, [origin?.name, dest?.name]);
  const preview = useMemo(() => (quote ? calculateBooking({ currency: quote.currency, platformFeeBps: quote.platformFeeBps, feeBearer: quote.feeBearer, taxOnFeeBps: 0 }, price, seats) : null), [quote, price, seats]);

  if (!me) return <View style={{ flex: 1, padding: 24, gap: 12, backgroundColor: c.bg }}><T variant="h2">{t('create.title')}</T><T variant="muted">Log in to offer a ride.</T><Button title={t('auth.login')} onPress={() => router.push('/login')} /></View>;
  if (!me.badges.phone) return <View style={{ flex: 1, padding: 24, gap: 12, backgroundColor: c.bg }}><T variant="h2">{t('create.title')}</T><T variant="muted">Please verify your phone before offering rides.</T><Button title="Verify phone" onPress={() => router.push('/verify-phone')} /></View>;
  if (country && !country.rideCreationEnabled) return <View style={{ padding: 24 }}><T>Creating rides isn't available in {country.name} yet.</T></View>;

  const step = quote ? Math.max(1, quote.suggestion.recommendedMinor >= 10000 ? 500 : 100) : 100;
  const valid = quote && price >= quote.suggestion.allowedMinMinor && price <= quote.suggestion.allowedMaxMinor;
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Card>
        <PlacePicker label={t('create.start')} value={origin} onChange={setOrigin} />
        <PlacePicker label={t('create.destination')} value={dest} onChange={setDest} />
        <T style={{ fontWeight: '600' }}>{t('home.date')}</T>
        <DayPicker value={date} onChange={setDate} />
        <Field label={`${t('ride.departure')} (HH:MM, 24h)`} value={time} onChangeText={setTime} keyboardType="numbers-and-punctuation" error={timeOk ? undefined : 'Use 24-hour time, e.g. 17:30'} />
      </Card>
      <Card>
        <T variant="h2">{t('create.vehicle')}</T>
        {vehicles.length === 0 && <T variant="muted">Add a vehicle from your Profile first.</T>}
        {vehicles.map((v) => (
          <Pressable key={v.id} accessibilityRole="radio" accessibilityState={{ selected: v.id === vehicleId }} onPress={() => setVehicleId(v.id)}
            style={{ padding: 12, borderRadius: 10, borderWidth: 1.5, borderColor: v.id === vehicleId ? c.brand : c.line }}>
            <Text style={{ color: c.ink }}>{v.color} {v.make} {v.model} · {v.licensePlate}</Text>
          </Pressable>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <T style={{ flex: 1, fontWeight: '600' }}>{t('create.seats')}: {seats}</T>
          <Button title="−" kind="outline" onPress={() => setSeats(Math.max(1, seats - 1))} />
          <Button title="+" kind="outline" onPress={() => setSeats(Math.min(8, seats + 1))} />
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><T>{t('create.instant')}</T><Switch value={instant} onValueChange={setInstant} accessibilityLabel={t('create.instant')} /></View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><T>{t('create.luggage')}</T><Switch value={luggage} onValueChange={setLuggage} accessibilityLabel={t('create.luggage')} /></View>
        <Field label={t('create.notes')} value={notes} onChangeText={setNotes} multiline maxLength={500} />
      </Card>

      {origin && dest && quote && <RouteMapView polyline={quote.route.polyline} origin={origin} destination={dest} />}
      <Card>
        {!quote ? (
          <Button title={t('create.calculate')} loading={busy} disabled={!origin || !dest || !country} onPress={async () => {
            setBusy(true); setError(null);
            try { const q = await api('/routes/quote', { method: 'POST', body: { countryCode: country!.code, origin, destination: dest, seats } }); setQuote(q); setPrice(q.suggestion.recommendedMinor); } catch (e) { setError(e); } finally { setBusy(false); }
          }} />
        ) : (
          <>
            <T variant="muted">{t('ride.distance')}: {distance(quote.route.distanceMeters)} · {t('ride.duration', { minutes: Math.round(quote.route.durationSeconds / 60) })}</T>
            <T>{t('create.suggested')}: {money(quote.suggestion.rangeMinMinor, quote.currency)} – {money(quote.suggestion.rangeMaxMinor, quote.currency)}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Button title="−" kind="outline" onPress={() => setPrice(Math.max(quote.suggestion.allowedMinMinor, price - step))} />
              <View style={{ flex: 1, alignItems: 'center' }} accessible accessibilityLabel={`${t('create.yourPrice')}: ${money(price, quote.currency)}`}>
                <T variant="price">{money(price, quote.currency)}</T><T variant="small">{t('create.yourPrice')}</T>
              </View>
              <Button title="+" kind="outline" onPress={() => setPrice(Math.min(quote.suggestion.allowedMaxMinor, price + step))} />
            </View>
            {preview && (
              <View style={{ gap: 4 }}>
                <T variant="muted">{t('create.gross')}: {money(preview.grossFareMinor, quote.currency)}</T>
                <T variant="muted">{t('create.commission')} ({preview.platformFeeBps / 100}%): −{money(preview.platformFeeMinor, quote.currency)}</T>
                <T variant="h2">{t('create.earnings')}: {money(preview.driverEarningsMinor, quote.currency)}</T>
              </View>
            )}
            <ErrorBox error={error} />
            <Button title={t('create.publish')} loading={busy} disabled={!valid || !vehicleId || !timeOk || !online} onPress={async () => {
              setBusy(true); setError(null);
              try {
                const ride = await api('/rides', { method: 'POST', body: { countryCode: country!.code, origin, destination: dest, departureAt: new Date(`${date}T${time}:00`).toISOString(), seats, pricePerSeatMinor: price, vehicleId, instantBooking: instant, luggageAllowed: luggage, notes: notes || undefined } });
                router.push(`/ride/${ride.id}`);
              } catch (e) { setError(e); } finally { setBusy(false); }
            }} />
            <T variant="small">Price shown as {toMajor(price, quote.currency)} {quote.currency}. Allowed {money(quote.suggestion.allowedMinMinor, quote.currency)}–{money(quote.suggestion.allowedMaxMinor, quote.currency)}.</T>
          </>
        )}
        {!quote && <ErrorBox error={error} />}
      </Card>
    </ScrollView>
  );
}
