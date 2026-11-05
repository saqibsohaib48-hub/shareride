import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useStripe } from '@stripe/stripe-react-native';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app';
import { Button, Card, ErrorBox, T, useColors } from '@/ui';

/**
 * Checkout (15) → Payment success (16). Card / Apple Pay / Google Pay via Stripe PaymentSheet.
 * The app never trusts its own "success": it polls until the server confirms via webhook.
 */
export default function Checkout() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, money } = useApp();
  const c = useColors();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const [b, setB] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [phase, setPhase] = useState<'form' | 'confirming' | 'done' | 'failed'>('form');
  const [error, setError] = useState<unknown>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    api(`/bookings/${id}`).then(async (bk) => {
      setB(bk);
      if (bk.status === 'CONFIRMED') return setPhase('done');
      if (bk.status !== 'RESERVED') return;
      const s = await api('/payments/checkout', { method: 'POST', body: { bookingId: id } });
      setSession(s);
      if (s.provider === 'stripe') {
        const { error: e } = await initPaymentSheet({ paymentIntentClientSecret: s.clientSecret, merchantDisplayName: 'Share Ride', applePay: { merchantCountryCode: 'AE' }, googlePay: { merchantCountryCode: 'AE', testEnv: __DEV__ }, returnURL: 'shareride://checkout' });
        if (e) setError(new Error(e.message));
      }
    }).catch(setError);
    return () => clearInterval(timer.current);
  }, [id]);

  function waitForWebhook() {
    setPhase('confirming');
    let n = 0;
    timer.current = setInterval(async () => {
      n++;
      const bk = await api(`/bookings/${id}`).catch(() => null);
      if (bk?.status === 'CONFIRMED') { clearInterval(timer.current); setB(bk); setPhase('done'); }
      else if (n > 40 || bk?.paymentStatus === 'FAILED' || bk?.status === 'EXPIRED') { clearInterval(timer.current); setPhase('failed'); }
    }, 1500);
  }

  async function pay() {
    setError(null);
    try {
      if (session.provider === 'stripe') {
        const { error: e } = await presentPaymentSheet();
        if (e) { if (e.code !== 'Canceled') setError(new Error(e.message)); return; }
      } else {
        await api('/payments/mock/complete', { method: 'POST', body: { paymentId: session.paymentId, outcome: 'succeeded' } });
      }
      waitForWebhook();
    } catch (e) { setError(e); }
  }

  if (!b) return <View style={{ flex: 1, padding: 16, backgroundColor: c.bg }}>{error ? <ErrorBox error={error} /> : <T variant="muted">{t('common.loading')}</T>}</View>;
  const bd = b.breakdown;
  if (phase === 'done') return (
    <View style={{ flex: 1, padding: 24, gap: 16, justifyContent: 'center', backgroundColor: c.bg }}>
      <T variant="h1" style={{ textAlign: 'center' }}>✅ {t('checkout.success')}</T>
      <T variant="muted" style={{ textAlign: 'center' }}>{b.ride.originName} → {b.ride.destName} · {money(bd.passengerTotalMinor, bd.currency)}</T>
      <Button title={t('search.viewRide')} onPress={() => router.replace(`/ride/${b.rideId}`)} />
      <Button title={t('nav.trips')} kind="outline" onPress={() => router.replace('/(tabs)/trips')} />
    </View>
  );
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card>
        <T variant="h2">{b.ride.originName} → {b.ride.destName}</T>
        <T variant="muted">{t('checkout.rideFare')} ({bd.seats} × {money(bd.pricePerSeatMinor, bd.currency)}): {money(bd.grossFareMinor, bd.currency)}</T>
        <T variant="muted">{t('checkout.platformFee')} ({bd.platformFeeBps / 100}%): {bd.feeBearer === 'PASSENGER' ? money(bd.platformFeeMinor, bd.currency) : `${t('checkout.feeIncluded')} (${money(bd.platformFeeMinor, bd.currency)})`}</T>
        {bd.taxMinor > 0 && <T variant="muted">{t('checkout.tax')}: {money(bd.taxMinor, bd.currency)}</T>}
        <T variant="h2">{t('checkout.total')}: {money(bd.passengerTotalMinor, bd.currency)}</T>
      </Card>
      {session?.provider === 'mock' && <T variant="small">🧪 {t('checkout.testMode')}</T>}
      {phase === 'confirming' && <T variant="muted">⏳ {t('checkout.processing')}</T>}
      {phase === 'failed' && <T style={{ color: c.danger }}>Payment was not completed. You can try again while your seat is held.</T>}
      <ErrorBox error={error} />
      {b.status === 'RESERVED' && phase !== 'confirming' && <Button title={t('checkout.pay', { amount: money(bd.passengerTotalMinor, bd.currency) })} disabled={!session} onPress={pay} />}
      <T variant="small">🔒 Card details are handled by our payment provider and never stored by Share Ride.</T>
    </ScrollView>
  );
}
