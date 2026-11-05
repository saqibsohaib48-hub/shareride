'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ErrorBox } from '@/components/ui';

export default function AuditAdmin() {
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');
  const [rows, setRows] = useState<any[]>([]);
  const [error, setError] = useState<unknown>(null);
  const load = () => api('/admin/audit-logs', { query: { action: action || undefined, entityId: entityId || undefined } }).then(setRows).catch(setError);
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="card stack">
      <form className="row" onSubmit={(e) => { e.preventDefault(); load(); }}>
        <input className="input" style={{ flex: 1 }} placeholder="Action prefix, e.g. admin. / booking. / auth.login" aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)} />
        <input className="input" style={{ flex: 1 }} placeholder="Entity ID" aria-label="Entity ID" value={entityId} onChange={(e) => setEntityId(e.target.value)} />
        <button className="btn primary">Search</button>
      </form>
      <ErrorBox error={error} />
      <div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Entity</th><th>Data</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id}>
            <td className="tiny">{new Date(r.created_at).toLocaleString()}</td>
            <td><code>{r.action}</code></td>
            <td className="small">{r.actor_name ?? 'system'}{r.actor_role ? ` (${r.actor_role})` : ''}<div className="tiny">{r.ip}</div></td>
            <td className="tiny">{r.entity_type} {r.entity_id?.slice(0, 8)}</td>
            <td className="tiny" style={{ maxWidth: 320, wordBreak: 'break-word' }}>{JSON.stringify(r.data).slice(0, 200)}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
