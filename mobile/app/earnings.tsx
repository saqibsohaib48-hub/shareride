import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app';
import { Card, ErrorBox, T, useColors } from '@/ui';

/** Earnings (screen 23) + Wallet (22). */
export default function Earnings() {
  const { t, money } = useApp();
  const c = useColors();
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { api('/earnings').then(setD).catch(setError); }, []);
  if (!d) return <View style={{ padding: 16 }}>{error ? <ErrorBox error={error} /> : <T variant="muted">{t('common.loading')}</T>}</View>;
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      {d.totals.length === 0 && <T variant="muted">No earnings yet — create a ride to start earning.</T>}
      {d.totals.map((x: any) => {
        const w = d.wallets.find((y: any) => y.currency === x.currency);
        return (
          <Card key={x.currency}>
            <T variant="h2">{t('earnings.title')} · {x.currency}</T>
            <T>{t('earnings.today')}: {money(x.todayMinor, x.currency)}</T>
            <T>{t('earnings.week')}: {money(x.weekMinor, x.currency)}</T>
            <T>{t('earnings.month')}: {money(x.monthMinor, x.currency)}</T>
            <T variant="h2">{t('earnings.total')}: {money(x.totalMinor, x.currency)}</T>
            {w && <T variant="muted">{t('earnings.available')}: {money(w.availableMinor, w.currency)} · {t('earnings.pending')}: {money(w.pendingMinor, w.currency)}</T>}
          </Card>
        );
      })}
      {d.items.map((e: any) => (
        <Card key={e.id}>
          <T style={{ fontWeight: '700' }}>{e.route}</T>
          <T variant="small">{t('checkout.passengerFare')}: {money(e.passengerPaidMinor, e.currency)}</T>
          <T variant="small">{t('checkout.platformFee')}: −{money(e.platformFeeMinor, e.currency)}</T>
          <T>{t('checkout.yourEarnings')}: {money(e.yourEarningsMinor, e.currency)} · {e.status.toLowerCase()}</T>
        </Card>
      ))}
    </ScrollView>
  );
}
