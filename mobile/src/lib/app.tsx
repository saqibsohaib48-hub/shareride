import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { I18nManager, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import * as Localization from 'expo-localization';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { formatMoney, isRtl, makeT } from '@share-ride/shared';
import { api, auth } from './api';
import { drain } from './cache';

export interface Me { id: string; name: string; phone: string | null; countryCode: string | null; rating: number; ratingCount: number; ridesAsDriver: number; tripsAsPassenger: number; memberSince: string; badges: { phone: boolean; email: boolean; identity: boolean; driver: boolean }; adminRole: string | null; gender: string | null; isDemo: boolean }
export interface Country { code: string; name: string; currency: string; distanceUnit: 'km' | 'mi'; rideCreationEnabled: boolean; bookingEnabled: boolean; womenOnlyAllowed: boolean }

interface Ctx {
  me: Me | null; ready: boolean; reloadMe: () => Promise<void>; logout: () => Promise<void>;
  lang: string; setLang: (l: string) => void; t: ReturnType<typeof makeT>;
  countries: Country[]; country: Country | null; setCountry: (c: string) => void;
  money: (m: number, c: string) => string; distance: (m: number) => string; online: boolean;
}
const C = createContext<Ctx | null>(null);

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true }) });

/** Register for push (Expo push → FCM/APNs) and send the token to the API. */
async function registerPush() {
  if (!Device.isDevice) return;
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: 'default', importance: Notifications.AndroidImportance.HIGH });
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  await api('/notifications/devices', { method: 'POST', body: { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' } }).catch(() => {});
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [lang, setLangS] = useState(Localization.getLocales()[0]?.languageCode ?? 'en');
  const [countries, setCountries] = useState<Country[]>([]);
  const [cc, setCc] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  const reloadMe = useCallback(async () => {
    try { setMe(auth.access || (await auth.refreshToken()) ? await api<Me>('/auth/me') : null); } catch { setMe(null); }
  }, []);

  useEffect(() => {
    (async () => {
      await auth.load();
      const [l, c] = await Promise.all([AsyncStorage.getItem('lang'), AsyncStorage.getItem('country')]);
      if (l) setLangS(l);
      await reloadMe();
      const cs = await api<Country[]>('/countries').catch(() => [] as Country[]);
      setCountries(cs);
      setCc(c ?? Localization.getLocales()[0]?.regionCode ?? cs[0]?.code ?? null);
      setReady(true);
    })();
    const un1 = auth.subscribe(reloadMe);
    const un2 = NetInfo.addEventListener((s) => {
      const on = !!s.isConnected;
      setOnline(on);
      if (on) drain((a) => api(a.path, { method: a.method, body: a.body }));
    });
    return () => { un1(); un2(); };
  }, [reloadMe]);

  useEffect(() => { if (me) registerPush().catch(() => {}); }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<Ctx>(() => {
    const country = countries.find((c) => c.code === cc) ?? countries.find((c) => c.code === 'AE') ?? null;
    return {
      me, ready, reloadMe,
      logout: async () => { const r = await auth.refreshToken(); if (r) await api('/auth/logout', { method: 'POST', body: { refreshToken: r } }).catch(() => {}); await auth.set(null, null); setMe(null); },
      lang,
      setLang: (l) => {
        setLangS(l); AsyncStorage.setItem('lang', l);
        // RTL layout flips after an app reload (React Native limitation).
        I18nManager.allowRTL(true); I18nManager.forceRTL(isRtl(l));
      },
      t: makeT(lang),
      countries, country, setCountry: (c) => { setCc(c); AsyncStorage.setItem('country', c); },
      money: (m, c) => formatMoney(m, c, lang),
      distance: (m) => (country?.distanceUnit === 'mi' ? `${(m / 1609.344).toFixed(0)} mi` : `${(m / 1000).toFixed(0)} km`),
      online,
    };
  }, [me, ready, reloadMe, lang, countries, cc, online]);
  return <C.Provider value={value}>{children}</C.Provider>;
}

export function useApp() { const c = useContext(C); if (!c) throw new Error('useApp outside provider'); return c; }
