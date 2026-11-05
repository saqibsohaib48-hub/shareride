import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { one } from '../db';
import { forbidden, unauthorized } from '../utils/errors';

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'SUPPORT' | 'FINANCE' | 'OPERATIONS';

export interface AuthUser { id: string; adminRole: AdminRole | null }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser; rawBody?: Buffer } }
}

/** Permission matrix for staff roles (spec §50). Normal users have none of these. */
export const PERMISSIONS = {
  'dashboard.view': ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'FINANCE', 'OPERATIONS'],
  'users.view': ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'OPERATIONS'],
  'users.manage': ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS'],
  'rides.view': ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'OPERATIONS'],
  'rides.manage': ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS'],
  'payments.view': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  'payments.refund': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  'pricing.manage': ['SUPER_ADMIN', 'ADMIN', 'FINANCE'],
  'countries.manage': ['SUPER_ADMIN', 'ADMIN'],
  'settings.manage': ['SUPER_ADMIN'],
  'audit.view': ['SUPER_ADMIN', 'ADMIN'],
  'support.manage': ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'],
} as const satisfies Record<string, readonly AdminRole[]>;
export type Permission = keyof typeof PERMISSIONS;

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.JWT_SECRET, { expiresIn: config.JWT_ACCESS_TTL as any, issuer: 'share-ride', audience: 'share-ride-api' });
}

async function resolve(req: Request): Promise<AuthUser | null> {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  let sub: string;
  try {
    const payload = jwt.verify(h.slice(7), config.JWT_SECRET, { issuer: 'share-ride', audience: 'share-ride-api', algorithms: ['HS256'] }) as jwt.JwtPayload;
    sub = String(payload.sub);
  } catch {
    throw unauthorized('Your session has expired. Please log in again.');
  }
  // Role & status are read from the DB on every request — never trusted from the token (prevents role escalation).
  const row = await one<{ id: string; status: string; role: AdminRole | null }>(
    `SELECT u.id, u.status, a.role FROM users u LEFT JOIN admin_users a ON a.user_id = u.id WHERE u.id = $1`, [sub]);
  if (!row || row.status === 'DELETED') throw unauthorized();
  if (row.status === 'SUSPENDED' || row.status === 'BLOCKED') throw forbidden('Your account is currently suspended. Please contact support.');
  return { id: row.id, adminRole: row.role };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  resolve(req).then((u) => { if (!u) throw unauthorized(); req.user = u; next(); }).catch(next);
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  resolve(req).then((u) => { if (u) req.user = u; next(); }).catch(() => next());
}

export function requirePermission(p: Permission) {
  return (req: Request, res: Response, next: NextFunction) => {
    requireAuth(req, res, (err?: unknown) => {
      if (err) return next(err);
      const role = req.user!.adminRole;
      if (!role || !(PERMISSIONS[p] as readonly string[]).includes(role)) return next(forbidden());
      next();
    });
  };
}
