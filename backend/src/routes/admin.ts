import { Router } from 'express';
import { z } from 'zod';
import { one, q, tx } from '../db';
import { h, body, query } from '../middleware/http';
import { requirePermission } from '../middleware/auth';
import { dashboard } from '../services/admin';
import { audit } from '../services/audit';
import { notify } from '../services/notifications';
import { cancelRide, getRide } from '../services/rides';
import { getBooking } from '../services/bookings';
import { processRefund, queueRefund } from '../services/payments';
import { getMe } from '../services/users';
import { AppError, badRequest, notFound } from '../utils/errors';
import { country, uuid } from './schemas';

/** Every route here requires a staff role with the specific permission (spec §50). */
export const adminRouter = Router();
const page = z.object({ q: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0) });

adminRouter.get('/dashboard', requirePermission('dashboard.view'), h(async (req, res) => {
  const p = query(z.object({ country: country.optional(), days: z.coerce.number().int().min(1).max(365).default(30), currency: z.string().length(3).default('AED') }), req);
  res.json(await dashboard({ countryCode: p.country, days: p.days, reportingCurrency: p.currency.toUpperCase() }));
}));

// ── Users ──
adminRouter.get('/users', requirePermission('users.view'), h(async (req, res) => {
  const p = query(page.extend({ status: z.string().optional() }), req);
  const rows = await q(
    `SELECT u.id, u.name, u.email, u.phone, u.country_code, u.status, u.rating_avg, u.rating_count, u.rides_as_driver, u.trips_as_passenger,
            u.driver_cancel_count, u.passenger_cancel_count, u.no_show_count, u.trust_score, u.created_at, u.is_demo,
            u.phone_verified_at IS NOT NULL AS phone_verified, u.identity_verified_at IS NOT NULL AS identity_verified, u.driver_verified_at IS NOT NULL AS driver_verified,
            a.role AS admin_role, (SELECT count(*)::int FROM fraud_flags f WHERE f.user_id = u.id AND f.status = 'OPEN') AS open_flags
       FROM users u LEFT JOIN admin_users a ON a.user_id = u.id
      WHERE ($1::text IS NULL OR u.name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%' OR u.phone LIKE '%' || $1 || '%' OR u.id::text = $1)
        AND ($2::text IS NULL OR u.status = $2)
      ORDER BY u.created_at DESC LIMIT $3 OFFSET $4`, [p.q ?? null, p.status ?? null, p.limit, p.offset]);
  res.json(rows);
}));

