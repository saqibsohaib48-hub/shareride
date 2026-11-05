import { describe, it, expect } from 'vitest';
import {
  calculateBooking, suggestPrice, validateDriverPrice, PricingRule,
  percentOf, toMinor, formatMoney, convertForDisplay,
  matchRoute, haversineMeters, decodePolyline, encodePolyline,
  refundBpsFor, refundAmount, DEFAULT_CANCELLATION_POLICY,
  canTransitionRide, assertBookingTransition, canTransitionPayment,
  rankScore, translate, isRtl,
} from '../src';

const UAE: PricingRule = {
  countryCode: 'AE', currency: 'AED', baseFareMinor: 500, perKmMinor: 120,
  minFareMinor: 1000, maxFareMinor: 50000, minDriverPriceMinor: 1000, maxDriverPriceMinor: 50000,
  platformFeeBps: 500, feeBearer: 'DRIVER', taxOnFeeBps: 0, roundingMinor: 100, suggestionSpreadBps: 1000,
};

describe('commission (spec §3, §55)', () => {
  it('AED 50 → fee 2.50, driver 47.50, passenger pays 50 (driver bears fee)', () => {
    const b = calculateBooking(UAE, 5000, 1);
    expect(b.platformFeeMinor).toBe(250);
    expect(b.driverEarningsMinor).toBe(4750);
    expect(b.passengerTotalMinor).toBe(5000);
    expect(b.platformRevenueMinor).toBe(250);
  });
  it('passenger-bears mode: total 52.50, driver 50 (spec §12/§54)', () => {
    const b = calculateBooking({ ...UAE, feeBearer: 'PASSENGER' }, 5000, 1);
    expect(b.passengerTotalMinor).toBe(5250);
    expect(b.driverEarningsMinor).toBe(5000);
  });
  it('gross = price × seats; 3 seats AED 50 → commission 7.50, earnings 142.50 (spec §10)', () => {
    const b = calculateBooking(UAE, 5000, 3);
    expect(b.grossFareMinor).toBe(15000);
    expect(b.platformFeeMinor).toBe(750);
    expect(b.driverEarningsMinor).toBe(14250);
  });
  it('fee + earnings always add up to gross exactly (no rounding leakage)', () => {
    for (let p = 101; p < 20000; p += 397) {
      for (const seats of [1, 2, 3, 4]) {
        const b = calculateBooking(UAE, p, seats);
        expect(b.platformFeeMinor + b.driverEarningsMinor).toBe(b.grossFareMinor);
      }
    }
  });
  it('commission is configurable (e.g. 7.5%)', () => {
    expect(calculateBooking({ ...UAE, platformFeeBps: 750 }, 10000, 1).platformFeeMinor).toBe(750);
  });
  it('tax is a separate component, never mixed into the fee', () => {
    const b = calculateBooking({ ...UAE, taxOnFeeBps: 500 }, 5000, 1); // 5% VAT on the fee
    expect(b.platformFeeMinor).toBe(250);
    expect(b.taxMinor).toBe(13);
    expect(b.driverEarningsMinor).toBe(5000 - 250 - 13);
  });
  it('promo discount is platform-funded: driver earnings untouched, passenger never below zero', () => {
    const b = calculateBooking(UAE, 5000, 1, 500);
    expect(b.passengerTotalMinor).toBe(4500);
    expect(b.driverEarningsMinor).toBe(4750);
    expect(b.platformRevenueMinor).toBe(-250);
    expect(calculateBooking(UAE, 5000, 1, 99999).passengerTotalMinor).toBe(0);
  });
  it('rejects manipulated inputs', () => {
    expect(() => calculateBooking(UAE, -5000, 1)).toThrow();
    expect(() => calculateBooking(UAE, 5000, 0)).toThrow();
    expect(() => calculateBooking(UAE, 50.5, 1)).toThrow();
  });
});

describe('pricing engine (spec §5, §30, §39)', () => {
  it('35 km: base 5 + 35 × 1.20 = AED 47', () => {
    expect(suggestPrice(UAE, 35000).recommendedMinor).toBe(4700);
  });
  it('clamps to min and max fare', () => {
    expect(suggestPrice(UAE, 1000).recommendedMinor).toBe(1000);
    expect(suggestPrice(UAE, 900000).recommendedMinor).toBe(50000);
  });
  it('produces a ±10% range around the recommendation', () => {
    const s = suggestPrice(UAE, 42000); // 5 + 50.4 = 55.4 → 55
    expect(s.recommendedMinor).toBe(5500);
    expect(s.rangeMinMinor).toBe(5000);
    expect(s.rangeMaxMinor).toBe(6100);
  });
  it('validates driver-chosen price within admin limits', () => {
    expect(validateDriverPrice(UAE, 5000).ok).toBe(true);
    expect(validateDriverPrice(UAE, 500)).toEqual({ ok: false, reason: 'PRICE_BELOW_MINIMUM' });
    expect(validateDriverPrice(UAE, 60000)).toEqual({ ok: false, reason: 'PRICE_ABOVE_MAXIMUM' });
  });
});

