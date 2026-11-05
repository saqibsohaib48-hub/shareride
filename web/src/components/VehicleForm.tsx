'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { ErrorBox, fieldErrors } from './ui';

const TYPES = ['sedan', 'suv', 'hatchback', 'van', 'minivan', 'pickup', 'ev', 'other'];

export function VehicleForm({ onSaved }: { onSaved: (v: any) => void }) {
  const [v, setV] = useState({ make: '', model: '', year: '', color: '', licensePlate: '', vehicleType: 'sedan', seats: '5' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fe = fieldErrors(error);
  const f = (k: keyof typeof v, label: string, type = 'text') => (
    <div className="field"><label htmlFor={`v-${k}`}>{label}</label>
      <input id={`v-${k}`} className="input" type={type} value={v[k]} aria-invalid={!!fe[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />
      {fe[k] && <span className="field-error">{fe[k][0]}</span>}
    </div>
  );
  async function save() {
    setBusy(true); setError(null);
    try {
      const out = await api('/vehicles', { method: 'POST', body: { ...v, year: v.year ? Number(v.year) : undefined, seats: Number(v.seats) } });
      onSaved(out);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  return (
    <div className="card flat stack" style={{ padding: 14 }}>
      <div className="form-grid two">{f('make', 'Make')}{f('model', 'Model')}{f('color', 'Color')}{f('year', 'Year', 'number')}{f('licensePlate', 'License plate')}
        <div className="field"><label htmlFor="v-type">Type</label><select id="v-type" className="input" value={v.vehicleType} onChange={(e) => setV({ ...v, vehicleType: e.target.value })}>{TYPES.map((x) => <option key={x}>{x}</option>)}</select></div>
        <div className="field"><label htmlFor="v-seats">Total seats (incl. driver)</label><select id="v-seats" className="input" value={v.seats} onChange={(e) => setV({ ...v, seats: e.target.value })}>{[2, 3, 4, 5, 6, 7, 8, 9].map((n) => <option key={n}>{n}</option>)}</select></div>
      </div>
      <p className="tiny" style={{ margin: 0 }}>Your plate is only shown to confirmed passengers.</p>
      <ErrorBox error={error} />
      <button type="button" className="btn primary sm" disabled={busy} onClick={save}>Save vehicle</button>
    </div>
  );
}