adminRouter.get('/users/:id', requirePermission('users.view'), h(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const user = await getMe(id);
  const [rides, bookings, payments, ratings, tickets, flags] = await Promise.all([
    q(`SELECT id, origin_name, dest_name, departure_at, status, seats_total, seats_available, price_per_seat_minor, currency FROM rides WHERE driver_id = $1 ORDER BY departure_at DESC LIMIT 50`, [id]),
    q(`SELECT b.id, b.status, b.seats, b.passenger_total_minor, b.currency, b.created_at, r.origin_name, r.dest_name FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE b.passenger_id = $1 ORDER BY b.created_at DESC LIMIT 50`, [id]),
    q(`SELECT p.id, p.status, p.amount_minor, p.refunded_minor, p.currency, p.provider, p.created_at FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE b.passenger_id = $1 ORDER BY p.created_at DESC LIMIT 50`, [id]),
    q(`SELECT ra.stars, ra.ratee_role, rv.comment, ra.created_at FROM ratings ra LEFT JOIN reviews rv ON rv.rating_id = ra.id WHERE ra.ratee_id = $1 ORDER BY ra.created_at DESC LIMIT 50`, [id]),
    q(`SELECT id, reference, category, status, subject, created_at FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [id]),
    q(`SELECT id, kind, severity, status, details, created_at FROM fraud_flags WHERE user_id = $1 ORDER BY created_at DESC`, [id]),
  ]);
  const internal = await one(`SELECT trust_score, driver_cancel_count, passenger_cancel_count, no_show_count FROM users WHERE id = $1`, [id]);
  res.json({ user, internal, rides, bookings, payments, ratings, tickets, fraudFlags: flags });
}));

const STATUS_ACTIONS = { suspend: 'SUSPENDED', reactivate: 'ACTIVE', block: 'BLOCKED' } as const;
adminRouter.post('/users/:id/:action(suspend|reactivate|block)', requirePermission('users.manage'), h(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const action = req.params.action as keyof typeof STATUS_ACTIONS;
  const { reason } = body(z.object({ reason: z.string().trim().min(3).max(500) }), req);
  if (id === req.user!.id) throw badRequest('SELF_ACTION', "You can't change your own account status.");
  const target = await one(`SELECT a.role FROM admin_users a WHERE a.user_id = $1`, [id]);
  if (target && req.user!.adminRole !== 'SUPER_ADMIN') throw new AppError(403, 'FORBIDDEN', 'Only a super admin can change staff accounts.');
  await tx(async (c) => {
    const u = await one(`UPDATE users SET status = $2, updated_at = now() WHERE id = $1 AND status <> 'DELETED' RETURNING id`, [id, STATUS_ACTIONS[action]], c);
    if (!u) throw notFound('User');
    if (action !== 'reactivate') await q(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [id], c);
    await notify(c, id, 'ACCOUNT', action === 'reactivate' ? 'Your account is active again' : 'Your account has been restricted', action === 'reactivate' ? 'Welcome back to Share Ride.' : 'Please contact support for details.');
    await audit(`admin.user_${action}`, { actorId: req.user!.id, actorRole: req.user!.adminRole, entityType: 'user', entityId: id, data: { reason }, req, db: c });
  });
  res.json(await getMe(id));
}));

adminRouter.post('/users/:id/verification', requirePermission('users.manage'), h(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const b = body(z.object({ level: z.enum(['identity', 'driver']), action: z.enum(['verify', 'reset']), note: z.string().max(500).optional() }), req);
  const col = b.level === 'identity' ? 'identity_verified_at' : 'driver_verified_at';
  await q(`UPDATE users SET ${col} = ${b.action === 'verify' ? 'now()' : 'NULL'} WHERE id = $1`, [id]);
  await audit(`admin.verification_${b.action}`, { actorId: req.user!.id, actorRole: req.user!.adminRole, entityType: 'user', entityId: id, data: b, req });
  res.json(await getMe(id));
}));

adminRouter.post('/vehicles/:id/verification', requirePermission('users.manage'), h(async (req, res) => {
  const b = body(z.object({ status: z.enum(['VERIFIED', 'REJECTED', 'EXPIRED', 'PENDING']) }), req);
  const v = await one(`UPDATE vehicles SET verification_status = $2 WHERE id = $1 RETURNING id, owner_id, verification_status`, [uuid.parse(req.params.id), b.status]);
  if (!v) throw notFound('Vehicle');
  await audit('admin.vehicle_verification', { actorId: req.user!.id, actorRole: req.user!.adminRole, entityType: 'vehicle', entityId: v.id, data: b, req });
  res.json(v);
}));

// ── Rides & bookings ──
adminRouter.get('/rides', requirePermission('rides.view'), h(async (req, res) => {
  const p = query(page.extend({ status: z.string().optional(), country: country.optional() }), req);
  res.json(await q(
    `SELECT r.id, r.status, r.country_code, r.origin_name, r.dest_name, r.departure_at, r.seats_total, r.seats_available, r.price_per_seat_minor, r.currency, r.is_demo,
            u.name AS driver_name, u.id AS driver_id,
            (SELECT count(*)::int FROM bookings b WHERE b.ride_id = r.id AND b.status IN ('CONFIRMED','IN_PROGRESS','COMPLETED')) AS passengers
       FROM rides r JOIN users u ON u.id = r.driver_id
      WHERE ($1::text IS NULL OR r.origin_name ILIKE '%' || $1 || '%' OR r.dest_name ILIKE '%' || $1 || '%' OR u.name ILIKE '%' || $1 || '%' OR r.id::text = $1)
        AND ($2::text IS NULL OR r.status = $2) AND ($3::char(2) IS NULL OR r.country_code = $3)
      ORDER BY r.departure_at DESC LIMIT $4 OFFSET $5`, [p.q ?? null, p.status ?? null, p.country ?? null, p.limit, p.offset]));
}));

adminRouter.get('/rides/:id', requirePermission('rides.view'), h(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const ride = await getRide(id);
  const passengers = await q(
    `SELECT b.id, b.status, b.seats, b.pickup_name, b.dropoff_name, b.passenger_total_minor, b.platform_fee_minor, b.driver_earnings_minor, b.currency, u.id AS user_id, u.name,
            (SELECT status FROM payments p WHERE p.booking_id = b.id ORDER BY created_at DESC LIMIT 1) AS payment_status
       FROM bookings b JOIN users u ON u.id = b.passenger_id WHERE b.ride_id = $1 ORDER BY b.created_at`, [id]);
  const seatLedger = await q(`SELECT booking_id, seats, action, created_at FROM ride_seats WHERE ride_id = $1 ORDER BY created_at`, [id]);
  res.json({ ride, passengers, seatLedger });
}));

adminRouter.post('/rides/:id/cancel', requirePermission('rides.manage'), h(async (req, res) => {
  const { reason } = body(z.object({ reason: z.string().trim().min(3).max(500) }), req);
  res.json(await cancelRide(uuid.parse(req.params.id), req.user!.id, { asAdmin: true, reason }));
}));

adminRouter.post('/bookings/:id/refund', requirePermission('payments.refund'), h(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const b = body(z.object({ amountMinor: z.number().int().positive(), reason: z.string().trim().min(3).max(500) }), req);
  const refundId = await tx(async (c) => {
    const p = await one(`SELECT id FROM payments WHERE booking_id = $1 AND status IN ('PAID','PARTIALLY_REFUNDED')`, [id], c);
    if (!p) throw new AppError(409, 'NOT_PAID', 'This booking has no captured payment.');
    return queueRefund(c, p.id, b.amountMinor, `Admin: ${b.reason}`, req.user!.id);
  });
  await processRefund(refundId);
  res.json(await getBooking(id, req.user!.id, true));
}));

adminRouter.get('/payments', requirePermission('payments.view'), h(async (req, res) => {
  const p = query(page.extend({ status: z.string().optional() }), req);
  res.json(await q(
    `SELECT p.id, p.booking_id, p.provider, p.provider_payment_id, p.status, p.amount_minor, p.refunded_minor, p.currency, p.created_at, u.name AS passenger
       FROM payments p JOIN bookings b ON b.id = p.booking_id JOIN users u ON u.id = b.passenger_id
      WHERE ($1::text IS NULL OR p.status = $1) ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`, [p.status ?? null, p.limit, p.offset]));
}));

// ── Pricing management (spec §30, §60): versioned; every change is a new row + audit entry ──
const pricingSchema = z.object({
  baseFareMinor: z.number().int().min(0), perKmMinor: z.number().int().min(0),
  minFareMinor: z.number().int().positive(), maxFareMinor: z.number().int().positive(),
  minDriverPriceMinor: z.number().int().positive(), maxDriverPriceMinor: z.number().int().positive(),
  platformFeeBps: z.number().int().min(0).max(5000), feeBearer: z.enum(['DRIVER', 'PASSENGER']),
  taxOnFeeBps: z.number().int().min(0).max(5000).default(0),
  roundingMinor: z.number().int().min(1).default(100), suggestionSpreadBps: z.number().int().min(0).max(5000).default(1000),
  note: z.string().max(500).optional(),
}).refine((r) => r.maxFareMinor >= r.minFareMinor && r.maxDriverPriceMinor >= r.minDriverPriceMinor, 'Max must be ≥ min');

adminRouter.get('/pricing', requirePermission('pricing.manage'), h(async (req, res) => {
  const { country: c } = query(z.object({ country: country.optional() }), req);
  res.json(await q(
    `SELECT pr.*, u.name AS created_by_name FROM pricing_rules pr LEFT JOIN users u ON u.id = pr.created_by
      WHERE ($1::char(2) IS NULL OR pr.country_code = $1) ORDER BY pr.country_code, pr.version DESC`, [c ?? null]));
}));

adminRouter.post('/pricing/:country', requirePermission('pricing.manage'), h(async (req, res) => {
  const cc = country.parse(req.params.country);
  const b = body(pricingSchema, req);
  const row = await tx(async (c) => {
    const co = await one(`SELECT currency FROM countries WHERE code = $1 FOR UPDATE`, [cc], c);
    if (!co) throw notFound('Country');
    const prev = await one(`SELECT * FROM pricing_rules WHERE country_code = $1 AND is_active`, [cc], c);
    await q(`UPDATE pricing_rules SET is_active = FALSE WHERE country_code = $1 AND is_active`, [cc], c);
    const version = ((await one(`SELECT max(version) AS v FROM pricing_rules WHERE country_code = $1`, [cc], c))?.v ?? 0) + 1;
    const r = await one(
      `INSERT INTO pricing_rules (country_code, currency, version, base_fare_minor, per_km_minor, min_fare_minor, max_fare_minor, min_driver_price_minor,
                                  max_driver_price_minor, platform_fee_bps, fee_bearer, tax_on_fee_bps, rounding_minor, suggestion_spread_bps, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [cc, co.currency, version, b.baseFareMinor, b.perKmMinor, b.minFareMinor, b.maxFareMinor, b.minDriverPriceMinor, b.maxDriverPriceMinor,
       b.platformFeeBps, b.feeBearer, b.taxOnFeeBps, b.roundingMinor, b.suggestionSpreadBps, b.note ?? null, req.user!.id], c);
    await audit('admin.pricing_update', { actorId: req.user!.id, actorRole: req.user!.adminRole, entityType: 'pricing_rule', entityId: r.id, data: { country: cc, before: prev, after: b }, req, db: c });
    return r;
  });
  res.status(201).json(row);
}));

