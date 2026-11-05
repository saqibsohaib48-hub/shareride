'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { ErrorBox, RequireAuth } from '@/components/ui';

// Emergency numbers per country. Verify for each launch country.
const EMERGENCY: Record<string, string> = { AE: '999', US: '911', GB: '999', IN: '112', SA: '911' };
const CATEGORIES = ['SAFETY', 'PAYMENT', 'DRIVER', 'PASSENGER', 'PICKUP', 'CANCELLATION', 'REFUND', 'LOST_ITEM', 'OTHER'];

function Safety() {
  const { country } = useApp();
  const [contacts, setContacts] = useState<any[]>([]);
  const [c, setC] = useState({ name: '', phone: '' });
  const [ticket, setTicket] = useState({ category: 'SAFETY', subject: '', body: '' });
  const [tickets, setTickets] = useState<any[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = () => { api('/profile/trusted-contacts').then(setContacts).catch(() => {}); api('/support/tickets').then(setTickets).catch(() => {}); };
  useEffect(load, []);
  const sos = EMERGENCY[country?.code ?? ''] ?? '112';

  return (
    <div className="stack" style={{ gap: 16 }}>
      <h1>Safety Center</h1>
      <div className="card stack" style={{ borderColor: 'var(--danger)' }}>
        <h2>Emergency</h2>
        <p className="muted" style={{ margin: 0 }}>If you are in danger, call local emergency services immediately.</p>
        <a className="btn danger block" href={`tel:${sos}`}>📞 Call emergency services ({sos})</a>
      </div>
      <div className="grid">
        <div className="card stack">
          <h2>Trusted contacts</h2>
          <p className="small muted" style={{ margin: 0 }}>Share your live trip details (driver, vehicle, route, status) with people you trust. Numbers are encrypted.</p>
          {contacts.map((x) => <div key={x.id} className="small">👤 {x.name}</div>)}
          <input className="input" placeholder="Name" aria-label="Contact name" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
          <input className="input" placeholder="+971501234567" aria-label="Contact phone" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} />
          <button className="btn outline" onClick={async () => { try { await api('/profile/trusted-contacts', { method: 'POST', body: c }); setC({ name: '', phone: '' }); load(); } catch (e) { setError(e); } }}>Add contact</button>
        </div>
        <div className="card stack">
          <h2>Safety tips</h2>
          <ul className="small" style={{ margin: 0, paddingInlineStart: 18 }}>
            <li>Check the driver's name, photo, car and plate before getting in.</li>
            <li>Keep chats and payments inside Share Ride — never pay cash outside the app.</li>
            <li>Your phone number stays private; use in-app messages.</li>
            <li>Share your trip from the ride page with a trusted contact.</li>
            <li>Report anything that makes you uncomfortable — safety reports are handled urgently.</li>
          </ul>
        </div>
      </div>
      <div className="card stack">
        <h2>Contact support / report a problem</h2>
        <select className="input" aria-label="Category" value={ticket.category} onChange={(e) => setTicket({ ...ticket, category: e.target.value })}>{CATEGORIES.map((x) => <option key={x} value={x}>{x.replace('_', ' ').toLowerCase()}</option>)}</select>
        <input className="input" placeholder="Subject" aria-label="Subject" value={ticket.subject} onChange={(e) => setTicket({ ...ticket, subject: e.target.value })} />
        <textarea className="input" rows={4} placeholder="What happened?" aria-label="Details" value={ticket.body} onChange={(e) => setTicket({ ...ticket, body: e.target.value })} />
        <ErrorBox error={error} />
        {msg && <div className="alert ok" role="status">{msg}</div>}
        <button className="btn primary" onClick={async () => { setError(null); try { const t = await api('/support/tickets', { method: 'POST', body: ticket }); setMsg(`Ticket ${t.reference} created. We'll get back to you soon.`); setTicket({ ...ticket, subject: '', body: '' }); load(); } catch (e) { setError(e); } }}>Send</button>
        {tickets.map((x) => <div key={x.id} className="row between small"><span>{x.reference} · {x.subject}</span><span className="pill">{x.status.replace(/_/g, ' ').toLowerCase()}</span></div>)}
      </div>
    </div>
  );
}
export default function Page() { return <RequireAuth><Safety /></RequireAuth>; }
