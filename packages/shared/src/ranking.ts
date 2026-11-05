/**
 * Search ranking (spec §37). Inputs are normalised to 0..1 by the backend so this stays pure and testable.
 */
export interface RankFeatures {
  /** Route compatibility from matchRoute(), 0..1. */
  routeScore: number;
  /** |ride departure − requested time| in minutes. */
  timeDiffMinutes: number;
  /** Ride price relative to the cheapest result: 0 = cheapest, 1 = most expensive. */
  relativePrice: number;
  /** Driver average rating 0..5 (0 if no ratings yet). */
  rating: number;
  ratingCount: number;
  /** Number of verification badges, 0..4. */
  verificationLevel: number;
  /** Internal trust score 0..100 (never shown to users). */
  trustScore: number;
  /** Seats left after this passenger's request. */
  seatsLeftAfter: number;
}

export interface RankWeights {
  route: number;
  time: number;
  price: number;
  rating: number;
  verification: number;
  trust: number;
}

/**
 * Default weights. Route match dominates (a ride that doesn't go your way is useless),
 * then departure time, then price/trust signals.
 *
 * TODO(product): tune these weights — see README "Ranking weights" for the trade-offs.
 */
export const DEFAULT_RANK_WEIGHTS: RankWeights = {
  route: 0.4,
  time: 0.2,
  price: 0.15,
  rating: 0.1,
  verification: 0.08,
  trust: 0.07,
};

/** Bayesian-smoothed rating so one 5★ review doesn't outrank 200 reviews at 4.8★. */
export function smoothedRating(rating: number, count: number, prior = 4.2, priorWeight = 5): number {
  return (rating * count + prior * priorWeight) / (count + priorWeight);
}

export function rankScore(f: RankFeatures, w: RankWeights = DEFAULT_RANK_WEIGHTS): number {
  if (f.routeScore <= 0) return 0;
  // Time: full marks within 15 minutes, decays to 0 at 4 hours.
  const time = Math.max(0, 1 - Math.max(0, f.timeDiffMinutes - 15) / 225);
  const price = 1 - Math.min(1, Math.max(0, f.relativePrice));
  const rating = Math.max(0, (smoothedRating(f.rating, f.ratingCount) - 3) / 2); // 3★→0, 5★→1
  const verification = Math.min(1, f.verificationLevel / 4);
  const trust = Math.min(1, Math.max(0, f.trustScore / 100));
  const s =
    w.route * f.routeScore + w.time * time + w.price * price +
    w.rating * rating + w.verification * verification + w.trust * trust;
  return Math.round(s * 1000) / 1000;
}
