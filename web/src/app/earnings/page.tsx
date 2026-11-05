'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { ErrorBox, RequireAuth, fmtDate } from '@/components/ui';

function Earnings() {
  const { t, money, lang } = useApp();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { api('/earnings').then(setData).catch(setError); }, []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="skeleton" />;
  return (
    <div className="stack" style={{ gap: 16 }}>
      <h1>{t('earnings.title')}</h1>
      {data.totals.length === 0 && <div className="card flat muted">No earnings yet. <Link href="/rides/new">{t('home.create')}</Link> to start earning.</div>}
      {data.totals.map((tot: any) => {
        const w = data.wallets.find((x: any) => x.currency === tot.currency);
        return (
          <div key={tot.currency} className="card stack">
            <div className="stats">
              <div className="stat"><span className="v">{money(tot.todayMinor, tot.currency)}</span><span className="l">{t('earnings.today')}</span></div>
              <div className="stat"><span className="v">{money(tot.weekMinor, tot.currency)}</span><span className="l">{t('earnings.week')}</span></div>
              <div className="stat"><span className="v">{money(tot.monthMinor, tot.currency)}</span><span className="l">{t('earnings.month')}</span></div>
              <div className="stat"><span className="v">{money(tot.totalMinor, tot.currency)}</span><span className="l">{t('earnings.total')}</span></div>
            </div>
            {w && (
              <>
                <hr className="divider" />
                <div className="stats">
                  <div className="stat"><span className="v">{money(w.availableMinor, w.currency)}</span><span className="l">{t('earnings.available')}</span></div>
                  <div className="stat"><span className="v">{money(w.pendingMinor, w.currency)}</span><span className="l">{t('earnings.pending')} (upcoming rides)</span></div>
                  <div className="stat"><span className="v">{money(w.withdrawnMinor, w.currency)}</span><span className="l">Withdrawn</span></div>
                </div>
                <p className="tiny" style={{ margin: 0 }}>Earnings become available once a ride is completed. Withdrawals are coming in the next release.</p>
              </>
            )}
          </div>
        );
      })}
      {data.items.length > 0 && (
        <div className="card">
          <h2>Per ride</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Date</th><th>Route</th><th>{t('checkout.passengerFare')}</th><th>{t('checkout.platformFee')}</th><th>{t('checkout.yourEarnings')}</th><th>Status</th></tr></thead>
              <tbody>
                {data.items.map((e: any) => (
                  <tr key={e.id}>
                    <td>{fmtDate(e.departureAt, lang)}</td>
                    <td><Link href={`/rides/${e.rideId}`}>{e.route}</Link> <span className="tiny">· {e.seats} seat(s)</span></td>
                    <td className="num">{money(e.passengerPaidMinor, e.currency)}</td>
                    <td className="num">−{money(e.platformFeeMinor, e.currency)}</td>
                    <td className="num"><b>{money(e.yourEarningsMinor, e.currency)}</b></td>
                    <td><span className="pill">{e.status.toLowerCase().replace('_', ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
export default function Page() { return <RequireAuth><Earnings /></RequireAuth>; }
