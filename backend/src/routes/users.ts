import { Router } from 'express';
import { z } from 'zod';
import { LANGUAGES } from '@share-ride/shared';
import { one, q } from '../db';
import { h, body } from '../middleware/http';
import { requireAuth } from '../middleware/auth';
import { getMe, getPublicUser } from '../services/users';
import { requestAccountDeletion } from '../services/auth';
import { audit } from '../services/audit';
import { encrypt } from '../utils/crypto';
import { notFound } from '../utils/errors';
import { country, e164, uuid } from './schemas';

export const usersRouter = Router();

// ── /profile ──
usersRouter.get('/profile', requireAuth, h(async (req, res) => { res.json(await getMe(req.user!.id)); }));

usersRouter.patch('/profile', requireAuth, h(async (req, res) => {
  const b = body(z.object({
    name: z.string().trim().min(2).max(80).optional(),
    about: z.string().max(500).nullable().optional(),
    languages: z.array(z.string().max(30)).max(10).optional(),
    countryCode: country.optional(),
    preferredCurrency: z.string().length(3).optional(),
    language: z.enum(LANGUAGES.map((l) => l.code) as [string, ...string[]]).optional(),
    gender: z.enum(['female', 'male', 'other', 'undisclosed']).optional(),
    photoUrl: z.string().url().max(500).nullable().optional(),
    notificationPrefs: z.object({ push: z.boolean(), email: z.boolean(), sms: z.boolean() }).optional(),
  }), req);
  const id = req.user!.id;
  await q(`UPDATE users SET name = COALESCE($2, name), country_code = COALESCE($3, country_code), preferred_currency = COALESCE($4, preferred_currency),
                            language = COALESCE($5, language), updated_at = now() WHERE id = $1`,
    [id, b.name ?? null, b.countryCode ?? null, b.preferredCurrency ?? null, b.language ?? null]);
  await q(`UPDATE profiles SET about = CASE WHEN $2 THEN $3 ELSE about END, languages = COALESCE($4, languages), gender = COALESCE($5, gender),
                               photo_url = CASE WHEN $6 THEN $7 ELSE photo_url END, notification_prefs = COALESCE($8, notification_prefs), updated_at = now()
            WHERE user_id = $1`,
    [id, b.about !== undefined, b.about ?? null, b.languages ?? null, b.gender ?? null, b.photoUrl !== undefined, b.photoUrl ?? null, b.notificationPrefs ? JSON.stringify(b.notificationPrefs) : null]);
  res.json(await getMe(id));
}));

usersRouter.post('/profile/delete', requireAuth, h(async (req, res) => {
  const b = body(z.object({ password: z.string().max(128).optional() }), req);
  await requestAccountDeletion(req.user!.id, b.password);
  res.status(204).end();
}));

// ── /users/:id (public profile) ──
usersRouter.get('/users/:id', h(async (req, res) => { res.json(await getPublicUser(uuid.parse(req.params.id))); }));

