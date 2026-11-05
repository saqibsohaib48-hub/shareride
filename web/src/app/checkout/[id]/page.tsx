'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { loadStripe, Stripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { ErrorBox, RequireAuth } from '@/components/ui';

const pk = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
let stripePromise: Promise<Stripe | null> | null = null;
const getStripe = () => (stripePromise ??= pk ? loadStripe(pk) : Promise.resolve(null));

/**
 * Checkout (spec §14, §54, §56). Card entry is handled by Stripe's PaymentElement
 * (cards, Apple Pay, Google Pay, local methods) — card data never touches our servers.
 * Success in the browser is NOT trusted: we poll the booking until the webhook confirms it.
 */
function Checkout() {
  const { id } = useParams<{ id: string }>();
  const { t, money } = useApp();
  const [booking, setBooking] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  const [phase, setPhase] = useState<'form' | 'confirming' | 'done' | 'failed'>('form');
  const [now, setNow] = useState(Date.now());
  const poll = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    api(`/bookings/${id}`).then((b) => {
      setBooking(b);
      if (b.status === 'CONFIRMED') setPhase('done');
      else if (b.status === 'RESERVED') return api('/payments/checkout', { method: 'POST', body: { bookingId: id } }).then(setSession);
    }).catch(setError);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(tick); clearInterval(poll.current); };
  }, [id]);

  function waitForWebhook() {
    setPhase('confirming');
    let tries = 0;
    poll.current = setInterval(async () => {
      tries++;
      const b = await api(`/bookings/${id}`).catch(() => null);
      if (b?.status === 'CONFIRMED') { clearInterval(poll.current); setBooking(b); setPhase('done'); }
      else if (b && (b.paymentStatus === 'FAILED' || ['EXPIRED', 'CANCELLED_BY_PASSENGER'].includes(b.status))) { clearInterval(poll.current); setPhase('failed'); setBooking(b); }
      else if (tries > 40) { clearInterval(poll.current); setPhase('failed'); }
    }, 1500);
  }

  async function payMock(outcome: 'succeeded' | 'failed') {
    try { await api('/payments/mock/complete', { method: 'POST', body: { paymentId: session.paymentId, outcome } }); waitForWebhook(); } catch (e) { setError(e); }
  }

  if (error && !booking) return <ErrorBox error={error} />;
  if (!booking) return <div className="skeleton" />;
  const bd = booking.breakdown;
  const left = booking.expiresAt ? Math.max(0, Math.floor((new Date(booking.expiresAt).getTime() - now) / 1000)) : null;

  if (phase === 'done') return (
    <div className="card stack" style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ fontSize: 56 }} aria-hidden>✅</div>
      <h1>{t('checkout.success')}</h1>
      <p className="muted">{booking.ride.originName} → {booking.ride.destName}</p>
      <p>Paid <b>{money(bd.passengerTotalMinor, bd.currency)}</b>. Your driver has been notified.</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link className="btn primary" href={`/rides/${booking.rideId}`}>{t('search.viewRide')}</Link>
        <Link className="btn outline" href="/trips">{t('nav.trips')}</Link>
      </div>
    </div>
  );

  return (
    <div className="grid-2">
      <div className="card stack">
        <h1>{t('checkout.title')}</h1>
        <p className="muted" style={{ margin: 0 }}>{booking.ride.originName} → {booking.ride.destName}</p>
        {left !== null && <div className={`alert ${left < 120 ? 'warn' : ''}`} role="timer">{t('checkout.expires', { minutes: Math.ceil(left / 60) })} ({Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')})</div>}
        <ErrorBox error={error} />
        {phase === 'failed' && <div className="alert error">Payment was not completed. {booking.status === 'RESERVED' ? 'You can try again while your seat is held.' : 'Your seat hold has ended.'}</div>}
        {phase === 'confirming' && <div className="alert" aria-live="polite">⏳ {t('checkout.processing')}</div>}
        {booking.status !== 'RESERVED' && phase === 'form' && <div className="alert warn">This booking is {booking.status.replace(/_/g, ' ').toLowerCase()} and cannot be paid.</div>}
        {session && phase !== 'confirming' && booking.status === 'RESERVED' && (
          session.provider === 'stripe' && pk ? (
            <Elements stripe={getStripe()} options={{ clientSecret: session.clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#0e7c66', borderRadius: '10px' } } }}>
              <StripeForm amount={money(session.amountMinor, session.currency)} onSubmitted={waitForWebhook} onError={setError} />
            </Elements>
          ) : session.provider === 'mock' ? (
            <div className="stack">
              <div className="alert warn">🧪 {t('checkout.testMode')}</div>
              <button className="btn primary block" onClick={() => payMock('succeeded')}>{t('checkout.pay', { amount: money(session.amountMinor, session.currency) })}</button>
              <button className="btn outline block sm" onClick={() => payMock('failed')}>Simulate a declined card</button>
            </div>
          ) : <div className="alert error">Payments are not configured (missing NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).</div>
        )}
        <p className="tiny" style={{ margin: 0 }}>🔒 Payments are processed securely by our payment provider. Share Ride never sees or stores your card number.</p>
      </div>
      <aside className="card stack">
        <h2>Summary</h2>
        <div className="breakdown num">
          <span>{t('checkout.rideFare')} ({bd.seats} × {money(bd.pricePerSeatMinor, bd.currency)})</span><span>{money(bd.grossFareMinor, bd.currency)}</span>
          <span>{t('checkout.platformFee')} ({bd.platformFeeBps / 100}%)</span><span>{bd.feeBearer === 'PASSENGER' ? money(bd.platformFeeMinor, bd.currency) : <span className="tiny">{t('checkout.feeIncluded')} ({money(bd.platformFeeMinor, bd.currency)})</span>}</span>
          {bd.taxMinor > 0 && <><span>{t('checkout.tax')}</span><span>{money(bd.taxMinor, bd.currency)}</span></>}
          {bd.promoDiscountMinor > 0 && <><span>{t('checkout.discount')}</span><span>−{money(bd.promoDiscountMinor, bd.currency)}</span></>}
          <span className="total">{t('checkout.total')}</span><span className="total">{money(bd.passengerTotalMinor, bd.currency)}</span>
        </div>
        <div className="small muted">{t('ride.pickup')}: {booking.pickup.name}<br />{t('ride.dropoff')}: {booking.dropoff.name}</div>
      </aside>
    </div>
  );
}

function StripeForm({ amount, onSubmitted, onError }: { amount: string; onSubmitted: () => void; onError: (e: unknown) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const { t } = useApp();
  const [busy, setBusy] = useState(false);
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      if (!stripe || !elements) return;
      setBusy(true);
      const { error } = await stripe.confirmPayment({ elements, redirect: 'if_required', confirmParams: { return_url: location.href } });
      setBusy(false);
      if (error) onError(new Error(error.message)); else onSubmitted();
    }}>
      <PaymentElement />
      <button className="btn primary block" disabled={!stripe || busy}>{t('checkout.pay', { amount })}</button>
    </form>
  );
}

export default function Page() { return <RequireAuth><Checkout /></RequireAuth>; }
