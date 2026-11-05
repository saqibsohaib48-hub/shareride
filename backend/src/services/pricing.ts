import { PricingRule, suggestPrice, calculateBooking, PriceSuggestion, BookingBreakdown, CancellationPolicy, DEFAULT_CANCELLATION_POLICY } from '@share-ride/shared';
import { Db, one, pool } from '../db';
import { AppError } from '../utils/errors';

export interface PricingRuleRow extends PricingRule { id: string; version: number }

const SELECT_RULE = `
  SELECT id, version, country_code AS "countryCode", currency, base_fare_minor AS "baseFareMinor", per_km_minor AS "perKmMinor",
         min_fare_minor AS "minFareMinor", max_fare_minor AS "maxFareMinor",
         min_driver_price_minor AS "minDriverPriceMinor", max_driver_price_minor AS "maxDriverPriceMinor",
         platform_fee_bps AS "platformFeeBps", fee_bearer AS "feeBearer", tax_on_fee_bps AS "taxOnFeeBps",
         rounding_minor AS "roundingMinor", suggestion_spread_bps AS "suggestionSpreadBps"
    FROM pricing_rules`;

export async function getActiveRule(countryCode: string, db: Db = pool): Promise<PricingRuleRow> {
  const r = await one<PricingRuleRow>(`${SELECT_RULE} WHERE country_code = $1 AND is_active`, [countryCode], db);
  if (!r) throw new AppError(422, 'COUNTRY_NOT_SUPPORTED', 'Share Ride is not available in this country yet.');
  return r;
}

export async function getRuleById(id: string, db: Db = pool): Promise<PricingRuleRow> {
  const r = await one<PricingRuleRow>(`${SELECT_RULE} WHERE id = $1`, [id], db);
  if (!r) throw new Error(`pricing rule ${id} missing`);
  return r;
}

/**
 * Smart price signal (spec §39): compares what drivers actually charged per km on recent
 * similar-length rides in this country against the configured rate. Bounded to ±10% so
 * configured pricing always dominates; neutral (10000) when there's not enough history.
 */
export async function demandFactorBps(rule: PricingRule, distanceMeters: number, db: Db = pool): Promise<number> {
  const row = await one<{ n: number; avg_per_km: number | null }>(
    `SELECT count(*)::int AS n, avg(price_per_seat_minor::numeric / (distance_meters / 1000.0)) AS avg_per_km
       FROM rides
      WHERE country_code = $1 AND created_at > now() - interval '60 days'
        AND status IN ('PUBLISHED','IN_PROGRESS','COMPLETED')
        AND distance_meters BETWEEN $2 * 0.5 AND $2 * 1.5`,
    [rule.countryCode, distanceMeters], db);
  if (!row || row.n < 10 || !row.avg_per_km) return 10000;
  const km = distanceMeters / 1000;
  const configuredPerKm = (rule.baseFareMinor + rule.perKmMinor * km) / km;
  const ratio = row.avg_per_km / configuredPerKm;
  return Math.round(Math.min(1.1, Math.max(0.9, ratio)) * 10000);
}

export async function suggest(rule: PricingRule, distanceMeters: number): Promise<PriceSuggestion & { demandFactorBps: number }> {
  const f = await demandFactorBps(rule, distanceMeters);
  return { ...suggestPrice(rule, distanceMeters, f), demandFactorBps: f };
}

/** Driver-side earnings preview for a full ride (spec §10). */
export function earningsPreview(rule: PricingRule, pricePerSeatMinor: number, seats: number): BookingBreakdown {
  return calculateBooking(rule, pricePerSeatMinor, seats);
}

export async function getCancellationPolicy(countryCode: string, rideType = 'standard', db: Db = pool): Promise<{ policy: CancellationPolicy; thresholds: Record<string, number> }> {
  const r = await one<{ policy: CancellationPolicy; restriction_thresholds: Record<string, number> }>(
    `SELECT policy, restriction_thresholds FROM cancellation_rules
      WHERE is_active AND ride_type = $2 AND (country_code = $1 OR country_code IS NULL)
      ORDER BY country_code NULLS LAST LIMIT 1`, [countryCode, rideType], db);
  return { policy: r?.policy ?? DEFAULT_CANCELLATION_POLICY, thresholds: r?.restriction_thresholds ?? { warning: 3, restricted: 5, review: 8, suspend: 12 } };
}
