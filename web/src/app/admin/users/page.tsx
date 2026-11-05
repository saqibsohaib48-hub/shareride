'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { ErrorBox, Stars } from '@/components/ui';

export default function UsersAdmin() {
  const { money } = useApp();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [sel, setSel] = useState<any>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<unknown>(null);
  const search = () => api('/admin/users', { query: { q: q || undefined } }).then(setRows).catch(setError);
  const open = (id: string) => api(`/admin/users/${id}`).then(setSel).catch(setError);
  useEffect(() => { search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function action(path: string, body: unknown) { setError(null); try { await api(path, { method: 'POST', body }); await open(sel.user.id); search(); } catch (e) { setError(e); } }

  return (
    <div className="grid-2">
      <div className="card stack">
        <form className="row" onSubmit={(e) => { e.preventDefault(); search(); }}>
          <input className="input" style={{ flex: 1 }} placeholder="Name, email, phone or ID" aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn primary">Search</button>
        </form>
        <div className="table-wrap"><table>
          <thead><tr><th>User</th><th>Status</th><th>Rides</th><th>Trust</th></tr></thead>
          <tbody>{rows.map((u) => (
            <tr key={u.id} onClick={() => open(u.id)} style={{ cursor: 'pointer' }}>
              <td><b>{u.name}</b> {u.is_demo && <span className="pill demo">demo</span>} {u.admin_role && <span className="pill brand">{u.admin_role}</span>}<div className="tiny">{u.email ?? u.phone} · {u.country_code}</div></td>
              <td><span className={`pill ${u.status === 'ACTIVE' ? 'brand' : 'danger'}`}>{u.status}</span>{u.open_flags > 0 && <span className="pill accent">⚑ {u.open_flags}</span>}</td>
              <td className="num">{u.rides_as_driver} / {u.trips_as_passenger}<div className="tiny">cancels {u.driver_cancel_count + u.passenger_cancel_count}</div></td>
              <td className="num">{u.trust_score}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
      <aside className="card stack">
        <ErrorBox error={error} />
        {!sel ? <p className="muted">Select a user.</p> : (
          <>
            <h2>{sel.user.name}</h2>
            <div className="small">{sel.user.email} · {sel.user.phone} · {sel.user.countryCode}</div>
            <Stars value={sel.user.rating} count={sel.user.ratingCount} />
            <div className="small">Status: <b>{sel.user.status}</b> · Trust score (internal): <b>{sel.internal.trust_score}</b> · No-shows: {sel.internal.no_show_count}</div>
            <div className="row small">
              <span>Identity: {sel.user.badges.identity ? '✓' : '✗'}</span>
              <button className="btn sm outline" onClick={() => action(`/admin/users/${sel.user.id}/verification`, { level: 'identity', action: sel.user.badges.identity ? 'reset' : 'verify' })}>{sel.user.badges.identity ? 'Reset' : 'Verify identity'}</button>
              <span>Driver: {sel.user.badges.driver ? '✓' : '✗'}</span>
              <button className="btn sm outline" onClick={() => action(`/admin/users/${sel.user.id}/verification`, { level: 'driver', action: sel.user.badges.driver ? 'reset' : 'verify' })}>{sel.user.badges.driver ? 'Reset' : 'Verify driver'}</button>
            </div>
            <input className="input" placeholder="Reason (required, audited)" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="row">
              {sel.user.status === 'ACTIVE' || sel.user.status === 'RESTRICTED'
                ? <><button className="btn danger sm" disabled={reason.length < 3} onClick={() => action(`/admin/users/${sel.user.id}/suspend`, { reason })}>Suspend</button><button className="btn danger sm" disabled={reason.length < 3} onClick={() => action(`/admin/users/${sel.user.id}/block`, { reason })}>Block</button></>
                : <button className="btn primary sm" disabled={reason.length < 3} onClick={() => action(`/admin/users/${sel.user.id}/reactivate`, { reason })}>Reactivate</button>}
            </div>
            {sel.fraudFlags.length > 0 && <><h3>Fraud flags</h3>{sel.fraudFlags.map((f: any) => <div key={f.id} className="small">⚑ {f.kind} · {f.severity} · {f.status}</div>)}</>}
            <h3>Rides as driver ({sel.rides.length})</h3>
            {sel.rides.slice(0, 6).map((r: any) => <div key={r.id} className="tiny">{new Date(r.departure_at).toLocaleDateString()} · {r.origin_name} → {r.dest_name} · {r.status}</div>)}
            <h3>Payments ({sel.payments.length})</h3>
            {sel.payments.slice(0, 6).map((p: any) => <div key={p.id} className="tiny">{money(p.amount_minor, p.currency)} · {p.status}{p.refunded_minor ? ` · refunded ${money(p.refunded_minor, p.currency)}` : ''}</div>)}
            <h3>Ratings received ({sel.ratings.length})</h3>
            {sel.ratings.slice(0, 6).map((r: any, i: number) => <div key={i} className="tiny">{'★'.repeat(r.stars)} {r.comment}</div>)}
            <h3>Complaints / tickets ({sel.tickets.length})</h3>
            {sel.tickets.map((t: any) => <div key={t.id} className="tiny">{t.reference} · {t.category} · {t.status}</div>)}
          </>
        )}
      </aside>
    </div>
  );
}
