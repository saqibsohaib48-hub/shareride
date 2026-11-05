'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { ErrorBox, RequireAuth, fmtDate, fmtTime } from '@/components/ui';

function Notifications() {
  const { t, lang } = useApp();
  const [data, setData] = useState<{ items: any[]; unread: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    api('/notifications').then((d) => { setData(d); if (d.unread) api('/notifications/read', { method: 'POST', body: {} }).catch(() => {}); }).catch(setError);
  }, []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <div className="skeleton" />;
  const link = (n: any) => (n.data?.bookingId && n.type === 'RIDE_REQUEST_ACCEPTED' ? `/checkout/${n.data.bookingId}` : n.data?.rideId ? `/rides/${n.data.rideId}` : null);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <h1>{t('nav.notifications')}</h1>
      {data.items.length === 0 && <div className="card flat muted">You're all caught up.</div>}
      {data.items.map((n) => {
        const href = link(n);
        const body = (
          <div className="card flat" style={{ borderInlineStart: n.readAt ? undefined : '4px solid var(--brand)' }}>
            <div className="row between"><b>{n.title}</b><span className="tiny">{fmtDate(n.createdAt, lang)} {fmtTime(n.createdAt, lang)}</span></div>
            <div className="small muted">{n.body}</div>
          </div>
        );
        return href ? <Link key={n.id} href={href} style={{ color: 'inherit', textDecoration: 'none' }}>{body}</Link> : <div key={n.id}>{body}</div>;
      })}
    </div>
  );
}
export default function Page() { return <RequireAuth><Notifications /></RequireAuth>; }
