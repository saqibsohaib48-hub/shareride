'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { calculateBooking } from '@share-ride/shared';
import { api, newIdempotencyKey } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { Avatar, Badges, ErrorBox, PlaceInput, PlaceValue, RouteMap, Stars, fmtDate, fmtTime } from '@/components/ui';
import { RatingForm } from '@/components/RatingForm';

function RideDetail() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const { t, lang, money, distance, me, online } = useApp();
  const [ride, setRide] = useState<any>(null);
  const [pricing, setPricing] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [seats, setSeats] = useState(Number(sp.get('seats') ?? 1));
  const [pickup, setPickup] = useState<PlaceValue | null>(sp.get('pa') ? { name: sp.get('pn')!, lat: Number(sp.get('pa')), lng: Number(sp.get('po')) } : null);
  const [dropoff, setDropoff] = useState<PlaceValue | null>(sp.get('da') ? { name: sp.get('dn')!, lat: Number(sp.get('da')), lng: Number(sp.get('do')) } : null);
  const [promo, setPromo] = useState('');
  const [idemKey] = useState(newIdempotencyKey);

  const load = () => api(`/rides/${id}`).then((r) => { setRide(r); return api(`/pricing/${r.countryCode}`).then(setPricing); }).catch(setError);
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, me?.id]);

  const preview = useMemo(() => (ride && pricing ? calculateBooking({ currency: ride.currency, platformFeeBps: pricing.platformFeeBps, feeBearer: pricing.feeBearer, taxOnFeeBps: 0 }, ride.pricePerSeatMinor, seats) : null), [ride, pricing, seats]);

  async function act(path: string, body?: unknown) {
    setBusy(true); setError(null);
    try { await api(path, { method: 'POST', body }); await load(); } catch (e) { setError(e); } finally { setBusy(false); }
  }

  async function bookNow() {
    if (!me) return router.push(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    setBusy(true); setError(null);
    try {
      const b = await api('/bookings', { method: 'POST', body: { rideId: id, seats, pickup: pickup ?? ride.origin, dropoff: dropoff ?? ride.destination, promoCode: promo || undefined, idempotencyKey: idemKey } });
      if (b.status === 'RESERVED') router.push(`/checkout/${b.id}`);
      else { await load(); }
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  if (error && !ride) return <ErrorBox error={error} />;
  if (!ride) return <div className="skeleton" style={{ minHeight: 400 }} />;
  const mine = ride.myBooking;
  const past = new Date(ride.departureAt) < new Date();
  const canBook = !ride.isDriver && !mine?.status?.match(/REQUESTED|RESERVED|CONFIRMED|IN_PROGRESS/) && ['PUBLISHED', 'DRIVER_READY'].includes(ride.status) && ride.seatsAvailable > 0 && !past;

  return (
    <div className="grid-2">
      <div className="stack" style={{ gap: 16 }}>
        {sp.get('created') && <div className="alert ok" role="status">✓ {t('create.published')}</div>}
        <RouteMap polyline={ride.polyline} origin={ride.origin} destination={ride.destination} height={240} />
        <div className="card stack">
          <div className="row between">
            <div className="row" style={{ gap: 6 }}>
              <span className="pill">{fmtDate(ride.departureAt, lang, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
              <span className="pill">{ride.status.replace(/_/g, ' ')}</span>
              {ride.isDemo && <span className="pill demo">{t('common.demo')}</span>}
            </div>
          </div>
          <div className="timeline" style={{ fontSize: '1.05rem' }}>
            <span className="t">{fmtTime(ride.departureAt, lang)}</span><span className="dot" /><span><b>{ride.origin.name}</b></span>
            <span /><span className="bar" style={{ minHeight: 34 }} /><span className="small muted">{distance(ride.distanceMeters)} · {t('ride.duration', { minutes: Math.round(ride.durationSeconds / 60) })}</span>
            <span className="t">{fmtTime(ride.arrivalEstimateAt, lang)}</span><span className="dot end" /><span><b>{ride.destination.name}</b></span>
          </div>
          <hr className="divider" />
          <div className="row" style={{ gap: 12 }}>
            <Avatar name={ride.driver.name} url={ride.driver.photoUrl} size="lg" />
            <div className="stack" style={{ gap: 4 }}>
              <Link href={`/users/${ride.driver.id}`} style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--ink)' }}>{ride.driver.name}</Link>
              <Stars value={ride.driver.rating} count={ride.driver.ratingCount} />
              <span className="small muted">{t('ride.completedRides', { count: ride.driver.completedRides })}</span>
              <Badges badges={ride.driver.badges} />
            </div>
          </div>
          {ride.vehicle && <div className="small"><b>{t('ride.vehicle')}:</b> {ride.vehicle.color} {ride.vehicle.make} {ride.vehicle.model}{ride.vehicle.plate ? ` · ${ride.vehicle.plate}` : ''}</div>}
          <div className="row" style={{ gap: 6 }}>
            {ride.instantBooking ? <span className="pill brand">⚡ {t('ride.instant')}</span> : <span className="pill">{t('ride.approval')}</span>}
            <span className="pill">{ride.luggageAllowed ? '🧳 Luggage OK' : 'No large luggage'}</span>
            <span className="pill">{ride.petsAllowed ? '🐾 Pets OK' : 'No pets'}</span>
            <span className="pill">{ride.smokingAllowed ? 'Smoking OK' : '🚭 No smoking'}</span>
            {ride.womenOnly && <span className="pill accent">{t('search.womenOnly')}</span>}
          </div>
          {ride.notes && <p className="muted" style={{ margin: 0 }}>“{ride.notes}”</p>}
        </div>

        {ride.reviews?.length > 0 && (
          <div className="card stack">
            <h2>{t('ride.reviews')}</h2>
            {ride.reviews.map((r: any, i: number) => <div key={i}><Stars value={r.stars} /> <span className="small"><b>{r.author}</b> — {r.comment}</span></div>)}
          </div>
        )}
        <div className="card stack small">
          <h3>{t('ride.cancellationPolicy')}</h3>
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {[...ride.cancellationPolicy.passengerTiers].sort((a: any, b: any) => b.minHoursBefore - a.minHoursBefore).map((tier: any) => (
              <li key={tier.minHoursBefore}>{tier.minHoursBefore > 0 ? `≥ ${tier.minHoursBefore}h before departure` : 'Less than that'}: {tier.refundBps / 100}% refund</li>
            ))}
            <li>If the driver cancels: {ride.cancellationPolicy.driverCancelRefundBps / 100}% refund</li>
          </ul>
          <h3>{t('ride.safety')}</h3>
          <p className="muted" style={{ margin: 0 }}>{t('ride.safetyText')}</p>
        </div>
      </div>

      <aside className="stack" style={{ gap: 16 }}>
        <ErrorBox error={error} />
        {ride.isDriver ? (
          <DriverPanel ride={ride} act={act} busy={busy} reload={load} />
        ) : (
          <div className="card stack" style={{ position: 'sticky', top: 80 }}>
            <div className="row between"><span className="price">{money(ride.pricePerSeatMinor, ride.currency)}</span><span className="muted small">{t('search.perPassenger')}</span></div>
            <div className="small muted">{t('ride.available')}: <b>{ride.seatsAvailable}</b> / {ride.seatsTotal}</div>
            {mine && <div className="alert ok">Your booking: <b>{mine.status.replace(/_/g, ' ')}</b> {mine.status === 'RESERVED' && <Link href={`/checkout/${mine.id}`}>→ Complete payment</Link>}{mine.status === 'REQUESTED' && ' — waiting for the driver.'}</div>}
            {mine?.status === 'COMPLETED' && <RatingForm bookingId={mine.id} who="driver" />}
            {mine && ['REQUESTED', 'RESERVED', 'CONFIRMED'].includes(mine.status) && <ConfirmButton label="Cancel my booking" confirm="Yes, cancel — refund follows the policy below" busy={busy} onConfirm={() => act(`/bookings/${mine.id}/cancel`)} />}
            {canBook && (
              <>
                <div className="field"><label htmlFor="seats">{t('ride.seats')}</label>
                  <select id="seats" className="input" value={seats} onChange={(e) => setSeats(Number(e.target.value))}>{Array.from({ length: ride.seatsAvailable }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}</select>
                </div>
                <PlaceInput id="pickup" label={t('ride.pickup')} value={pickup ?? ride.origin} onChange={setPickup} />
                <PlaceInput id="dropoff" label={t('ride.dropoff')} value={dropoff ?? ride.destination} onChange={setDropoff} />
                <div className="field"><label htmlFor="promo">Promo code (optional)</label><input id="promo" className="input" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} /></div>
                {preview && (
                  <div className="breakdown num" aria-label="Price breakdown">
                    <span>{t('checkout.rideFare')} ({seats} × {money(ride.pricePerSeatMinor, ride.currency)})</span><span>{money(preview.grossFareMinor, ride.currency)}</span>
                    <span>{t('checkout.platformFee')} ({preview.platformFeeBps / 100}%)</span><span>{preview.feeBearer === 'PASSENGER' ? money(preview.platformFeeMinor, ride.currency) : <span className="tiny">{t('checkout.feeIncluded')}</span>}</span>
                    <span className="total">{t('checkout.total')}</span><span className="total">{money(preview.passengerTotalMinor, ride.currency)}</span>
                  </div>
                )}
                <button className="btn primary block" disabled={busy || !online} onClick={bookNow}>{ride.instantBooking ? t('ride.bookNow') : t('ride.requestJoin')}</button>
                {!ride.instantBooking && <p className="tiny" style={{ margin: 0 }}>You'll only pay after the driver accepts.</p>}
              </>
            )}
            {!canBook && !mine && !ride.isDriver && <div className="muted small">{past ? 'This ride has departed.' : ride.seatsAvailable === 0 ? 'This ride is full.' : 'Not available for booking.'}</div>}
          </div>
        )}
      </aside>
    </div>
  );
}

function ConfirmButton({ label, confirm, busy, onConfirm }: { label: string; confirm: string; busy: boolean; onConfirm: () => void }) {
  const [asking, setAsking] = useState(false);
  if (!asking) return <button className="btn danger sm block" disabled={busy} onClick={() => setAsking(true)}>{label}</button>;
  return (
    <div className="stack" role="group" aria-label={label}>
      <button className="btn danger block" disabled={busy} onClick={() => { setAsking(false); onConfirm(); }}>{confirm}</button>
      <button className="btn outline sm block" onClick={() => setAsking(false)}>Keep it</button>
    </div>
  );
}

function DriverPanel({ ride, act, busy, reload }: { ride: any; act: (p: string, b?: unknown) => Promise<void>; busy: boolean; reload: () => void }) {
  const { t, money } = useApp();
  const confirmed = ride.passengers.filter((p: any) => ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'PASSENGER_PICKUP'].includes(p.status));
  const totalEarn = confirmed.reduce((s: number, p: any) => s + p.earningsMinor, 0);
  return (
    <div className="card stack">
      <h2>Your ride</h2>
      <div className="stats">
        <div className="stat"><span className="v">{confirmed.length}</span><span className="l">{t('ride.passengers', { count: '' }).trim()}</span></div>
        <div className="stat"><span className="v">{ride.seatsAvailable}</span><span className="l">{t('ride.available')}</span></div>
        <div className="stat"><span className="v">{money(totalEarn, ride.currency)}</span><span className="l">{t('checkout.yourEarnings')}</span></div>
      </div>
      <hr className="divider" />
      {ride.passengers.length === 0 && <p className="muted small">No passengers yet.</p>}
      {ride.passengers.map((p: any) => (
        <div key={p.bookingId} className="card flat stack" style={{ padding: 14 }}>
          <div className="row between"><b>{p.name} · {p.seats} seat(s)</b><span className="pill">{p.status.replace(/_/g, ' ')}</span></div>
          <div className="tiny">{p.pickup} → {p.dropoff}</div>
          <div className="breakdown small num">
            <span>{t('checkout.passengerFare')}</span><span>{money(p.grossMinor, ride.currency)}</span>
            <span>{t('checkout.platformFee')}</span><span>−{money(p.feeMinor, ride.currency)}</span>
            <span><b>{t('checkout.yourEarnings')}</b></span><span><b>{money(p.earningsMinor, ride.currency)}</b></span>
          </div>
          {p.status === 'REQUESTED' && (
            <div className="row">
              <button className="btn primary sm" disabled={busy} onClick={() => act(`/bookings/${p.bookingId}/accept`)}>{t('common.accept')}</button>
              <button className="btn outline sm" disabled={busy} onClick={() => act(`/bookings/${p.bookingId}/decline`)}>{t('common.decline')}</button>
            </div>
          )}
          {p.status === 'COMPLETED' && !p.rated && <RatingForm bookingId={p.bookingId} who="passenger" onDone={reload} />}
        </div>
      ))}
      <hr className="divider" />
      {['PUBLISHED', 'DRIVER_READY'].includes(ride.status) && <button className="btn primary block" disabled={busy} onClick={() => act(`/rides/${ride.id}/start`)}>▶ {t('ride.start')}</button>}
      {ride.status === 'IN_PROGRESS' && <button className="btn primary block" disabled={busy} onClick={() => act(`/rides/${ride.id}/complete`)}>✓ {t('ride.complete')}</button>}
      {['PUBLISHED', 'DRIVER_READY'].includes(ride.status) && <ConfirmButton label={t('ride.cancel')} confirm={`Yes, cancel — all ${confirmed.length} passenger(s) get a full refund`} busy={busy} onConfirm={() => act(`/rides/${ride.id}/cancel`)} />}
    </div>
  );
}

export default function Page() { return <Suspense fallback={<div className="skeleton" />}><RideDetail /></Suspense>; }
