/** API DTOs shared by backend, web and mobile. */
import type { BookingStatus, PaymentStatus, RideStatus } from './stateMachine';
import type { BookingBreakdown } from './pricing';

export interface Place { name: string; lat: number; lng: number; placeId?: string }

export interface PublicUser {
  id: string;
  name: string;
  photoUrl: string | null;
  rating: number;
  ratingCount: number;
  completedRides: number;
  memberSince: string;
  badges: { phone: boolean; email: boolean; identity: boolean; driver: boolean };
  languages: string[];
  about: string | null;
}

export interface RideSummary {
  id: string;
  status: RideStatus;
  driver: PublicUser;
  origin: Place;
  destination: Place;
  departureAt: string;
  arrivalEstimateAt: string;
  distanceMeters: number;
  durationSeconds: number;
  seatsTotal: number;
  seatsAvailable: number;
  pricePerSeatMinor: number;
  currency: string;
  countryCode: string;
  instantBooking: boolean;
  luggageAllowed: boolean;
  petsAllowed: boolean;
  womenOnly: boolean;
  smokingAllowed: boolean;
  vehicle: { make: string; model: string; color: string; type: string } | null;
  notes: string | null;
  polyline: string | null;
  isDemo: boolean;
  match?: { score: number; pickupDeviationM: number; dropoffDeviationM: number; rank: number };
}

export interface BookingDto {
  id: string;
  rideId: string;
  status: BookingStatus;
  seats: number;
  pickup: Place;
  dropoff: Place;
  breakdown: BookingBreakdown;
  expiresAt: string | null;
  paymentStatus: PaymentStatus | null;
  createdAt: string;
}

export interface ApiError { error: { code: string; message: string; referenceId?: string; details?: unknown } }
