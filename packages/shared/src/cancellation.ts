import { percentOf } from './money';

/** One tier: cancelling at least `minHoursBefore` hours before departure refunds `refundBps`. */
export interface CancellationTier { minHoursBefore: number; refundBps: number }

export interface CancellationPolicy {
  /** Sorted or unsorted; evaluated from the largest threshold down. */
  passengerTiers: CancellationTier[];
  noShowRefundBps: number;
  /** When the driver cancels, passengers get this much back (normally 100%). */
  driverCancelRefundBps: number;
}

/** Default from spec §18. Admin-configurable per country / ride type in `cancellation_rules`. */
export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = {
  passengerTiers: [
    { minHoursBefore: 24, refundBps: 10000 },
    { minHoursBefore: 12, refundBps: 7500 },
    { minHoursBefore: 0, refundBps: 5000 },
  ],
  noShowRefundBps: 0,
  driverCancelRefundBps: 10000,
};

export type Canceller = 'PASSENGER' | 'DRIVER' | 'NO_SHOW' | 'ADMIN';

export function refundBpsFor(policy: CancellationPolicy, by: Canceller, departureAt: Date, now: Date): number {
  if (by === 'DRIVER' || by === 'ADMIN') return policy.driverCancelRefundBps;
  if (by === 'NO_SHOW') return policy.noShowRefundBps;
  const hours = (departureAt.getTime() - now.getTime()) / 3_600_000;
  const tiers = [...policy.passengerTiers].sort((a, b) => b.minHoursBefore - a.minHoursBefore);
  for (const t of tiers) if (hours >= t.minHoursBefore) return t.refundBps;
  return 0; // after departure
}

/** Refund amount in minor units of what the passenger actually paid. */
export function refundAmount(paidMinor: number, refundBps: number): number {
  return Math.min(paidMinor, percentOf(paidMinor, refundBps));
}
