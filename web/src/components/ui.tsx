'use client';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { decodePolyline, LatLng } from '@share-ride/shared';
import { api, ApiError } from '@/lib/api';
import { useApp } from '@/lib/app-context';

export function Logo({ size = 30 }: { size?: number }) {
  // Two pins joined by a shared route — original Share Ride mark.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <path d="M8 22c3-9 13-3 16-12" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeDasharray="0.1 4.6" />
      <circle cx="8" cy="22" r="3.2" fill="#fff" />
      <circle cx="24" cy="10" r="3.2" fill="var(--accent)" stroke="#fff" strokeWidth="1.5" />
    </svg>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const { t } = useApp();
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  const details = e?.details;
  return (
    <div className="alert error" role="alert">
      {e?.message ?? t('errors.generic')}
      {Array.isArray(details) && <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>{details.map((d) => <li key={String(d)}>{String(d)}</li>)}</ul>}
      {e?.referenceId && <div className="tiny">{t('errors.reference', { id: e.referenceId })}</div>}
    </div>
  );
}

export function fieldErrors(error: unknown): Record<string, string[]> {
  return error instanceof ApiError && error.code === 'VALIDATION_ERROR' && error.details && typeof error.details === 'object' ? (error.details as Record<string, string[]>) : {};
}

export function Stars({ value, count }: { value: number; count?: number }) {
  const full = Math.round(value);
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className="stars" aria-hidden="true">{'★'.repeat(full)}{'☆'.repeat(5 - full)}</span>
      <span className="small num" aria-label={`Rated ${value.toFixed(1)} out of 5`}>{value ? value.toFixed(1) : 'New'}{count !== undefined ? ` · ${count}` : ''}</span>
    </span>
  );
}

export function Badges({ badges }: { badges: { phone: boolean; email: boolean; identity: boolean; driver: boolean } }) {
  const { t } = useApp();
  const items: [boolean, Parameters<typeof t>[0]][] = [[badges.phone, 'verify.phone'], [badges.email, 'verify.email'], [badges.identity, 'verify.identity'], [badges.driver, 'verify.driver']];
  return <div className="row" style={{ gap: 6 }}>{items.filter(([ok]) => ok).map(([, k]) => <span key={k} className="pill brand">✓ {t(k)}</span>)}</div>;
}

export function Avatar({ name, url, size }: { name: string; url?: string | null; size?: 'lg' }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <div className={`avatar ${size ?? ''}`} aria-hidden="true">{url ? <img src={url} alt="" width="100%" height="100%" style={{ objectFit: 'cover' }} /> : name.slice(0, 1).toUpperCase()}</div>;
}

export interface PlaceValue { name: string; lat: number; lng: number }

/** Place search backed by the API's maps provider (Google Places / Mapbox / dev gazetteer). */
export function PlaceInput({ id, label, value, onChange, placeholder, error }: { id: string; label: string; value: PlaceValue | null; onChange: (p: PlaceValue | null) => void; placeholder?: string; error?: string }) {
  const { country } = useApp();
  const [text, setText] = useState(value?.name ?? '');
  const [items, setItems] = useState<PlaceValue[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => { setText(value?.name ?? ''); }, [value?.name]);

  function search(q: string) {
    setText(q);
    onChange(null);
    clearTimeout(timer.current);
    if (q.trim().length < 2) { setItems([]); return; }
    timer.current = setTimeout(() => {
      api<PlaceValue[]>('/routes/places', { query: { q, country: country?.code } }).then((r) => { setItems(r); setOpen(true); setActive(0); }).catch(() => setItems([]));
    }, 250);
  }
  function pick(p: PlaceValue) { onChange(p); setText(p.name); setOpen(false); }

  return (
    <div className="field ac">
      <label htmlFor={id}>{label}</label>
      <input
        id={id} className="input" value={text} placeholder={placeholder} autoComplete="off" role="combobox"
        aria-expanded={open && items.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list" aria-invalid={!!error}
        onChange={(e) => search(e.target.value)} onFocus={() => items.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (!open) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          if (e.key === 'Enter' && items[active]) { e.preventDefault(); pick(items[active]); }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && items.length > 0 && (
        <ul className="ac-list" id={`${id}-list`} role="listbox">
          {items.map((p, i) => <li key={`${p.name}-${i}`} role="option" aria-selected={i === active} onMouseDown={() => pick(p)}>📍 {p.name}</li>)}
        </ul>
      )}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

/**
 * Route map. Uses a Mapbox static image when NEXT_PUBLIC_MAPBOX_TOKEN is set, otherwise an
 * offline-friendly SVG projection of the route polyline with pickup / destination markers.
 */
export function RouteMap({ polyline, origin, destination, height = 220 }: { polyline?: string | null; origin: LatLng; destination: LatLng; height?: number }) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (token && polyline) {
    const path = encodeURIComponent(polyline);
    const url = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/path-4+0e7c66-0.9(${path}),pin-s-a+0e7c66(${origin.lng},${origin.lat}),pin-s-b+ff7a45(${destination.lng},${destination.lat})/auto/800x${height * 2}@2x?padding=40&access_token=${token}`;
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="map" src={url} alt="Route map" height={height} style={{ height, objectFit: 'cover' }} />;
  }
  const pts = polyline ? decodePolyline(polyline) : [origin, destination];
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const W = 800, H = height * 2, pad = 60;
  const sx = (W - pad * 2) / Math.max(maxLng - minLng, 1e-6), sy = (H - pad * 2) / Math.max(maxLat - minLat, 1e-6), s = Math.min(sx, sy);
  const ox = (W - (maxLng - minLng) * s) / 2, oy = (H - (maxLat - minLat) * s) / 2;
  const P = (p: LatLng) => [ox + (p.lng - minLng) * s, H - (oy + (p.lat - minLat) * s)];
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${P(p).map((n) => n.toFixed(1)).join(' ')}`).join(' ');
  const [ax, ay] = P(origin), [bx, by] = P(destination);
  return (
    <svg className="map" viewBox={`0 0 ${W} ${H}`} style={{ height }} role="img" aria-label="Route from pickup to destination">
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="var(--line)" strokeWidth="1" /></pattern>
        <linearGradient id="rt" x1="0" x2="1"><stop offset="0" stopColor="var(--brand)" /><stop offset="1" stopColor="var(--accent)" /></linearGradient>
      </defs>
      <rect width={W} height={H} fill="url(#grid)" />
      <path d={d} fill="none" stroke="var(--surface)" strokeWidth="14" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke="url(#rt)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={ax} cy={ay} r="14" fill="var(--brand)" stroke="var(--surface)" strokeWidth="5" />
      <circle cx={bx} cy={by} r="14" fill="var(--accent)" stroke="var(--surface)" strokeWidth="5" />
    </svg>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading, t } = useApp();
  if (loading) return <div className="skeleton" />;
  if (!me) return (
    <div className="card stack" style={{ maxWidth: 460, margin: '40px auto', textAlign: 'center' }}>
      <h2>{t('nav.login')}</h2>
      <p className="muted">Log in to continue.</p>
      <a className="btn primary" href={`/login?next=${encodeURIComponent(typeof window !== 'undefined' ? location.pathname + location.search : '/')}`}>{t('auth.login')}</a>
    </div>
  );
  return <>{children}</>;
}

export function fmtDate(iso: string, lang: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' }) {
  return new Intl.DateTimeFormat(lang, opts).format(new Date(iso));
}
export function fmtTime(iso: string, lang: string) {
  return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}
