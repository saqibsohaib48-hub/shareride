'use client';
import Link from 'next/link';
import type { RideSummary } from '@share-ride/shared';
import { useApp } from '@/lib/app-context';
import { Avatar, Stars, fmtDate, fmtTime } from './ui';

export function RideCard({ ride, query = '' }: { ride: RideSummary; query?: string }) {
  const { t, lang, money, distance } = useApp();
  const verified = ride.driver.badges.driver || ride.driver.badges.identity;
  return (
    <Link href={`/rides/${ride.id}${query}`} className="card ride-card" style={{ color: 'inherit', textDecoration: 'none' }} aria-label={`${ride.origin.name} to ${ride.destination.name}, ${fmtTime(ride.departureAt, lang)}, ${money(ride.pricePerSeatMinor, ride.currency)}`}>
      <div className="stack" style={{ gap: 10 }}>
        <div className="timeline">
          <span className="t">{fmtTime(ride.departureAt, lang)}</span><span className="dot" /><span>{ride.origin.name}</span>
          <span /><span className="bar" /><span className="tiny">{distance(ride.distanceMeters)} · {t('ride.duration', { minutes: Math.round(ride.durationSeconds / 60) })}</span>
          <span className="t">{fmtTime(ride.arrivalEstimateAt, lang)}</span><span className="dot end" /><span>{ride.destination.name}</span>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <Avatar name={ride.driver.name} url={ride.driver.photoUrl} />
          <div>
            <div style={{ fontWeight: 700 }}>{ride.driver.name} {verified && <span className="pill brand" style={{ marginInlineStart: 4 }}>✓ {t('ride.verified')}</span>}</div>
            <Stars value={ride.driver.rating} count={ride.driver.ratingCount} />
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="pill">{fmtDate(ride.departureAt, lang)}</span>
          <span className="pill">{t('search.seatsLeft', { count: ride.seatsAvailable })}</span>
          {ride.instantBooking ? <span className="pill brand">⚡ {t('ride.instant')}</span> : <span className="pill">{t('ride.approval')}</span>}
          {ride.womenOnly && <span className="pill accent">{t('search.womenOnly')}</span>}
          {ride.match && ride.match.pickupDeviationM > 1500 && <span className="pill">↔ {distance(ride.match.pickupDeviationM)} pickup</span>}
          {ride.isDemo && <span className="pill demo">{t('common.demo')}</span>}
        </div>
      </div>
      <div style={{ textAlign: 'end' }}>
        <div className="price">{money(ride.pricePerSeatMinor, ride.currency)}</div>
        <div className="tiny">{t('search.perPassenger')}</div>
      </div>
    </Link>
  );
}
