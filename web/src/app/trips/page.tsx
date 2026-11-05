'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { ErrorBox, RequireAuth, Stars, fmtDate, fmtTime } from '@/components/ui';

const TABS = ['upcoming', 'active', 'completed', 'cancelled'] as const;

function Trips() {
  const { t, lang, money } = useApp();
  const [tab, setTab] = useState<(typeof TABS)[number]>('upcoming');
  const [role, setRole] = useState<'passenger' | 'driver'>('passenger');
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    setItems(null); setError(null);
    api(role === 'passenger' ? '/bookings' : '/rides/mine', { query: { tab } }).then(setItems).catch(setError);
  }, [tab, role]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <h1>{t('nav.trips')}</h1>
      <div className="tabs" role="tablist" aria-label="Role">
        <button role="tab" aria-selected={role === 'passenger'} onClick={() => setRole('passenger')}>{t('trips.asPassenger')}</button>
        <button role="tab" aria-selected={role === 'driver'} onClick={() => setRole('driver')}>{t('trips.asDriver')}</button>
      </div>
      <div className="tabs" role="tablist" aria-label="Status">
        {TABS.map((x) => <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)}>{t(`trips.${x}` as any)}</button>)}
      </div>
      <ErrorBox error={error} />
      {!items && !error && <div className="skeleton" />}
      {items?.length === 0 && <div className="card flat muted">{t('trips.empty')}</div>}
      <div className="stack">
        {role === 'passenger' && items?.map((b) => (
          <Link key={b.id} href={b.status === 'RESERVED' ? `/checkout/${b.id}` : `/rides/${b.rideId}`} className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="row between">
              <b>{b.ride.originName} → {b.ride.destName}</b>
              <span className={`pill ${b.status === 'CONFIRMED' || b.status === 'COMPLETED' ? 'brand' : b.status.startsWith('CANCEL') || b.status === 'EXPIRED' ? 'danger' : 'accent'}`}>{b.status.replace(/_/g, ' ')}</span>
            </div>
            <div className="row small muted">
              <span>{fmtDate(b.ride.departureAt, lang)} · {fmtTime(b.ride.departureAt, lang)}</span>
              <span>Driver {b.driver.name}</span><Stars value={b.driver.rating} />
              <span>{b.seats} seat(s)</span>
              <span className="num"><b>{money(b.breakdown.passengerTotalMinor, b.breakdown.currency)}</b>{b.paymentStatus ? ` · ${b.paymentStatus.toLowerCase().replace('_', ' ')}` : ''}</span>
              {b.status === 'COMPLETED' && !b.rated && <span className="pill accent">{t('trips.rate')}</span>}
              {b.status === 'RESERVED' && <span className="pill accent">Complete payment →</span>}
            </div>
          </Link>
        ))}
        {role === 'driver' && items?.map((r) => (
          <Link key={r.id} href={`/rides/${r.id}`} className="card" style={{ color: 'inherit', textDecoration: 'none' }}>
            <div className="row between"><b>{r.origin.name} → {r.destination.name}</b><span className="pill">{r.status.replace(/_/g, ' ')}</span></div>
            <div className="row small muted">
              <span>{fmtDate(r.departureAt, lang)} · {fmtTime(r.departureAt, lang)}</span>
              <span>{t('ride.passengers', { count: r.confirmedPassengers })}</span>
              <span>{t('search.seatsLeft', { count: r.seatsAvailable })}</span>
              <span className="num">{money(r.pricePerSeatMinor, r.currency)} / seat</span>
              {r.pendingRequests > 0 && <span className="pill accent">{r.pendingRequests} {t('trips.requests').toLowerCase()}</span>}
              {r.isDemo && <span className="pill demo">{t('common.demo')}</span>}
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
export default function Page() { return <RequireAuth><Trips /></RequireAuth>; }