/** Activate an older version (rollback) or deactivate pricing entirely (which disables new rides in that country). */
adminRouter.post('/pricing/rules/:id/:action(activate|deactivate)', requirePermission('pricing.manage'), h(async (req, res) => {
  const id = uuid.parse(req.params.id);
  const activate = req.params.action === 'activate';
  const row = await tx(async (c) => {
    const r = await one(`SELECT * FROM pricing_rules WHERE id = $1 FOR UPDATE`, [id], c);
    if (!r) throw notFound('Pricing rule');
    if (activate) await q(`UPDATE pricing_rules SET is_active = FALSE WHERE country_code = $1 AND is_active`, [r.country_code], c);
    const out = await one(`UPDATE pricing_rules SET is_active = $2 WHERE id = $1 RETURNING *`, [id, activate], c);
    await audit(`admin.pricing_${req.params.action}`, { actorId: req.user!.id, actorRole: req.user!.adminRole, entityType: 'pricing_rule', entityId: id, req, db: c });
    return out;
  });
  res.json(row);
}));

// ── Countries / compliance switches (spec §53) ──
adminRouter.get('/countries', requirePermission('countries.manage'), h(async (_req, res) => { res.json(await q(`SELECT * FROM countries ORDER BY name`)); }));
adminRouter.patch('/countries/:code', requirePermission('countries.manage'), h(async (req, res) => {
  const cc = country.parse(req.params.code);
  const b = body(z.object({
    rideCreationEnabled: z.boolean().optional(), bookingEnabled: z.boolean().optional(), womenOnlyAllowed: z.boolean().optional(), isActive: z.boolean().optional(),
    verificationRequirements: z.object({ driver: z.array(z.enum(['phone', 'email', 'identity', 'driver'])), passenger: z.array(z.enum(['phone', 'email', 'identity'])) }).optional(),
    withdrawalMethods: z.array(z.string().max(40)).optional(),
  }), req);
  const row = await one(
    `UPDATE countries SET ride_creation_enabled = COALESCE($2, ride_creation_enabled), booking_enabled = COALESCE($3, booking_enabled),
            women_only_allowed = COALESCE($4, women_only_allowed), is_active = COALESCE($5, is_active),
            verification_requirements = COALESCE($6, verification_requirements), withdrawal_methods = COALESCE($7, withdrawal_methods)
      WHERE code = $1 RETURNING *`,
    [cc, b.rideCreationEnabled ?? null, b.bookingEnabled ?? null, b.womenOnlyAllowed ?? null, b.isActive ?? null,
     b.verificationRequirements ? JSON.stringify(b.verificationRequirements) : null, b.withdrawalMethods ? JSON.stringify(b.withdrawalMethods) : null]);
  if (!row) throw notFound('Country');
  await audit('admin.country_update', { actorId: req.user!.id, actorRole: req.user!.adminRole, entityType: 'country', entityId: cc, data: b, req });
  res.json(row);
}));

