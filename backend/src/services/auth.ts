import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config';
import { Db, one, pool, q, tx } from '../db';
import { signAccessToken } from '../middleware/auth';
import { sendSms } from '../providers/messaging';
import { AppError, badRequest, conflict, unauthorized } from '../utils/errors';
import { randomToken, sha256 } from '../utils/crypto';
import { audit } from './audit';

export interface Tokens { accessToken: string; refreshToken: string; userId: string }

async function issueTokens(userId: string, userAgent: string | undefined, familyId: string = crypto.randomUUID(), db: Db = pool): Promise<Tokens> {
  const refresh = randomToken(48);
  await q(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at, user_agent) VALUES ($1,$2,$3, now() + ($4 || ' days')::interval, $5)`,
    [userId, sha256(refresh), familyId, String(config.REFRESH_TTL_DAYS), userAgent?.slice(0, 200) ?? null], db);
  return { accessToken: signAccessToken(userId), refreshToken: refresh, userId };
}

async function createUser(db: Db, u: { name: string; email?: string | null; phone?: string | null; passwordHash?: string | null; countryCode?: string | null; googleSub?: string; appleSub?: string; emailVerified?: boolean; phoneVerified?: boolean }) {
  const country = u.countryCode ? await one<{ currency: string; default_language: string }>(`SELECT currency, default_language FROM countries WHERE code = $1`, [u.countryCode], db) : undefined;
  const row = await one<{ id: string }>(
    `INSERT INTO users (name, email, phone, password_hash, country_code, preferred_currency, google_sub, apple_sub, email_verified_at, phone_verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $9 THEN now() END, CASE WHEN $10 THEN now() END) RETURNING id`,
    [u.name, u.email?.toLowerCase() ?? null, u.phone ?? null, u.passwordHash ?? null, country ? u.countryCode : null, country?.currency ?? null,
     u.googleSub ?? null, u.appleSub ?? null, !!u.emailVerified, !!u.phoneVerified], db);
  await q(`INSERT INTO profiles (user_id) VALUES ($1)`, [row!.id], db);
  await audit('auth.account_created', { actorId: row!.id, entityType: 'user', entityId: row!.id, db });
  return row!.id;
}

export async function registerEmail(input: { name: string; email: string; password: string; phone?: string; countryCode: string }, ua?: string): Promise<Tokens> {
  const existing = await one(`SELECT 1 FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`, [input.email]);
  if (existing) throw conflict('EMAIL_TAKEN', 'An account with this email already exists.');
  const passwordHash = await bcrypt.hash(input.password, 12);
  return tx(async (c) => {
    const id = await createUser(c, { ...input, passwordHash });
    return issueTokens(id, ua, undefined, c);
  });
}

export async function loginEmail(email: string, password: string, ua?: string): Promise<Tokens> {
  const u = await one<{ id: string; password_hash: string | null; status: string }>(
    `SELECT id, password_hash, status FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`, [email]);
  // Constant-ish time: always run a bcrypt compare.
  const ok = await bcrypt.compare(password, u?.password_hash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
  if (!u || !ok) throw unauthorized('Email or password is incorrect.');
  if (u.status === 'SUSPENDED' || u.status === 'BLOCKED') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Your account is currently suspended. Please contact support.');
  await audit('auth.login', { actorId: u.id, data: { method: 'email' } });
  return issueTokens(u.id, ua);
}

// ── Phone OTP ──
const OTP_TTL_MIN = 10;
const OTP_MAX_ATTEMPTS = 5;

export async function sendOtp(phone: string): Promise<{ sent: true; devCode?: string }> {
  const recent = await one<{ n: number }>(`SELECT count(*)::int AS n FROM otp_codes WHERE phone = $1 AND created_at > now() - interval '15 minutes'`, [phone]);
  if (recent && recent.n >= 5) throw new AppError(429, 'TOO_MANY_CODES', 'Too many codes requested. Please wait a few minutes.');
  const code = String(crypto.randomInt(100000, 999999));
  await q(`INSERT INTO otp_codes (phone, code_hash, expires_at) VALUES ($1,$2, now() + interval '${OTP_TTL_MIN} minutes')`, [phone, sha256(`${phone}:${code}`)]);
  await sendSms(phone, `Your Share Ride code is ${code}. It expires in ${OTP_TTL_MIN} minutes. Never share this code.`);
  return { sent: true, ...(config.NODE_ENV !== 'production' && config.SMS_PROVIDER === 'console' ? { devCode: code } : {}) };
}

export async function verifyOtp(input: { phone: string; code: string; name?: string; countryCode?: string }, ua?: string, currentUserId?: string): Promise<Tokens & { isNew: boolean }> {
  // Atomically consume the code only if it matches; otherwise count the attempt.
  // (Kept outside the login transaction so a failed attempt is never rolled back.)
  const otp = await one<{ id: string; code_hash: string; attempts: number }>(
    `SELECT id, code_hash, attempts FROM otp_codes WHERE phone = $1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`, [input.phone]);
  if (!otp || otp.attempts >= OTP_MAX_ATTEMPTS) throw badRequest('OTP_INVALID', 'This code has expired. Please request a new one.');
  const consumed = await one(
    `UPDATE otp_codes SET consumed_at = now() WHERE id = $1 AND code_hash = $2 AND consumed_at IS NULL AND attempts < $3 RETURNING id`,
    [otp.id, sha256(`${input.phone}:${input.code}`), OTP_MAX_ATTEMPTS]);
  if (!consumed) {
    await q(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);
    throw badRequest('OTP_INVALID', 'That code is incorrect.');
  }
  return tx(async (c) => {

    // Verifying a phone on an existing logged-in account.
    if (currentUserId) {
      await q(`UPDATE users SET phone = $2, phone_verified_at = now() WHERE id = $1`, [currentUserId, input.phone], c);
      return { ...(await issueTokens(currentUserId, ua, undefined, c)), isNew: false };
    }
    let u = await one<{ id: string }>(`SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL`, [input.phone], c);
    let isNew = false;
    if (!u) {
      if (!input.name) throw badRequest('NAME_REQUIRED', 'Please tell us your name to create your account.');
      u = { id: await createUser(c, { name: input.name, phone: input.phone, countryCode: input.countryCode, phoneVerified: true }) };
      isNew = true;
    } else {
      await q(`UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, now()) WHERE id = $1`, [u.id], c);
    }
    await audit('auth.login', { actorId: u.id, data: { method: 'phone' }, db: c });
    return { ...(await issueTokens(u.id, ua, undefined, c)), isNew };
  });
}

// ── Social sign-in: we verify the provider's ID token server-side; never trust client-sent profile data. ──
async function socialLogin(provider: 'google' | 'apple', sub: string, email: string | undefined, name: string, ua?: string): Promise<Tokens> {
  const col = provider === 'google' ? 'google_sub' : 'apple_sub';
  return tx(async (c) => {
    let u = await one<{ id: string }>(`SELECT id FROM users WHERE ${col} = $1`, [sub], c);
    if (!u && email) {
      // Link to an existing account only if that email was verified by the provider.
      u = await one<{ id: string }>(`UPDATE users SET ${col} = $2, email_verified_at = COALESCE(email_verified_at, now()) WHERE lower(email) = lower($1) AND deleted_at IS NULL RETURNING id`, [email, sub], c);
    }
    if (!u) u = { id: await createUser(c, { name, email, [provider === 'google' ? 'googleSub' : 'appleSub']: sub, emailVerified: !!email }) };
    await audit('auth.login', { actorId: u.id, data: { method: provider }, db: c });
    return issueTokens(u.id, ua, undefined, c);
  });
}

export async function loginGoogle(idToken: string, ua?: string): Promise<Tokens> {
  const audiences = (config.GOOGLE_OAUTH_CLIENT_IDS ?? '').split(',').filter(Boolean);
  if (!audiences.length) throw new AppError(503, 'GOOGLE_NOT_CONFIGURED', 'Google sign-in is not available yet.');
  const ticket = await new OAuth2Client().verifyIdToken({ idToken, audience: audiences }).catch(() => { throw unauthorized('Google sign-in failed.'); });
  const p = ticket.getPayload();
  if (!p?.sub) throw unauthorized('Google sign-in failed.');
  return socialLogin('google', p.sub, p.email_verified ? p.email : undefined, p.name ?? 'Share Ride user', ua);
}

const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
export async function loginApple(identityToken: string, fullName: string | undefined, ua?: string): Promise<Tokens> {
  const audiences = (config.APPLE_CLIENT_IDS ?? '').split(',').filter(Boolean);
  if (!audiences.length) throw new AppError(503, 'APPLE_NOT_CONFIGURED', 'Apple sign-in is not available yet.');
  const { payload } = await jwtVerify(identityToken, appleJwks, { issuer: 'https://appleid.apple.com', audience: audiences })
    .catch(() => { throw unauthorized('Apple sign-in failed.'); });
  const verified = payload.email_verified === true || payload.email_verified === 'true';
  return socialLogin('apple', String(payload.sub), verified ? (payload.email as string) : undefined, fullName || 'Share Ride user', ua);
}

/** Refresh-token rotation with reuse detection: replaying a used token revokes the whole family (account-takeover defence). */
export async function refresh(token: string, ua?: string): Promise<Tokens> {
  // The transaction returns an outcome; we throw only AFTER commit so the family revocation persists.
  const out = await tx(async (c): Promise<Tokens | 'reject'> => {
    const row = await one<{ id: string; user_id: string; family_id: string; revoked_at: Date | null; expires_at: Date }>(
      `SELECT id, user_id, family_id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`, [sha256(token)], c);
    if (!row || row.expires_at < new Date()) return 'reject';
    if (row.revoked_at) {
      await q(`UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [row.family_id], c);
      await audit('auth.refresh_reuse_detected', { actorId: row.user_id, db: c });
      return 'reject';
    }
    await q(`UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`, [row.id], c);
    return issueTokens(row.user_id, ua, row.family_id, c);
  });
  if (out === 'reject') throw unauthorized();
  return out;
}

