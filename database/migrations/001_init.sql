-- Share Ride — initial schema (PostgreSQL 14+)
-- Money: BIGINT minor units (fils/cents/paise). Percentages: basis points (500 = 5%).
-- Every financial / seat operation runs inside a transaction in the application layer;
-- CHECK constraints below are the last line of defence against negative balances & overbooking.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────────────────── Reference data ─────────────────────────
CREATE TABLE currencies (
  code        CHAR(3) PRIMARY KEY,
  name        TEXT NOT NULL,
  exponent    SMALLINT NOT NULL DEFAULT 2 CHECK (exponent BETWEEN 0 AND 4),
  symbol      TEXT
);

CREATE TABLE countries (
  code                   CHAR(2) PRIMARY KEY,               -- ISO-3166 alpha-2
  name                   TEXT NOT NULL,
  currency               CHAR(3) NOT NULL REFERENCES currencies(code),
  distance_unit          TEXT NOT NULL DEFAULT 'km' CHECK (distance_unit IN ('km','mi')),
  default_timezone       TEXT NOT NULL,
  default_language       TEXT NOT NULL DEFAULT 'en',
  payment_provider       TEXT NOT NULL DEFAULT 'stripe',
  ride_creation_enabled  BOOLEAN NOT NULL DEFAULT FALSE,     -- compliance kill-switch (spec §53)
  booking_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  women_only_allowed     BOOLEAN NOT NULL DEFAULT FALSE,     -- spec §26: only where legally appropriate
  verification_requirements JSONB NOT NULL DEFAULT '{"driver":["phone"],"passenger":["phone"]}',
  withdrawal_methods     JSONB NOT NULL DEFAULT '["bank_transfer"]',
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  name         TEXT NOT NULL,
  timezone     TEXT NOT NULL,
  lat          DOUBLE PRECISION NOT NULL,
  lng          DOUBLE PRECISION NOT NULL,
  is_enabled   BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (country_code, name)
);

-- Display-only FX rates (spec §29). Never used for charging.
CREATE TABLE exchange_rates (
  base        CHAR(3) NOT NULL REFERENCES currencies(code),
  quote       CHAR(3) NOT NULL REFERENCES currencies(code),
  rate        NUMERIC(20,10) NOT NULL CHECK (rate > 0),
  source      TEXT NOT NULL,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (base, quote)
);

-- Key/value platform config editable from admin (platform fee default, booking expiry …). Spec §74.
CREATE TABLE platform_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────── Users & auth ─────────────────────────
CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                 TEXT,
  phone                 TEXT,                                   -- E.164
  password_hash         TEXT,
  name                  TEXT NOT NULL,
  country_code          CHAR(2) REFERENCES countries(code),
  preferred_currency    CHAR(3) REFERENCES currencies(code),
  language              TEXT NOT NULL DEFAULT 'en',
  status                TEXT NOT NULL DEFAULT 'ACTIVE'
                         CHECK (status IN ('ACTIVE','RESTRICTED','SUSPENDED','BLOCKED','PENDING_DELETION','DELETED')),
  phone_verified_at     TIMESTAMPTZ,
  email_verified_at     TIMESTAMPTZ,
  identity_verified_at  TIMESTAMPTZ,
  driver_verified_at    TIMESTAMPTZ,
  google_sub            TEXT UNIQUE,
  apple_sub             TEXT UNIQUE,
  -- aggregates (denormalised, updated transactionally)
  rating_avg            NUMERIC(3,2) NOT NULL DEFAULT 0,
  rating_count          INTEGER NOT NULL DEFAULT 0,
  rides_as_driver       INTEGER NOT NULL DEFAULT 0,
  trips_as_passenger    INTEGER NOT NULL DEFAULT 0,
  driver_cancel_count   INTEGER NOT NULL DEFAULT 0,
  passenger_cancel_count INTEGER NOT NULL DEFAULT 0,
  no_show_count         INTEGER NOT NULL DEFAULT 0,
  trust_score           SMALLINT NOT NULL DEFAULT 50 CHECK (trust_score BETWEEN 0 AND 100), -- internal only (spec §36)
  is_demo               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at            TIMESTAMPTZ,
  CHECK (email IS NOT NULL OR phone IS NOT NULL OR google_sub IS NOT NULL OR apple_sub IS NOT NULL)
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX users_phone_uq ON users (phone) WHERE phone IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX users_country_idx ON users (country_code);
CREATE INDEX users_created_idx ON users (created_at);

