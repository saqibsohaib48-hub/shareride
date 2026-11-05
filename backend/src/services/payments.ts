import { assertBookingTransition, assertPaymentTransition, BookingStatus, PaymentStatus } from '@share-ride/shared';
import { config } from '../config';
import { Db, one, pool, q, tx } from '../db';
import { payments, NormalisedEvent, MockProvider } from '../providers/payments';
import { AppError, notFound, forbidden } from '../utils/errors';
import { logger } from '../utils/logger';
import { audit } from './audit';
import { notify } from './notifications';
import { ensureWallet, moveWallet } from './wallet';
import { formatMoney } from '@share-ride/shared';

/** Passenger starts checkout for a RESERVED booking. Returns the provider client secret for the hosted payment UI. */
export async function startCheckout(bookingId: string, userId: string) {
  const b = await one(`SELECT b.*, r.origin_name, r.dest_name FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE b.id = $1`, [bookingId]);
  if (!b) throw notFound('Booking');
  if (b.passenger_id !== userId) throw forbidden();
  if (b.status !== 'RESERVED') throw new AppError(409, 'NOT_PAYABLE', b.status === 'REQUESTED' ? 'Waiting for the driver to accept your request.' : 'This booking can no longer be paid.');
  if (new Date(b.expires_at) < new Date()) throw new AppError(409, 'RESERVATION_EXPIRED', 'Your seat hold has expired. Please book again.');

  // Supersede any live payment for this booking so only one can ever be captured (unique index enforces it).
  // If the old one is captured anyway (race), the webhook refunds it automatically.
  const existing = await one(`SELECT id, provider_payment_id FROM payments WHERE booking_id = $1 AND status IN ('PENDING','AUTHORIZED')`, [bookingId]);
  if (existing) await payments.cancel(existing.provider_payment_id).then(() =>
    q(`UPDATE payments SET status = 'CANCELLED', updated_at = now() WHERE id = $1`, [existing.id]));

  const attempt = (await one<{ n: number }>(`SELECT count(*)::int AS n FROM payments WHERE booking_id = $1`, [bookingId]))!.n;
  const created = await payments.createPayment({
    bookingId,
    amountMinor: b.passenger_total_minor,           // amount is ALWAYS taken from the server-side snapshot
    currency: b.currency,
    description: `Share Ride ${b.origin_name} → ${b.dest_name}`,
    idempotencyKey: `booking:${bookingId}:attempt:${attempt}`,
  });
  const p = await one<{ id: string }>(
    `INSERT INTO payments (booking_id, provider, provider_payment_id, amount_minor, currency) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [bookingId, payments.name, created.providerPaymentId, b.passenger_total_minor, b.currency]);
  await audit('payment.created', { actorId: userId, entityType: 'payment', entityId: p!.id, data: { bookingId, amount: b.passenger_total_minor } });
  return {
    paymentId: p!.id,
    provider: payments.name,
    clientSecret: created.clientSecret,
    amountMinor: b.passenger_total_minor,
    currency: b.currency,
    expiresAt: b.expires_at,
  };
}

/**
 * Webhook processing — the ONLY place a booking becomes CONFIRMED (spec §56).
 * Idempotent: each provider event id is processed once; replays are no-ops.
 */
export async function handlePaymentEvent(ev: NormalisedEvent): Promise<{ processed: boolean }> {
  const inserted = await one(`INSERT INTO payment_events (id, provider, type, payload) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING RETURNING id`,
    [ev.eventId, payments.name, ev.kind, JSON.stringify(ev.raw)]);
  if (!inserted) return { processed: false };
  if (ev.kind === 'ignored') { await q(`UPDATE payment_events SET processed_at = now() WHERE id = $1`, [ev.eventId]); return { processed: true }; }

  const refundsToProcess: string[] = [];
  let mismatch: { passengerId: string; details: unknown } | null = null;
  await tx(async (c) => {
    const p = await one(`SELECT * FROM payments WHERE provider_payment_id = $1 FOR UPDATE`, [ev.providerPaymentId], c);
    if (!p) { logger.warn({ ev: ev.eventId }, 'webhook for unknown payment'); return; }
    const b = await one(`SELECT * FROM bookings WHERE id = $1 FOR UPDATE`, [p.booking_id], c);

    if (ev.kind === 'failed' || ev.kind === 'cancelled') {
      const to: PaymentStatus = ev.kind === 'failed' ? 'FAILED' : 'CANCELLED';
      if (p.status === to) return;
      assertPaymentTransition(p.status, to);
      await q(`UPDATE payments SET status = $2, failure_reason = $3, updated_at = now() WHERE id = $1`, [p.id, to, ev.failureReason ?? null], c);
      await audit('payment.failed', { entityType: 'payment', entityId: p.id, data: { reason: ev.failureReason }, db: c });
      // Booking stays RESERVED until expiry so the passenger can retry; the expiry job releases the seat.
      return;
    }
    if (ev.kind === 'authorized') {
      if (p.status === 'PENDING') await q(`UPDATE payments SET status = 'AUTHORIZED', updated_at = now() WHERE id = $1`, [p.id], c);
      return;
    }

    // succeeded — verify amount & currency against our snapshot (payment-manipulation defence).
    if (ev.amountMinor !== p.amount_minor || ev.currency !== p.currency) {
      mismatch = { passengerId: b.passenger_id, details: { paymentId: p.id, expected: p.amount_minor, got: ev.amountMinor, currency: ev.currency } };
      return; // nothing is confirmed; the flag is written after this transaction
    }
    if (p.status === 'PAID') return;
    if (p.status === 'CANCELLED' || p.status === 'FAILED') {
      // Money captured on a payment we already abandoned (e.g. a stale retry) → refund it fully.
      await q(`UPDATE payments SET status = 'PAID', updated_at = now() WHERE id = $1`, [p.id], c);
      refundsToProcess.push(await queueRefund(c, p.id, p.amount_minor, 'Duplicate/abandoned payment', null));
      return;
    }
    assertPaymentTransition(p.status, 'PAID');
    await q(`UPDATE payments SET status = 'PAID', updated_at = now() WHERE id = $1`, [p.id], c);

    if (b.status === 'RESERVED') {
      await confirmBooking(c, b);
    } else if (b.status === 'EXPIRED') {
      // Paid after the hold expired: confirm if the seat is still free, otherwise refund in full.
      const got = await one(`UPDATE rides SET seats_available = seats_available - $2 WHERE id = $1 AND seats_available >= $2 AND status IN ('PUBLISHED','DRIVER_READY') RETURNING id`, [b.ride_id, b.seats], c);
      if (got) {
        await q(`UPDATE bookings SET status = 'RESERVED' WHERE id = $1`, [b.id], c);
        await q(`INSERT INTO ride_seats (ride_id, booking_id, seats, action) VALUES ($1,$2,$3,'HOLD')`, [b.ride_id, b.id, b.seats], c);
        await confirmBooking(c, { ...b, status: 'RESERVED' });
      } else {
        refundsToProcess.push(await queueRefund(c, p.id, p.amount_minor, 'Seat no longer available after payment', null));
        await notify(c, b.passenger_id, 'REFUND_ISSUED', 'Seat no longer available', 'Your seat hold expired before payment completed and the ride is now full. You will receive a full refund.', { bookingId: b.id });
      }
    } else {
      refundsToProcess.push(await queueRefund(c, p.id, p.amount_minor, `Payment for booking in status ${b.status}`, null));
    }
  });
  if (mismatch) {
    const m = mismatch as { passengerId: string; details: unknown };
    await q(`INSERT INTO fraud_flags (user_id, kind, severity, details) VALUES ($1,'PAYMENT_AMOUNT_MISMATCH','HIGH',$2)`, [m.passengerId, JSON.stringify(m.details)]);
    await audit('payment.amount_mismatch', { entityType: 'payment', data: m.details });
    throw new AppError(400, 'AMOUNT_MISMATCH', 'Payment amount mismatch');
  }
  await q(`UPDATE payment_events SET processed_at = now() WHERE id = $1`, [ev.eventId]);
  for (const r of refundsToProcess) await processRefund(r);
  return { processed: true };
}

async function confirmBooking(c: Db, b: any) {
  assertBookingTransition(b.status as BookingStatus, 'CONFIRMED');
  await q(`UPDATE bookings SET status = 'CONFIRMED', confirmed_at = now(), expires_at = NULL, updated_at = now() WHERE id = $1`, [b.id], c);
  await q(`INSERT INTO ride_seats (ride_id, booking_id, seats, action) VALUES ($1,$2,$3,'ALLOCATE')`, [b.ride_id, b.id, b.seats], c);
  const ride = await one(`SELECT driver_id, origin_name, dest_name, departure_at FROM rides WHERE id = $1`, [b.ride_id], c);

  // Earnings are recorded as PENDING and released when the ride completes.
  await q(`INSERT INTO driver_earnings (driver_id, booking_id, ride_id, currency, gross_minor, fee_minor, tax_minor, net_minor)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [ride.driver_id, b.id, b.ride_id, b.currency, b.gross_fare_minor, b.platform_fee_minor, b.tax_minor, b.driver_earnings_minor], c);
  const wallet = await ensureWallet(c, ride.driver_id, b.currency);
  await moveWallet(c, wallet, { pending: b.driver_earnings_minor }, {
    type: 'EARNING_PENDING', amountMinor: b.driver_earnings_minor, bookingId: b.id, rideId: b.ride_id,
    description: `Booking ${ride.origin_name} → ${ride.dest_name} (${b.seats} seat${b.seats > 1 ? 's' : ''})`,
  });
  if (b.promo_code_id) {
    await q(`INSERT INTO promo_redemptions (promo_code_id, user_id, booking_id, discount_minor) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [b.promo_code_id, b.passenger_id, b.id, b.promo_discount_minor], c);
    await q(`UPDATE promo_codes SET redemptions = redemptions + 1 WHERE id = $1`, [b.promo_code_id], c);
  }
  const route = `${ride.origin_name} → ${ride.dest_name}`;
  await notify(c, b.passenger_id, 'PAYMENT_SUCCESSFUL', 'Ride Request Confirmed', `You're booked on ${route}. Paid ${formatMoney(b.passenger_total_minor, b.currency)}.`, { bookingId: b.id, rideId: b.ride_id });
  await notify(c, ride.driver_id, 'PAYMENT_RECEIVED', 'New passenger confirmed', `${b.seats} seat(s) booked on ${route}. You'll earn ${formatMoney(b.driver_earnings_minor, b.currency)}.`, { bookingId: b.id, rideId: b.ride_id });
  await audit('booking.confirmed', { entityType: 'booking', entityId: b.id, data: { paid: b.passenger_total_minor }, db: c });
}

/** Record a refund inside the caller's transaction. Call `processRefund` after commit to execute it with the provider. */
export async function queueRefund(c: Db, paymentId: string, amountMinor: number, reason: string, initiatedBy: string | null): Promise<string> {
  const p = await one(`SELECT amount_minor, refunded_minor FROM payments WHERE id = $1 FOR UPDATE`, [paymentId], c);
  const pendingRefunds = (await one<{ s: number }>(`SELECT COALESCE(sum(amount_minor),0)::bigint AS s FROM refunds WHERE payment_id = $1 AND status = 'PENDING'`, [paymentId], c))!.s;
  const refundable = p.amount_minor - p.refunded_minor - Number(pendingRefunds);
  const amount = Math.min(amountMinor, refundable);
  if (amount <= 0) throw new AppError(409, 'NOTHING_TO_REFUND', 'This payment has already been fully refunded.');
  const r = await one<{ id: string }>(`INSERT INTO refunds (payment_id, amount_minor, reason, initiated_by) VALUES ($1,$2,$3,$4) RETURNING id`, [paymentId, amount, reason, initiatedBy], c);
  await audit('refund.queued', { actorId: initiatedBy, entityType: 'refund', entityId: r!.id, data: { paymentId, amount, reason }, db: c });
  return r!.id;
}

/** Execute a queued refund with the provider. Safe to retry (idempotency key = refund id). */
export async function processRefund(refundId: string): Promise<void> {
  const r = await one(`SELECT r.*, p.provider_payment_id, p.booking_id, p.currency FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE r.id = $1`, [refundId]);
  if (!r || r.status !== 'PENDING') return;
  try {
    const { providerRefundId } = await payments.refund(r.provider_payment_id, r.amount_minor, `refund:${refundId}`);
    await tx(async (c) => {
      const p = await one(`SELECT * FROM payments WHERE id = $1 FOR UPDATE`, [r.payment_id], c);
      const refunded = p.refunded_minor + r.amount_minor;
      const status: PaymentStatus = refunded >= p.amount_minor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
      await q(`UPDATE payments SET refunded_minor = $2, status = $3, updated_at = now() WHERE id = $1`, [p.id, refunded, status], c);
      await q(`UPDATE refunds SET status = 'SUCCEEDED', provider_refund_id = $2 WHERE id = $1`, [refundId, providerRefundId], c);
      const b = await one(`SELECT passenger_id FROM bookings WHERE id = $1`, [r.booking_id], c);
      await notify(c, b.passenger_id, 'REFUND_ISSUED', 'Refund issued', `${formatMoney(r.amount_minor, r.currency)} is on its way back to your payment method.`, { bookingId: r.booking_id });
      await audit('refund.succeeded', { entityType: 'refund', entityId: refundId, data: { amount: r.amount_minor }, db: c });
    });
  } catch (err) {
    // Stays PENDING; the retry job picks it up. Admin sees it in the dashboard.
    logger.error({ err, refundId }, 'refund failed');
  }
}

/** DEV ONLY: simulate the provider confirming (or declining) a payment — goes through the real webhook path. */
export async function simulateMockPayment(paymentId: string, userId: string, outcome: 'succeeded' | 'failed') {
  if (config.NODE_ENV === 'production' || !(payments instanceof MockProvider)) throw notFound();
  const p = await one(`SELECT p.*, b.passenger_id FROM payments p JOIN bookings b ON b.id = p.booking_id WHERE p.id = $1`, [paymentId], pool);
  if (!p) throw notFound('Payment');
  if (p.passenger_id !== userId) throw forbidden();
  const { body, signature } = payments.buildEvent(outcome, p.provider_payment_id, p.amount_minor, p.currency);
  const ev = payments.parseWebhook(Buffer.from(body), { 'x-mock-signature': signature });
  return handlePaymentEvent(ev);
}
