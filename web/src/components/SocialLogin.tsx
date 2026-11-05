'use client';
import { useEffect, useRef, useState } from 'react';
import { api, tokens } from '@/lib/api';
import { useApp } from '@/lib/app-context';
import { ErrorBox } from './ui';

const GOOGLE_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const APPLE_ID = process.env.NEXT_PUBLIC_APPLE_CLIENT_ID;

function loadScript(src: string) {
  return new Promise<void>((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script'); s.src = src; s.async = true; s.onload = () => res(); s.onerror = () => rej(new Error('load failed'));
    document.head.appendChild(s);
  });
}

/** Google Identity Services + Sign in with Apple JS. Buttons render only when their client IDs are configured. */
export function SocialLogin({ onDone }: { onDone: () => void }) {
  const { t } = useApp();
  const gRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!GOOGLE_ID) return;
    loadScript('https://accounts.google.com/gsi/client').then(() => {
      const g = (window as any).google;
      g.accounts.id.initialize({
        client_id: GOOGLE_ID,
        callback: async (r: { credential: string }) => {
          try { const out = await api('/auth/google', { method: 'POST', body: { idToken: r.credential } }); tokens.set(out.accessToken, out.refreshToken); onDone(); } catch (e) { setError(e); }
        },
      });
      if (gRef.current) g.accounts.id.renderButton(gRef.current, { theme: 'outline', size: 'large', shape: 'pill', width: 320, text: 'continue_with' });
    }).catch(() => {});
  }, [onDone]);

  async function apple() {
    try {
      await loadScript('https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js');
      const A = (window as any).AppleID;
      A.auth.init({ clientId: APPLE_ID, scope: 'name email', redirectURI: location.origin + '/login', usePopup: true });
      const r = await A.auth.signIn();
      const fullName = r.user?.name ? `${r.user.name.firstName ?? ''} ${r.user.name.lastName ?? ''}`.trim() : undefined;
      const out = await api('/auth/apple', { method: 'POST', body: { identityToken: r.authorization.id_token, fullName } });
      tokens.set(out.accessToken, out.refreshToken); onDone();
    } catch (e: any) { if (e?.error !== 'popup_closed_by_user') setError(e); }
  }

  if (!GOOGLE_ID && !APPLE_ID) return null;
  return (
    <div className="stack" style={{ alignItems: 'center' }}>
      {GOOGLE_ID && <div ref={gRef} aria-label={t('auth.google')} />}
      {APPLE_ID && <button type="button" className="btn block" style={{ background: '#000', color: '#fff', maxWidth: 320 }} onClick={apple}> {t('auth.apple')}</button>}
      <ErrorBox error={error} />
    </div>
  );
}
