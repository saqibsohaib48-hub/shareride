'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LANGUAGES } from '@share-ride/shared';
import { useApp } from '@/lib/app-context';
import { Logo } from './ui';

export function Header() {
  const { t, me, lang, setLang, countries, country, setCountryCode, online } = useApp();
  const path = usePathname();
  const cur = (href: string) => (path === href || (href !== '/' && path.startsWith(href)) ? 'page' : undefined);
  return (
    <>
      {!online && <div className="offline" role="status">{t('errors.offline')}</div>}
      <header className="header">
        <div className="container">
          <Link href="/" className="logo" aria-label={t('app.name')}><Logo /> <span>{t('app.name')}</span></Link>
          <nav className="nav-links" aria-label="Main">
            <Link href="/search" aria-current={cur('/search')}>{t('nav.search')}</Link>
            <Link href="/rides/new" aria-current={cur('/rides/new')}>{t('nav.create')}</Link>
            <Link href="/trips" aria-current={cur('/trips')}>{t('nav.trips')}</Link>
            <Link href="/earnings" aria-current={cur('/earnings')}>{t('nav.earnings')}</Link>
            {me?.adminRole && <Link href="/admin" aria-current={cur('/admin')}>{t('nav.admin')}</Link>}
          </nav>
          <span className="spacer" />
          <label className="sr-only" htmlFor="country-select">{t('auth.country')}</label>
          <select id="country-select" className="select-sm" value={country?.code ?? ''} onChange={(e) => setCountryCode(e.target.value)}>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.code} · {c.currency}</option>)}
          </select>
          <label className="sr-only" htmlFor="lang-select">{t('profile.language')}</label>
          <select id="lang-select" className="select-sm" value={lang} onChange={(e) => setLang(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
          {me ? (
            <>
              <Link href="/notifications" aria-label={t('nav.notifications')} className="btn sm outline">🔔</Link>
              <Link href="/profile" className="btn sm outline">{me.name.split(' ')[0]}</Link>
            </>
          ) : <Link href="/login" className="btn sm primary">{t('nav.login')}</Link>}
        </div>
      </header>
    </>
  );
}

export function BottomNav() {
  const { t } = useApp();
  const path = usePathname();
  const cur = (href: string) => (path === href ? 'page' : undefined);
  return (
    <nav className="bottom-nav" aria-label="Primary">
      <Link href="/" aria-current={cur('/')}><span aria-hidden>⌂</span><span>{t('nav.home')}</span></Link>
      <Link href="/search" aria-current={cur('/search')}><span aria-hidden>⌕</span><span>{t('nav.search')}</span></Link>
      <Link href="/rides/new" className="create" aria-current={cur('/rides/new')}><span aria-hidden>＋</span><span style={{ color: 'var(--ink-2)' }}>{t('nav.create')}</span></Link>
      <Link href="/trips" aria-current={cur('/trips')}><span aria-hidden>⇄</span><span>{t('nav.trips')}</span></Link>
      <Link href="/profile" aria-current={cur('/profile')}><span aria-hidden>◉</span><span>{t('nav.profile')}</span></Link>
    </nav>
  );
}
