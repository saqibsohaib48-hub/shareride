'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { ErrorBox } from '@/components/ui';
import { BarChart } from '@/components/BarChart';

export default function AdminDashboard() {
  const { money, countries } = useApp();
  const [days, setDays] = useState(30);
  const [country, setCountry] = useState('');
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { setD(null); api('/admin/dashboard', { query: { days, country: country || undefined, currency: 'AED' } }).then(setD).catch(setError); }, [days, country]);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <div className="skeleton" style={{ minHeight: 300 }} />;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const primary = d.money[0];
  const dailyRev = d.dailyMoney.filter((x: any) => x.currency === primary?.currency);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row">
        <select className="select-sm" aria-label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>{[7, 30, 90, 365].map((n) => <option key={n} value={n}>Last {n} days</option>)}</select>
        <select className="select-sm" aria-label="Country" value={country} onChange={(e) => setCountry(e.target.value)}><option value="">All countries</option>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
      </div>
      {d.reportingTotal && (
        <div className="card stats">
          <div className="stat"><span className="v">{money(d.reportingTotal.gmvMinor, d.reportingTotal.currency)}</span><span className="l">Total GMV (≈{d.reportingTotal.currency})</span></div>
          <div className="stat"><span className="v">{money(d.reportingTotal.platformRevenueMinor, d.reportingTotal.currency)}</span><span className="l">Platform revenue</span></div>
          <div className="stat"><span className="v">{money(d.reportingTotal.driverEarningsMinor, d.reportingTotal.currency)}</span><span className="l">Driver earnings</span></div>
          <p className="tiny" style={{ gridColumn: '1/-1', margin: 0 }}>{d.reportingTotal.note}. Per-currency figures below are authoritative.</p>
        </div>
      )}
      <div className="card">
        <h2>Money by currency</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Currency</th><th>GMV</th><th>Platform revenue</th><th>Driver earnings</th><th>Tax</th><th>Bookings</th><th>Avg booking</th></tr></thead>
          <tbody>{d.money.map((m: any) => (
            <tr key={m.currency}><td><b>{m.currency}</b></td><td className="num">{money(m.gmvMinor, m.currency)}</td><td className="num">{money(m.platformRevenueMinor, m.currency)}</td><td className="num">{money(m.driverEarningsMinor, m.currency)}</td><td className="num">{money(m.taxMinor, m.currency)}</td><td className="num">{m.bookings}</td><td className="num">{money(m.avgBookingValueMinor, m.currency)}</td></tr>
          ))}</tbody>
        </table></div>
      </div>
      <div className="card stats">
        <div className="stat"><span className="v">{d.users.total}</span><span className="l">Total users</span></div>
        <div className="stat"><span className="v">{d.users.activeUsers}</span><span className="l">Active users</span></div>
        <div className="stat"><span className="v">{d.users.newUsers}</span><span className="l">New users</span></div>
        <div className="stat"><span className="v">{d.users.activeDrivers}</span><span className="l">Active drivers</span></div>
        <div className="stat"><span className="v">{d.users.activePassengers}</span><span className="l">Active passengers</span></div>
        <div className="stat"><span className="v">{d.rides.total}</span><span className="l">Total rides</span></div>
        <div className="stat"><span className="v">{d.rides.completed}</span><span className="l">Completed rides</span></div>
        <div className="stat"><span className="v">{d.rides.cancelled}</span><span className="l">Cancelled rides</span></div>
        <div className="stat"><span className="v">{pct(d.rides.cancellationRate)}</span><span className="l">Cancellation %</span></div>
        <div className="stat"><span className="v">{pct(d.conversion.rate)}</span><span className="l">Ride conversion</span></div>
        <div className="stat"><span className="v">{pct(d.repeatBookingRate)}</span><span className="l">Repeat booking %</span></div>
        <div className="stat"><span className="v">{d.averageRating || '—'}</span><span className="l">Average rating</span></div>
        <div className="stat"><span className="v">{pct(d.rides.avgOccupancy)}</span><span className="l">Avg occupancy</span></div>
        <div className="stat"><span className="v">{(d.rides.avgDistanceMeters / 1000).toFixed(0)} km</span><span className="l">Avg distance</span></div>
      </div>
      <div className="card stats">
        <div className="stat"><span className="v">{d.pending.pendingRefunds}</span><span className="l">Pending refunds</span></div>
        <div className="stat"><span className="v">{d.pending.withdrawals}</span><span className="l">Pending withdrawals</span></div>
        <div className="stat"><span className="v">{d.pending.openTickets}</span><span className="l">Open tickets</span></div>
        <div className="stat"><span className="v">{d.pending.disputes}</span><span className="l">Disputes</span></div>
        <div className="stat"><span className="v">{d.pending.fraudFlags}</span><span className="l">Fraud flags</span></div>
        {d.refunds.map((r: any) => <div key={r.currency} className="stat"><span className="v">{money(r.refundedMinor, r.currency)}</span><span className="l">Refunds ({r.count})</span></div>)}
      </div>
      <div className="grid">
        <div className="card"><BarChart label="Rides created per day" data={d.daily.map((x: any) => ({ x: x.day, y: x.rides }))} /></div>
        <div className="card"><BarChart label="Confirmed bookings per day" data={d.daily.map((x: any) => ({ x: x.day, y: x.bookings }))} color="var(--accent)" /></div>
        <div className="card"><BarChart label="New users per day" data={d.daily.map((x: any) => ({ x: x.day, y: x.new_users }))} /></div>
        {primary && <div className="card"><BarChart label={`Platform revenue per day (${primary.currency})`} data={dailyRev.map((x: any) => ({ x: x.day, y: x.revenue }))} format={(n) => money(n, primary.currency)} color="var(--accent)" /></div>}
      </div>
      <div className="card">
        <h2>Country performance</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Country</th><th>Rides</th><th>GMV</th><th>Revenue</th></tr></thead>
          <tbody>{d.byCountry.map((c: any) => <tr key={c.country + c.currency}><td>{c.country}</td><td className="num">{c.rides}</td><td className="num">{money(c.gmv, c.currency)}</td><td className="num">{money(c.revenue, c.currency)}</td></tr>)}</tbody>
        </table></div>
      </div>
    </div>
  );
}
