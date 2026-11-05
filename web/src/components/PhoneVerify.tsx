'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { ErrorBox } from './ui';

/** OTP flow. With a logged-in user it verifies their phone; otherwise it logs in / registers by phone. */
export function PhoneVerify({ onDone, mode = 'verify' }: { onDone: (tokens?: any) => void; mode?: 'verify' | 'login' }) {
  const { t, me, country } = useApp();
  const [phone, setPhone] = useState(me?.phone ?? '');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [needName, setNeedName] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true); setError(null);
    try { const r = await api('/auth/otp/send', { method: 'POST', body: { phone } }); setSent(true); setDevCode(r.devCode ?? null); } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function verify() {
    setBusy(true); setError(null);
    try {
      const r = await api('/auth/otp/verify', { method: 'POST', body: { phone, code, name: name || undefined, countryCode: country?.code } });
      onDone(r);
    } catch (e: any) { if (e?.code === 'NAME_REQUIRED') setNeedName(true); setError(e); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="field"><label htmlFor="otp-phone">{t('auth.phone')}</label>
        <input id="otp-phone" className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="+971501234567" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ''))} disabled={sent} />
      </div>
      {!sent ? (
        <button type="button" className="btn primary block" disabled={busy || phone.length < 8} onClick={send}>{t('auth.sendCode')}</button>
      ) : (
        <>
          <div className="field"><label htmlFor="otp-code">{t('auth.otp')}</label>
            <input id="otp-code" className="input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            {devCode && <span className="tiny">Dev mode — your code is <b>{devCode}</b> (SMS_PROVIDER=console)</span>}
          </div>
          {mode === 'login' && needName && <div className="field"><label htmlFor="otp-name">{t('auth.name')}</label><input id="otp-name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></div>}
          <button type="button" className="btn primary block" disabled={busy || code.length !== 6} onClick={verify}>{t('auth.verify')}</button>
          <button type="button" className="btn outline sm" onClick={() => { setSent(false); setCode(''); }}>Change number</button>
        </>
      )}
      <ErrorBox error={error} />
    </div>
  );
}
