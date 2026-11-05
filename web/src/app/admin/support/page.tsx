'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorBox } from '@/components/ui';

const STATUSES = ['OPEN', 'UNDER_REVIEW', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED'];

export default function SupportAdmin() {
  const [rows, setRows] = useState<any[]>([]);
  const [status, setStatus] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const load = () => api('/admin/support/tickets', { query: { status: status || undefined } }).then(setRows).catch(setError);
  useEffect(() => { load(); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  async function update(id: string, body: Record<string, unknown>) { setError(null); try { await api(`/admin/support/tickets/${id}`, { method: 'PATCH', body }); setNote({ ...note, [id]: '' }); load(); } catch (e) { setError(e); } }
  return (
    <div className="card stack">
      <div className="row between"><h2 style={{ margin: 0 }}>Support tickets</h2>
        <select className="select-sm" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
      </div>
      <ErrorBox error={error} />
      {rows.length === 0 && <p className="muted">No tickets.</p>}
      {rows.map((t) => (
        <div key={t.id} className="card flat stack" style={{ padding: 14 }}>
          <div className="row between"><b>{t.reference} · {t.subject}</b><span className={`pill ${t.priority === 'URGENT' ? 'danger' : ''}`}>{t.category} · {t.priority}</span></div>
          <div className="small muted">{t.user_name} · {new Date(t.created_at).toLocaleString()}</div>
          <p className="small" style={{ margin: 0 }}>{t.body}</p>
          <div className="row">
            <select className="select-sm" aria-label="Ticket status" value={t.status} onChange={(e) => update(t.id, { status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
            <input className="input" style={{ flex: 1 }} placeholder="Internal note" aria-label="Internal note" value={note[t.id] ?? ''} onChange={(e) => setNote({ ...note, [t.id]: e.target.value })} />
            <button className="btn sm outline" disabled={!note[t.id]} onClick={() => update(t.id, { note: note[t.id], internal: true })}>Add note</button>
            <button className="btn sm outline" disabled={!note[t.id]} onClick={() => update(t.id, { note: note[t.id], internal: false })}>Reply to user</button>
          </div>
        </div>
      ))}
    </div>
  );
}
