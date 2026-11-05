'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { RideSummary } from '@share-ride/shared';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { SearchForm } from '@/components/SearchForm';
import { RideCard } from '@/components/RideCard';
import { ErrorBox } from '@/components/ui';

const SORTS = ['best', 'cheapest', 'earliest', 'closest', 'rating', 'shortest'] as const;

function Results() {
  const sp = useSearchParams();
  const router = useRouter();
  const { t } = useApp();
  const [rides, setRides] = useState<RideSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const has = sp.get('fa') && sp.get('ta');
  const from = has ? { name: sp.get('fn')!, lat: Number(sp.get('fa')), lng: Number(sp.get('fo')) } : null;
  const to = has ? { name: sp.get('tn')!, lat: Number(sp.get('ta')), lng: Number(sp.get('to')) } : null;
  const date = sp.get('d') ?? '';
  const time = sp.get('t') ?? '';
  const seats = Number(sp.get('s') ?? 1);
  const sort = (sp.get('sort') as (typeof SORTS)[number]) ?? 'best';
  const flexible = sp.get('flex') === '1';
  const filters = { womenOnly: sp.get('w') === '1', pets: sp.get('p') === '1', luggage: sp.get('l') === '1', smoking: sp.get('ns') === '1' ? false : undefined };

  useEffect(() => {
    if (!from || !to || !date) return;
    setRides(null); setError(null);
    // Local day bounds (or ±3h around the chosen time; flexible widens to ±1 day).
    const base = new Date(`${date}T${time || '00:00'}`);
    const start = time && !flexible ? new Date(base.getTime() - 3 * 3600_000) : new Date(`${date}T00:00`);
    const end = time && !flexible ? new Date(base.getTime() + 3 * 3600_000) : new Date(new Date(`${date}T00:00`).getTime() + 86400_000);
    if (flexible) { start.setDate(start.getDate() - 1); end.setDate(end.getDate() + 1); }
    api<RideSummary[]>('/rides/search', {
      query: {
        fromLat: from.lat, fromLng: from.lng, toLat: to.lat, toLng: to.lng,
        departAfter: start.toISOString(), departBefore: end.toISOString(), time: time ? base.toISOString() : undefined,
        seats, sort, womenOnly: filters.womenOnly || undefined, pets: filters.pets || undefined, luggage: filters.luggage || undefined, smoking: filters.smoking,
      },
    }).then(setRides).catch(setError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.toString()]);

  function setParam(k: string, v: string | null) {
    const q = new URLSearchParams(sp.toString());
    if (v === null) q.delete(k); else q.set(k, v);
    router.replace(`/search?${q}`);
  }
  const bookingQuery = `?seats=${seats}${from ? `&pn=${encodeURIComponent(from.name)}&pa=${from.lat}&po=${from.lng}` : ''}${to ? `&dn=${encodeURIComponent(to.name)}&da=${to.lat}&do=${to.lng}` : ''}`;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="card"><SearchForm key={sp.toString()} initial={{ from, to, date: date || undefined, time, seats }} /></div>
      {has && (
        <>
          <div className="row between">
            <div className="tabs" role="tablist" aria-label={t('search.sort')}>
              {SORTS.map((s) => <button key={s} role="tab" aria-selected={sort === s} onClick={() => setParam('sort', s)}>{t(`sort.${s}` as any)}</button>)}
            </div>
          </div>
          <div className="row small" role="group" aria-label="Filters">
            <label className="check"><input type="checkbox" checked={flexible} onChange={(e) => setParam('flex', e.target.checked ? '1' : null)} /> {t('search.flexible')}</label>
            <label className="check"><input type="checkbox" checked={filters.womenOnly} onChange={(e) => setParam('w', e.target.checked ? '1' : null)} /> {t('search.womenOnly')}</label>
            <label className="check"><input type="checkbox" checked={filters.pets} onChange={(e) => setParam('p', e.target.checked ? '1' : null)} /> {t('search.pets')}</label>
            <label className="check"><input type="checkbox" checked={filters.luggage} onChange={(e) => setParam('l', e.target.checked ? '1' : null)} /> {t('search.luggage')}</label>
            <label className="check"><input type="checkbox" checked={filters.smoking === false} onChange={(e) => setParam('ns', e.target.checked ? '1' : null)} /> No smoking</label>
          </div>
          <ErrorBox error={error} />
          {!rides && !error && <><div className="skeleton" /><div className="skeleton" /></>}
          {rides && <p className="muted" aria-live="polite">{t('search.results', { count: rides.length })}</p>}
          {rides && rides.length === 0 && <div className="card flat muted">{t('search.noResults')}</div>}
          <div className="stack">{rides?.map((r) => <RideCard key={r.id} ride={r} query={bookingQuery} />)}</div>
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  return <Suspense fallback={<div className="skeleton" />}><Results /></Suspense>;
}
