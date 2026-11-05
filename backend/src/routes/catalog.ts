import { Router } from 'express';
import { z } from 'zod';
import { q } from '../db';
import { h, body, query } from '../middleware/http';
import { optionalAuth } from '../middleware/auth';
import { maps } from '../providers/maps';
import { getActiveRule } from '../services/pricing';
import { quoteRide, popularRoutes } from '../services/rides';
import { country, placeSchema, money } from './schemas';

export const catalogRouter = Router();

// ── /countries, /currencies ──
catalogRouter.get('/countries', h(async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(await q(
    `SELECT code, name, currency, distance_unit AS "distanceUnit", default_timezone AS timezone, default_language AS "defaultLanguage",
            ride_creation_enabled AS "rideCreationEnabled", booking_enabled AS "bookingEnabled", women_only_allowed AS "womenOnlyAllowed"
       FROM countries WHERE is_active ORDER BY name`));
}));

catalogRouter.get('/currencies', h(async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(await q(`SELECT code, name, exponent, symbol FROM currencies ORDER BY code`));
}));

/** Display-only FX (spec §29). Rates refreshed by the exchange-rate job; `fetchedAt` lets the UI show staleness. */
catalogRouter.get('/currencies/rates', h(async (req, res) => {
  const { base } = query(z.object({ base: z.string().length(3).default('USD') }), req);
  res.json(await q(`SELECT quote, rate, source, fetched_at AS "fetchedAt" FROM exchange_rates WHERE base = $1`, [base.toUpperCase()]));
}));

/** Detect country from edge headers where available (Cloudflare / Vercel / CloudFront); client may override. */
catalogRouter.get('/countries/detect', h(async (req, res) => {
  const hdr = (req.get('cf-ipcountry') || req.get('x-vercel-ip-country') || req.get('cloudfront-viewer-country') || '').toUpperCase();
  const rows = await q(`SELECT code, currency FROM countries WHERE code = $1 AND is_active`, [hdr]);
  res.json(rows[0] ?? null);
}));

// ── /pricing ──
catalogRouter.get('/pricing/:country', h(async (req, res) => {
  const r = await getActiveRule(country.parse(req.params.country));
  // Public subset only.
  res.json({ countryCode: r.countryCode, currency: r.currency, baseFareMinor: r.baseFareMinor, perKmMinor: r.perKmMinor, minFareMinor: r.minFareMinor, maxFareMinor: r.maxFareMinor, platformFeeBps: r.platformFeeBps, feeBearer: r.feeBearer, minDriverPriceMinor: r.minDriverPriceMinor, maxDriverPriceMinor: r.maxDriverPriceMinor });
}));

// ── /routes ──
catalogRouter.get('/routes/places', h(async (req, res) => {
  const p = query(z.object({ q: z.string().trim().min(2).max(100), country: country.optional(), lat: z.coerce.number().optional(), lng: z.coerce.number().optional() }), req);
  res.json(await maps.searchPlaces(p.q, p.country, p.lat !== undefined && p.lng !== undefined ? { lat: p.lat, lng: p.lng } : undefined));
}));

catalogRouter.post('/routes/quote', optionalAuth, h(async (req, res) => {
  const b = body(z.object({ countryCode: country, origin: placeSchema, destination: placeSchema, seats: z.number().int().min(1).max(14).default(1), pricePerSeatMinor: money.optional() }), req);
  res.json(await quoteRide(b.countryCode, b.origin, b.destination, b.seats, b.pricePerSeatMinor));
}));

catalogRouter.get('/routes/popular', h(async (req, res) => {
  const { country: c } = query(z.object({ country }), req);
  res.json(await popularRoutes(c));
}));