export async function logout(token: string) {
  await q(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [sha256(token)]);
}

/** Account deletion (spec §81): blocks while anything is pending; then anonymises (retaining financial records). */
export async function requestAccountDeletion(userId: string, password?: string) {
  const u = await one<{ password_hash: string | null }>(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
  if (u?.password_hash && !(password && (await bcrypt.compare(password, u.password_hash)))) {
    throw unauthorized('Please confirm your password to delete your account.');
  }
  const blockers = await one<{ rides: number; bookings: number; payouts: number; balance: number }>(
    `SELECT (SELECT count(*)::int FROM rides WHERE driver_id = $1 AND status IN ('PUBLISHED','DRIVER_READY','IN_PROGRESS')) AS rides,
            (SELECT count(*)::int FROM bookings WHERE passenger_id = $1 AND status IN ('REQUESTED','RESERVED','CONFIRMED','PASSENGER_PICKUP','IN_PROGRESS')) AS bookings,
            (SELECT count(*)::int FROM payouts WHERE driver_id = $1 AND status IN ('REQUESTED','PROCESSING')) AS payouts,
            (SELECT COALESCE(sum(available_minor + pending_minor),0)::bigint FROM wallets WHERE user_id = $1) AS balance`, [userId]);
  const reasons: string[] = [];
  if (blockers!.rides) reasons.push('You have upcoming rides as a driver.');
  if (blockers!.bookings) reasons.push('You have upcoming bookings.');
  if (blockers!.payouts) reasons.push('You have a withdrawal in progress.');
  if (Number(blockers!.balance) > 0) reasons.push('Please withdraw your remaining earnings first.');
  if (reasons.length) throw new AppError(409, 'DELETION_BLOCKED', 'Your account can\'t be deleted yet.', reasons);
  await tx(async (c) => {
    // Financial records (bookings, payments, earnings) are retained for legal/tax retention; personal data is removed.
    await q(`UPDATE users SET status = 'DELETED', deleted_at = now(), name = 'Deleted user', email = NULL, phone = NULL,
                    password_hash = NULL, google_sub = NULL, apple_sub = NULL WHERE id = $1`, [userId], c);
    await q(`UPDATE profiles SET photo_url = NULL, about = NULL, gender = NULL WHERE user_id = $1`, [userId], c);
    await q(`DELETE FROM trusted_contacts WHERE user_id = $1`, [userId], c);
    await q(`DELETE FROM device_tokens WHERE user_id = $1`, [userId], c);
    await q(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId], c);
    await audit('user.deleted', { actorId: userId, entityType: 'user', entityId: userId, db: c });
  });
}