usersRouter.post('/users/:id/block', requireAuth, h(async (req, res) => {
  const target = uuid.parse(req.params.id);
  await q(`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.user!.id, target]);
  await audit('user.blocked_user', { actorId: req.user!.id, entityType: 'user', entityId: target });
  res.status(204).end();
}));

// ── /vehicles ──
const vehicleSchema = z.object({
  make: z.string().trim().min(1).max(40), model: z.string().trim().min(1).max(40),
  year: z.number().int().min(1950).max(new Date().getFullYear() + 1).optional(),
  color: z.string().trim().min(2).max(30), licensePlate: z.string().trim().min(2).max(20),
  vehicleType: z.enum(['sedan', 'suv', 'hatchback', 'van', 'minivan', 'pickup', 'ev', 'other']),
  seats: z.number().int().min(2).max(15),
});

const vehicleOut = (v: any) => ({ id: v.id, make: v.make, model: v.model, year: v.year, color: v.color, licensePlate: v.license_plate, vehicleType: v.vehicle_type, seats: v.seats, photos: v.photos, verificationStatus: v.verification_status });

usersRouter.get('/vehicles', requireAuth, h(async (req, res) => {
  res.json((await q(`SELECT * FROM vehicles WHERE owner_id = $1 AND is_active ORDER BY created_at`, [req.user!.id])).map(vehicleOut));
}));
usersRouter.post('/vehicles', requireAuth, h(async (req, res) => {
  const v = body(vehicleSchema, req);
  const row = await one(`INSERT INTO vehicles (owner_id, make, model, year, color, license_plate, vehicle_type, seats) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.user!.id, v.make, v.model, v.year ?? null, v.color, v.licensePlate.toUpperCase(), v.vehicleType, v.seats]);
  await audit('vehicle.created', { actorId: req.user!.id, entityType: 'vehicle', entityId: row.id });
  res.status(201).json(vehicleOut(row));
}));
usersRouter.patch('/vehicles/:id', requireAuth, h(async (req, res) => {
  const v = body(vehicleSchema.partial(), req);
  // Material changes reset verification.
  const row = await one(
    `UPDATE vehicles SET make = COALESCE($3, make), model = COALESCE($4, model), year = COALESCE($5, year), color = COALESCE($6, color),
            license_plate = COALESCE($7, license_plate), vehicle_type = COALESCE($8, vehicle_type), seats = COALESCE($9, seats),
            verification_status = CASE WHEN $7 IS NOT NULL AND $7 <> license_plate THEN 'PENDING' ELSE verification_status END
      WHERE id = $1 AND owner_id = $2 AND is_active RETURNING *`,
    [uuid.parse(req.params.id), req.user!.id, v.make ?? null, v.model ?? null, v.year ?? null, v.color ?? null, v.licensePlate?.toUpperCase() ?? null, v.vehicleType ?? null, v.seats ?? null]);
  if (!row) throw notFound('Vehicle');
  res.json(vehicleOut(row));
}));
usersRouter.delete('/vehicles/:id', requireAuth, h(async (req, res) => {
  const row = await one(`UPDATE vehicles SET is_active = FALSE WHERE id = $1 AND owner_id = $2 RETURNING id`, [uuid.parse(req.params.id), req.user!.id]);
  if (!row) throw notFound('Vehicle');
  res.status(204).end();
}));

// ── /notifications ──
usersRouter.get('/notifications', requireAuth, h(async (req, res) => {
  const items = await q(`SELECT id, type, title, body, data, read_at AS "readAt", created_at AS "createdAt" FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`, [req.user!.id]);
  const unread = (await one(`SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL`, [req.user!.id])).n;
  res.json({ items, unread });
}));
usersRouter.post('/notifications/read', requireAuth, h(async (req, res) => {
  const b = body(z.object({ ids: z.array(uuid).max(200).optional() }), req);
  await q(`UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND ($2::uuid[] IS NULL OR id = ANY($2))`, [req.user!.id, b.ids ?? null]);
  res.status(204).end();
}));
usersRouter.post('/notifications/devices', requireAuth, h(async (req, res) => {
  const b = body(z.object({ token: z.string().min(10).max(300), platform: z.enum(['ios', 'android', 'web']) }), req);
  await q(`INSERT INTO device_tokens (user_id, token, platform) VALUES ($1,$2,$3) ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id`, [req.user!.id, b.token, b.platform]);
  res.status(204).end();
}));

// ── Trusted contacts (safety) — phone/email encrypted at rest ──
usersRouter.get('/profile/trusted-contacts', requireAuth, h(async (req, res) => {
  res.json(await q(`SELECT id, name, created_at AS "createdAt" FROM trusted_contacts WHERE user_id = $1`, [req.user!.id]));
}));
usersRouter.post('/profile/trusted-contacts', requireAuth, h(async (req, res) => {
  const b = body(z.object({ name: z.string().trim().min(1).max(80), phone: e164.optional(), email: z.string().email().optional() }).refine((x) => x.phone || x.email, 'Phone or email required'), req);
  const row = await one(`INSERT INTO trusted_contacts (user_id, name, phone_enc, email_enc) VALUES ($1,$2,$3,$4) RETURNING id, name`,
    [req.user!.id, b.name, b.phone ? encrypt(b.phone) : null, b.email ? encrypt(b.email) : null]);
  res.status(201).json(row);
}));
