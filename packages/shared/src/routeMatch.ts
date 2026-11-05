import { LatLng, pointToSegment, haversineMeters } from './geo';

export interface RouteMatch {
  /** Metres from passenger pickup to the nearest point of the driver's route. */
  pickupDeviationM: number;
  /** Metres from passenger drop-off to the nearest point of the driver's route. */
  dropoffDeviationM: number;
  /** Position along the route (0 = driver start, 1 = driver end). */
  pickupPosition: number;
  dropoffPosition: number;
  /** Pickup comes before drop-off along the driver's direction of travel. */
  sameDirection: boolean;
  /** Share of the passenger's trip that overlaps the driver's route, 0..1. */
  overlap: number;
  /** 0..1 compatibility; 0 = not a match. */
  score: number;
}

export interface MatchOptions {
  /** Max acceptable detour to pick up / drop off, metres. */
  maxDeviationM: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = { maxDeviationM: 15000 };

function nearestOnRoute(route: LatLng[], p: LatLng): { distance: number; position: number } {
  if (route.length === 1) return { distance: haversineMeters(route[0], p), position: 0 };
  // cumulative lengths for position along route
  const cum: number[] = [0];
  for (let i = 1; i < route.length; i++) cum.push(cum[i - 1] + haversineMeters(route[i - 1], route[i]));
  const total = cum[cum.length - 1] || 1;
  let best = { distance: Infinity, position: 0 };
  for (let i = 0; i < route.length - 1; i++) {
    const { distance, t } = pointToSegment(p, route[i], route[i + 1]);
    if (distance < best.distance) {
      best = { distance, position: (cum[i] + t * (cum[i + 1] - cum[i])) / total };
    }
  }
  return best;
}

/**
 * Route compatibility (spec §37–38): driver route + passenger pickup + passenger destination → score.
 * A Sharjah→Ajman passenger matches a Dubai→Sharjah→Ajman→RAK driver;
 * a Dubai Marina→Abu Dhabi passenger matches a JLT→Abu Dhabi driver.
 */
export function matchRoute(route: LatLng[], pickup: LatLng, dropoff: LatLng, opts: MatchOptions = DEFAULT_MATCH_OPTIONS): RouteMatch {
  const a = nearestOnRoute(route, pickup);
  const b = nearestOnRoute(route, dropoff);
  const sameDirection = b.position > a.position;
  const overlap = Math.max(0, b.position - a.position);
  const within = a.distance <= opts.maxDeviationM && b.distance <= opts.maxDeviationM;
  let score = 0;
  if (within && sameDirection) {
    const dev = (a.distance + b.distance) / (2 * opts.maxDeviationM); // 0 (perfect) .. 1 (limit)
    score = Math.max(0, 1 - dev) * 0.85 + Math.min(1, overlap * 4) * 0.15;
  }
  return {
    pickupDeviationM: Math.round(a.distance),
    dropoffDeviationM: Math.round(b.distance),
    pickupPosition: a.position,
    dropoffPosition: b.position,
    sameDirection,
    overlap,
    score: Math.round(score * 1000) / 1000,
  };
}