describe('currency', () => {
  it('converts to minor units per currency exponent', () => {
    expect(toMinor(47.5, 'AED')).toBe(4750);
    expect(toMinor(1000, 'JPY')).toBe(1000);
    expect(toMinor(1.234, 'KWD')).toBe(1234);
  });
  it('percentOf rounds half up on integers', () => {
    expect(percentOf(250, 500)).toBe(13);
    expect(percentOf(5000, 500)).toBe(250);
  });
  it('formats', () => {
    expect(formatMoney(4750, 'USD', 'en-US')).toBe('$47.50');
  });
  it('display conversion requires a live rate', () => {
    expect(convertForDisplay(5000, 'AED', 'USD', 0.2723)).toBe(1362);
    expect(() => convertForDisplay(5000, 'AED', 'USD', 0)).toThrow();
  });
});

describe('distance & route matching (spec §37–38)', () => {
  const dubai = { lat: 25.2048, lng: 55.2708 };
  const sharjah = { lat: 25.3463, lng: 55.4209 };
  const ajman = { lat: 25.4052, lng: 55.5136 };
  const rak = { lat: 25.8007, lng: 55.9762 };
  const route = [dubai, sharjah, ajman, rak];

  it('haversine sanity: Dubai→Abu Dhabi ≈ 125 km straight line', () => {
    const d = haversineMeters(dubai, { lat: 24.4539, lng: 54.3773 });
    expect(d).toBeGreaterThan(115000);
    expect(d).toBeLessThan(130000);
  });
  it('Sharjah→Ajman passenger matches Dubai→RAK driver', () => {
    const m = matchRoute(route, sharjah, ajman);
    expect(m.sameDirection).toBe(true);
    expect(m.score).toBeGreaterThan(0.8);
  });
  it('opposite direction does not match', () => {
    expect(matchRoute(route, ajman, sharjah).score).toBe(0);
  });
  it('Dubai Marina → Abu Dhabi matches JLT → Abu Dhabi', () => {
    const jlt = { lat: 25.0693, lng: 55.1413 };
    const marina = { lat: 25.0805, lng: 55.1403 };
    const abuDhabi = { lat: 24.4539, lng: 54.3773 };
    const m = matchRoute([jlt, { lat: 24.9, lng: 55.0 }, abuDhabi], marina, abuDhabi);
    expect(m.score).toBeGreaterThan(0.8);
  });
  it('far-away pickup is rejected', () => {
    expect(matchRoute(route, { lat: 24.4539, lng: 54.3773 }, rak).score).toBe(0);
  });
  it('polyline round-trips', () => {
    const decoded = decodePolyline(encodePolyline(route));
    expect(decoded[2].lat).toBeCloseTo(ajman.lat, 4);
  });
});

describe('cancellation (spec §18–19)', () => {
  const dep = new Date('2026-11-10T17:00:00Z');
  const at = (h: number) => new Date(dep.getTime() - h * 3600_000);
  it('applies tiers', () => {
    expect(refundBpsFor(DEFAULT_CANCELLATION_POLICY, 'PASSENGER', dep, at(30))).toBe(10000);
    expect(refundBpsFor(DEFAULT_CANCELLATION_POLICY, 'PASSENGER', dep, at(13))).toBe(7500);
    expect(refundBpsFor(DEFAULT_CANCELLATION_POLICY, 'PASSENGER', dep, at(2))).toBe(5000);
    expect(refundBpsFor(DEFAULT_CANCELLATION_POLICY, 'PASSENGER', dep, at(-1))).toBe(0);
    expect(refundBpsFor(DEFAULT_CANCELLATION_POLICY, 'DRIVER', dep, at(1))).toBe(10000);
    expect(refundBpsFor(DEFAULT_CANCELLATION_POLICY, 'NO_SHOW', dep, at(0))).toBe(0);
  });
  it('refund never exceeds paid', () => {
    expect(refundAmount(5250, 7500)).toBe(3938);
    expect(refundAmount(5250, 20000)).toBe(5250);
  });
});

describe('state machine (spec §57)', () => {
  it('blocks invalid transitions', () => {
    expect(canTransitionRide('PUBLISHED', 'IN_PROGRESS')).toBe(true);
    expect(canTransitionRide('COMPLETED', 'PUBLISHED')).toBe(false);
    expect(() => assertBookingTransition('EXPIRED', 'CONFIRMED')).toThrow();
    expect(canTransitionPayment('FAILED', 'PAID')).toBe(false);
  });
});

describe('ranking & i18n', () => {
  it('non-matching routes get zero', () => {
    expect(rankScore({ routeScore: 0, timeDiffMinutes: 0, relativePrice: 0, rating: 5, ratingCount: 100, verificationLevel: 4, trustScore: 100, seatsLeftAfter: 1 })).toBe(0);
  });
  it('better route ranks higher, all else equal', () => {
    const base = { timeDiffMinutes: 10, relativePrice: 0.5, rating: 4.5, ratingCount: 20, verificationLevel: 2, trustScore: 60, seatsLeftAfter: 1 };
    expect(rankScore({ ...base, routeScore: 0.95 })).toBeGreaterThan(rankScore({ ...base, routeScore: 0.6 }));
  });
  it('translates with fallback and RTL', () => {
    expect(translate('fr', 'nav.home')).toBe('Accueil');
    expect(translate('fr', 'trips.requests')).toBe('Join requests');
    expect(translate('en', 'search.seatsLeft', { count: 2 })).toBe('2 seats left');
    expect(isRtl('ar')).toBe(true);
  });
});
