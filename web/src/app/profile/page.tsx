'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LANGUAGES } from '@share-ride/shared';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { Avatar, Badges, ErrorBox, RequireAuth, Stars } from '@/components/ui';
import { PhoneVerify } from '@/components/PhoneVerify';
import { VehicleForm } from '@/components/VehicleForm';

function Profile() {
  const { t, me, reloadMe, logout, countries, lang, setLang } = useApp();
  const router = useRouter();
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [edit, setEdit] = useState({ name: me!.name, about: me!.about ?? '', languages: me!.languages.join(', '), countryCode: me!.countryCode ?? '', gender: me!.gender ?? 'undisclosed' });
  const [prefs, setPrefs] = useState(me!.notificationPrefs);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [addVehicle, setAddVehicle] = useState(false);
  const [verifyPhone, setVerifyPhone] = useState(false);
  const [del, setDel] = useState<{ open: boolean; password: string }>({ open: false, password: '' });
  const loadVehicles = () => api('/vehicles').then(setVehicles).catch(() => {});
  useEffect(() => { loadVehicles(); }, []);

  async function save() {
    setError(null); setSaved(false);
    try {
      const countryCode = edit.countryCode || undefined;
      const currency = countries.find((c) => c.code === countryCode)?.currency;
      await api('/profile', { method: 'PATCH', body: { name: edit.name, about: edit.about || null, languages: edit.languages.split(',').map((s) => s.trim()).filter(Boolean), countryCode, preferredCurrency: currency, gender: edit.gender, notificationPrefs: prefs } });
      await reloadMe(); setSaved(true);
    } catch (e) { setError(e); }
  }
  async function deleteAccount() {
    setError(null);
    try { await api('/profile/delete', { method: 'POST', body: { password: del.password || undefined } }); await logout(); router.push('/'); } catch (e) { setError(e); }
  }

  const m = me!;
  return (
    <div className="grid-2">
      <div className="stack" style={{ gap: 16 }}>
        <div className="card row" style={{ gap: 16 }}>
          <Avatar name={m.name} url={m.photoUrl} size="lg" />
          <div className="stack" style={{ gap: 4 }}>
            <h1 style={{ margin: 0 }}>{m.name} {m.isDemo && <span className="pill demo">{t('common.demo')}</span>}</h1>
            <Stars value={m.rating} count={m.ratingCount} />
            <span className="small muted">{t('profile.memberSince', { date: new Date(m.memberSince).toLocaleDateString(lang, { month: 'long', year: 'numeric' }) })} · {m.ridesAsDriver} rides given · {m.tripsAsPassenger} trips taken</span>
            <Badges badges={m.badges} />
          </div>
        </div>

        <div className="card stack">
          <h2>{t('profile.settings')}</h2>
          <div className="form-grid two">
            <div className="field"><label htmlFor="n">{t('auth.name')}</label><input id="n" className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="c">{t('auth.country')}</label><select id="c" className="input" value={edit.countryCode} onChange={(e) => setEdit({ ...edit, countryCode: e.target.value })}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.currency})</option>)}</select></div>
            <div className="field"><label htmlFor="l">{t('profile.language')}</label><select id="l" className="input" value={lang} onChange={(e) => setLang(e.target.value)}>{LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select></div>
            <div className="field"><label htmlFor="g">Gender (private — used only for women-only rides)</label><select id="g" className="input" value={edit.gender} onChange={(e) => setEdit({ ...edit, gender: e.target.value })}><option value="undisclosed">Prefer not to say</option><option value="female">Female</option><option value="male">Male</option><option value="other">Other</option></select></div>
          </div>
          <div className="field"><label htmlFor="langs">{t('profile.languages')}</label><input id="langs" className="input" value={edit.languages} onChange={(e) => setEdit({ ...edit, languages: e.target.value })} placeholder="English, Arabic" /></div>
          <div className="field"><label htmlFor="ab">{t('profile.about')}</label><textarea id="ab" className="input" rows={3} maxLength={500} value={edit.about} onChange={(e) => setEdit({ ...edit, about: e.target.value })} /></div>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ fontWeight: 600, fontSize: '.9rem', marginBottom: 4 }}>{t('nav.notifications')}</legend>
            <label className="check"><input type="checkbox" checked={prefs.push} onChange={(e) => setPrefs({ ...prefs, push: e.target.checked })} /> Push</label>
            <label className="check"><input type="checkbox" checked={prefs.email} onChange={(e) => setPrefs({ ...prefs, email: e.target.checked })} /> Email</label>
            <label className="check"><input type="checkbox" checked={prefs.sms} onChange={(e) => setPrefs({ ...prefs, sms: e.target.checked })} /> SMS / WhatsApp</label>
          </fieldset>
          <ErrorBox error={error} />
          {saved && <div className="alert ok" role="status">Saved.</div>}
          <button className="btn primary" onClick={save}>{t('common.save')}</button>
        </div>
      </div>

      <aside className="stack" style={{ gap: 16 }}>
        <div className="card stack">
          <h2>Verification</h2>
          <div className="small">📱 Phone: {m.badges.phone ? <b>✓ {m.phone}</b> : <button className="btn sm outline" onClick={() => setVerifyPhone(true)}>Verify now</button>}</div>
          {verifyPhone && !m.badges.phone && <PhoneVerify onDone={() => { setVerifyPhone(false); reloadMe(); }} />}
          <div className="small">✉️ Email: {m.badges.email ? '✓ Verified' : m.email ?? '—'}</div>
          <div className="small">🪪 Identity: {m.badges.identity ? '✓ Verified' : 'Not verified — upload ID from the mobile app'}</div>
          <div className="small">🚗 Driver: {m.badges.driver ? '✓ Verified' : 'Not verified'}</div>
          <p className="tiny" style={{ margin: 0 }}>Your phone, email and documents are never shown to other members.</p>
        </div>
        <div className="card stack">
          <h2>{t('profile.vehicles')}</h2>
          {vehicles.map((v) => <div key={v.id} className="row between small"><span>{v.color} {v.make} {v.model} · {v.licensePlate}</span><span className="pill">{v.verificationStatus.toLowerCase()}</span></div>)}
          {addVehicle ? <VehicleForm onSaved={() => { setAddVehicle(false); loadVehicles(); }} /> : <button className="btn outline sm" onClick={() => setAddVehicle(true)}>＋ {t('create.addVehicle')}</button>}
        </div>
        <div className="card stack">
          <Link href="/trips">{t('nav.trips')}</Link>
          <Link href="/earnings">{t('nav.earnings')}</Link>
          <Link href="/notifications">{t('nav.notifications')}</Link>
          <Link href="/safety">Safety Center</Link>
          {m.adminRole && <Link href="/admin">{t('nav.admin')} ({m.adminRole})</Link>}
          <button className="btn outline" onClick={async () => { await logout(); router.push('/'); }}>{t('nav.logout')}</button>
        </div>
        <div className="card stack">
          <h3>{t('profile.deleteAccount')}</h3>
          {!del.open ? <button className="btn danger sm" onClick={() => setDel({ ...del, open: true })}>{t('profile.deleteAccount')}…</button> : (
            <>
              <p className="small muted" style={{ margin: 0 }}>This removes your personal data. Upcoming rides, bookings or unpaid earnings must be settled first. Financial records are kept as required by law.</p>
              {m.email && <input className="input" type="password" placeholder={t('auth.password')} aria-label={t('auth.password')} value={del.password} onChange={(e) => setDel({ ...del, password: e.target.value })} />}
              <button className="btn danger" onClick={deleteAccount}>Permanently delete my account</button>
              <button className="btn outline sm" onClick={() => setDel({ open: false, password: '' })}>{t('common.cancel')}</button>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
export default function Page() { return <RequireAuth><Profile /></RequireAuth>; }
