import type { PublicUser } from '@share-ride/shared';
import { Db, one, pool, q } from '../db';
import { notFound } from '../utils/errors';
import { notify } from './notifications';
import { audit } from './audit';

export const PUBLIC_USER_COLUMNS = `
  u.id, u.name, u.rating_avg, u.rating_count, u.rides_as_driver, u.trips_as_passenger, u.created_at,
  u.phone_verified_at IS NOT NULL AS b_phone, u.email_verified_at IS NOT NULL AS b_email,
  u.identity_verified_at IS NOT NULL AS b_identity, u.driver_verified_at IS NOT NULL AS b_driver,
  p.photo_url, p.languages, p.about`;

/** Only information needed for a ride is public (spec §51): no phone, email, documents or exact address. */
export function toPublicUser(r: any, prefix = ''): PublicUser {
  const g = (k: string) => r[prefix + k];
  return {
    id: g('id'),
    name: firstNameLastInitial(g('name')),
    photoUrl: g('photo_url') ?? null,
    rating: Number(g('rating_avg') ?? 0),
    ratingCount: g('rating_count') ?? 0,
    completedRides: (g('rides_as_driver') ?? 0) + (g('trips_as_passenger') ?? 0),
    memberSince: new Date(g('created_at')).toISOString(),
    badges: { phone: !!g('b_phone'), email: !!g('b_email'), identity: !!g('b_identity'), driver: !!g('b_driver') },
    languages: g('languages') ?? [],
    about: g('about') ?? null,
  };
}

export function firstNameLastInitial(name: string): string {
  const parts = String(name).trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

export async function getPublicUser(id: string): Promise<PublicUser> {
  const r = await one(`SELECT ${PUBLIC_USER_COLUMNS} FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1 AND u.status <> 'DELETED'`, [id]);
  if (!r) throw notFound('User');
  return toPublicUser(r);
}

export async function getMe(id: string) {
  const r = await one(
    `SELECT u.id, u.name, u.email, u.phone, u.country_code, u.preferred_currency, u.language, u.status, u.created_at,
            u.rating_avg, u.rating_count, u.rides_as_driver, u.trips_as_passenger,
            u.phone_verified_at, u.email_verified_at, u.identity_verified_at, u.driver_verified_at, u.is_demo,
            p.photo_url, p.about, p.languages, p.gender, p.notification_prefs, a.role AS admin_role
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id LEFT JOIN admin_users a ON a.user_id = u.id
      WHERE u.id = $1`, [id]);
  if (!r) throw notFound('User');
  return {
    id: r.id, name: r.name, email: r.email, phone: r.phone, countryCode: r.country_code,
    preferredCurrency: r.preferred_currency, language: r.language, status: r.status, memberSince: r.created_at,
    rating: Number(r.rating_avg), ratingCount: r.rating_count, ridesAsDriver: r.rides_as_driver, tripsAsPassenger: r.trips_as_passenger,
    badges: { phone: !!r.phone_verified_at, email: !!r.email_verified_at, identity: !!r.identity_verified_at, driver: !!r.driver_verified_at },
    photoUrl: r.photo_url, about: r.about, languages: r.languages ?? [], gender: r.gender,
    notificationPrefs: r.notification_prefs, adminRole: r.admin_role, isDemo: r.is_demo,
  };
}

/**
 * Internal reliability score 0..100 (spec §36). Never returned by any user-facing endpoint.
 * Used for search ranking and fraud review prioritisation.
 */
export async function recomputeTrustScore(userId: string, db: Db = pool): Promise<number> {
  const u = await one(
    `SELECT rides_as_driver + trips_as_passenger AS completed, driver_cancel_count + passenger_cancel_count AS cancels,
            no_show_count, rating_avg, rating_count,
            (phone_verified_at IS NOT NULL)::int + (email_verified_at IS NOT NULL)::int +
            (identity_verified_at IS NOT NULL)::int + (driver_verified_at IS NOT NULL)::int AS verif,
            (SELECT count(*) FROM support_tickets t WHERE t.user_id <> users.id AND t.category IN ('DRIVER','PASSENGER','SAFETY')
               AND (t.ride_id IN (SELECT id FROM rides WHERE driver_id = users.id))) AS complaints
       FROM users WHERE id = $1`, [userId], db);
  if (!u) return 50;
  const total = u.completed + u.cancels + u.no_show_count;
  const reliability = total ? u.completed / total : 0.7;
  const rating = u.rating_count ? (Number(u.rating_avg) - 1) / 4 : 0.7;
  const experience = Math.min(1, Math.log10(1 + u.completed) / 2);
  let score = 100 * (0.35 * reliability + 0.25 * rating + 0.2 * (u.verif / 4) + 0.2 * experience);
  score -= Math.min(30, Number(u.complaints) * 5) + Math.min(20, u.no_show_count * 4);
  const final = Math.round(Math.max(0, Math.min(100, score)));
  await q(`UPDATE users SET trust_score = $2 WHERE id = $1`, [userId, final], db);
  return final;
}

/**
 * Escalating consequences for repeated cancellations (spec §19). Never auto-bans permanently:
 * the top tier suspends and opens a fraud flag for human review (spec §35).
 */
export async function applyCancellationConsequences(userId: string, count: number, thresholds: Record<string, number>, db: Db) {
  if (count === thresholds.suspend) {
    await q(`UPDATE users SET status = 'SUSPENDED' WHERE id = $1 AND status IN ('ACTIVE','RESTRICTED')`, [userId], db);
    await q(`INSERT INTO fraud_flags (user_id, kind, severity, details) VALUES ($1,'REPEATED_CANCELLATIONS','HIGH',$2)`, [userId, JSON.stringify({ count })], db);
    await audit('user.auto_suspend', { entityType: 'user', entityId: userId, data: { count }, db });
  } else if (count === thresholds.review) {
    await q(`INSERT INTO fraud_flags (user_id, kind, severity, details) VALUES ($1,'REPEATED_CANCELLATIONS','MEDIUM',$2)`, [userId, JSON.stringify({ count })], db);
  } else if (count === thresholds.restricted) {
    await q(`UPDATE users SET status = 'RESTRICTED' WHERE id = $1 AND status = 'ACTIVE'`, [userId], db);
    await notify(db, userId, 'ACCOUNT', 'Account temporarily restricted', 'Because of repeated cancellations, you can\'t create new rides or bookings for now. Contact support if you think this is a mistake.');
  } else if (count === thresholds.warning) {
    await notify(db, userId, 'ACCOUNT', 'A friendly reminder', 'Frequent cancellations affect other travellers. Repeated cancellations may limit your account.');
  }
}
