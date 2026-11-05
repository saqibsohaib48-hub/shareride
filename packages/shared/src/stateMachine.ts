/** Ride lifecycle (driver-level). Spec §57. */
export const RIDE_STATUSES = [
  'DRAFT', 'PUBLISHED', 'DRIVER_READY', 'IN_PROGRESS', 'COMPLETED',
  'CANCELLED_BY_DRIVER', 'EXPIRED', 'DISPUTED',
] as const;
export type RideStatus = (typeof RIDE_STATUSES)[number];

/** Booking lifecycle (one per passenger). Spec §13, §56, §57. */
export const BOOKING_STATUSES = [
  'REQUESTED',        // driver-approval mode: waiting for driver
  'RESERVED',         // seat held, awaiting payment webhook (expires)
  'CONFIRMED',        // payment verified by webhook
  'PASSENGER_PICKUP', // driver arrived / picked up
  'IN_PROGRESS',
  'COMPLETED',
  'DECLINED',
  'CANCELLED_BY_PASSENGER',
  'CANCELLED_BY_DRIVER',
  'EXPIRED',
  'NO_SHOW',
  'DISPUTED',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Payment states. Spec §14. */
export const PAYMENT_STATUSES = [
  'PENDING', 'AUTHORIZED', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'CANCELLED',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

const RIDE_TRANSITIONS: Record<RideStatus, RideStatus[]> = {
  DRAFT: ['PUBLISHED', 'CANCELLED_BY_DRIVER'],
  PUBLISHED: ['DRIVER_READY', 'IN_PROGRESS', 'CANCELLED_BY_DRIVER', 'EXPIRED'],
  DRIVER_READY: ['IN_PROGRESS', 'CANCELLED_BY_DRIVER'],
  IN_PROGRESS: ['COMPLETED', 'DISPUTED'],
  COMPLETED: ['DISPUTED'],
  CANCELLED_BY_DRIVER: [],
  EXPIRED: [],
  DISPUTED: ['COMPLETED'],
};

const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  REQUESTED: ['RESERVED', 'DECLINED', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'EXPIRED'],
  RESERVED: ['CONFIRMED', 'EXPIRED', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER'],
  CONFIRMED: ['PASSENGER_PICKUP', 'IN_PROGRESS', 'CANCELLED_BY_PASSENGER', 'CANCELLED_BY_DRIVER', 'NO_SHOW'],
  PASSENGER_PICKUP: ['IN_PROGRESS', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED', 'DISPUTED'],
  COMPLETED: ['DISPUTED'],
  DECLINED: [],
  CANCELLED_BY_PASSENGER: [],
  CANCELLED_BY_DRIVER: [],
  EXPIRED: [],
  NO_SHOW: ['DISPUTED'],
  DISPUTED: ['COMPLETED'],
};

const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['AUTHORIZED', 'PAID', 'FAILED', 'CANCELLED'],
  AUTHORIZED: ['PAID', 'FAILED', 'CANCELLED'],
  PAID: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  PARTIALLY_REFUNDED: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  FAILED: [],
  REFUNDED: [],
  CANCELLED: [],
};

export class InvalidTransitionError extends Error {
  constructor(public entity: string, public from: string, public to: string) {
    super(`Invalid ${entity} transition ${from} → ${to}`);
  }
}

export function canTransitionRide(from: RideStatus, to: RideStatus) { return RIDE_TRANSITIONS[from].includes(to); }
export function canTransitionBooking(from: BookingStatus, to: BookingStatus) { return BOOKING_TRANSITIONS[from].includes(to); }
export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus) { return PAYMENT_TRANSITIONS[from].includes(to); }

export function assertRideTransition(from: RideStatus, to: RideStatus) {
  if (!canTransitionRide(from, to)) throw new InvalidTransitionError('ride', from, to);
}
export function assertBookingTransition(from: BookingStatus, to: BookingStatus) {
  if (!canTransitionBooking(from, to)) throw new InvalidTransitionError('booking', from, to);
}
export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus) {
  if (!canTransitionPayment(from, to)) throw new InvalidTransitionError('payment', from, to);
}

/** Statuses that hold a seat. Used for seat accounting and duplicate-booking prevention. */
export const SEAT_HOLDING_BOOKING_STATUSES: BookingStatus[] = ['RESERVED', 'CONFIRMED', 'PASSENGER_PICKUP', 'IN_PROGRESS'];
/** Statuses that count as an "active" booking for duplicate prevention. */
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ['REQUESTED', ...SEAT_HOLDING_BOOKING_STATUSES];
