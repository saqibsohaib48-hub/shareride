'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorBox } from '@/components/ui';

/** Compliance switches per country (spec §53): disable ride creation or bookings where not yet permitted. */
export default function CountriesAdmin() {
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<unknown>(null);
  const load = () => api('/admin/countries').then(setRows).catch(setError);
  useEffect(() => { load(); }, []);
  async function patch(code: string, body: Record<string, unknown>) { setError(null); try { await api(`/admin/countries/${code}`, { method: 'PATCH', body }); load(); } catch (e) { setError(e); } }
  return (
    <div className="card stack">
      <h2>Countries & compliance</h2>
      <div className="alert warn small">Before enabling a country, verify transport regulations, driver licensing, vehicle and insurance requirements, tax, payments, consumer protection, data privacy and local permits.</div>
      <ErrorBox error={error} />
      <div className="table-wrap"><table>
        <thead><tr><th>Country</th><th>Ride creation</th><th>Bookings</th><th>Women-only</th><th>Driver verification</th></tr></thead>
        <tbody>{rows.map((c) => {
          const req: string[] = c.verification_requirements?.driver ?? [];
          const toggleReq = (lvl: string) => patch(c.code, { verificationRequirements: { ...c.verification_requirements, driver: req.includes(lvl) ? req.filter((x) => x !== lvl) : [...req, lvl] } });
          return (
            <tr key={c.code}>
              <td><b>{c.name}</b><div className="tiny">{c.currency} · {c.distance_unit} · {c.default_timezone}</div></td>
              <td><label className="check"><input type="checkbox" checked={c.ride_creation_enabled} onChange={(e) => patch(c.code, { rideCreationEnabled: e.target.checked })} /> Enabled</label></td>
              <td><label className="check"><input type="checkbox" checked={c.booking_enabled} onChange={(e) => patch(c.code, { bookingEnabled: e.target.checked })} /> Enabled</label></td>
              <td><label className="check"><input type="checkbox" checked={c.women_only_allowed} onChange={(e) => patch(c.code, { womenOnlyAllowed: e.target.checked })} /> Allowed</label></td>
              <td>{['phone', 'email', 'identity', 'driver'].map((l) => <label key={l} className="check small"><input type="checkbox" checked={req.includes(l)} onChange={() => toggleReq(l)} /> {l}</label>)}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </div>
  );
}
