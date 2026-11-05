'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { SearchForm, toDateInput } from '@/components/SearchForm';
import { fmtDate, fmtTime, Stars } from '@/components/ui';

interface Popular { from: string; to: string; rides: number; fromPriceMinor: number; currency: string; fromLat: number; fromLng: number; toLat: number; toLng: number }

export default function Home() {
  const { t, me, country, money, lang } = useApp();
  const [popular, setPopular] = useState<Popular[]>([]);
  const [upcoming, setUpcoming] = useState<any[]>([]);
  const [driving, setDriving] = useState<any[]>([]);
  const [earn, setEarn] = useState<any>(null);

  useEffect(() => { if (country) api<Popular[]>('/routes/popular', { query: { country: country.code } }).then(setPopular).catch(() => {}); }, [country]);
  useEffect(() => {
    if (!me) return;
    api('/bookings', { query: { tab: 'upcoming' } }).then(setUpcoming).catch(() => {});
    api('/rides/mine', { query: { tab: 'upcoming' } }).then(setDriving).catch(() => {});
    if (me.ridesAsDriver) api('/earnings').then(setEarn).catch(() => {});
  }, [me]);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const nextDrive = driving[0], nextTrip = upcoming[0];
  const total = earn?.totals?.[0];

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section className="card hero stack" style={{ gap: 16 }}>
        <div>
          {me && <p className="muted" style={{ margin: 0 }}>{greet}, {me.name.split(' ')[0]}</p>}
          <h1>{t('home.where')}</h1>
          <p className="muted" style={{ margin: 0 }}>{t('app.tagline')}</p>
        </div>
        <SearchForm />
        <div className="or">{t('home.or')}</div>
        <Link href="/rides/new" className="btn accent block">＋ {t('home.create')}</Link>
      </section>

      {(nextDrive || nextTrip || total) && (
        <section className="grid">
          {nextDrive && (
            <div className="card stack">
              <span className="pill brand">Your next drive</span>
              <h3>{nextDrive.origin.name} → {nextDrive.destination.name}</h3>
              <div className="muted">{fmtDate(nextDrive.departureAt, lang)} · {fmtTime(nextDrive.departureAt, lang)}</div>
              <div className="row small"><b>{t('ride.passengers', { count: nextDrive.confirmedPassengers })}</b> · {t('search.seatsLeft', { count: nextDrive.seatsAvailable })}{nextDrive.pendingRequests ? <span className="pill accent">{nextDrive.pendingRequests} request(s)</span> : null}</div>
              <Link href={`/rides/${nextDrive.id}`} className="btn outline sm">Manage ride</Link>
            </div>
          )}
          {nextTrip && (
            <div className="card stack">
              <span className="pill brand">{t('home.upcoming')}</span>
              <h3>{nextTrip.ride.originName} → {nextTrip.ride.destName}</h3>
              <div className="muted">{fmtDate(nextTrip.ride.departureAt, lang)} · {fmtTime(nextTrip.ride.departureAt, lang)}</div>
              <div className="row small">Driver: <b>{nextTrip.driver.name}</b> <Stars value={nextTrip.driver.rating} /></div>
              <div className="small">{t('ride.pickup')}: {nextTrip.pickup.name}</div>
              <div className="row"><Link href={`/rides/${nextTrip.rideId}`} className="btn outline sm">{t('search.viewRide')}</Link><span className="pill">{nextTrip.status}</span></div>
            </div>
          )}
          {total && (
            <div className="card stack">
              <span className="pill brand">{t('earnings.title')}</span>
              <div className="stats">
                <div className="stat"><span className="v">{money(total.todayMinor, total.currency)}</span><span className="l">{t('earnings.today')}</span></div>
                <div className="stat"><span className="v">{money(total.monthMinor, total.currency)}</span><span className="l">{t('earnings.month')}</span></div>
              </div>
              <div className="row small">{t('profile.rating')}: <Stars value={me!.rating} count={me!.ratingCount} /></div>
              <Link href="/earnings" className="btn outline sm">Details</Link>
            </div>
          )}
        </section>
      )}

      {popular.length > 0 && (
        <section className="stack">
          <h2>{t('home.popular')}</h2>
          <div className="grid">
            {popular.map((p) => {
              const q = new URLSearchParams({ fn: p.from, fa: String(p.fromLat), fo: String(p.fromLng), tn: p.to, ta: String(p.toLat), to: String(p.toLng), d: toDateInput(new Date()), s: '1' });
              return (
                <Link key={`${p.from}-${p.to}`} href={`/search?${q}`} className="card flat" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div style={{ fontWeight: 700 }}>{p.from} → {p.to}</div>
                  <div className="small muted">{t('home.routeMeta', { count: p.rides, price: '⁨' + money(p.fromPriceMinor, p.currency) + '⁩' })}</div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