CREATE TABLE profiles (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  photo_url      TEXT,
  about          TEXT,
  languages      TEXT[] NOT NULL DEFAULT '{}',
  gender         TEXT CHECK (gender IN ('female','male','other','undisclosed')),  -- only for women-only features; never public
  notification_prefs JSONB NOT NULL DEFAULT '{"push":true,"email":true,"sms":false}',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Staff roles (spec §50). Normal users never have a row here.
CREATE TABLE admin_users (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','ADMIN','SUPPORT','FINANCE','OPERATIONS')),
  mfa_secret_enc TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  family_id   UUID NOT NULL,                       -- rotation family; reuse of a revoked token revokes the family
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone       TEXT NOT NULL,
  code_hash   TEXT NOT NULL,
  purpose     TEXT NOT NULL DEFAULT 'login',
  attempts    SMALLINT NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX otp_phone_idx ON otp_codes (phone, created_at DESC);

CREATE TABLE device_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  platform    TEXT NOT NULL CHECK (platform IN ('ios','android','web')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE trusted_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone_enc   TEXT,                                -- AES-256-GCM, app-side
  email_enc   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_blocks (
  blocker_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

-- ───────────────────────── Vehicles & documents ─────────────────────────
CREATE TABLE vehicles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  make          TEXT NOT NULL,
  model         TEXT NOT NULL,
  year          SMALLINT CHECK (year BETWEEN 1950 AND 2100),
  color         TEXT NOT NULL,
  license_plate TEXT NOT NULL,                     -- never public (shown to confirmed passengers only)
  vehicle_type  TEXT NOT NULL DEFAULT 'sedan' CHECK (vehicle_type IN ('sedan','suv','hatchback','van','minivan','pickup','ev','other')),
  seats         SMALLINT NOT NULL CHECK (seats BETWEEN 1 AND 15),
  photos        JSONB NOT NULL DEFAULT '[]',
  verification_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING','VERIFIED','REJECTED','EXPIRED')),
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  is_demo       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_owner_idx ON vehicles (owner_id);

CREATE TABLE driver_documents (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id   UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  doc_type     TEXT NOT NULL CHECK (doc_type IN ('GOVERNMENT_ID','DRIVING_LICENSE','VEHICLE_REGISTRATION','VEHICLE_INSURANCE')),
  storage_key  TEXT NOT NULL,                      -- object-storage key; never a public URL
  status       TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','VERIFIED','REJECTED','EXPIRED')),
  expires_on   DATE,
  reviewed_by  UUID REFERENCES users(id),
  reviewed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────── Pricing & policy configuration ─────────────────────────
-- Versioned: an edit inserts a new row and deactivates the previous → full pricing history (spec §60).
CREATE TABLE pricing_rules (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code           CHAR(2) NOT NULL REFERENCES countries(code),
  currency               CHAR(3) NOT NULL REFERENCES currencies(code),
  version                INTEGER NOT NULL,
  base_fare_minor        BIGINT NOT NULL CHECK (base_fare_minor >= 0),
  per_km_minor           BIGINT NOT NULL CHECK (per_km_minor >= 0),
  min_fare_minor         BIGINT NOT NULL CHECK (min_fare_minor > 0),
  max_fare_minor         BIGINT NOT NULL,
  min_driver_price_minor BIGINT NOT NULL CHECK (min_driver_price_minor > 0),
  max_driver_price_minor BIGINT NOT NULL,
  platform_fee_bps       INTEGER NOT NULL DEFAULT 500 CHECK (platform_fee_bps BETWEEN 0 AND 5000),
  fee_bearer             TEXT NOT NULL DEFAULT 'DRIVER' CHECK (fee_bearer IN ('DRIVER','PASSENGER')),
  tax_on_fee_bps         INTEGER NOT NULL DEFAULT 0 CHECK (tax_on_fee_bps BETWEEN 0 AND 5000),
  rounding_minor         INTEGER NOT NULL DEFAULT 100 CHECK (rounding_minor >= 1),
  suggestion_spread_bps  INTEGER NOT NULL DEFAULT 1000 CHECK (suggestion_spread_bps BETWEEN 0 AND 5000),
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  note                   TEXT,
  created_by             UUID REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (max_fare_minor >= min_fare_minor),
  CHECK (max_driver_price_minor >= min_driver_price_minor),
  UNIQUE (country_code, version)
);
CREATE UNIQUE INDEX pricing_rules_one_active ON pricing_rules (country_code) WHERE is_active;

CREATE TABLE cancellation_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code  CHAR(2) REFERENCES countries(code),      -- NULL = global default
  ride_type     TEXT NOT NULL DEFAULT 'standard',
  policy        JSONB NOT NULL,                           -- CancellationPolicy (packages/shared/src/cancellation.ts)
  restriction_thresholds JSONB NOT NULL DEFAULT '{"warning":3,"restricted":5,"review":8,"suspend":12}',
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX cancellation_rules_active ON cancellation_rules (COALESCE(country_code,'**'), ride_type) WHERE is_active;

CREATE TABLE tax_rules (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  name         TEXT NOT NULL,                             -- VAT / GST / Sales tax
  applies_to   TEXT NOT NULL CHECK (applies_to IN ('PLATFORM_FEE','FARE')),
  rate_bps     INTEGER NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  is_active    BOOLEAN NOT NULL DEFAULT FALSE,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────── Rides ─────────────────────────
CREATE TABLE rides (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id            UUID NOT NULL REFERENCES users(id),
  vehicle_id           UUID REFERENCES vehicles(id),
  country_code         CHAR(2) NOT NULL REFERENCES countries(code),
  currency             CHAR(3) NOT NULL REFERENCES currencies(code),
  pricing_rule_id      UUID NOT NULL REFERENCES pricing_rules(id),
  status               TEXT NOT NULL DEFAULT 'PUBLISHED'
                        CHECK (status IN ('DRAFT','PUBLISHED','DRIVER_READY','IN_PROGRESS','COMPLETED','CANCELLED_BY_DRIVER','EXPIRED','DISPUTED')),
  ride_type            TEXT NOT NULL DEFAULT 'standard',
  origin_name          TEXT NOT NULL,
  origin_lat           DOUBLE PRECISION NOT NULL,
  origin_lng           DOUBLE PRECISION NOT NULL,
  dest_name            TEXT NOT NULL,
  dest_lat             DOUBLE PRECISION NOT NULL,
  dest_lng             DOUBLE PRECISION NOT NULL,
  departure_at         TIMESTAMPTZ NOT NULL,
  arrival_estimate_at  TIMESTAMPTZ NOT NULL,
  distance_meters      INTEGER NOT NULL CHECK (distance_meters > 0),
  duration_seconds     INTEGER NOT NULL CHECK (duration_seconds > 0),
  seats_total          SMALLINT NOT NULL CHECK (seats_total BETWEEN 1 AND 14),
  seats_available      SMALLINT NOT NULL,
  price_per_seat_minor BIGINT NOT NULL CHECK (price_per_seat_minor > 0),
  suggested_price_minor BIGINT,
  instant_booking      BOOLEAN NOT NULL DEFAULT TRUE,
  luggage_allowed      BOOLEAN NOT NULL DEFAULT TRUE,
  pets_allowed         BOOLEAN NOT NULL DEFAULT FALSE,
  smoking_allowed      BOOLEAN NOT NULL DEFAULT FALSE,
  women_only           BOOLEAN NOT NULL DEFAULT FALSE,
  pickup_flexibility_m INTEGER NOT NULL DEFAULT 2000,
  notes                TEXT,
  is_demo              BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at           TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  cancelled_at         TIMESTAMPTZ,
  -- Overbooking is impossible at the DB level:
  CONSTRAINT seats_non_negative CHECK (seats_available >= 0),
  CONSTRAINT seats_not_above_total CHECK (seats_available <= seats_total),
  CHECK (arrival_estimate_at > departure_at)
);
CREATE INDEX rides_search_idx ON rides (country_code, status, departure_at) WHERE status = 'PUBLISHED';
CREATE INDEX rides_driver_idx ON rides (driver_id, departure_at DESC);
CREATE INDEX rides_origin_idx ON rides (origin_lat, origin_lng);

CREATE TABLE ride_routes (
  ride_id        UUID PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,                  -- google | mapbox | mock
  polyline       TEXT NOT NULL,                  -- encoded, precision 5
  points         JSONB NOT NULL,                 -- sampled [{lat,lng}] (≤200) for matching
  min_lat DOUBLE PRECISION NOT NULL, max_lat DOUBLE PRECISION NOT NULL,
  min_lng DOUBLE PRECISION NOT NULL, max_lng DOUBLE PRECISION NOT NULL,
  is_approximate BOOLEAN NOT NULL DEFAULT FALSE  -- TRUE only for dev mock provider
);
CREATE INDEX ride_routes_bbox_idx ON ride_routes (min_lat, max_lat, min_lng, max_lng);

CREATE TABLE ride_stops (
  id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id  UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  seq      SMALLINT NOT NULL,
  name     TEXT NOT NULL,
  lat      DOUBLE PRECISION NOT NULL,
  lng      DOUBLE PRECISION NOT NULL,
  UNIQUE (ride_id, seq)
);

-- ───────────────────────── Bookings ─────────────────────────
CREATE TABLE promo_codes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code               TEXT NOT NULL UNIQUE,
  discount_type      TEXT NOT NULL CHECK (discount_type IN ('PERCENT','FIXED')),
  value              BIGINT NOT NULL CHECK (value > 0),         -- bps for PERCENT, minor units for FIXED
  max_discount_minor BIGINT,
  min_ride_minor     BIGINT,
  country_code       CHAR(2) REFERENCES countries(code),
  new_users_only     BOOLEAN NOT NULL DEFAULT FALSE,
  starts_at          TIMESTAMPTZ,
  ends_at            TIMESTAMPTZ,
  max_redemptions    INTEGER,
  redemptions        INTEGER NOT NULL DEFAULT 0,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE bookings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id               UUID NOT NULL REFERENCES rides(id),
  passenger_id          UUID NOT NULL REFERENCES users(id),
  status                TEXT NOT NULL
                         CHECK (status IN ('REQUESTED','RESERVED','CONFIRMED','PASSENGER_PICKUP','IN_PROGRESS','COMPLETED',
                                           'DECLINED','CANCELLED_BY_PASSENGER','CANCELLED_BY_DRIVER','EXPIRED','NO_SHOW','DISPUTED')),
  seats                 SMALLINT NOT NULL CHECK (seats >= 1),
  pickup_name           TEXT NOT NULL,
  pickup_lat            DOUBLE PRECISION NOT NULL,
  pickup_lng            DOUBLE PRECISION NOT NULL,
  pickup_status         TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (pickup_status IN ('PROPOSED','APPROVED','REJECTED')),
  dropoff_name          TEXT NOT NULL,
  dropoff_lat           DOUBLE PRECISION NOT NULL,
  dropoff_lng           DOUBLE PRECISION NOT NULL,
  -- frozen price snapshot (spec §54/§55) — never recomputed after creation
  currency              CHAR(3) NOT NULL REFERENCES currencies(code),
  price_per_seat_minor  BIGINT NOT NULL CHECK (price_per_seat_minor > 0),
  gross_fare_minor      BIGINT NOT NULL CHECK (gross_fare_minor > 0),
  platform_fee_minor    BIGINT NOT NULL CHECK (platform_fee_minor >= 0),
  tax_minor             BIGINT NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  promo_discount_minor  BIGINT NOT NULL DEFAULT 0 CHECK (promo_discount_minor >= 0),
  passenger_total_minor BIGINT NOT NULL CHECK (passenger_total_minor >= 0),
  driver_earnings_minor BIGINT NOT NULL CHECK (driver_earnings_minor >= 0),
  platform_fee_bps      INTEGER NOT NULL,
  fee_bearer            TEXT NOT NULL,
  promo_code_id         UUID REFERENCES promo_codes(id),
  idempotency_key       TEXT UNIQUE,
  expires_at            TIMESTAMPTZ,                   -- seat hold expiry while RESERVED
  refund_bps            INTEGER,
  cancelled_by          TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at          TIMESTAMPTZ,
  cancelled_at          TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  CHECK (gross_fare_minor = price_per_seat_minor * seats)
);
-- No duplicate active bookings per passenger per ride (spec §85).
CREATE UNIQUE INDEX bookings_one_active_per_passenger ON bookings (ride_id, passenger_id)
  WHERE status IN ('REQUESTED','RESERVED','CONFIRMED','PASSENGER_PICKUP','IN_PROGRESS');
CREATE INDEX bookings_passenger_idx ON bookings (passenger_id, created_at DESC);
CREATE INDEX bookings_ride_idx ON bookings (ride_id);
CREATE INDEX bookings_expiry_idx ON bookings (expires_at) WHERE status = 'RESERVED';

-- Seat ledger: every hold / allocation / release is recorded (spec §40).
CREATE TABLE ride_seats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  seats       SMALLINT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('HOLD','ALLOCATE','RELEASE')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ride_seats_ride_idx ON ride_seats (ride_id);

CREATE TABLE promo_redemptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_code_id UUID NOT NULL REFERENCES promo_codes(id),
  user_id       UUID NOT NULL REFERENCES users(id),
  booking_id    UUID NOT NULL REFERENCES bookings(id),
  discount_minor BIGINT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (promo_code_id, user_id)
);

-- ───────────────────────── Payments ─────────────────────────
CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          UUID NOT NULL REFERENCES bookings(id),
  provider            TEXT NOT NULL,                 -- stripe | mock
  provider_payment_id TEXT NOT NULL UNIQUE,          -- e.g. Stripe PaymentIntent id
  status              TEXT NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','AUTHORIZED','PAID','FAILED','REFUNDED','PARTIALLY_REFUNDED','CANCELLED')),
  amount_minor        BIGINT NOT NULL CHECK (amount_minor > 0),
  currency            CHAR(3) NOT NULL REFERENCES currencies(code),
  refunded_minor      BIGINT NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  failure_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (refunded_minor <= amount_minor)
);
-- At most one live payment per booking → no duplicate charges (spec §85).
CREATE UNIQUE INDEX payments_one_live_per_booking ON payments (booking_id)
  WHERE status IN ('PENDING','AUTHORIZED','PAID','PARTIALLY_REFUNDED');

-- Webhook idempotency: each provider event is processed exactly once.
CREATE TABLE payment_events (
  id            TEXT PRIMARY KEY,                    -- provider event id
  provider      TEXT NOT NULL,
  type          TEXT NOT NULL,
  payload       JSONB NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ
);

CREATE TABLE refunds (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         UUID NOT NULL REFERENCES payments(id),
  amount_minor       BIGINT NOT NULL CHECK (amount_minor > 0),
  provider_refund_id TEXT UNIQUE,
  status             TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUCCEEDED','FAILED')),
  reason             TEXT NOT NULL,
  initiated_by       UUID REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ───────────────────────── Wallet & earnings ─────────────────────────
CREATE TABLE wallets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  currency         CHAR(3) NOT NULL REFERENCES currencies(code),
  available_minor  BIGINT NOT NULL DEFAULT 0 CHECK (available_minor >= 0),   -- never negative (spec §85)
  pending_minor    BIGINT NOT NULL DEFAULT 0 CHECK (pending_minor >= 0),
  withdrawn_minor  BIGINT NOT NULL DEFAULT 0 CHECK (withdrawn_minor >= 0),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, currency)
);

CREATE TABLE wallet_transactions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id    UUID NOT NULL REFERENCES wallets(id),
  booking_id   UUID REFERENCES bookings(id),
  ride_id      UUID REFERENCES rides(id),
  type         TEXT NOT NULL CHECK (type IN ('EARNING_PENDING','EARNING_RELEASED','EARNING_REVERSED','PAYMENT','REFUND','PAYOUT','ADJUSTMENT','CREDIT')),
  amount_minor BIGINT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PENDING','COMPLETED','FAILED')),
  description  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wallet_tx_wallet_idx ON wallet_transactions (wallet_id, created_at DESC);

CREATE TABLE driver_earnings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     UUID NOT NULL REFERENCES users(id),
  booking_id    UUID NOT NULL UNIQUE REFERENCES bookings(id),   -- one earning per booking
  ride_id       UUID NOT NULL REFERENCES rides(id),
  currency      CHAR(3) NOT NULL REFERENCES currencies(code),
  gross_minor   BIGINT NOT NULL CHECK (gross_minor >= 0),
  fee_minor     BIGINT NOT NULL CHECK (fee_minor >= 0),
  tax_minor     BIGINT NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  net_minor     BIGINT NOT NULL CHECK (net_minor >= 0),           -- never negative earnings
  status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','AVAILABLE','PAID_OUT','REVERSED')),
  available_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX driver_earnings_driver_idx ON driver_earnings (driver_id, created_at DESC);

CREATE TABLE payouts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     UUID NOT NULL REFERENCES users(id),
  wallet_id     UUID NOT NULL REFERENCES wallets(id),
  amount_minor  BIGINT NOT NULL CHECK (amount_minor > 0),
  currency      CHAR(3) NOT NULL REFERENCES currencies(code),
  method        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','PROCESSING','COMPLETED','FAILED','CANCELLED')),
  provider_ref  TEXT,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

-- ───────────────────────── Ratings, chat, notifications ─────────────────────────
CREATE TABLE ratings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id     UUID NOT NULL REFERENCES bookings(id),
  ride_id        UUID NOT NULL REFERENCES rides(id),
  rater_id       UUID NOT NULL REFERENCES users(id),
  ratee_id       UUID NOT NULL REFERENCES users(id),
  ratee_role     TEXT NOT NULL CHECK (ratee_role IN ('DRIVER','PASSENGER')),
  stars          SMALLINT NOT NULL CHECK (stars BETWEEN 1 AND 5),
  communication  SMALLINT CHECK (communication BETWEEN 1 AND 5),
  punctuality    SMALLINT CHECK (punctuality BETWEEN 1 AND 5),
  cleanliness    SMALLINT CHECK (cleanliness BETWEEN 1 AND 5),
  safety         SMALLINT CHECK (safety BETWEEN 1 AND 5),
  respect        SMALLINT CHECK (respect BETWEEN 1 AND 5),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (booking_id, rater_id),
  CHECK (rater_id <> ratee_id)
);
CREATE INDEX ratings_ratee_idx ON ratings (ratee_id, created_at DESC);

CREATE TABLE reviews (
  rating_id   UUID PRIMARY KEY REFERENCES ratings(id) ON DELETE CASCADE,
  comment     TEXT NOT NULL CHECK (length(comment) <= 1000),
  is_hidden   BOOLEAN NOT NULL DEFAULT FALSE,           -- moderation
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id     UUID NOT NULL REFERENCES rides(id),
  sender_id   UUID NOT NULL REFERENCES users(id),
  recipient_id UUID REFERENCES users(id),
  kind        TEXT NOT NULL DEFAULT 'TEXT' CHECK (kind IN ('TEXT','PICKUP_LOCATION','SHARED_LOCATION','SYSTEM')),
  body        TEXT NOT NULL CHECK (length(body) <= 2000),
  data        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX messages_ride_idx ON messages (ride_id, created_at);

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  read_at     TIMESTAMPTZ,
  push_sent_at TIMESTAMPTZ,                        -- transactional outbox: push is sent after commit by a worker
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_outbox_idx ON notifications (created_at) WHERE push_sent_at IS NULL;

-- ───────────────────────── Support, disputes, trust ─────────────────────────
CREATE TABLE support_tickets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference   TEXT NOT NULL UNIQUE,
  user_id     UUID NOT NULL REFERENCES users(id),
  booking_id  UUID REFERENCES bookings(id),
  ride_id     UUID REFERENCES rides(id),
  category    TEXT NOT NULL CHECK (category IN ('PAYMENT','DRIVER','PASSENGER','SAFETY','PICKUP','CANCELLATION','REFUND','LOST_ITEM','OTHER')),
  status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','UNDER_REVIEW','WAITING_FOR_USER','RESOLVED','CLOSED')),
  priority    TEXT NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  assigned_to UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX support_tickets_status_idx ON support_tickets (status, created_at DESC);

CREATE TABLE ticket_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  author_id   UUID NOT NULL REFERENCES users(id),
  is_internal BOOLEAN NOT NULL DEFAULT TRUE,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE disputes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      UUID REFERENCES support_tickets(id),
  booking_id     UUID NOT NULL REFERENCES bookings(id),
  status         TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','INVESTIGATING','RESOLVED_REFUND','RESOLVED_NO_REFUND','CLOSED')),
  resolution     TEXT,
  refund_minor   BIGINT CHECK (refund_minor >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ
);

CREATE TABLE referrals (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id   UUID NOT NULL REFERENCES users(id),
  referred_id   UUID NOT NULL UNIQUE REFERENCES users(id),
  code          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','QUALIFIED','REWARDED','REJECTED')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (referrer_id <> referred_id)
);

-- Fraud signals for human review (spec §35). Never auto-bans.
CREATE TABLE fraud_flags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id),
  kind        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'MEDIUM' CHECK (severity IN ('LOW','MEDIUM','HIGH')),
  details     JSONB NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REVIEWING','DISMISSED','ACTIONED')),
  reviewed_by UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX fraud_flags_open_idx ON fraud_flags (status, created_at DESC);

-- ───────────────────────── Audit ─────────────────────────
CREATE TABLE audit_logs (
  id           BIGSERIAL PRIMARY KEY,
  actor_id     UUID REFERENCES users(id),
  actor_role   TEXT,
  action       TEXT NOT NULL,          -- e.g. auth.login, ride.create, booking.confirm, pricing.update
  entity_type  TEXT,
  entity_id    TEXT,
  data         JSONB NOT NULL DEFAULT '{}',
  ip           INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_action_idx ON audit_logs (action, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
