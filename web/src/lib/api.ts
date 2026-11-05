'use client';
/**
 * API client. Access token in memory + localStorage; refresh token rotated on 401.
 * (For stricter XSS posture, front the API with a same-site BFF that keeps tokens in httpOnly cookies — see docs/SECURITY.md.)
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public referenceId?: string, public details?: unknown) { super(message); }
}

const store = {
  get access() { try { return localStorage.getItem('sr_access'); } catch { return null; } },
  get refresh() { try { return localStorage.getItem('sr_refresh'); } catch { return null; } },
  set(a: string | null, r: string | null) {
    try {
      if (a) localStorage.setItem('sr_access', a); else localStorage.removeItem('sr_access');
      if (r) localStorage.setItem('sr_refresh', r); else localStorage.removeItem('sr_refresh');
    } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event('sr-auth'));
  },
};
export const tokens = store;

let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  const r = store.refresh;
  if (!r) return false;
  refreshing ??= fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: r }) })
    .then(async (res) => {
      if (!res.ok) { store.set(null, null); return false; }
      const t = await res.json();
      store.set(t.accessToken, t.refreshToken);
      return true;
    })
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; query?: Record<string, unknown> } = {}, retry = true): Promise<T> {
  if (typeof navigator !== 'undefined' && !navigator.onLine && opts.method && opts.method !== 'GET') {
    throw new ApiError(0, 'OFFLINE', "You're offline. Bookings and payments need a connection.");
  }
  const qs = opts.query ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== '' && v !== null).map(([k, v]) => [k, String(v)])) : '';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (store.access) headers.Authorization = `Bearer ${store.access}`;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}${qs}`, { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Something went wrong. Please check your connection and try again.');
  }
  if (res.status === 401 && retry && store.refresh && (await tryRefresh())) return api<T>(path, opts, false);
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'INTERNAL', e.message ?? 'Something went wrong. Please try again.', e.referenceId, e.details);
  }
  return data as T;
}

export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
