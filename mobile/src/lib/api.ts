import * as SecureStore from 'expo-secure-store';
import NetInfo from '@react-native-community/netinfo';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public referenceId?: string, public details?: unknown) { super(message); }
}

// Tokens live in the device keychain / keystore, never in plain storage.
let access: string | null = null;
let listeners: (() => void)[] = [];
export const auth = {
  async load() { access = await SecureStore.getItemAsync('sr_access'); return access; },
  async set(a: string | null, r: string | null) {
    access = a;
    if (a) await SecureStore.setItemAsync('sr_access', a); else await SecureStore.deleteItemAsync('sr_access');
    if (r) await SecureStore.setItemAsync('sr_refresh', r); else await SecureStore.deleteItemAsync('sr_refresh');
    listeners.forEach((l) => l());
  },
  refreshToken: () => SecureStore.getItemAsync('sr_refresh'),
  get access() { return access; },
  subscribe(l: () => void) { listeners.push(l); return () => { listeners = listeners.filter((x) => x !== l); }; },
};

let refreshing: Promise<boolean> | null = null;
async function tryRefresh() {
  const r = await auth.refreshToken();
  if (!r) return false;
  refreshing ??= fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: r }) })
    .then(async (res) => { if (!res.ok) { await auth.set(null, null); return false; } const t = await res.json(); await auth.set(t.accessToken, t.refreshToken); return true; })
    .catch(() => false).finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; query?: Record<string, unknown> } = {}, retry = true): Promise<T> {
  const method = opts.method ?? 'GET';
  // Never let a booking/payment look successful while offline (spec §72).
  if (method !== 'GET' && !(await NetInfo.fetch()).isConnected) throw new ApiError(0, 'OFFLINE', "You're offline. Bookings and payments need a connection.");
  const qs = opts.query ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])).toString() : '';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (access) headers.Authorization = `Bearer ${access}`;
  let res: Response;
  try { res = await fetch(`${API_URL}${path}${qs}`, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new ApiError(0, 'NETWORK', 'Something went wrong. Please check your connection and try again.'); }
  if (res.status === 401 && retry && (await tryRefresh())) return api<T>(path, opts, false);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = (data as any)?.error ?? {}; throw new ApiError(res.status, e.code ?? 'INTERNAL', e.message ?? 'Something went wrong. Please try again.', e.referenceId, e.details); }
  return data as T;
}

export const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
