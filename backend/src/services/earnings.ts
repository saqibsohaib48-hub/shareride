import { one, q, tx } from '../db';
import { AppError, badRequest, forbidden, notFound } from '../utils/errors';
import { audit } from './audit';
import { notify } from './notifications';
import { recomputeTrustScore } from './users';

/** Driver earnings dashboard (spec §15, §58). Periods use the driver's country timezone. */
export async function earningsSummary(driverId: string) {
  const tz = (await one(`SELECT COALESCE(c.default_timezone,'UTC') AS tz FROM users u LEFT JOIN countries c ON c.code = u.country_code WHERE u.id = $1`, [driverId]))?.tz ?? 'UTC';
  const totals = await q(
    `SELECT currency,
            COALESCE(sum(net_minor) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2),0)::bigint AS today,
            COALESCE(sum(net_minor) FILTER (WHERE created_at >= date_trunc('week', now() AT TIME ZONE $2) AT TIME ZONE $2),0)::bigint AS week,
            COALESCE(sum(net_minor) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE $2) AT TIME ZONE $2),0)::bigint AS month,
            COALESCE(sum(net_minor),0)::bigint AS total,
            COALESCE(sum(fee_minor),0)::bigint AS fees_total
       FROM driver_earnings WHERE driver_id = $1 AND status <> 'REVERSED' GROUP BY currency`, [driverId, tz]);
  const wallets = await q(`SELECT currency, available_minor, pending_minor, withdrawn_minor FROM wallets WHERE user_id = $1`, [driverId]);
  const recent = await q(
    `SELECT e.id, e.booking_id, e.ride_id, e.currency, e.gross_minor, e.fee_minor, e.tax_minor, e.net_minor, e.status, e.created_at,
            r.origin_name, r.dest_name, r.departure_at, b.seats
       FROM driver_earnings e JOIN rides r ON r.id = e.ride_id JOIN bookings b ON b.id = e.booking_id
      WHERE e.driver_id = $1 ORDER BY e.created_at DESC LIMIT 50`, [driverId]);
  return {
    timezone: tz,
    totals: totals.map((t) => ({ currency: t.currency, todayMinor: t.today, weekMinor: t.week, monthMinor: t.month, totalMinor: t.total, feesTotalMinor: t.fees_total })),
    wallets: wallets.map((w) => ({ currency: w.currency, availableMinor: w.available_minor, pendingMinor: w.pending_minor, withdrawnMinor: w.withdrawn_minor })),
    items: recent.map((e) => ({
      id: e.id, bookingId: e.booking_id, rideId: e.ride_id, route: `${e.origin_name} → ${e.dest_name}`, departureAt: e.departure_at, seats: e.seats,
      currency: e.currency, passengerPaidMinor: e.gross_minor, platformFeeMinor: e.fee_minor, taxMinor: e.tax_minor, yourEarningsMinor: e.net_minor,
      status: e.status, createdAt: e.created_at,
    })),
  };
}

export async function walletTransactions(userId: string) {
  return q(
    `SELECT t.id, t.created_at AS date, t.ride_id AS "rideId", t.booking_id AS "bookingId", t.description, t.amount_minor AS "amountMinor", t.type, t.status, w.currency
       FROM wallet_transactions t JOIN wallets w ON w.id = t.wallet_id WHERE w.user_id = $1 ORDER BY t.created_at DESC LIMIT 100`, [userId]);
}

/** Ratings (spec §20): both sides rate after a COMPLETED booking; one rating per rater per booking. */
export async function submitRating(raterId: string, input: { bookingId: string; stars: number; comment?: string; categories?: Partial<Record<'communication' | 'punctuality' | 'cleanliness' | 'safety' | 'respect', number>> }) {
  return tx(async (c) => {
    const b = await one(`SELECT b.id, b.status, b.passenger_id, b.ride_id, r.driver_id FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE b.id = $1`, [input.bookingId], c);
    if (!b) throw notFound('Booking');
    if (b.status !== 'COMPLETED') throw new AppError(409, 'NOT_COMPLETED', 'You can rate a trip once it is completed.');
    let rateeId: string, role: 'DRIVER' | 'PASSENGER';
    if (raterId === b.passenger_id) { rateeId = b.driver_id; role = 'DRIVER'; }
    else if (raterId === b.driver_id) { rateeId = b.passenger_id; role = 'PASSENGER'; }
    else throw forbidden();
    if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) throw badRequest('STARS_INVALID', 'Please choose 1 to 5 stars.');
    const cat = input.categories ?? {};
    const r = await one<{ id: string }>(
      `INSERT INTO ratings (booking_id, ride_id, rater_id, ratee_id, ratee_role, stars, communication, punctuality, cleanliness, safety, respect)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [b.id, b.ride_id, raterId, rateeId, role, input.stars, cat.communication ?? null, cat.punctuality ?? null, cat.cleanliness ?? null, cat.safety ?? null, cat.respect ?? null], c);
    if (input.comment?.trim()) await q(`INSERT INTO reviews (rating_id, comment) VALUES ($1,$2)`, [r!.id, input.comment.trim().slice(0, 1000)], c);
    // Incremental average under the row lock taken by UPDATE.
    await q(`UPDATE users SET rating_avg = round(((rating_avg * rating_count) + $2)::numeric / (rating_count + 1), 2), rating_count = rating_count + 1 WHERE id = $1`, [rateeId, input.stars], c);
    await recomputeTrustScore(rateeId, c);
    await notify(c, rateeId, 'ACCOUNT', 'You received a new rating', `${'★'.repeat(input.stars)}${'☆'.repeat(5 - input.stars)}`, { rideId: b.ride_id });
    await audit('rating.created', { actorId: raterId, entityType: 'rating', entityId: r!.id, data: { stars: input.stars }, db: c });
    return { id: r!.id };
  });
}
