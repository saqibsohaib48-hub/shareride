'use client';
import { FormEvent, Suspense, useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, tokens } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { ErrorBox, Logo } from '@/components/ui';
import { PhoneVerify } from '@/components/PhoneVerify';
import { SocialLogin } from '@/components/SocialLogin';

function Login() {
  const { t, reloadMe } = useApp();
  const router = useRouter();
  const next = useSearchParams().get('next') || '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/'; // no open redirects
  const [tab, setTab] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const done = useCallback(async () => { await reloadMe(); router.push(safeNext); }, [reloadMe, router, safeNext]);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r = await api('/auth/login', { method: 'POST', body: { email, password } }); tokens.set(r.accessToken, r.refreshToken); await done(); }
    catch (err) { setError(err); } finally { setBusy(false); }
  }

  return (
    <div className="card stack" style={{ maxWidth: 440, margin: '0 auto' }}>
      <div className="row" style={{ justifyContent: 'center' }}><Logo size={44} /></div>
      <h1 style={{ textAlign: 'center' }}>{t('auth.login')}</h1>
      <div className="tabs" role="tablist" style={{ justifyContent: 'center' }}>
        <button role="tab" aria-selected={tab === 'email'} onClick={() => setTab('email')}>{t('auth.email')}</button>
        <button role="tab" aria-selected={tab === 'phone'} onClick={() => setTab('phone')}>{t('auth.withPhone')}</button>
      </div>
      {tab === 'email' ? (
        <form className="stack" onSubmit={submit}>
          <div className="field"><label htmlFor="email">{t('auth.email')}</label><input id="email" className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="field"><label htmlFor="pw">{t('auth.password')}</label><input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <ErrorBox error={error} />
          <button className="btn primary block" disabled={busy}>{t('auth.login')}</button>
        </form>
      ) : (
        <PhoneVerify mode="login" onDone={async (r) => { tokens.set(r.accessToken, r.refreshToken); await done(); }} />
      )}
      <SocialLogin onDone={done} />
      <Link href={`/register?next=${encodeURIComponent(safeNext)}`} className="small" style={{ textAlign: 'center' }}>{t('auth.noAccount')}</Link>
    </div>
  );
}
export default function Page() { return <Suspense><Login /></Suspense>; }
