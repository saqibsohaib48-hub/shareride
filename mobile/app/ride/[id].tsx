import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Share, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { calculateBooking } from '@share-ride/shared';
import { api, newKey } from '@/lib/api';
import { cached } from '@/lib/cache';
import { useApp } from '@/lib/app';
import { Button, Card, ErrorBox, Field, Pill, RouteMapView, T, useColors } from '@/ui';

/** Ride details (10) + Booking (14) + driver management + Trip details/Ratings (17, 26). */
export default function RideScreen() {
  const p = useLocalSearchParams<Record<string, string>>();
  const { t, me, money, distance, lang, online } = useApp();
  const c = useColors();
  const [ride, setRide] = useState<any>(null);
  const [pricing, setPricing] = useState<any>(null);
  const [seats, setSeats] = useState(Number(p.seats ?? 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [stars, setStars] = useState(0);
  const [key] = useState(newKey);

  const load = useCallback(() => cached(`ride:${p.id}`, () => api(`/rides/${p.id}`)).then(({ data }: any) => { setRide(data); return api(`/pricing/${data.countryCode}`).then(setPricing); }).catch(setError), [p.id]);
  useFocusEffect(useCallback(() => { load(); }, [load, me?.id]));
  const preview = useMemo(() => (ride && pricing ? calculateBooking({ currency: ride.currency, platformFeeBps: pricing.platformFeeBps, feeBearer: pricing.feeBearer, taxOnFeeBps: 0 }, ride.pricePerSeatMinor, seats) : null), [ride, pricing, seats]);

  async function act(path: string, body?: unknown) { setBusy(true); setError(null); try { await api(path, { method: 'POST', body }); await load(); } catch (e) { setError(e); } finally { setBusy(false); } }

  if (!ride) return <View style={{ flex: 1, padding: 16, backgroundColor: c.bg }}>{error ? <ErrorBox error={error} /> : <T variant="muted">{t('common.loading')}</T>}</View>;
  const when = (iso: string) => new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const mine = ride.myBooking;
  const canBook = !ride.isDriver && !(mine && /REQUESTED|RESERVED|CONFIRMED|IN_PROGRESS/.test(mine.status)) && ['PUBLISHED', 'DRIVER_READY'].includes(ride.status) && ride.seatsAvailable > 0 && new Date(ride.departureAt) > new Date();
  const pickup = p.pa ? { name: p.pn, lat: Number(p.pa), lng: Number(p.po) } : ride.origin;
  const dropoff = p.da ? { name: p.dn, lat: Number(p.da), lng: Number(p.do) } : ride.destination;

  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <RouteMapView polyline={ride.polyline} origin={ride.origin} destination={ride.destination} />
      <Card>
        <T variant="h2">{ride.origin.name} → {ride.destination.name}</T>
        <T variant="muted">{when(ride.departureAt)}</T>
        <T variant="muted">{distance(ride.distanceMeters)} · {t('ride.duration', { minutes: Math.round(ride.durationSeconds / 60) })}</T>
        <T variant="price">{money(ride.pricePerSeatMinor, ride.currency)} <T variant="small">{t('search.perPassenger')}</T></T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Pill text={`${t('ride.available')}: ${ride.seatsAvailable}`} />
          <Pill text={ride.instantBooking ? `⚡ ${t('ride.instant')}` : t('ride.approval')} tone={ride.instantBooking ? 'brand' : 'default'} />
          {ride.isDemo && <Pill text={t('common.demo')} tone="accent" />}
        </View>
      </Card>
      <Card>
        <Pressable accessibilityRole="link" onPress={() => {}}><T variant="h2">{ride.driver.name}</T></Pressable>
        <T variant="muted">★ {ride.driver.rating ? ride.driver.rating.toFixed(1) : 'New'} ({ride.driver.ratingCount}) · {t('ride.completedRides', { count: ride.driver.completedRides })}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{ride.driver.badges.phone && <Pill text={`✓ ${t('verify.phone')}`} tone="brand" />}{ride.driver.badges.driver && <Pill text={`✓ ${t('verify.driver')}`} tone="brand" />}</View>
        {ride.vehicle && <T variant="muted">{t('ride.vehicle')}: {ride.vehicle.color} {ride.vehicle.make} {ride.vehicle.model}{ride.vehicle.plate ? ` · ${ride.vehicle.plate}` : ''}</T>}
        {ride.notes && <T variant="muted">“{ride.notes}”</T>}
        {ride.reviews?.slice(0, 3).map((r: any, i: number) => <T key={i} variant="small">{'★'.repeat(r.stars)} {r.author}: {r.comment}</T>)}
      </Card>

      <ErrorBox error={error} />

      {ride.isDriver ? (
        <Card>
          <T variant="h2">Passengers</T>
          {ride.passengers.length === 0 && <T variant="muted">No passengers yet.</T>}
          {ride.passengers.map((x: any) => (
            <View key={x.bookingId} style={{ gap: 6, paddingVertical: 8, borderBottomWidth: 1, borderColor: c.line }}>
              <T style={{ fontWeight: '700' }}>{x.name} · {x.seats} seat(s) · {x.status.replace(/_/g, ' ')}</T>
              <T variant="small">{t('checkout.passengerFare')} {money(x.grossMinor, ride.currency)} · {t('checkout.platformFee')} −{money(x.feeMinor, ride.currency)} · {t('checkout.yourEarnings')} {money(x.earningsMinor, ride.currency)}</T>
              {x.status === 'REQUESTED' && <View style={{ flexDirection: 'row', gap: 8 }}><View style={{ flex: 1 }}><Button title={t('common.accept')} onPress={() => act(`/bookings/${x.bookingId}/accept`)} /></View><View style={{ flex: 1 }}><Button title={t('common.decline')} kind="outline" onPress={() => act(`/bookings/${x.bookingId}/decline`)} /></View></View>}
              {x.status === 'COMPLETED' && !x.rated && <Button title={`${t('trips.rate')} ★★★★★`} kind="outline" onPress={() => act('/ratings', { bookingId: x.bookingId, stars: 5 })} />}
            </View>
          ))}
          {['PUBLISHED', 'DRIVER_READY'].includes(ride.status) && <Button title={`▶ ${t('ride.start')}`} loading={busy} onPress={() => act(`/rides/${ride.id}/start`)} />}
          {ride.status === 'IN_PROGRESS' && <Button title={`✓ ${t('ride.complete')}`} loading={busy} onPress={() => act(`/rides/${ride.id}/complete`)} />}
          {['PUBLISHED', 'DRIVER_READY'].includes(ride.status) && <Button title={t('ride.cancel')} kind="danger" onPress={() => act(`/rides/${ride.id}/cancel`)} />}
        </Card>
      ) : (
        <Card>
          {mine && <T>Your booking: <Text style={{ fontWeight: '700' }}>{mine.status.replace(/_/g, ' ')}</Text></T>}
          {mine?.status === 'RESERVED' && <Button title="Complete payment" onPress={() => router.push(`/checkout/${mine.id}`)} />}
          {mine && /CONFIRMED|IN_PROGRESS/.test(mine.status) && (
            <Button title="Share trip with a trusted contact" kind="outline" onPress={() => Share.share({ message: `I'm riding with ${ride.driver.name} (${ride.vehicle?.color ?? ''} ${ride.vehicle?.make ?? ''} ${ride.vehicle?.plate ?? ''}) from ${ride.origin.name} to ${ride.destination.name}, departing ${when(ride.departureAt)}. — Share Ride` })} />
          )}
          {mine && /REQUESTED|RESERVED|CONFIRMED/.test(mine.status) && <Button title="Cancel my booking" kind="danger" onPress={() => act(`/bookings/${mine.id}/cancel`)} />}
          {mine?.status === 'COMPLETED' && (
            <View style={{ gap: 8 }}>
              <T style={{ fontWeight: '600' }}>{t('rating.title')}</T>
              <View style={{ flexDirection: 'row', gap: 6 }}>{[1, 2, 3, 4, 5].map((n) => <Pressable key={n} accessibilityRole="radio" accessibilityLabel={`${n} stars`} accessibilityState={{ selected: stars === n }} onPress={() => setStars(n)} style={{ padding: 8 }}><Text style={{ fontSize: 28, color: n <= stars ? '#e3a008' : c.ink3 }}>★</Text></Pressable>)}</View>
              <Button title={t('rating.submit')} disabled={!stars} onPress={() => act('/ratings', { bookingId: mine.id, stars })} />
            </View>
          )}
          {canBook && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <T style={{ flex: 1, fontWeight: '600' }}>{t('ride.seats')}: {seats}</T>
                <Button title="−" kind="outline" onPress={() => setSeats(Math.max(1, seats - 1))} />
                <Button title="+" kind="outline" onPress={() => setSeats(Math.min(ride.seatsAvailable, seats + 1))} />
              </View>
              <T variant="small">{t('ride.pickup')}: {pickup.name} · {t('ride.dropoff')}: {dropoff.name}</T>
              {preview && (
                <View style={{ gap: 2 }}>
                  <T variant="muted">{t('checkout.rideFare')}: {money(preview.grossFareMinor, ride.currency)}</T>
                  <T variant="muted">{t('checkout.platformFee')} ({preview.platformFeeBps / 100}%): {preview.feeBearer === 'PASSENGER' ? money(preview.platformFeeMinor, ride.currency) : t('checkout.feeIncluded')}</T>
                  <T variant="h2">{t('checkout.total')}: {money(preview.passengerTotalMinor, ride.currency)}</T>
                </View>
              )}
              <Button title={ride.instantBooking ? t('ride.bookNow') : t('ride.requestJoin')} loading={busy} disabled={!online} onPress={async () => {
                if (!me) return router.push('/login');
                setBusy(true); setError(null);
                try {
                  const b = await api('/bookings', { method: 'POST', body: { rideId: ride.id, seats, pickup, dropoff, idempotencyKey: key } });
                  if (b.status === 'RESERVED') router.push(`/checkout/${b.id}`); else await load();
                } catch (e) { setError(e); } finally { setBusy(false); }
              }} />
            </>
          )}
        </Card>
      )}
      <Card>
        <T variant="h2">{t('ride.cancellationPolicy')}</T>
        {[...ride.cancellationPolicy.passengerTiers].sort((a: any, b: any) => b.minHoursBefore - a.minHoursBefore).map((x: any) => <T key={x.minHoursBefore} variant="small">{x.minHoursBefore > 0 ? `≥ ${x.minHoursBefore}h before` : 'Later'}: {x.refundBps / 100}% refund</T>)}
        <T variant="small">{t('ride.safetyText')}</T>
      </Card>
    </ScrollView>
  );
}
