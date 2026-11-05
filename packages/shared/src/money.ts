/**
 * Money is ALWAYS handled as integer minor units (fils, cents, paise...).
 * Never use floating point for stored or charged amounts.
 */

/** ISO-4217 minor-unit exponents for supported currencies. Unknown → 2. */
export const CURRENCY_EXPONENT: Record<string, number> = {
  AED: 2, USD: 2, GBP: 2, EUR: 2, INR: 2, SAR: 2, QAR: 2, CAD: 2, AUD: 2,
  JPY: 0, KWD: 3, BHD: 3, OMR: 3,
};

export function exponent(currency: string): number {
  return CURRENCY_EXPONENT[currency.toUpperCase()] ?? 2;
}

/** Convert a major-unit decimal (e.g. 47.5) to minor units (4750). Input from config/forms only. */
export function toMinor(major: number, currency: string): number {
  if (!Number.isFinite(major)) throw new Error('Invalid amount');
  const f = 10 ** exponent(currency);
  return Math.round(major * f);
}

export function toMajor(minor: number, currency: string): number {
  return minor / 10 ** exponent(currency);
}

/** Integer percentage of an amount, using basis points (500 = 5%). Rounds half up. */
export function percentOf(amountMinor: number, basisPoints: number): number {
  assertInt(amountMinor, 'amount');
  assertInt(basisPoints, 'basisPoints');
  if (amountMinor < 0 || basisPoints < 0) throw new Error('Negative values are not allowed');
  return Math.floor((amountMinor * basisPoints + 5000) / 10000);
}

export function formatMoney(minor: number, currency: string, locale = 'en'): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: exponent(currency),
      maximumFractionDigits: exponent(currency),
    }).format(toMajor(minor, currency));
  } catch {
    return `${currency} ${toMajor(minor, currency).toFixed(exponent(currency))}`;
  }
}

/**
 * Display-only conversion. `rate` = units of `to` per 1 unit of `from`, from an exchange-rate API.
 * Never use the result for charging — charges are always in the ride's settlement currency.
 */
export function convertForDisplay(minor: number, from: string, to: string, rate: number): number {
  if (!(rate > 0)) throw new Error('Invalid exchange rate');
  const scale = 10 ** (exponent(to) - exponent(from));
  // toPrecision(12) strips binary float noise (13.615 → 13.6149999…) before rounding.
  return Math.round(Number((minor * rate * scale).toPrecision(12)));
}

export function assertInt(n: number, name: string): void {
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer (minor units)`);
}
