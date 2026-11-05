import { percentOf, assertInt } from './money';

/**
 * Who bears the platform fee. Configurable per country.
 * - DRIVER:    passenger pays the fare; fee is deducted from the driver's earnings (spec §3, §55).
 * - PASSENGER: fee is added on top of the fare at checkout; driver receives the full fare (spec §12).
 */
export type FeeBearer = 'DRIVER' | 'PASSENGER';

/** Mirror of the `pricing_rules` table. All amounts in minor units of `currency`. */
export interface PricingRule {
  countryCode: string;
  currency: string;
  baseFareMinor: number;
  perKmMinor: number;
  minFareMinor: number;
  maxFareMinor: number;
  /** Max per-seat price a driver may set (may exceed computed max fare only if admin allows). */
  maxDriverPriceMinor: number;
  /** Min per-seat price a driver may set. */
  minDriverPriceMinor: number;
  /** Platform fee in basis points. 500 = 5%. */
  platformFeeBps: number;
  feeBearer: FeeBearer;
  /** Tax charged on the platform fee (e.g. VAT/GST on the service), basis points. Kept separate from the fee. */
  taxOnFeeBps: number;
  /** Round suggested prices to this increment (minor units), e.g. 100 = whole AED. */
  roundingMinor: number;
  /** ± spread around the recommended price, in basis points (1000 = ±10%). */
  suggestionSpreadBps: number;
}

export interface PriceSuggestion {
  distanceKm: number;
  recommendedMinor: number;
  rangeMinMinor: number;
  rangeMaxMinor: number;
  allowedMinMinor: number;
  allowedMaxMinor: number;
}

function roundTo(value: number, inc: number): number {
  if (inc <= 1) return Math.round(value);
  return Math.round(value / inc) * inc;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Distance-based per-seat price: base + perKm × roadKm, clamped to [minFare, maxFare].
 * `distanceMeters` MUST be road/driving distance from the maps provider.
 *
 * `demandFactorBps` hooks in the smart-pricing signals from §39 (historical rides, demand, time):
 * 10000 = neutral. The backend computes it; the formula stays here so it is unit-tested.
 */
export function suggestPrice(rule: PricingRule, distanceMeters: number, demandFactorBps = 10000): PriceSuggestion {
  if (!(distanceMeters > 0)) throw new Error('Distance must be positive');
  assertInt(demandFactorBps, 'demandFactorBps');
  const km = distanceMeters / 1000;
  const raw = rule.baseFareMinor + rule.perKmMinor * km;
  const adjusted = (raw * demandFactorBps) / 10000;
  const recommended = clamp(roundTo(adjusted, rule.roundingMinor), rule.minFareMinor, rule.maxFareMinor);
  const spread = Math.round((recommended * rule.suggestionSpreadBps) / 10000);
  const allowedMin = rule.minDriverPriceMinor;
  const allowedMax = rule.maxDriverPriceMinor;
  return {
    distanceKm: Math.round(km * 10) / 10,
    recommendedMinor: clamp(recommended, allowedMin, allowedMax),
    rangeMinMinor: clamp(roundTo(recommended - spread, rule.roundingMinor), allowedMin, allowedMax),
    rangeMaxMinor: clamp(roundTo(recommended + spread, rule.roundingMinor), allowedMin, allowedMax),
    allowedMinMinor: allowedMin,
    allowedMaxMinor: allowedMax,
  };
}

export function validateDriverPrice(rule: PricingRule, priceMinor: number): { ok: true } | { ok: false; reason: string } {
  if (!Number.isInteger(priceMinor) || priceMinor <= 0) return { ok: false, reason: 'PRICE_INVALID' };
  if (priceMinor < rule.minDriverPriceMinor) return { ok: false, reason: 'PRICE_BELOW_MINIMUM' };
  if (priceMinor > rule.maxDriverPriceMinor) return { ok: false, reason: 'PRICE_ABOVE_MAXIMUM' };
  return { ok: true };
}

export interface BookingBreakdown {
  currency: string;
  seats: number;
  pricePerSeatMinor: number;
  /** gross_fare = passenger_price × seats */
  grossFareMinor: number;
  /** platform_fee = gross_fare × fee% */
  platformFeeMinor: number;
  /** Tax on the platform fee, separate component (never mixed into the fee). */
  taxMinor: number;
  promoDiscountMinor: number;
  /** What the passenger is charged. */
  passengerTotalMinor: number;
  /** What the driver earns. Never negative. */
  driverEarningsMinor: number;
  /** Platform revenue (fee only, excluding tax which is a liability). */
  platformRevenueMinor: number;
  feeBearer: FeeBearer;
  platformFeeBps: number;
}

/**
 * The single source of truth for checkout + earnings maths (spec §3, §12, §54, §55).
 * Promo discounts are funded by the platform (reduce passenger total, never driver earnings).
 */
export function calculateBooking(
  rule: Pick<PricingRule, 'currency' | 'platformFeeBps' | 'feeBearer' | 'taxOnFeeBps'>,
  pricePerSeatMinor: number,
  seats: number,
  promoDiscountMinor = 0,
): BookingBreakdown {
  assertInt(pricePerSeatMinor, 'pricePerSeat');
  assertInt(seats, 'seats');
  assertInt(promoDiscountMinor, 'promoDiscount');
  if (seats < 1) throw new Error('At least one seat is required');
  if (pricePerSeatMinor <= 0) throw new Error('Price must be positive');
  if (promoDiscountMinor < 0) throw new Error('Discount cannot be negative');

  const gross = pricePerSeatMinor * seats;
  const fee = percentOf(gross, rule.platformFeeBps);
  const tax = percentOf(fee, rule.taxOnFeeBps);

  let passengerTotal: number;
  let driver: number;
  if (rule.feeBearer === 'PASSENGER') {
    passengerTotal = gross + fee + tax;
    driver = gross;
  } else {
    // Fee (and tax on it) come out of the fare.
    passengerTotal = gross;
    driver = gross - fee - tax;
  }
  // Discount is a platform marketing cost: it lowers what the passenger pays, never the driver's earnings.
  // platformRevenue may go negative for a promo booking; the passenger total never does.
  const discount = Math.min(promoDiscountMinor, passengerTotal);
  passengerTotal -= discount;

  if (driver < 0 || passengerTotal < 0) throw new Error('Negative amounts are not allowed');
  return {
    currency: rule.currency,
    seats,
    pricePerSeatMinor,
    grossFareMinor: gross,
    platformFeeMinor: fee,
    taxMinor: tax,
    promoDiscountMinor: discount,
    passengerTotalMinor: passengerTotal,
    driverEarningsMinor: driver,
    platformRevenueMinor: fee - discount,
    feeBearer: rule.feeBearer,
    platformFeeBps: rule.platformFeeBps,
  };
}
