# Architecture & key decisions

## Layout
```
share-ride/
├── packages/shared/      Pure TS business core used by API, web and mobile
│   ├── money.ts          integer minor units, basis points, display-only FX
│   ├── pricing.ts        distance pricing, smart suggestion, booking/commission maths
│   ├── routeMatch.ts     route compatibility (pickup/drop-off vs driver polyline)
│   ├── ranking.ts        search ranking weights
│   ├── stateMachine.ts   ride / booking / payment transitions
│   ├── cancellation.ts   refund tiers
│   └── i18n/             en, ar, hi, ur, fr, es (+ RTL)
├── backend/src/
│   ├── routes/           HTTP layer (validation with zod, auth, permissions)
│   ├── services/         business logic (transactions live here)
│   ├── providers/        maps (google|mapbox|mock), payments (stripe|mock), sms, push
│   ├── middleware/       auth/RBAC, error handling
│   └── jobs/             reservation expiry, push outbox, refund retries, FX refresh
├── database/migrations/  SQL schema · database/seed/ demo data
├── web/src/app/          Next.js screens incl. /admin/*
└── mobile/app/           Expo Router screens
```

## Money
- All amounts are **BIGINT minor units**. Percentages are **basis points**. `calculateBooking()` in `packages/shared` is the single source of truth, used by the API at booking time and by both UIs for previews.
- `platform_fee = round_half_up(gross × fee_bps)`, `driver = gross − fee − tax` (driver-bears mode). Tests prove `fee + driver == gross` across thousands of combinations.
- Bookings **freeze** their full price snapshot (`price_per_seat`, `fee_bps`, `fee_bearer`, every amount). A DB `CHECK` enforces `gross = price × seats`.
- Tax is a separate component, never folded into the fee. Promo discounts are a platform marketing cost and never reduce driver earnings.
- Multi-currency reporting is **per currency**. A converted total is shown only as a labelled, display-only figure.

## Seats & concurrency
- Seat hold = `UPDATE rides SET seats_available = seats_available − n WHERE id = $1 AND seats_available >= n` inside a transaction that already holds `SELECT … FOR UPDATE` on the ride, backed by `CHECK (seats_available >= 0)`.
- A partial unique index prevents two active bookings for the same passenger on the same ride. An idempotency key makes client retries return the same booking.
- `ride_seats` is an append-only ledger (HOLD / ALLOCATE / RELEASE) for audit.

## Payments
```
book (RESERVED, seat held, expires_at) → /payments/checkout (PaymentIntent, amount from snapshot)
  → client confirms with Stripe UI → Stripe webhook (signature verified)
  → payment_events insert (idempotent) → amount/currency check → booking CONFIRMED,
    driver_earnings PENDING, wallet.pending += net, notifications (outbox)
expiry job → RESERVED past expires_at → EXPIRED, seat released, PaymentIntent cancelled
```
- Side effects that must survive a rejection (fraud flags, token-family revocation, OTP attempt counts) are committed **before** the error is raised.
- Refunds: a `refunds` row is written in the same transaction as the cancellation, the provider call happens after commit, and a background job retries failures.

## State machines
Defined in `packages/shared/src/stateMachine.ts` and enforced in every service before a status change. Invalid transitions return `409 INVALID_STATUS`.

## Privacy by design
- Public profile = first name + last initial, rating, ride count, badges, languages. Never phone, email, documents or exact address.
- Ride coordinates are coarsened to about 1 km for the public. Exact pickup and the vehicle plate are shown only to the driver and confirmed passengers.
- `trust_score` is internal: it is used for ranking and fraud triage and never serialised to users.
- Gender is optional and private, used only for women-only eligibility.

## Security summary
Bcrypt (cost 12) passwords; 15-minute JWT access tokens plus rotating refresh tokens with reuse detection; RBAC read from the DB on each request; zod validation on every input; parameterised SQL only; helmet (HSTS, CSP, frame-deny), CORS allow-list, rate limits (global, auth and OTP); AES-256-GCM for sensitive fields; audit log for logins, ride and booking lifecycle, payments, refunds, admin and pricing changes. CSRF does not apply to the bearer-token API. For cookie-based web sessions, add a same-site BFF.

## Notifications
A transactional outbox: rows are written inside business transactions, and `dispatchPendingPushes` sends them after commit through Expo Push (FCM/APNs), honouring user preferences. Email and SMS channels plug into the same outbox.

## Background jobs
In-process intervals guarded by Postgres advisory locks (safe with N replicas): reservation expiry (30s), push outbox (5s), refund retries (2m), ride-starting-soon (5m), stale-ride expiry (10m), FX refresh (6h).
