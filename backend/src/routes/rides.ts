import { Router } from 'express';
import { z } from 'zod';
import { h, body, query } from '../middleware/http';
import { optionalAuth, requireAuth } from '../middleware/auth';
import * as rides from '../services/rides';
import { boolish, country, money, placeSchema, uuid } from './schemas';

export const ridesRouter = Router();

ridesRouter.get('/rides/search', optionalAuth, h(async (req, res) => {
  const p = query(z.object({
    fromLat: z.coerce.number().min(-90).max(90), fromLng: z.coerce.number().min(-180).max(180),
    toLat: z.coerce.number().min(-90).max(90), toLng: z.coerce.number().min(-180).max(180),
    departAfter: z.string().datetime({ offset: true }), departBefore: z.string().datetime({ offset: true }),
    time: z.string().datetime({ offset: true }).optional(),
    seats: z.coerce.number().int().min(1).max(8).default(1),
    womenOnly: boolish.optional(), pets: boolish.optional(), luggage: boolish.optional(), smoking: boolish.optional(),
    vehicleType: z.string().max(20).optional(),
    sort: z.enum(['best', 'cheapest', 'earliest', 'closest', 'rating', 'shortest']).default('best'),
    limit: z.coerce.number().int().min(1).max(50).default(30),
  }).refine((x) => new Date(x.departBefore).getTime() - new Date(x.departAfter).getTime() <= 8 * 86400_000, 'Search window too large'), req);
  res.json(await rides.searchRides({
    origin: { lat: p.fromLat, lng: p.fromLng }, destination: { lat: p.toLat, lng: p.toLng },
    departAfter: p.departAfter, departBefore: p.departBefore, preferredTime: p.time, seats: p.seats,
    womenOnly: p.womenOnly, pets: p.pets, luggage: p.luggage, smoking: p.smoking, vehicleType: p.vehicleType, sort: p.sort, limit: p.limit,
  }, req.user?.id));
}));

ridesRouter.post('/rides', requireAuth, h(async (req, res) => {
  const b = body(z.object({
    countryCode: country, origin: placeSchema, destination: placeSchema,
    departureAt: z.string().datetime({ offset: true }),
    seats: z.number().int().min(1).max(14), pricePerSeatMinor: money, vehicleId: uuid,
    instantBooking: z.boolean().default(true), luggageAllowed: z.boolean().default(true), petsAllowed: z.boolean().default(false),
    smokingAllowed: z.boolean().default(false), womenOnly: z.boolean().default(false),
    pickupFlexibilityM: z.number().int().min(0).max(20000).default(2000), notes: z.string().max(500).optional(),
  }), req);
  res.status(201).json(await rides.createRide(req.user!.id, b));
}));

ridesRouter.get('/rides/mine', requireAuth, h(async (req, res) => {
  const { tab } = query(z.object({ tab: z.enum(['upcoming', 'active', 'completed', 'cancelled']).default('upcoming') }), req);
  res.json(await rides.listDriverRides(req.user!.id, tab));
}));

ridesRouter.get('/rides/:id', optionalAuth, h(async (req, res) => { res.json(await rides.getRide(uuid.parse(req.params.id), req.user?.id)); }));
ridesRouter.post('/rides/:id/start', requireAuth, h(async (req, res) => { res.json(await rides.startRide(uuid.parse(req.params.id), req.user!.id)); }));
ridesRouter.post('/rides/:id/complete', requireAuth, h(async (req, res) => { res.json(await rides.completeRide(uuid.parse(req.params.id), req.user!.id)); }));
ridesRouter.post('/rides/:id/cancel', requireAuth, h(async (req, res) => { res.json(await rides.cancelRide(uuid.parse(req.params.id), req.user!.id)); }));
