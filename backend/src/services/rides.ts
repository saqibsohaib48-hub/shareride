import {
  assertRideTransition, decodePolyline, sampleRoute, boundingBox, matchRoute, rankScore, validateDriverPrice,
  formatMoney, RideSummary, RideStatus, DEFAULT_MATCH_OPTIONS, LatLng,
} from '@share-ride/shared';
import { one, pool, q, tx } from '../db';
import { maps } from '../providers/maps';
import { payments } from '../providers/payments';
import { AppError, badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { audit } from './audit';
import { notify } from './notifications';
import { getActiveRule, getCancellationPolicy, suggest, earningsPreview } from './pricing';
import { processRefund, queueRefund } from './payments';
import { toPublicUser, applyCancellationConsequences, recomputeTrustScore } from './users';
import { ensureWallet, moveWallet } from './wallet';

interface PlaceIn { name: string; lat: number; lng: number }

/** Pricing preview for Create Ride (spec §10, §39): road route → suggested price → earnings. */
export async function quoteRide(countryCode: string, origin: PlaceIn, destination: PlaceIn, seats: number, pricePerSeatMinor?: number) {
  const rule = await getActiveRule(countryCode);
  const route = await maps.route(origin, destination);
  const s = await suggest(rule, route.distanceMeters);
  const price = pricePerSeatMinor ?? s.recommendedMinor;
  const valid = validateDriverPrice(rule, price);
  const full = earningsPreview(rule, price, seats);
  return {
    currency: rule.currency,
    route: { distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, polyline: route.polyline, approximate: route.approximate, provider: route.provider },
    suggestion: s,
    pricePerSeatMinor: price,
    priceValid: valid.ok,
    priceError: valid.ok ? null : valid.reason,
    fullRide: { seats, grossMinor: full.grossFareMinor, platformFeeMinor: full.platformFeeMinor, taxMinor: full.taxMinor, driverEarningsMinor: full.driverEarningsMinor },
    perPassenger: earningsPreview(rule, price, 1),
    platformFeeBps: rule.platformFeeBps,
    feeBearer: rule.feeBearer,
  };
}

export interface CreateRideInput {
  countryCode: string;
  origin: PlaceIn;
  destination: PlaceIn;
  departureAt: string;
  seats: number;
  pricePerSeatMinor: number;
  vehicleId: string;
  instantBooking: boolean;
  luggageAllowed: boolean;
  petsAllowed: boolean;
  smokingAllowed: boolean;
  womenOnly: boolean;
  pickupFlexibilityM: number;
  notes?: string;
}

export async function createRide(driverId: string, input: CreateRideInput) {
  const country = await one(`SELECT * FROM countries WHERE code = $1 AND is_active`, [input.countryCode]);
  if (!country?.ride_creation_enabled) throw new AppError(422, 'RIDES_DISABLED', 'Creating rides is not available in this country yet.');
  const driver = await one(`SELECT u.*, p.gender FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE u.id = $1`, [driverId]);
  if (driver.status === 'RESTRICTED') throw forbidden('Your account is temporarily restricted from creating rides.');

  // Country-configurable verification requirements (spec §7).
  const required: string[] = country.verification_requirements?.driver ?? ['phone'];
  const have: Record<string, boolean> = { phone: !!driver.phone_verified_at, email: !!driver.email_verified_at, identity: !!driver.identity_verified_at, driver: !!driver.driver_verified_at };
  const missing = required.filter((r) => !have[r]);
  if (missing.length) throw new AppError(403, 'VERIFICATION_REQUIRED', 'Please complete verification before offering rides.', { missing });

  const vehicle = await one(`SELECT * FROM vehicles WHERE id = $1 AND owner_id = $2 AND is_active`, [input.vehicleId, driverId]);
  if (!vehicle) throw badRequest('VEHICLE_INVALID', 'Please choose one of your vehicles.');
  if (required.includes('driver') && vehicle.verification_status !== 'VERIFIED') throw new AppError(403, 'VEHICLE_NOT_VERIFIED', 'This vehicle needs to be verified first.');
  if (input.seats > vehicle.seats - 1) throw badRequest('TOO_MANY_SEATS', `This vehicle can take at most ${vehicle.seats - 1} passengers.`);
  if (input.womenOnly && !(country.women_only_allowed && driver.gender === 'female')) throw badRequest('WOMEN_ONLY_UNAVAILABLE', 'Women-only rides are not available for this account or country.');

  const departure = new Date(input.departureAt);
  if (departure.getTime() < Date.now() + 15 * 60_000) throw badRequest('DEPARTURE_TOO_SOON', 'Departure must be at least 15 minutes from now.');
  if (departure.getTime() > Date.now() + 90 * 86400_000) throw badRequest('DEPARTURE_TOO_FAR', 'Rides can be scheduled up to 90 days ahead.');

  const rule = await getActiveRule(input.countryCode);
  const v = validateDriverPrice(rule, input.pricePerSeatMinor);
  if (!v.ok) throw badRequest(v.reason, 'Please choose a price within the allowed range.');

  // Pricing uses ROAD distance from the maps provider — never straight-line.
  const route = await maps.route(input.origin, input.destination);
  const s = await suggest(rule, route.distanceMeters);
  const points = sampleRoute(decodePolyline(route.polyline), 200);
  const bbox = boundingBox(points);
  const arrival = new Date(departure.getTime() + route.durationSeconds * 1000);

  const id = await tx(async (c) => {
    const r = await one<{ id: string }>(
      `INSERT INTO rides (driver_id, vehicle_id, country_code, currency, pricing_rule_id, status, origin_name, origin_lat, origin_lng,
                          dest_name, dest_lat, dest_lng, departure_at, arrival_estimate_at, distance_meters, duration_seconds,
                          seats_total, seats_available, price_per_seat_minor, suggested_price_minor, instant_booking,
                          luggage_allowed, pets_allowed, smoking_allowed, women_only, pickup_flexibility_m, notes)
       VALUES ($1,$2,$3,$4,$5,'PUBLISHED',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING id`,
      [driverId, vehicle.id, input.countryCode, rule.currency, rule.id, input.origin.name, input.origin.lat, input.origin.lng,
       input.destination.name, input.destination.lat, input.destination.lng, departure, arrival, route.distanceMeters, route.durationSeconds,
       input.seats, input.pricePerSeatMinor, s.recommendedMinor, input.instantBooking, input.luggageAllowed, input.petsAllowed,
       input.smokingAllowed, input.womenOnly, input.pickupFlexibilityM, input.notes ?? null], c);
    await q(`INSERT INTO ride_routes (ride_id, provider, polyline, points, min_lat, max_lat, min_lng, max_lng, is_approximate) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [r!.id, route.provider, route.polyline, JSON.stringify(points), bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng, route.approximate], c);
    await q(`INSERT INTO ride_stops (ride_id, seq, name, lat, lng) VALUES ($1,0,$2,$3,$4), ($1,1,$5,$6,$7)`,
      [r!.id, input.origin.name, input.origin.lat, input.origin.lng, input.destination.name, input.destination.lat, input.destination.lng], c);
    await audit('ride.created', { actorId: driverId, entityType: 'ride', entityId: r!.id, data: { price: input.pricePerSeatMinor, seats: input.seats, distance: route.distanceMeters }, db: c });
    return r!.id;
  });
  return getRide(id, driverId);
}

const RIDE_SELECT = `
  SELECT r.*, rr.polyline, rr.points,
         v.make, v.model, v.color, v.vehicle_type, v.license_plate,
         u.id AS d_id, u.name AS d_name, u.rating_avg AS d_rating_avg, u.rating_count AS d_rating_count,
         u.rides_as_driver AS d_rides_as_driver, u.trips_as_passenger AS d_trips_as_passenger, u.created_at AS d_created_at,
         u.phone_verified_at IS NOT NULL AS d_b_phone, u.email_verified_at IS NOT NULL AS d_b_email,
         u.identity_verified_at IS NOT NULL AS d_b_identity, u.driver_verified_at IS NOT NULL AS d_b_driver,
         u.trust_score AS d_trust_score, p.photo_url AS d_photo_url, p.languages AS d_languages, p.about AS d_about
    FROM rides r
    JOIN users u ON u.id = r.driver_id
    LEFT JOIN profiles p ON p.user_id = u.id
    LEFT JOIN vehicles v ON v.id = r.vehicle_id
    LEFT JOIN ride_routes rr ON rr.ride_id = r.id`;

/** Coarsen coordinates for the public (≈1 km) so exact home addresses aren't exposed before booking (spec §24). */
const coarse = (n: number) => Math.round(n * 100) / 100;

function serializeRide(r: any, opts: { exact: boolean }): RideSummary & Record<string, unknown> {
  const pos = (lat: number, lng: number) => (opts.exact ? { lat, lng } : { lat: coarse(lat), lng: coarse(lng) });
  return {
    id: r.id,
    status: r.status as RideStatus,
    driver: toPublicUser(r, 'd_'),
    origin: { name: r.origin_name, ...pos(r.origin_lat, r.origin_lng) },
    destination: { name: r.dest_name, ...pos(r.dest_lat, r.dest_lng) },
    departureAt: new Date(r.departure_at).toISOString(),
    arrivalEstimateAt: new Date(r.arrival_estimate_at).toISOString(),
    distanceMeters: r.distance_meters,
    durationSeconds: r.duration_seconds,
    seatsTotal: r.seats_total,
    seatsAvailable: r.seats_available,
    pricePerSeatMinor: r.price_per_seat_minor,
    currency: r.currency,
    countryCode: r.country_code,
    instantBooking: r.instant_booking,
    luggageAllowed: r.luggage_allowed,
    petsAllowed: r.pets_allowed,
    womenOnly: r.women_only,
    smokingAllowed: r.smoking_allowed,
    vehicle: r.make ? { make: r.make, model: r.model, color: r.color, type: r.vehicle_type, ...(opts.exact ? { plate: r.license_plate } : {}) } : null,
    notes: r.notes,
    polyline: r.polyline ?? null,
    isDemo: r.is_demo,
  };
}

export async function getRide(id: string, viewerId?: string) {
  const r = await one(`${RIDE_SELECT} WHERE r.id = $1`, [id]);
  if (!r) throw notFound('Ride');
  const isDriver = viewerId === r.driver_id;
  const myBooking = viewerId ? await one(`SELECT id, status FROM bookings WHERE ride_id = $1 AND passenger_id = $2 ORDER BY created_at DESC LIMIT 1`, [id, viewerId]) : undefined;
  const confirmed = !!myBooking && ['CONFIRMED', 'PASSENGER_PICKUP', 'IN_PROGRESS', 'COMPLETED'].includes(myBooking.status);
  const ride = serializeRide(r, { exact: isDriver || confirmed });
  const reviews = await q(
    `SELECT ra.stars, rv.comment, ra.created_at, u.name FROM ratings ra JOIN reviews rv ON rv.rating_id = ra.id JOIN users u ON u.id = ra.rater_id
      WHERE ra.ratee_id = $1 AND NOT rv.is_hidden ORDER BY ra.created_at DESC LIMIT 5`, [r.driver_id]);
  const { policy } = await getCancellationPolicy(r.country_code, r.ride_type);
  const extra: Record<string, unknown> = {
    reviews: reviews.map((x) => ({ stars: x.stars, comment: x.comment, createdAt: x.created_at, author: String(x.name).split(' ')[0] })),
    cancellationPolicy: policy,
    myBooking: myBooking ?? null,
    isDriver,
  };
  if (isDriver) {
    const pax = await q(
      `SELECT b.id, b.status, b.seats, b.pickup_name, b.dropoff_name, b.pickup_status, b.driver_earnings_minor, b.gross_fare_minor, b.platform_fee_minor,
              u.name, u.rating_avg, (SELECT 1 FROM ratings WHERE booking_id = b.id AND rater_id = $2) AS rated
         FROM bookings b JOIN users u ON u.id = b.passenger_id
        WHERE b.ride_id = $1 AND b.status NOT IN ('EXPIRED') ORDER BY b.created_at`, [id, viewerId]);
    extra.passengers = pax.map((p) => ({
      bookingId: p.id, status: p.status, seats: p.seats, pickup: p.pickup_name, dropoff: p.dropoff_name, pickupStatus: p.pickup_status,
      name: String(p.name).split(' ')[0], rating: Number(p.rating_avg), grossMinor: p.gross_fare_minor, feeMinor: p.platform_fee_minor,
      earningsMinor: p.driver_earnings_minor, rated: !!p.rated,
    }));
  }
  return { ...ride, ...extra };
}

export interface SearchInput {
  origin: LatLng; destination: LatLng;
  departAfter: string; departBefore: string; preferredTime?: string;
  seats: number;
  womenOnly?: boolean; pets?: boolean; luggage?: boolean; smoking?: boolean; vehicleType?: string;
  sort: 'best' | 'cheapest' | 'earliest' | 'closest' | 'rating' | 'shortest';
  limit: number;
}

/**
 * Search (spec §9, §37–38): SQL pre-filter by time window, seats and route bounding box,
 * then precise route-compatibility scoring and ranking in the app layer.
 * For very large volumes, move the bbox/route filter to PostGIS (see docs/ARCHITECTURE.md).
 */
export async function searchRides(input: SearchInput, viewerId?: string) {
  const pad = DEFAULT_MATCH_OPTIONS.maxDeviationM / 111_000;
  const viewer = viewerId ? await one(`SELECT p.gender FROM profiles p WHERE p.user_id = $1`, [viewerId]) : null;
  const rows = await q(
    `${RIDE_SELECT}
      WHERE r.status = 'PUBLISHED' AND r.departure_at BETWEEN $1 AND $2 AND r.departure_at > now()
        AND r.seats_available >= $3
        AND rr.min_lat - $4 <= $5 AND rr.max_lat + $4 >= $5 AND rr.min_lng - $4 <= $6 AND rr.max_lng + $4 >= $6
        AND rr.min_lat - $4 <= $7 AND rr.max_lat + $4 >= $7 AND rr.min_lng - $4 <= $8 AND rr.max_lng + $4 >= $8
        AND ($9::uuid IS NULL OR r.driver_id <> $9)
        AND u.status = 'ACTIVE'
      LIMIT 500`,
    [input.departAfter, input.departBefore, input.seats, pad, input.origin.lat, input.origin.lng, input.destination.lat, input.destination.lng, viewerId ?? null]);

  const preferred = input.preferredTime ? new Date(input.preferredTime).getTime() : new Date(input.departAfter).getTime();
  const scored = rows
    .filter((r) => !r.women_only || viewer?.gender === 'female')
    .filter((r) => (input.womenOnly ? r.women_only : true) && (input.pets ? r.pets_allowed : true) && (input.luggage ? r.luggage_allowed : true))
    .filter((r) => (input.smoking === false ? !r.smoking_allowed : true) && (input.vehicleType ? r.vehicle_type === input.vehicleType : true))
    .map((r) => ({ r, m: matchRoute(r.points as LatLng[], input.origin, input.destination) }))
    .filter(({ m }) => m.score > 0);

  const minPrice = Math.min(...scored.map(({ r }) => r.price_per_seat_minor));
  const maxPrice = Math.max(...scored.map(({ r }) => r.price_per_seat_minor));
  const results = scored.map(({ r, m }) => {
    const rank = rankScore({
      routeScore: m.score,
      timeDiffMinutes: Math.abs(new Date(r.departure_at).getTime() - preferred) / 60_000,
      relativePrice: maxPrice > minPrice ? (r.price_per_seat_minor - minPrice) / (maxPrice - minPrice) : 0,
      rating: Number(r.d_rating_avg), ratingCount: r.d_rating_count,
      verificationLevel: [r.d_b_phone, r.d_b_email, r.d_b_identity, r.d_b_driver].filter(Boolean).length,
      trustScore: r.d_trust_score, // internal: influences ranking, never serialised
      seatsLeftAfter: r.seats_available - input.seats,
    });
    return { ...serializeRide(r, { exact: false }), polyline: null, match: { score: m.score, pickupDeviationM: m.pickupDeviationM, dropoffDeviationM: m.dropoffDeviationM, rank } };
  });

  const sorters: Record<SearchInput['sort'], (a: any, b: any) => number> = {
    best: (a, b) => b.match.rank - a.match.rank,
    cheapest: (a, b) => a.pricePerSeatMinor - b.pricePerSeatMinor,
    earliest: (a, b) => a.departureAt.localeCompare(b.departureAt),
    closest: (a, b) => a.match.pickupDeviationM - b.match.pickupDeviationM,
    rating: (a, b) => b.driver.rating - a.driver.rating,
    shortest: (a, b) => a.durationSeconds - b.durationSeconds,
  };
  results.sort(sorters[input.sort]);
  return results.slice(0, input.limit);
}

/** Driver's rides (spec §42, §58). */
export async function listDriverRides(driverId: string, tab: 'upcoming' | 'active' | 'completed' | 'cancelled') {
  const where = {
    upcoming: `r.status IN ('PUBLISHED','DRIVER_READY')`,
    active: `r.status = 'IN_PROGRESS'`,
    completed: `r.status IN ('COMPLETED','DISPUTED')`,
    cancelled: `r.status IN ('CANCELLED_BY_DRIVER','EXPIRED')`,
  }[tab];
  const rows = await q(
    `${RIDE_SELECT.replace('FROM rides r', `, (SELECT count(*)::int FROM bookings b WHERE b.ride_id = r.id AND b.status IN ('CONFIRMED','PASSENGER_PICKUP','IN_PROGRESS','COMPLETED')) AS confirmed_passengers,
        (SELECT count(*)::int FROM bookings b WHERE b.ride_id = r.id AND b.status = 'REQUESTED') AS pending_requests
      FROM rides r`)} WHERE r.driver_id = $1 AND ${where} ORDER BY r.departure_at ${tab === 'upcoming' ? 'ASC' : 'DESC'} LIMIT 100`, [driverId]);
  return rows.map((r) => ({ ...serializeRide(r, { exact: true }), polyline: null, confirmedPassengers: r.confirmed_passengers, pendingRequests: r.pending_requests }));
}

export async function startRide(rideId: string, driverId: string) {
  await tx(async (c) => {
    const r = await one(`SELECT * FROM rides WHERE id = $1 FOR UPDATE`, [rideId], c);
    if (!r) throw notFound('Ride');
    if (r.driver_id !== driverId) throw forbidden();
    if (new Date(r.departure_at).getTime() - Date.now() > 2 * 3600_000) throw conflict('TOO_EARLY', 'You can start the trip up to 2 hours before departure.');
    assertRideTransition(r.status, 'IN_PROGRESS');
    await q(`UPDATE rides SET status = 'IN_PROGRESS', started_at = now(), updated_at = now() WHERE id = $1`, [rideId], c);
    const pax = await q(`UPDATE bookings SET status = 'IN_PROGRESS', updated_at = now() WHERE ride_id = $1 AND status IN ('CONFIRMED','PASSENGER_PICKUP') RETURNING passenger_id`, [rideId], c);
    for (const p of pax) await notify(c, p.passenger_id, 'RIDE_STARTED', 'Your ride has started', `${r.origin_name} → ${r.dest_name}. Have a safe trip!`, { rideId });
    await audit('ride.started', { actorId: driverId, entityType: 'ride', entityId: rideId, db: c });
  });
  return getRide(rideId, driverId);
}

/** Complete: earnings move from pending to available, counters and trust scores update. */
export async function completeRide(rideId: string, driverId: string) {
  await tx(async (c) => {
    const r = await one(`SELECT * FROM rides WHERE id = $1 FOR UPDATE`, [rideId], c);
    if (!r) throw notFound('Ride');
    if (r.driver_id !== driverId) throw forbidden();
    assertRideTransition(r.status, 'COMPLETED');
    await q(`UPDATE rides SET status = 'COMPLETED', completed_at = now(), updated_at = now() WHERE id = $1`, [rideId], c);
    const done = await q(`UPDATE bookings SET status = 'COMPLETED', completed_at = now(), updated_at = now() WHERE ride_id = $1 AND status = 'IN_PROGRESS' RETURNING id, passenger_id`, [rideId], c);
    const earnings = await q(`UPDATE driver_earnings SET status = 'AVAILABLE', available_at = now() WHERE ride_id = $1 AND status = 'PENDING' RETURNING net_minor, currency, booking_id`, [rideId], c);
    let total = 0;
    for (const e of earnings) {
      const w = await ensureWallet(c, driverId, e.currency);
      await moveWallet(c, w, { pending: -e.net_minor, available: e.net_minor }, { type: 'EARNING_RELEASED', amountMinor: e.net_minor, bookingId: e.booking_id, rideId, description: `Ride completed: ${r.origin_name} → ${r.dest_name}` });
      total += e.net_minor;
    }
    await q(`UPDATE users SET rides_as_driver = rides_as_driver + 1 WHERE id = $1`, [driverId], c);
    for (const b of done) {
      await q(`UPDATE users SET trips_as_passenger = trips_as_passenger + 1 WHERE id = $1`, [b.passenger_id], c);
      await notify(c, b.passenger_id, 'RIDE_COMPLETED', 'You have arrived', `How was your ride with your driver? Leave a rating.`, { rideId, bookingId: b.id });
      await recomputeTrustScore(b.passenger_id, c);
    }
    if (total) await notify(c, driverId, 'PAYMENT_RECEIVED', 'Earnings available', `${formatMoney(total, r.currency)} from ${r.origin_name} → ${r.dest_name} is now in your balance.`, { rideId });
    await recomputeTrustScore(driverId, c);
    await audit('ride.completed', { actorId: driverId, entityType: 'ride', entityId: rideId, data: { passengers: done.length, earnings: total }, db: c });
  });
  return getRide(rideId, driverId);
}

/** Driver cancels (spec §19): every passenger gets the policy refund (default 100%), earnings reversed. */
export async function cancelRide(rideId: string, actorId: string, opts: { asAdmin?: boolean; reason?: string } = {}) {
  const refunds: string[] = [];
  const voided: string[] = [];
  await tx(async (c) => {
    const r = await one(`SELECT * FROM rides WHERE id = $1 FOR UPDATE`, [rideId], c);
    if (!r) throw notFound('Ride');
    if (!opts.asAdmin && r.driver_id !== actorId) throw forbidden();
    assertRideTransition(r.status, 'CANCELLED_BY_DRIVER');
    const { policy, thresholds } = await getCancellationPolicy(r.country_code, r.ride_type, c);
    const bps = opts.asAdmin ? 10000 : policy.driverCancelRefundBps;
    await q(`UPDATE rides SET status = 'CANCELLED_BY_DRIVER', cancelled_at = now(), seats_available = seats_total, updated_at = now() WHERE id = $1`, [rideId], c);
    const bookings = await q(`SELECT * FROM bookings WHERE ride_id = $1 AND status IN ('REQUESTED','RESERVED','CONFIRMED','PASSENGER_PICKUP') FOR UPDATE`, [rideId], c);
    let hadPaidPassengers = false;
    for (const b of bookings) {
      await q(`UPDATE bookings SET status = 'CANCELLED_BY_DRIVER', cancelled_by = $2, refund_bps = $3, cancelled_at = now(), expires_at = NULL, updated_at = now() WHERE id = $1`, [b.id, opts.asAdmin ? 'ADMIN' : 'DRIVER', bps], c);
      const live = await q(`UPDATE payments SET status = 'CANCELLED', updated_at = now() WHERE booking_id = $1 AND status IN ('PENDING','AUTHORIZED') RETURNING provider_payment_id`, [b.id], c);
      voided.push(...live.map((p) => p.provider_payment_id));
      const paid = await one(`SELECT id, amount_minor FROM payments WHERE booking_id = $1 AND status IN ('PAID','PARTIALLY_REFUNDED')`, [b.id], c);
      if (paid) {
        hadPaidPassengers = true;
        refunds.push(await queueRefund(c, paid.id, Math.round((paid.amount_minor * bps) / 10000), opts.asAdmin ? `Admin cancelled ride: ${opts.reason ?? ''}` : 'Driver cancelled ride', actorId));
        const e = await one(`UPDATE driver_earnings SET status = 'REVERSED' WHERE booking_id = $1 AND status = 'PENDING' RETURNING net_minor, currency`, [b.id], c);
        if (e) {
          const w = await ensureWallet(c, r.driver_id, e.currency);
          await moveWallet(c, w, { pending: -e.net_minor }, { type: 'EARNING_REVERSED', amountMinor: -e.net_minor, bookingId: b.id, rideId, description: 'Ride cancelled — earning reversed' });
        }
      }
      await notify(c, b.passenger_id, 'RIDE_CANCELLED', 'Your ride was cancelled', `The ride ${r.origin_name} → ${r.dest_name} was cancelled.${paid ? ' You will receive a full refund.' : ''}`, { rideId, bookingId: b.id });
    }
    if (!opts.asAdmin && hadPaidPassengers) {
      const cnt = (await one(`UPDATE users SET driver_cancel_count = driver_cancel_count + 1 WHERE id = $1 RETURNING driver_cancel_count`, [r.driver_id], c)).driver_cancel_count;
      await applyCancellationConsequences(r.driver_id, cnt, thresholds, c);
      await recomputeTrustScore(r.driver_id, c);
    }
    await audit(opts.asAdmin ? 'admin.ride_cancelled' : 'ride.cancelled', { actorId, entityType: 'ride', entityId: rideId, data: { bookings: bookings.length, reason: opts.reason }, db: c });
  });
  for (const pid of voided) await payments.cancel(pid);
  for (const id of refunds) await processRefund(id);
  return getRide(rideId, opts.asAdmin ? undefined : actorId);
}

/** Popular routes for the home screen (aggregate only — no personal data). */
export async function popularRoutes(countryCode: string) {
  return q(
    `SELECT origin_name AS "from", dest_name AS "to", count(*)::int AS rides, min(price_per_seat_minor)::bigint AS "fromPriceMinor", min(currency) AS currency,
            avg(origin_lat) AS "fromLat", avg(origin_lng) AS "fromLng", avg(dest_lat) AS "toLat", avg(dest_lng) AS "toLng"
       FROM rides WHERE country_code = $1 AND created_at > now() - interval '90 days'
      GROUP BY origin_name, dest_name ORDER BY rides DESC LIMIT 6`, [countryCode], pool);
}
