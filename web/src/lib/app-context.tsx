'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { formatMoney, isRtl, makeT, MessageKey } from '@share-ride/shared';
import { api, tokens } from './api';

export interface Me {
  id: string; name: string; email: string | null; phone: string | null; countryCode: string | null; preferredCurrency: string | null;
  language: string; memberSince: string; rating: number; ratingCount: number; ridesAsDriver: number; tripsAsPassenger: number;
  badges: { phone: boolean; email: boolean; identity: boolean; driver: boolean }; photoUrl: string | null; about: string | null;
  languages: string[]; gender: string | null; notificationPrefs: { push: boolean; email: boolean; sms: boolean }; adminRole: string | null; isDemo: boolean;
}
export interface Country { code: string; name: string; currency: string; distanceUnit: 'km' | 'mi'; timezone: string; rideCreationEnabled: boolean; bookingEnabled: boolean; womenOnlyAllowed: boolean }

interface Ctx {
  me: Me | null; loading: boolean; reloadMe: () => Promise<void>; logout: () => Promise<void>;
  lang: string; setLang: (l: string) => void; t: ReturnType<typeof makeT>;
  countries: Country[]; country: Country | null; setCountryCode: (c: string) => void;
  money: (minor: number, currency: string) => string; distance: (m: number) => string; online: boolean;
}
const AppCtx = createContext<Ctx | null>(null);

function safeGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState('en');
  const [countries, setCountries] = useState<Country[]>([]);
  const [countryCode, setCountryCodeState] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  const reloadMe = useCallback(async () => {
    if (!tokens.access && !tokens.refresh) { setMe(null); setLoading(false); return; }
    try { setMe(await api<Me>('/auth/me')); } catch { setMe(null); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    setLangState(safeGet('sr_lang') ?? (navigator.language?.slice(0, 2) || 'en'));
    setOnline(navigator.onLine);
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    const auth = () => reloadMe();
    window.addEventListener('sr-auth', auth);
    reloadMe();
    api<Country[]>('/countries').then(async (cs) => {
      setCountries(cs);
      const saved = safeGet('sr_country');
      if (saved) return setCountryCodeState(saved);
      const detected = await api<{ code: string } | null>('/countries/detect').catch(() => null);
      setCountryCodeState(detected?.code ?? cs.find((c) => c.code === 'AE')?.code ?? cs[0]?.code ?? null);
    }).catch(() => {});
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); window.removeEventListener('sr-auth', auth); };
  }, [reloadMe]);

  useEffect(() => { if (me?.countryCode && !safeGet('sr_country')) setCountryCodeState(me.countryCode); if (me?.language && !safeGet('sr_lang')) setLangState(me.language); }, [me]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? 'rtl' : 'ltr';
  }, [lang]);

  const value = useMemo<Ctx>(() => {
    const country = countries.find((c) => c.code === countryCode) ?? null;
    const locale = lang === 'ar' ? 'ar-AE' : lang === 'hi' ? 'hi-IN' : lang === 'ur' ? 'ur-PK' : lang;
    return {
      me, loading, reloadMe,
      logout: async () => { const r = tokens.refresh; if (r) await api('/auth/logout', { method: 'POST', body: { refreshToken: r } }).catch(() => {}); tokens.set(null, null); setMe(null); },
      lang, setLang: (l) => { safeSet('sr_lang', l); setLangState(l); if (me) api('/profile', { method: 'PATCH', body: { language: l } }).catch(() => {}); },
      t: makeT(lang),
      countries, country, setCountryCode: (c) => { safeSet('sr_country', c); setCountryCodeState(c); },
      money: (minor, currency) => formatMoney(minor, currency, locale),
      distance: (m) => country?.distanceUnit === 'mi' ? `${(m / 1609.344).toFixed(m < 16093 ? 1 : 0)} mi` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`,
      online,
    };
  }, [me, loading, reloadMe, lang, countries, countryCode, online]);

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useApp() {
  const c = useContext(AppCtx);
  if (!c) throw new Error('useApp outside provider');
  return c;
}
export type { MessageKey };
