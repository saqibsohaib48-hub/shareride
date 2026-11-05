'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { ErrorBox } from './ui';

const CATS = ['punctuality', 'communication', 'cleanliness', 'safety', 'respect'] as const;

export function RatingForm({ bookingId, who, onDone }: { bookingId: string; who: 'driver' | 'passenger'; onDone?: () => void }) {
  const { t } = useApp();
  const [stars, setStars] = useState(0);
  const [cats, setCats] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (done) return <div className="alert ok">Thanks for rating your {who}!</div>;
  return (
    <form className="stack" onSubmit={async (e) => {
      e.preventDefault();
      try { await api('/ratings', { method: 'POST', body: { bookingId, stars, comment: comment || undefined, categories: cats } }); setDone(true); onDone?.(); } catch (err) { setError(err); }
    }}>
      <b>{t('rating.title')}</b>
      <div role="radiogroup" aria-label="Stars" className="row" style={{ gap: 4 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className="btn sm outline" style={{ minWidth: 44, color: n <= stars ? '#e3a008' : undefined }} onClick={() => setStars(n)}>★</button>
        ))}
      </div>
      <details><summary className="small">Rate categories (optional)</summary>
        {CATS.map((c) => (
          <div key={c} className="row small between"><span style={{ textTransform: 'capitalize' }}>{c}</span>
            <select className="select-sm" value={cats[c] ?? ''} onChange={(e) => setCats({ ...cats, [c]: Number(e.target.value) })}><option value="">–</option>{[5, 4, 3, 2, 1].map((n) => <option key={n}>{n}</option>)}</select>
          </div>
        ))}
      </details>
      <textarea className="input" placeholder={t('rating.comment')} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={2} />
      <ErrorBox error={error} />
      <button className="btn primary sm" disabled={!stars}>{t('rating.submit')}</button>
    </form>
  );
}
