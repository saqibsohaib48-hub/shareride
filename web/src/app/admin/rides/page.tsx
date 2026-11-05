'use client';
import { useEffect, useState } from 'react';
import { toMinor } from '@share-ride/shared';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { ErrorBox, RouteMap } from '@/components/ui';

export default function RidesAdmin() {
  const { money } = useApp();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [refund, setRefund] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const search = () => api('/admin/rides', { query: { q: q || undefined, status: status || undefined } }).then(setRows).catch(setError);
  const open = (id: string) => api(`/admin/rides/${id}`).then(setSel).catch(setError);
  useEffect(() => { search(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid-2">
      <div className="card stack">
        <form className="row" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <input className="input" style={{ flex: 1 }} placeholder="Route, driver or ride ID" aria-label="Search rides" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="select-sm" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED_BY_DRIVER', 'EXPIRED'].map((s) => <option key={s}>{s}</option>)}</select>
          <button className="btn primary">Search</button>
        </form>
        <div className="table-wrap"><table>
          <thead><tr><th>Ride</th><th>Driver</th><th>Seats</th><th>Price</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} onClick={() => open(r.id)} style={{ cursor: 'pointer' }}>
              <td><b>{r.origin_name} → {r.dest_name}</b>{r.is_demo && <span className="pill demo">demo</span>}<div className="tiny">{new Date(r.departure_at).toLocaleString()} · {r.status}</div></td>
              <td>{r.driver_name}</td>
              <td className="num">{r.passengers} pax · {r.seats_available}/{r.seats_total} free</td>
              <td className="num">{money(r.price_per_seat_minor, r.currency)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
      <aside className="card stack">
        <ErrorBox error={error} />
        {!sel ? <p className="muted">Select a ride.</p> : (
          <>
            <h2>{sel.ride.origin.name} → {sel.ride.destination.name}</h2>
            <RouteMap polyline={sel.ride.polyline} origin={sel.ride.origin} destination={sel.ride.destination} height={160} />
            <div className="small">Driver: <b>{sel.ride.driver.name}</b> · {sel.ride.status} · {new Date(sel.ride.departureAt).toLocaleString()}</div>
            <h3>Passengers</h3>
            {sel.passengers.map((p: any) => (
              <div key={p.id} className="card flat stack" style={{ padding: 12 }}>
                <div className="row between small"><b>{p.name} · {p.seats} seat(s)</b><span className="pill">{p.status} · {p.payment_status ?? 'no payment'}</span></div>
                <div className="tiny num">Paid {money(p.passenger_total_minor, p.currency)} · fee {money(p.platform_fee_minor, p.currency)} · driver {money(p.driver_earnings_minor, p.currency)}</div>
                {['PAID', 'PARTIALLY_REFUNDED'].includes(p.payment_status) && (
                  <div className="row">
                    <input className="input" style={{ maxWidth: 120 }} type="number" step="0.01" placeholder="Amount" aria-label="Refund amount" value={refund[p.id] ?? ''} onChange={(e) => setRefund({ ...refund, [p.id]: e.target.value })} />
                    <button className="btn sm outline" disabled={!refund[p.id] || reason.length < 3} onClick={async () => { setError(null); try { await api(`/admin/bookings/${p.id}/refund`, { method: 'POST', body: { amountMinor: toMinor(Number(refund[p.id]), p.currency), reason } }); open(sel.ride.id); } catch (e) { setError(e); } }}>Refund</button>
                  </div>
                )}
              </div>
            ))}
            <h3>Seat ledger</h3>
            {sel.seatLedger.map((l: any, i: number) => <div key={i} className="tiny">{new Date(l.created_at).toLocaleString()} · {l.action} {l.seats}</div>)}
            <input className="input" placeholder="Reason (required, audited)" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            {['PUBLISHED', 'DRIVER_READY'].includes(sel.ride.status) && (
              <button className="btn danger" disabled={reason.length < 3} onClick={async () => { setError(null); try { await api(`/admin/rides/${sel.ride.id}/cancel`, { method: 'POST', body: { reason } }); open(sel.ride.id); search(); } catch (e) { setError(e); } }}>Cancel ride & refund everyone</button>
            )}
          </>
        )}
      </aside>
    </div>
  );
}
