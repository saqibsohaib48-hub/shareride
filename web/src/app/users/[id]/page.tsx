'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { PublicUser } from '@share-ride/shared';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { Avatar, Badges, ErrorBox, Stars } from '@/components/ui';

export default function PublicProfile() {
  const { id } = useParams<{ id: string }>();
  const { t, lang, me } = useApp();
  const [u, setU] = useState<PublicUser | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [blocked, setBlocked] = useState(false);
  useEffect(() => { api<PublicUser>(`/users/${id}`).then(setU).catch(setError); }, [id]);
  if (error) return <ErrorBox error={error} />;
  if (!u) return <div className="skeleton" />;
  return (
    <div className="card stack" style={{ maxWidth: 560, margin: '0 auto' }}>
      <div className="row" style={{ gap: 16 }}>
        <Avatar name={u.name} url={u.photoUrl} size="lg" />
        <div className="stack" style={{ gap: 4 }}>
          <h1 style={{ margin: 0 }}>{u.name}</h1>
          <Stars value={u.rating} count={u.ratingCount} />
          <span className="small muted">{t('ride.completedRides', { count: u.completedRides })} · {t('profile.memberSince', { date: new Date(u.memberSince).toLocaleDateString(lang, { month: 'long', year: 'numeric' }) })}</span>
        </div>
      </div>
      <Badges badges={u.badges} />
      {u.about && <p style={{ margin: 0 }}>{u.about}</p>}
      {u.languages.length > 0 && <div className="small"><b>{t('profile.languages')}:</b> {u.languages.join(', ')}</div>}
      {me && me.id !== u.id && (blocked ? <div className="alert">User blocked. They can't book your rides or see you in search.</div> :
        <button className="btn outline sm" onClick={() => api(`/users/${u.id}/block`, { method: 'POST' }).then(() => setBlocked(true)).catch(setError)}>Block user</button>)}
    </div>
  );
}