adminRouter.get('/cancellation-rules', requirePermission('pricing.manage'), h(async (_req, res) => { res.json(await q(`SELECT * FROM cancellation_rules ORDER BY country_code NULLS FIRST, ride_type`)); }));
adminRouter.put('/cancellation-rules', requirePermission('pricing.manage'), h(async (req, res) => {
  const tier = z.object({ minHoursBefore: z.number().min(0), refundBps: z.number().int().min(0).max(10000) });
  const b = body(z.object({
    countryCode: country.nullable(), rideType: z.string().default('standard'),
    policy: z.object({ passengerTiers: z.array(tier).min(1), noShowRefundBps: z.number().int().min(0).max(10000), driverCancelRefundBps: z.number().int().min(0).max(10000) }),
  }), req);
  const row = await tx(async (c) => {
    await q(`UPDATE cancellation_rules SET is_active = FALSE WHERE COALESCE(country_code,'**') = COALESCE($1,'**') AND ride_type = $2 AND is_active`, [b.countryCode, b.rideType], c);
    const r = await one(`INSERT INTO cancellation_rules (country_code, ride_type, policy) VALUES ($1,$2,$3) RETURNING *`, [b.countryCode, b.rideType, JSON.stringify(b.policy)], c);
    await audit('admin.cancellation_rules_update', { actorId: req.user!.id, actorRole: req.user!.adminRole, entityType: 'cancellation_rule', entityId: r.id, data: b, req, db: c });
    return r;
  });
  res.json(row);
}));

