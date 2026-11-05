'use client';
import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, tokens } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { ErrorBox, Logo, fieldErrors } from '@/components/ui';
import { SocialLogin } from '@/components/SocialLogin';

function Register() {
  const { t, countries, country, reloadMe } = useApp();
  const router = useRouter();
  const next = useSearchParams().get('next') || '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  const [f, setF] = useState({ name: '', email: '', password: '', phone: '', countryCode: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const fe = fieldErrors(error);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const r = await api('/auth/register', { method: 'POST', body: { ...f, phone: f.phone || undefined, countryCode: f.countryCode || country?.code } });
      tokens.set(r.accessToken, r.refreshToken); await reloadMe(); router.push(safeNext);
    } catch (err) { setError(err); } finally { setBusy(false); }
  }
  const input = (k: keyof typeof f, label: string, type: string, auto: string, hint?: string) => (
    <div className="field"><label htmlFor={k}>{label}</label>
      <input id={k} className="input" type={type} autoComplete={auto} value={f[k]} aria-invalid={!!fe[k]} aria-describedby={hint ? `${k}-hint` : undefined} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      {hint && !fe[k] && <span id={`${k}-hint`} className="tiny">{hint}</span>}
      {fe[k] && <span className="field-error">{fe[k][0]}</span>}
    </div>
  );
  return (
    <form className="card stack" style={{ maxWidth: 480, margin: '0 auto' }} onSubmit={submit} noValidate>
      <div className="row" style={{ justifyContent: 'center' }}><Logo size={44} /></div>
      <h1 style={{ textAlign: 'center' }}>{t('auth.register')}</h1>
      {input('name', t('auth.name'), 'text', 'name')}
      {input('email', t('auth.email'), 'email', 'email')}
      {input('password', t('auth.password'), 'password', 'new-password', 'At least 8 characters, with a letter and a number')}
      {input('phone', `${t('auth.phone')} (optional)`, 'tel', 'tel', 'International format, e.g. +971501234567. Never shown publicly.')}
      <div className="field"><label htmlFor="cc">{t('auth.country')}</label>
        <select id="cc" className="input" value={f.countryCode || country?.code || ''} onChange={(e) => setF({ ...f, countryCode: e.target.value })}>{countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
      </div>
      <ErrorBox error={error} />
      <button className="btn primary block" disabled={busy}>{t('auth.register')}</button>
      <SocialLogin onDone={async () => { await reloadMe(); router.push(safeNext); }} />
      <p className="tiny" style={{ textAlign: 'center', margin: 0 }}>By creating an account you agree to the <Link href="/legal/terms">Terms</Link> and <Link href="/legal/privacy">Privacy Policy</Link>.</p>
      <Link href={`/login?next=${encodeURIComponent(safeNext)}`} className="small" style={{ textAlign: 'center' }}>{t('auth.haveAccount')}</Link>
    </form>
  );
}
export default function Page() { return <Suspense><Register /></Suspense>; }
