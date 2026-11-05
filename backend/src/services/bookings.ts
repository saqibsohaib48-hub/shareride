import { assertBookingTransition, calculateBooking, refundAmount, refundBpsFor, formatMoney, percentOf, BookingStatus, haversineMeters } from '@share-ride/shared';
import { config } from '../config';
import { Db, one, pool, q, tx } from '../db';
import { payments } from '../providers/payments';
import { AppError, badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { audit } from './audit';
import { notify } from './notifications';
import { getCancellationPolicy, getRuleById } from './pricing';
import { processRefund, queueRefund } from './payments';
import { applyCancellationConsequences, recomputeTrustScore } from './users';
import { ensureWallet, moveWallet } from './wallet';

export interface CreateBookingInput {
  rideId: string;
  seats: number;
  pickup: { name: string; lat: number; lng: number };
  dropoff: { name: string; lat: number; lng: number };
  promoCode?: string;
  idempotencyKey: string;
}

const MIN_CHARGE_MINOR = 100; // payment providers can't charge 0; keep at least 1 currency unit

async function resolvePromo(db: Db, code: string, userId: string, countryCode: string, grossMinor: number) {
  const p = await one(`SELECT * FROM promo_codes WHERE upper(code) = upper($1) AND is_active`, [code], db);
  const invalid = () => badRequest('PROMO_INVALID', 'This promo code is not valid for this ride.');
  if (!p) throw invalid();
  const now = new Date();
  if ((p.starts_at && new Date(p.starts_at) > now) || (p.ends_at && new Date(p.ends_at) < now)) throw invalid();
  if (p.country_code && p.country_code !== countryCode) throw invalid();
  if (p.min_ride_minor && grossMinor < p.min_ride_minor) throw invalid();
  if (p.max_redemptions && p.redemptions >= p.max_redemptions) throw invalid();
  if (await one(`SELECT 1 FROM promo_redemptions WHERE promo_code_id = $1 AND user_id = $2`, [p.id, userId], db)) throw invalid();
  if (p.new_users_only && (await one(`SELECT 1 FROM bookings WHERE passenger_id = $1 AND status IN ('CONFIRMED','IN_PROGRESS','COMPLETED')`, [userId], db))) throw invalid();
  let discount = p.discount_type === 'PERCENT' ? percentOf(grossMinor, p.value) : p.value;
  if (p.max_discount_minor) discount = Math.min(discount, p.max_discount_minor);
  return { id: p.id as string, discount };
}

/**
 * Create a booking. Instant-booking rides hold seats immediately (RESERVED, expiring);
 * driver-approval rides create a REQUESTED booking and hold nothing until the driver accepts.
 */
export async function createBooking(passengerId: string, input: CreateBookingInput) {
  const prior = await one(`SELECT id FROM bookings WHERE idempotency_key = $1 AND passenger_id = $2`, [input.idempotencyKey, passengerId]);
  if (prior) return getBooking(prior.id, passengerId);

  const id = await tx(async (c) => {
    // Row lock on the ride serialises concurrent bookings for the same ride.
    const ride = await one(`SELECT r.*, co.booking_enabled, co.women_only_allowed FROM rides r JOIN countries co ON co.code = r.country_code WHERE r.id = $1 FOR UPDATE OF r`, [input.rideId], c);
    if (!ride) throw notFound('Ride');
    const passenger = await one(`SELECT u.status, u.phone_verified_at, p.gender FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`, [passengerId], c);
    if (ride.driver_id === passengerId) throw badRequest('OWN_RIDE', "You can't book your own ride.");
    if (!ride.booking_enabled) throw new AppError(422, 'BOOKINGS_DISABLED', 'Bookings are not available in this country yet.');
    if (passenger.status === 'RESTRICTED') throw forbidden('Your account is temporarily restricted from new bookings.');
    if (!['PUBLISHED', 'DRIVER_READY'].includes(ride.status)) throw conflict('RIDE_UNAVAILABLE', 'This ride is no longer accepting bookings.');
    if (new Date(ride.departure_at) <= new Date()) throw conflict('RIDE_DEPARTED', 'This ride has already departed.');
    if (ride.women_only && (!ride.women_only_allowed || passenger.gender !== 'female')) throw forbidden('This ride is reserved for women passengers.');
    if (input.seats > ride.seats_available) throw conflict('SEATS_UNAVAILABLE', ride.seats_available ? `Only ${ride.seats_available} seat(s) left.` : 'This ride is full.');
    if (await one(`SELECT 1 FROM user_blocks WHERE (blocker_id = $1 AND blocked_id = $2) OR (blocker_id = $2 AND blocked_id = $1)`, [ride.driver_id, passengerId], c)) {
      throw forbidden('This ride is not available to you.');
    }
    const flexOk = haversineMeters(input.pickup, { lat: ride.origin_lat, lng: ride.origin_lng }) <= ride.pickup_flexibility_m;

    const rule = await getRuleById(ride.pricing_rule_id, c);
    const gross = ride.price_per_seat_minor * input.seats;
    let promo: { id: string; discount: number } | null = null;
    if (input.promoCode) promo = await resolvePromo(c, input.promoCode, passengerId, ride.country_code, gross);
    let bd = calculateBooking(rule, ride.price_per_seat_minor, input.seats, 0);
    if (promo) bd = calculateBooking(rule, ride.price_per_seat_minor, input.seats, Math.min(promo.discount, bd.passengerTotalMinor - MIN_CHARGE_MINOR));

    const status: BookingStatus = ride.instant_booking ? 'RESERVED' : 'REQUESTED';
    if (status === 'RESERVED') {
      // Atomic seat hold. The WHERE clause + CHECK(seats_available >= 0) make overbooking impossible.
      const held = await one(`UPDATE rides SET seats_available = seats_available - $2, updated_at = now() WHERE id = $1 AND seats_available >= $2 RETURNING id`, [ride.id, input.seats], c);
      if (!held) throw conflict('SEATS_UNAVAILABLE', 'Sorry, those seats were just taken.');
    }
    const b = await one<{ id: string }>(
      `INSERT INTO bookings (ride_id, passenger_id, status, seats, pickup_name, pickup_lat, pickup_lng, pickup_status,
                             dropoff_name, dropoff_lat, dropoff_lng, currency, price_per_seat_minor, gross_fare_minor,
                             platform_fee_minor, tax_minor, promo_discount_minor, passenger_total_minor, driver_earnings_minor,
                             platform_fee_bps, fee_bearer, promo_code_id, idempotency_key, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,
               CASE WHEN $3 = 'RESERVED' THEN now() + ($24 || ' minutes')::interval END) RETURNING id`,
      [ride.id, passengerId, status, input.seats, input.pickup.name, input.pickup.lat, input.pickup.lng, flexOk ? 'APPROVED' : 'PROPOSED',
       input.dropoff.name, input.dropoff.lat, input.dropoff.lng, bd.currency, bd.pricePerSeatMinor, bd.grossFareMinor,
       bd.platformFeeMinor, bd.taxMinor, bd.promoDiscountMinor, bd.passengerTotalMinor, bd.driverEarningsMinor,
       bd.platformFeeBps, bd.feeBearer, promo?.id ?? null, input.idempotencyKey, String(config.BOOKING_EXPIRY_MINUTES)], c);
    if (status === 'RESERVED') await q(`INSERT INTO ride_seats (ride_id, booking_id, seats, action) VALUES ($1,$2,$3,'HOLD')`, [ride.id, b!.id, input.seats], c);

    if (status === 'REQUESTED') {
      const pName = (await one(`SELECT name FROM users WHERE id = $1`, [passengerId], c)).name.split(' ')[0];
      await notify(c, ride.driver_id, 'RIDE_REQUEST_RECEIVED', `${pName} wants to join your ride`,
        `${ride.origin_name} → ${ride.dest_name} · ${input.seats} passenger${input.seats > 1 ? 's' : ''}`, { bookingId: b!.id, rideId: ride.id });
    }
    await audit('booking.created', { actorId: passengerId, entityType: 'booking', entityId: b!.id, data: { rideId: ride.id, seats: input.seats, status }, db: c });
    return b!.id;
  });
  return getBooking(id, passengerId);
}

/** Driver approval mode (spec §13). Accept → seats held + passenger pays; Decline → nothing captured. */
export async function respondToRequest(bookingId: string, driverId: string, accept: boolean) {
  await tx(async (c) => {
    const b = await one(`SELECT b.*, r.driver_id, r.origin_name, r.dest_name FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE b.id = $1 FOR UPDATE OF b`, [bookingId], c);
    if (!b) throw notFound('Booking');
    if (b.driver_id !== driverId) throw forbidden();
    if (accept) {
      assertBookingTransition(b.status, 'RESERVED');
      const held = await one(`UPDATE rides SET seats_available = seats_available - $2 WHERE id = $1 AND seats_available >= $2 AND status IN ('PUBLISHED','DRIVER_READY') RETURNING id`, [b.ride_id, b.seats], c);
      if (!held) throw conflict('SEATS_UNAVAILABLE', 'Not enough seats left to accept this request.');
      await q(`UPDATE bookings SET status = 'RESERVED', pickup_status = 'APPROVED', expires_at = now() + ($2 || ' minutes')::interval, updated_at = now() WHERE id = $1`, [bookingId, String(config.BOOKING_EXPIRY_MINUTES * 2)], c);
      await q(`INSERT INTO ride_seats (ride_id, booking_id, seats, action) VALUES ($1,$2,$3,'HOLD')`, [b.ride_id, b.id, b.seats], c);
      await notify(c, b.passenger_id, 'RIDE_REQUEST_ACCEPTED', 'Your request was accepted', `Complete payment to confirm your seat on ${b.origin_name} → ${b.dest_name}.`, { bookingId });
    } else {
      assertBookingTransition(b.status, 'DECLINED');
      await q(`UPDATE bookings SET status = 'DECLINED', updated_at = now() WHERE id = $1`, [bookingId], c);
      await notify(c, b.passenger_id, 'RIDE_REQUEST_DECLINED', 'Request declined', `The driver couldn't take you on ${b.origin_name} → ${b.dest_name}. No payment was taken.`, { bookingId });
    }
    await audit(accept ? 'booking.accepted' : 'booking.declined', { actorId: driverId, entityType: 'booking', entityId: bookingId, db: c });
  });
  return getBooking(bookingId, driverId);
}

/** Release a seat hold and void the pending payment. Used for expiry and pre-payment cancellations. */
async function releaseHold(c: Db, b: any, to: BookingStatus) {
  assertBookingTransition(b.status, to);
  if (b.status === 'RESERVED') {
    await q(`UPDATE rides SET seats_available = seats_available + $2 WHERE id = $1`, [b.ride_id, b.seats], c);
    await q(`INSERT INTO ride_seats (ride_id, booking_id, seats, action) VALUES ($1,$2,$3,'RELEASE')`, [b.ride_id, b.id, b.seats], c);
  }
  await q(`UPDATE bookings SET status = $2, expires_at = NULL, cancelled_at = CASE WHEN $2 LIKE 'CANCELLED%' THEN now() END, updated_at = now() WHERE id = $1`, [b.id, to], c);
  const live = await q(`UPDATE payments SET status = 'CANCELLED', updated_at = now() WHERE booking_id = $1 AND status IN ('PENDING','AUTHORIZED') RETURNING provider_payment_id`, [b.id], c);
  return live.map((p) => p.provider_payment_id as string);
}

/** Background job: expire unpaid holds so seats become available again (spec §56). */
export async function expireReservations(): Promise<number> {
  const ids = (await q<{ id: string }>(
    `SELECT id FROM bookings WHERE (status = 'RESERVED' AND expires_at < now())
        OR (status = 'REQUESTED' AND ride_id IN (SELECT id FROM rides WHERE departure_at < now()))
      LIMIT 500`)).map((r) => r.id);
  let n = 0;
  for (const id of ids) {
    const toCancel = await tx(async (c) => {
      const b = await one(`SELECT * FROM bookings WHERE id = $1 FOR UPDATE`, [id], c);
      if (!b || !['RESERVED', 'REQUESTED'].includes(b.status)) return [];
      if (b.status === 'RESERVED' && new Date(b.expires_at) >= new Date()) return [];
      const voided = await releaseHold(c, b, 'EXPIRED');
      await notify(c, b.passenger_id, 'BOOKING_EXPIRED', 'Seat hold expired', 'Your seat was released because payment was not completed. You can book again if seats are available.', { bookingId: id });
      await audit('booking.expired', { entityType: 'booking', entityId: id, db: c });
      n++;
      return voided;
    });
    for (const pid of toCancel) await payments.cancel(pid);
  }
  return n;
}

/** Passenger cancels (spec §18). Unpaid → free. Paid → refund per configurable policy; driver keeps the rest. */
export async function cancelByPassenger(bookingId: string, passengerId: string) {
  const refunds: string[] = [];
  const voided: string[] = [];
  await tx(async (c) => {
    const b = await one(`SELECT b.*, r.driver_id, r.departure_at, r.country_code, r.ride_type, r.origin_name, r.dest_name FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE b.id = $1 FOR UPDATE OF b`, [bookingId], c);
    if (!b) throw notFound('Booking');
    if (b.passenger_id !== passengerId) throw forbidden();

    if (b.status === 'REQUESTED' || b.status === 'RESERVED') {
      voided.push(...(await releaseHold(c, b, 'CANCELLED_BY_PASSENGER')));
    } else {
      assertBookingTransition(b.status, 'CANCELLED_BY_PASSENGER');
      const { policy, thresholds } = await getCancellationPolicy(b.country_code, b.ride_type, c);
      const bps = refundBpsFor(policy, 'PASSENGER', new Date(b.departure_at), new Date());
      const payment = await one(`SELECT id, amount_minor FROM payments WHERE booking_id = $1 AND status IN ('PAID','PARTIALLY_REFUNDED')`, [b.id], c);
      const refund = payment ? refundAmount(payment.amount_minor, bps) : 0;

      await q(`UPDATE rides SET seats_available = seats_available + $2 WHERE id = $1`, [b.ride_id, b.seats], c);
      await q(`INSERT INTO ride_seats (ride_id, booking_id, seats, action) VALUES ($1,$2,$3,'RELEASE')`, [b.ride_id, b.id, b.seats], c);
      await q(`UPDATE bookings SET status = 'CANCELLED_BY_PASSENGER', cancelled_by = 'PASSENGER', refund_bps = $2, cancelled_at = now(), updated_at = now() WHERE id = $1`, [b.id, bps], c);
      if (payment && refund > 0) refunds.push(await queueRefund(c, payment.id, refund, `Passenger cancellation (${bps / 100}% refund)`, passengerId));

      // Driver keeps the non-refunded share of their earnings, proportionally.
      const e = await one(`SELECT * FROM driver_earnings WHERE booking_id = $1 FOR UPDATE`, [b.id], c);
      if (e && payment) {
        const keepBps = 10000 - bps;
        const newNet = percentOf(e.net_minor, keepBps);
        const delta = e.net_minor - newNet;
        await q(`UPDATE driver_earnings SET net_minor = $2::bigint, gross_minor = $3, fee_minor = $4, status = CASE WHEN $2::bigint = 0 THEN 'REVERSED' ELSE 'AVAILABLE' END, available_at = now() WHERE id = $1`,
          [e.id, newNet, percentOf(e.gross_minor, keepBps), percentOf(e.fee_minor, keepBps)], c);
        const w = await ensureWallet(c, b.driver_id, b.currency);
        await moveWallet(c, w, { pending: -e.net_minor, available: newNet }, { type: delta ? 'EARNING_REVERSED' : 'EARNING_RELEASED', amountMinor: -delta, bookingId: b.id, rideId: b.ride_id, description: `Passenger cancelled — you keep ${formatMoney(newNet, b.currency)}` });
      }
      const cnt = (await one(`UPDATE users SET passenger_cancel_count = passenger_cancel_count + 1 WHERE id = $1 RETURNING passenger_cancel_count`, [passengerId], c)).passenger_cancel_count;
      await applyCancellationConsequences(passengerId, cnt, thresholds, c);
      await recomputeTrustScore(passengerId, c);
    }
    await notify(c, b.driver_id, 'RIDE_CANCELLED', 'A passenger cancelled', `${b.seats} seat(s) on ${b.origin_name} → ${b.dest_name} are available again.`, { bookingId, rideId: b.ride_id });
    await audit('booking.cancelled', { actorId: passengerId, entityType: 'booking', entityId: bookingId, db: c });
  });
  for (const pid of voided) await payments.cancel(pid);
  for (const r of refunds) await processRefund(r);
  return getBooking(bookingId, passengerId);
}

export async function getBooking(id: string, viewerId: string, isStaff = false) {
  const b = await one(
    `SELECT b.*, r.driver_id, r.origin_name, r.dest_name, r.departure_at, r.status AS ride_status,
            (SELECT status FROM payments p WHERE p.booking_id = b.id ORDER BY created_at DESC LIMIT 1) AS payment_status,
            (SELECT id FROM ratings WHERE booking_id = b.id AND rater_id = $2) AS my_rating_id
       FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE b.id = $1`, [id, viewerId]);
  if (!b) throw notFound('Booking');
  if (!isStaff && b.passenger_id !== viewerId && b.driver_id !== viewerId) throw notFound('Booking');
  return serializeBooking(b);
}

export function serializeBooking(b: any) {
  return {
    id: b.id, rideId: b.ride_id, status: b.status, seats: b.seats,
    pickup: { name: b.pickup_name, lat: b.pickup_lat, lng: b.pickup_lng }, pickupStatus: b.pickup_status,
    dropoff: { name: b.dropoff_name, lat: b.dropoff_lat, lng: b.dropoff_lng },
    breakdown: {
      currency: b.currency, seats: b.seats, pricePerSeatMinor: b.price_per_seat_minor, grossFareMinor: b.gross_fare_minor,
      platformFeeMinor: b.platform_fee_minor, taxMinor: b.tax_minor, promoDiscountMinor: b.promo_discount_minor,
      passengerTotalMinor: b.passenger_total_minor, driverEarningsMinor: b.driver_earnings_minor,
      platformRevenueMinor: b.platform_fee_minor - b.promo_discount_minor, feeBearer: b.fee_bearer, platformFeeBps: b.platform_fee_bps,
    },
    expiresAt: b.expires_at, paymentStatus: b.payment_status ?? null, refundBps: b.refund_bps,
    createdAt: b.created_at, confirmedAt: b.confirmed_at,
    ride: b.origin_name ? { originName: b.origin_name, destName: b.dest_name, departureAt: b.departure_at, status: b.ride_status, driverId: b.driver_id } : undefined,
    rated: b.my_rating_id ? true : false,
  };
}

/** Passenger trip history (spec §42). */
export async function listMyBookings(passengerId: string, tab: 'upcoming' | 'active' | 'completed' | 'cancelled') {
  const where: Record<typeof tab, string> = {
    upcoming: `b.status IN ('REQUESTED','RESERVED','CONFIRMED') AND r.departure_at > now() - interval '6 hours'`,
    active: `b.status IN ('PASSENGER_PICKUP','IN_PROGRESS')`,
    completed: `b.status IN ('COMPLETED','NO_SHOW','DISPUTED')`,
    cancelled: `b.status IN ('CANCELLED_BY_PASSENGER','CANCELLED_BY_DRIVER','DECLINED','EXPIRED')`,
  };
  const rows = await q(
    `SELECT b.*, r.driver_id, r.origin_name, r.dest_name, r.departure_at, r.status AS ride_status,
            (SELECT status FROM payments p WHERE p.booking_id = b.id ORDER BY created_at DESC LIMIT 1) AS payment_status,
            (SELECT id FROM ratings WHERE booking_id = b.id AND rater_id = $1) AS my_rating_id,
            du.name AS driver_name, du.rating_avg AS driver_rating
       FROM bookings b JOIN rides r ON r.id = b.ride_id JOIN users du ON du.id = r.driver_id
      WHERE b.passenger_id = $1 AND ${where[tab]}
      ORDER BY r.departure_at ${tab === 'upcoming' ? 'ASC' : 'DESC'} LIMIT 100`, [passengerId], pool);
  return rows.map((r) => ({ ...serializeBooking(r), driver: { name: r.driver_name.split(' ')[0], rating: Number(r.driver_rating) } }));
}
