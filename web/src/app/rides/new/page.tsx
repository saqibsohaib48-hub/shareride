'use client';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { calculateBooking, toMajor, toMinor } from '@share-ride/shared';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { ErrorBox, PlaceInput, PlaceValue, RequireAuth, RouteMap, fieldErrors } from '@/components/ui';
import { PhoneVerify } from '@/components/PhoneVerify';
import { toDateInput } from '@/components/SearchForm';
import { VehicleForm } from '@/components/VehicleForm';

function CreateRide() {
  const { t, me, country, money, distance, reloadMe, online } = useApp();
  const router = useRouter();
  const [origin, setOrigin] = useState<PlaceValue | null>(null);
  const [dest, setDest] = useState<PlaceValue | null>(null);
  const tomorrow = new Date(Date.now() + 86400_000);
  const [date, setDate] = useState(toDateInput(tomorrow));
  const [time, setTime] = useState('17:00');
  const [seats, setSeats] = useState(3);
  const [vehicles, setVehicles] = useState<any[] | null>(null);
  const [vehicleId, setVehicleId] = useState('');
  const [addingVehicle, setAddingVehicle] = useState(false);
  const [opts, setOpts] = useState({ instantBooking: true, luggageAllowed: true, petsAllowed: false, smokingAllowed: false, womenOnly: false });
  const [notes, setNotes] = useState('');
  const [quote, setQuote] = useState<any>(null);
  const [price, setPrice] = useState<number | null>(null); // minor units
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const loadVehicles = () => api<any[]>('/vehicles').then((v) => { setVehicles(v); if (v[0] && !vehicleId) setVehicleId(v[0].id); });
  useEffect(() => { loadVehicles().catch(setError); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  useEffect(() => { setQuote(null); setPrice(null); }, [origin?.name, dest?.name, country?.code]);

  const vehicle = vehicles?.find((v) => v.id === vehicleId);
  const maxSeats = vehicle ? vehicle.seats - 1 : 6;
  const preview = useMemo(() => (quote && price ? calculateBooking({ currency: quote.currency, platformFeeBps: quote.platformFeeBps, feeBearer: quote.feeBearer, taxOnFeeBps: 0 }, price, seats) : null), [quote, price, seats]);
  const priceError = quote && price !== null && (price < quote.suggestion.allowedMinMinor || price > quote.suggestion.allowedMaxMinor);

  async function calculate() {
    if (!origin || !dest || !country) return;
    setBusy(true); setError(null);
    try {
      const q = await api('/routes/quote', { method: 'POST', body: { countryCode: country.code, origin, destination: dest, seats } });
      setQuote(q); setPrice(q.suggestion.recommendedMinor);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }

  async function publish(e: FormEvent) {
    e.preventDefault();
    if (!quote || !price || !origin || !dest || !country) return;
    setBusy(true); setError(null);
    try {
      const ride = await api('/rides', { method: 'POST', body: {
        countryCode: country.code, origin, destination: dest, departureAt: new Date(`${date}T${time}`).toISOString(),
        seats, pricePerSeatMinor: price, vehicleId, ...opts, notes: notes || undefined,
      } });
      router.push(`/rides/${ride.id}?created=1`);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }

  if (!me) return null;
  if (country && !country.rideCreationEnabled) return <div className="alert warn">Creating rides isn't available in {country.name} yet.</div>;
  if (!me.badges.phone) return (
    <div className="card stack" style={{ maxWidth: 480, margin: '0 auto' }}>
      <h1>{t('create.title')}</h1>
      <p className="muted">To keep everyone safe, please verify your phone number before offering rides.</p>
      <PhoneVerify onDone={() => reloadMe()} />
    </div>
  );
  const fe = fieldErrors(error);
  const cur = quote?.currency ?? country?.currency ?? 'AED';

  return (
    <form className="grid-2" onSubmit={publish} noValidate>
      <div className="stack" style={{ gap: 16 }}>
        <h1>{t('create.title')}</h1>
        <div className="card stack">
          <PlaceInput id="origin" label={t('create.start')} value={origin} onChange={setOrigin} placeholder="e.g. JLT, Dubai" />
          <PlaceInput id="dest" label={t('create.destination')} value={dest} onChange={setDest} placeholder="e.g. Abu Dhabi" />
          <div className="form-grid two">
            <div className="field"><label htmlFor="d">{t('home.date')}</label><input id="d" type="date" className="input" min={toDateInput(new Date())} value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="field"><label htmlFor="tm">{t('ride.departure')}</label><input id="tm" type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} /></div>
          </div>
          {fe.departureAt && <span className="field-error">{fe.departureAt[0]}</span>}
        </div>

        <div className="card stack">
          <h2>{t('create.vehicle')}</h2>
          {vehicles?.length ? (
            <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label={t('create.vehicle')}>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.color} {v.make} {v.model} · {v.licensePlate} {v.verificationStatus !== 'VERIFIED' ? `(${v.verificationStatus.toLowerCase()})` : '✓'}</option>)}
            </select>
          ) : vehicles && <p className="muted small">Add the vehicle you'll drive.</p>}
          {addingVehicle || (vehicles && !vehicles.length)
            ? <VehicleForm onSaved={(v) => { setAddingVehicle(false); loadVehicles().then(() => setVehicleId(v.id)); }} />
            : <button type="button" className="btn outline sm" onClick={() => setAddingVehicle(true)}>＋ {t('create.addVehicle')}</button>}
          <div className="field"><label htmlFor="seats">{t('create.seats')}</label>
            <select id="seats" className="input" value={Math.min(seats, maxSeats)} onChange={(e) => setSeats(Number(e.target.value))}>{Array.from({ length: Math.max(1, maxSeats) }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}</select>
          </div>
          <div className="stack" style={{ gap: 2 }}>
            <label className="check"><input type="checkbox" checked={opts.instantBooking} onChange={(e) => setOpts({ ...opts, instantBooking: e.target.checked })} /> {t('create.instant')}</label>
            <label className="check"><input type="checkbox" checked={opts.luggageAllowed} onChange={(e) => setOpts({ ...opts, luggageAllowed: e.target.checked })} /> {t('create.luggage')}</label>
            <label className="check"><input type="checkbox" checked={opts.petsAllowed} onChange={(e) => setOpts({ ...opts, petsAllowed: e.target.checked })} /> {t('create.pets')}</label>
            <label className="check"><input type="checkbox" checked={opts.smokingAllowed} onChange={(e) => setOpts({ ...opts, smokingAllowed: e.target.checked })} /> Smoking allowed</label>
            {country?.womenOnlyAllowed && me.gender === 'female' && <label className="check"><input type="checkbox" checked={opts.womenOnly} onChange={(e) => setOpts({ ...opts, womenOnly: e.target.checked })} /> {t('create.womenOnly')}</label>}
          </div>
          <div className="field"><label htmlFor="notes">{t('create.notes')}</label><textarea id="notes" className="input" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Pickup near the metro station, small bags only" /></div>
        </div>
      </div>

      <aside className="stack" style={{ gap: 16 }}>
        {origin && dest && <RouteMap polyline={quote?.route.polyline} origin={origin} destination={dest} />}
        <div className="card stack" style={{ position: 'sticky', top: 80 }}>
          {!quote ? (
            <button type="button" className="btn primary block" disabled={!origin || !dest || busy} onClick={calculate}>{t('create.calculate')}</button>
          ) : (
            <>
              <div className="row between small"><span>{t('ride.distance')}</span><b>{distance(quote.route.distanceMeters)} · {t('ride.duration', { minutes: Math.round(quote.route.durationSeconds / 60) })}</b></div>
              {quote.route.approximate && <div className="tiny">⚠️ Dev map provider: distance is approximate. Configure Google Maps or Mapbox for road distance.</div>}
              <div className="alert ok">
                {t('create.suggested')}: <b>{money(quote.suggestion.rangeMinMinor, cur)} – {money(quote.suggestion.rangeMaxMinor, cur)}</b><br />
                {t('create.recommended')}: <b>{money(quote.suggestion.recommendedMinor, cur)}</b>
              </div>
              <div className="field">
                <label htmlFor="price">{t('create.yourPrice')} ({cur})</label>
                <input id="price" className="input num" type="number" step="0.5" inputMode="decimal" aria-invalid={!!priceError}
                  value={price !== null ? toMajor(price, cur) : ''} onChange={(e) => setPrice(e.target.value ? toMinor(Number(e.target.value), cur) : null)} />
                <input type="range" aria-label="Adjust price" min={quote.suggestion.rangeMinMinor} max={quote.suggestion.rangeMaxMinor} step={Math.max(1, Math.round((quote.suggestion.rangeMaxMinor - quote.suggestion.rangeMinMinor) / 20))} value={price ?? 0} onChange={(e) => setPrice(Number(e.target.value))} />
                <span className={priceError ? 'field-error' : 'tiny'}>{t('create.allowed', { min: money(quote.suggestion.allowedMinMinor, cur), max: money(quote.suggestion.allowedMaxMinor, cur) })}</span>
              </div>
              {preview && (
                <div className="breakdown num">
                  <span>{t('ride.seats')}</span><span>{seats}</span>
                  <span>{t('create.gross')}</span><span>{money(preview.grossFareMinor, cur)}</span>
                  <span>{t('create.commission')} ({preview.platformFeeBps / 100}%)</span><span>{preview.feeBearer === 'DRIVER' ? '−' : ''}{money(preview.platformFeeMinor, cur)}{preview.feeBearer === 'PASSENGER' ? ' (paid by passengers)' : ''}</span>
                  <span className="total">{t('create.earnings')}</span><span className="total">{money(preview.driverEarningsMinor, cur)}</span>
                </div>
              )}
              <ErrorBox error={error} />
              <button className="btn primary block" disabled={busy || !vehicleId || !!priceError || !online}>{t('create.publish')}</button>
              <button type="button" className="btn outline sm" onClick={calculate} disabled={busy}>Recalculate</button>
            </>
          )}
          {!quote && <ErrorBox error={error} />}
        </div>
      </aside>
    </form>
  );
}

export default function Page() { return <RequireAuth><CreateRide /></RequireAuth>; }
