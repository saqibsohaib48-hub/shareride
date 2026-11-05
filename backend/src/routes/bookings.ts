import { Router } from 'express';
import { z } from 'zod';
import { h, body, query } from '../middleware/http';
import { requireAuth } from '../middleware/auth';
import * as bookings from '../services/bookings';
import { startCheckout, simulateMockPayment } from '../services/payments';
import { earningsSummary, submitRating, walletTransactions } from '../services/earnings';
import { placeSchema, uuid } from './schemas';

export const bookingsRouter = Router();

bookingsRouter.post('/bookings', requireAuth, h(async (req, res) => {
  const b = body(z.object({
    rideId: uuid, seats: z.number().int().min(1).max(8), pickup: placeSchema, dropoff: placeSchema,
    promoCode: z.string().trim().max(40).optional(),
    idempotencyKey: z.string().min(8).max(100),
  }), req);
  res.status(201).json(await bookings.createBooking(req.user!.id, b));
}));

bookingsRouter.get('/bookings', requireAuth, h(async (req, res) => {
  const { tab } = query(z.object({ tab: z.enum(['upcoming', 'active', 'completed', 'cancelled']).default('upcoming') }), req);
  res.json(await bookings.listMyBookings(req.user!.id, tab));
}));

bookingsRouter.get('/bookings/:id', requireAuth, h(async (req, res) => { res.json(await bookings.getBooking(uuid.parse(req.params.id), req.user!.id)); }));
bookingsRouter.post('/bookings/:id/accept', requireAuth, h(async (req, res) => { res.json(await bookings.respondToRequest(uuid.parse(req.params.id), req.user!.id, true)); }));
bookingsRouter.post('/bookings/:id/decline', requireAuth, h(async (req, res) => { res.json(await bookings.respondToRequest(uuid.parse(req.params.id), req.user!.id, false)); }));
bookingsRouter.post('/bookings/:id/cancel', requireAuth, h(async (req, res) => { res.json(await bookings.cancelByPassenger(uuid.parse(req.params.id), req.user!.id)); }));

// ── /payments ── checkout returns a client secret for the provider's hosted UI. Confirmation arrives ONLY via webhook.
bookingsRouter.post('/payments/checkout', requireAuth, h(async (req, res) => {
  const b = body(z.object({ bookingId: uuid }), req);
  res.json(await startCheckout(b.bookingId, req.user!.id));
}));

/** DEV/TEST ONLY (404 in production): stands in for the card form when PAYMENT_PROVIDER=mock. */
bookingsRouter.post('/payments/mock/complete', requireAuth, h(async (req, res) => {
  const b = body(z.object({ paymentId: uuid, outcome: z.enum(['succeeded', 'failed']).default('succeeded') }), req);
  res.json(await simulateMockPayment(b.paymentId, req.user!.id, b.outcome));
}));

// ── /earnings, /wallet, /ratings ──
bookingsRouter.get('/earnings', requireAuth, h(async (req, res) => { res.json(await earningsSummary(req.user!.id)); }));
bookingsRouter.get('/wallet/transactions', requireAuth, h(async (req, res) => { res.json(await walletTransactions(req.user!.id)); }));

bookingsRouter.post('/ratings', requireAuth, h(async (req, res) => {
  const cat = z.number().int().min(1).max(5).optional();
  const b = body(z.object({
    bookingId: uuid, stars: z.number().int().min(1).max(5), comment: z.string().max(1000).optional(),
    categories: z.object({ communication: cat, punctuality: cat, cleanliness: cat, safety: cat, respect: cat }).optional(),
  }), req);
  res.status(201).json(await submitRating(req.user!.id, b));
}));