// ── Platform settings (spec §74) ──
adminRouter.get('/settings', requirePermission('settings.manage'), h(async (_req, res) => { res.json(await q(`SELECT key, value, updated_at FROM platform_settings ORDER BY key`)); }));
adminRouter.put('/settings/:key', requirePermission('settings.manage'), h(async (req, res) => {
  const key = z.enum(['DEFAULT_PLATFORM_FEE_BPS', 'BOOKING_EXPIRY_MINUTES', 'MINIMUM_RIDE_PRICE_NOTE', 'SUPPORT_EMAIL', 'ANNOUNCEMENT']).parse(req.params.key);
  const { value } = body(z.object({ value: z.unknown() }), req);
  await q(`INSERT INTO platform_settings (key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [key, JSON.stringify(value), req.user!.id]);
  await audit('admin.setting_update', { actorId: req.user!.id, actorRole: req.user!.adminRole, entityType: 'setting', entityId: key, data: { value }, req });
  res.status(204).end();
}));

// ── Audit logs, fraud flags, support ──
adminRouter.get('/audit-logs', requirePermission('audit.view'), h(async (req, res) => {
  const p = query(page.extend({ action: z.string().max(60).optional(), entityId: z.string().max(60).optional(), actorId: uuid.optional() }), req);
  res.json(await q(
    `SELECT l.id, l.action, l.entity_type, l.entity_id, l.data, l.ip, l.created_at, l.actor_role, u.name AS actor_name, l.actor_id
       FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id
      WHERE ($1::text IS NULL OR l.action ILIKE $1 || '%') AND ($2::text IS NULL OR l.entity_id = $2) AND ($3::uuid IS NULL OR l.actor_id = $3)
      ORDER BY l.id DESC LIMIT $4 OFFSET $5`, [p.action ?? null, p.entityId ?? null, p.actorId ?? null, p.limit, p.offset]));
}));

adminRouter.get('/fraud-flags', requirePermission('users.view'), h(async (_req, res) => {
  res.json(await q(`SELECT f.*, u.name FROM fraud_flags f JOIN users u ON u.id = f.user_id ORDER BY (f.status = 'OPEN') DESC, f.created_at DESC LIMIT 200`));
}));
adminRouter.patch('/fraud-flags/:id', requirePermission('users.manage'), h(async (req, res) => {
  const b = body(z.object({ status: z.enum(['REVIEWING', 'DISMISSED', 'ACTIONED']) }), req);
  const row = await one(`UPDATE fraud_flags SET status = $2, reviewed_by = $3 WHERE id = $1 RETURNING *`, [uuid.parse(req.params.id), b.status, req.user!.id]);
  if (!row) throw notFound('Flag');
  await audit('admin.fraud_flag_update', { actorId: req.user!.id, actorRole: req.user!.adminRole, entityType: 'fraud_flag', entityId: row.id, data: b, req });
  res.json(row);
}));

adminRouter.post('/announcements', requirePermission('settings.manage'), h(async (req, res) => {
  const b = body(z.object({ title: z.string().min(3).max(80), body: z.string().min(3).max(500), country: country.optional(), audience: z.enum(['all', 'drivers', 'passengers']).default('all') }), req);
  const n = await tx(async (c) => {
    const users = await q(
      `SELECT id FROM users WHERE status = 'ACTIVE' AND ($1::char(2) IS NULL OR country_code = $1)
         AND ($2 = 'all' OR ($2 = 'drivers' AND rides_as_driver > 0) OR ($2 = 'passengers' AND trips_as_passenger > 0)) LIMIT 50000`, [b.country ?? null, b.audience], c);
    for (const u of users) await notify(c, u.id, 'ANNOUNCEMENT', b.title, b.body);
    await audit('admin.announcement', { actorId: req.user!.id, actorRole: req.user!.adminRole, data: { ...b, recipients: users.length }, req, db: c });
    return users.length;
  });
  res.json({ recipients: n });
}));
