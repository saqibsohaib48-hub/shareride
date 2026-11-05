'use client';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { useApp } from '@/lib/app-context';
import { PlaceInput, PlaceValue } from './ui';

export function toDateInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function SearchForm({ initial }: { initial?: { from?: PlaceValue | null; to?: PlaceValue | null; date?: string; time?: string; seats?: number } }) {
  const { t } = useApp();
  const router = useRouter();
  const [from, setFrom] = useState<PlaceValue | null>(initial?.from ?? null);
  const [to, setTo] = useState<PlaceValue | null>(initial?.to ?? null);
  const [date, setDate] = useState(initial?.date ?? toDateInput(new Date()));
  const [time, setTime] = useState(initial?.time ?? '');
  const [seats, setSeats] = useState(initial?.seats ?? 1);
  const [err, setErr] = useState<{ from?: string; to?: string }>({});

  function submit(e: FormEvent) {
    e.preventDefault();
    const errors = { from: from ? undefined : 'Choose a starting point from the list', to: to ? undefined : 'Choose a destination from the list' };
    setErr(errors);
    if (!from || !to) return;
    const q = new URLSearchParams({ fn: from.name, fa: String(from.lat), fo: String(from.lng), tn: to.name, ta: String(to.lat), to: String(to.lng), d: date, s: String(seats) });
    if (time) q.set('t', time);
    router.push(`/search?${q}`);
  }

  return (
    <form onSubmit={submit} className="stack" noValidate aria-label={t('home.where')}>
      <div className="form-grid two">
        <PlaceInput id="from" label={t('home.from')} value={from} onChange={setFrom} placeholder="e.g. Dubai Marina" error={err.from} />
        <PlaceInput id="to" label={t('home.to')} value={to} onChange={setTo} placeholder="e.g. Abu Dhabi" error={err.to} />
      </div>
      <div className="form-grid three">
        <div className="field"><label htmlFor="date">{t('home.date')}</label><input id="date" type="date" className="input" value={date} min={toDateInput(new Date())} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="field"><label htmlFor="time">{t('search.time')}</label><input id="time" type="time" className="input" value={time} onChange={(e) => setTime(e.target.value)} /></div>
        <div className="field"><label htmlFor="seats">{t('search.passengers')}</label>
          <select id="seats" className="input" value={seats} onChange={(e) => setSeats(Number(e.target.value))}>{[1, 2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</select>
        </div>
      </div>
      <button className="btn primary block" type="submit">{t('home.search')}</button>
    </form>
  );
}
