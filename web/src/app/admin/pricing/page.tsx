'use client';
import { useEffect, useState } from 'react';
import { suggestPrice, toMajor, toMinor } from '@share-ride/shared';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { ErrorBox } from '@/components/ui';

const FIELDS = [
  ['baseFareMinor', 'base_fare_minor', 'Base fare'], ['perKmMinor', 'per_km_minor', 'Price per km'],
  ['minFareMinor', 'min_fare_minor', 'Minimum fare'], ['maxFareMinor', 'max_fare_minor', 'Maximum fare'],
  ['minDriverPriceMinor', 'min_driver_price_minor', 'Min driver price / seat'], ['maxDriverPriceMinor', 'max_driver_price_minor', 'Max driver price / seat'],
] as const;

/** Pricing management (spec §30, §60). Each save creates a new version; history is kept and audited. */
export default function PricingAdmin() {
  const { money, countries } = useApp();
  const [rules, setRules] = useState<any[]>([]);
  const [cc, setCc] = useState('AE');
  const [form, setForm] = useState<Record<string, string>>({});
  const [fee, setFee] = useState('5');
  const [bearer, setBearer] = useState<'DRIVER' | 'PASSENGER'>('DRIVER');
  const [tax, setTax] = useState('0');
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState<string | null>(null);
  const load = () => api('/admin/pricing').then(setRules).catch(setError);
  useEffect(() => { load(); }, []);
  const active = rules.find((r) => r.country_code === cc && r.is_active);
  const cur = active?.currency ?? countries.find((c) => c.code === cc)?.currency ?? 'AED';

  useEffect(() => {
    if (!active) return;
    setForm(Object.fromEntries(FIELDS.map(([k, col]) => [k, String(toMajor(active[col], cur))])));
    setFee(String(active.platform_fee_bps / 100)); setBearer(active.fee_bearer); setTax(String(active.tax_on_fee_bps / 100)); setNote('');
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const minor = Object.fromEntries(FIELDS.map(([k]) => [k, toMinor(Number(form[k] || 0), cur)]));
  const example = active ? (() => { try { return suggestPrice({ ...minor, countryCode: cc, currency: cur, platformFeeBps: Math.round(Number(fee) * 100), feeBearer: bearer, taxOnFeeBps: 0, roundingMinor: active.rounding_minor, suggestionSpreadBps: active.suggestion_spread_bps } as any, 42000); } catch { return null; } })() : null;

  async function save() {
    setError(null); setOk(null);
    try {
      await api(`/admin/pricing/${cc}`, { method: 'POST', body: { ...minor, platformFeeBps: Math.round(Number(fee) * 100), feeBearer: bearer, taxOnFeeBps: Math.round(Number(tax) * 100), roundingMinor: active?.rounding_minor ?? 100, suggestionSpreadBps: active?.suggestion_spread_bps ?? 1000, note: note || undefined } });
      setOk('New pricing version published. It applies to rides created from now on; existing bookings keep their price.'); load();
    } catch (e) { setError(e); }
  }
  async function toggle(id: string, action: 'activate' | 'deactivate') { try { await api(`/admin/pricing/rules/${id}/${action}`, { method: 'POST' }); load(); } catch (e) { setError(e); } }

  return (
    <div className="grid-2">
      <div className="card stack">
        <div className="row between"><h2 style={{ margin: 0 }}>Pricing Management</h2>
          <select className="select-sm" aria-label="Country" value={cc} onChange={(e) => setCc(e.target.value)}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.currency})</option>)}</select>
        </div>
        {!active && <div className="alert warn">No active pricing for this country — ride creation is effectively disabled. Create a version below.</div>}
        <div className="form-grid two">
          {FIELDS.map(([k, , label]) => (
            <div className="field" key={k}><label htmlFor={k}>{label} ({cur})</label><input id={k} className="input num" type="number" step="0.01" min="0" value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
          ))}
          <div className="field"><label htmlFor="fee">Platform fee (%)</label><input id="fee" className="input num" type="number" step="0.1" min="0" max="50" value={fee} onChange={(e) => setFee(e.target.value)} /></div>
          <div className="field"><label htmlFor="bearer">Fee paid by</label><select id="bearer" className="input" value={bearer} onChange={(e) => setBearer(e.target.value as any)}><option value="DRIVER">Driver (deducted from earnings)</option><option value="PASSENGER">Passenger (added at checkout)</option></select></div>
          <div className="field"><label htmlFor="tax">Tax on platform fee (%)</label><input id="tax" className="input num" type="number" step="0.1" min="0" value={tax} onChange={(e) => setTax(e.target.value)} /><span className="tiny">Separate from the fee. Confirm with a tax adviser.</span></div>
          <div className="field"><label htmlFor="note">Change note</label><input id="note" className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this change?" /></div>
        </div>
        {example && <div className="alert">Example — 42 km ride: suggested <b>{money(example.recommendedMinor, cur)}</b> per seat (range {money(example.rangeMinMinor, cur)}–{money(example.rangeMaxMinor, cur)}).</div>}
        <p className="tiny" style={{ margin: 0 }}>Values are configuration, not official market prices. Validate against local market and regulatory data before launch.</p>
        <ErrorBox error={error} />
        {ok && <div className="alert ok">{ok}</div>}
        <button className="btn primary" onClick={save}>Publish new version</button>
      </div>
      <div className="card stack">
        <h2>History — {cc}</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>v</th><th>Base / km</th><th>Fee</th><th>By</th><th></th></tr></thead>
          <tbody>{rules.filter((r) => r.country_code === cc).map((r) => (
            <tr key={r.id}>
              <td>{r.version} {r.is_active && <span className="pill brand">active</span>}</td>
              <td className="num">{money(r.base_fare_minor, r.currency)} + {money(r.per_km_minor, r.currency)}/km</td>
              <td className="num">{r.platform_fee_bps / 100}% · {r.fee_bearer.toLowerCase()}</td>
              <td className="tiny">{r.created_by_name ?? 'seed'}<br />{new Date(r.created_at).toLocaleDateString()}{r.note ? <><br />{r.note}</> : null}</td>
              <td>{r.is_active ? <button className="btn sm outline" onClick={() => toggle(r.id, 'deactivate')}>Deactivate</button> : <button className="btn sm outline" onClick={() => toggle(r.id, 'activate')}>Roll back</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </div>
    </div>
  );
}
