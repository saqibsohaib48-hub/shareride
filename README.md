# Share Ride

**Your Ride. Their Journey. Share the Way.**

A person is already travelling somewhere and has empty seats. Another person wants to go the same way. Share Ride connects them, calculates a fair distance‑based price, takes payment securely, pays the driver, and keeps a configurable platform fee (default **5%**).

This repository is the **P0 MVP** (signup → create ride → search → book → pay → trip → rating → earnings → admin), built as a production foundation. The schema already includes P1/P2 tables (wallet payouts, chat, disputes, referrals, promo codes, trusted contacts, fraud flags), so later features plug in without schema rewrites. See [What's built vs. next](#whats-built-vs-next).

| Part | Tech | Folder |
|---|---|---|
| Shared core (pricing, commission, currency, route matching, state machine, i18n) | TypeScript, unit-tested | `packages/shared` |
| API | Node 22 + Express + TypeScript, PostgreSQL (`pg`), Zod validation | `backend` |
| Database | PostgreSQL 14+ SQL migrations + demo seed | `database` |
| Web app + Admin dashboard | Next.js 14 (App Router) | `web` (`/admin/*`) |
| Mobile app (iOS / Android) | Expo SDK 52 + Expo Router | `mobile` |
| API docs | OpenAPI 3 (Swagger UI at `/docs`) | `docs/openapi.yaml` |
| Deployment | Docker, docker‑compose, GitHub Actions CI | `deployment`, `.github` |

---

## 1. Quick start (Windows, macOS, Linux)

**Requirements:** Node.js 20+ (22 recommended), PostgreSQL 14+ (or Docker Desktop).

```powershell
cd Documents\share-ride

# 1) Postgres — easiest via Docker Desktop:
docker run --name shareride-db -e POSTGRES_USER=shareride -e POSTGRES_PASSWORD=shareride -e POSTGRES_DB=shareride -p 5432:5432 -d postgres:16

# 2) Install (root workspaces: shared + backend + web)
npm install

# 3) Configure the API
copy .env.example backend\.env        # macOS/Linux: cp .env.example backend/.env
#   Edit backend\.env:  JWT_SECRET, DATA_ENCRYPTION_KEY, SEED_ADMIN_PASSWORD (12+ chars)
#   Generate secrets:
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"         # DATA_ENCRYPTION_KEY

# 4) Database: migrate + demo data (+ dev admin from SEED_ADMIN_*)
npm run db:seed

# 5) Run
npm run dev:api        # http://localhost:4000  (Swagger: http://localhost:4000/docs)
npm run dev:web        # http://localhost:3000  (second terminal)
```

Create `web\.env.local` with `NEXT_PUBLIC_API_URL=http://localhost:4000` (already the default).

**Try it:**
- Passenger: `sara.ibrahim@demo.shareride.invalid` / `DemoPass123`
- Driver: `ahmed.al.mansoori@demo.shareride.invalid` / `DemoPass123`
- Admin: the `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` you set → open **/admin**

By default the app runs with **mock maps** and **mock payments**. Mock payments go through the real webhook code path with an HMAC signature, and both mocks are refused in production. Phone OTP codes appear in the API log and in the UI in development.

### Mobile app
```powershell
cd mobile
npm install
# point the app at your API (use your PC's LAN IP for a physical phone; 10.0.2.2 for the Android emulator)
$env:EXPO_PUBLIC_API_URL="http://192.168.1.20:4000"
npx expo start
```
Stripe PaymentSheet, maps and push need a **development build** (`npx expo run:android` / `run:ios`, or `eas build --profile development`); they are not available inside Expo Go. Add your machine to `CORS_ORIGINS` only for the web; mobile doesn't need CORS.

---

## 2. Environment variables

All variables are documented in [`.env.example`](.env.example). Secrets are **only** read from env; nothing is hard-coded. In production the API **refuses to start** with mock maps/payments/SMS or missing Stripe keys.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `JWT_SECRET` | ≥32 chars; signs 15-min access tokens |
| `DATA_ENCRYPTION_KEY` | 32-byte hex; AES-256-GCM for sensitive fields (trusted-contact phones, MFA secrets) |
| `CORS_ORIGINS` | Comma-separated web origins |
| `MAP_PROVIDER` | `google` \| `mapbox` \| `mock` |
| `PAYMENT_PROVIDER` | `stripe` \| `mock` |
| `SMS_PROVIDER` | `twilio` \| `console` |
| `PUSH_PROVIDER` | `expo` \| `console` |
| `GOOGLE_OAUTH_CLIENT_IDS`, `APPLE_CLIENT_IDS` | Allowed audiences for Google / Apple ID tokens |
| `EXCHANGE_RATE_API_URL` | Display-only FX source, `{BASE}` placeholder |
| `BOOKING_EXPIRY_MINUTES` | Seat-hold window while paying (default 15) |
| `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` | Public client config (API URL, Stripe publishable key, Mapbox public token, OAuth client IDs) |

---

## 3. Payment setup (Stripe)

1. Create a Stripe account → Developers → API keys. Put `STRIPE_SECRET_KEY` in `backend/.env`, the publishable key in `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (web) and `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` (mobile). Set `PAYMENT_PROVIDER=stripe`.
2. Webhook: Developers → Webhooks → add endpoint `https://<api-host>/webhooks/payments` with events `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `payment_intent.amount_capturable_updated`. Copy the signing secret to `STRIPE_WEBHOOK_SECRET`.
   Local testing: `stripe listen --forward-to localhost:4000/webhooks/payments`.
3. Enable the payment methods you want (cards, Apple Pay, Google Pay, local methods) in the Dashboard. The PaymentElement and PaymentSheet pick them up automatically.
4. Apple Pay on web: verify your domain in Stripe. On iOS: set the merchant ID in `mobile/app.json`.

**How it's secured:** the amount always comes from the server-side booking snapshot. The client only receives a client secret. **Only the verified webhook confirms a booking.** Each event is processed exactly once (`payment_events`), and the amount and currency are checked against the stored payment (a mismatch is rejected and raised as a fraud flag). At most one live payment exists per booking (unique index). If an abandoned payment gets captured anyway, it is refunded automatically. Refunds are queued in the same transaction as the cancellation, executed after commit, and retried by a background job.

Stripe charges in the ride's currency. For 3-decimal currencies (KWD/BHD/OMR), Stripe requires amounts ending in 0; set `rounding_minor` ≥ 10 for those countries.

## 4. Maps setup

- **Google:** enable **Routes API** and **Places API (New)**. Set `MAP_PROVIDER=google` and `GOOGLE_MAPS_API_KEY` (restrict the key to your server IPs). For the mobile map, add a separate Maps SDK key in `mobile/app.json` (`ios.config.googleMapsApiKey`, `android.config.googleMaps.apiKey`).
- **Mapbox:** `MAP_PROVIDER=mapbox`, `MAPBOX_ACCESS_TOKEN` (Directions + Geocoding). For static route images on the web, set a URL-restricted public token in `NEXT_PUBLIC_MAPBOX_TOKEN`; otherwise the web draws the route as an SVG.
- Pricing **always uses road (driving) distance** from the provider. The mock provider (straight line × 1.25) is flagged `approximate` and blocked in production.

## 5. Country & pricing configuration

Everything is editable in **Admin → Pricing / Countries**, with no code changes:

- **Pricing rule per country:** base fare, price/km, min/max fare, min/max driver price per seat, platform fee %, **who pays the fee** (driver or passenger), tax on fee %, rounding, suggestion spread. Each save creates a **new version**. History is kept, any version can be rolled back, and every change is audit-logged. Bookings freeze their price snapshot, so a change never alters existing bookings.
- **Countries:** turn ride creation and bookings on or off (compliance kill-switch), allow women-only rides, set required driver verification levels (phone / email / identity / driver), and withdrawal methods.
- **Cancellation rules:** refund tiers per country and ride type (default: >24h 100%, 12–24h 75%, <12h 50%, driver cancels 100%), plus escalating consequences for repeated cancellations (warning → restriction → review → suspension, with human review before any permanent action).
- **Add a country:** insert into `currencies` + `countries` (see `database/seed/seed.ts`), then create its pricing in Admin.

> ⚠️ Seeded prices are **illustrative placeholders**, not market or regulated prices. Set real values only after checking local market and regulatory data.

### The fee rule you need to confirm
Your spec says both "passenger pays AED 50, driver gets 47.50" (§3, §55) and "passenger pays 52.50" (§12, §54). Doing both would charge 10% in total. This is a per-country setting, `fee_bearer`, and it defaults to **DRIVER** (passenger pays 50.00, driver gets 47.50, platform keeps 2.50). Switch a country to **PASSENGER** to add the fee at checkout instead.

### Ranking weights
Search ranking blends route match, departure-time closeness, price, rating, verification and the internal trust score. The weights live in `packages/shared/src/ranking.ts` (`DEFAULT_RANK_WEIGHTS`, marked `TODO(product)`). See the note at the end of the delivery message on tuning them.

## 6. Admin login setup

The admin account is created **only** from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` when you run the seed in a non-production environment. In production, create staff by inserting a row in `admin_users` for an existing user, with role `SUPER_ADMIN | ADMIN | SUPPORT | FINANCE | OPERATIONS`. Role and status are read from the database on **every request**; they are never trusted from the token. The permission matrix is in `backend/src/middleware/auth.ts`.

## 7. Testing

```powershell
# needs a Postgres DB named shareride_test (wiped on every run)
docker exec shareride-db createdb -U shareride shareride_test
npm test
```
- **Unit (28):** pricing, commission (incl. "fee + earnings always equal gross" over thousands of combinations), tax separation, promos, currency, distance, route matching, cancellation tiers, state machine, ranking, i18n.
- **Integration / E2E (7):** driver signup → verify phone → vehicle → create ride → passenger signup → search (with nearby-pickup matching) → book → pay → **webhook** → confirmed → start → complete → earnings released → ratings both ways → admin KPIs. Plus driver-approval mode, failed payment → hold expiry, cancellations at >24h and <12h, driver cancellation refunds, versioned pricing, country kill-switch.
- **Security (12):** unauthenticated access, role escalation and forged JWTs, staff permission boundaries, forged and tampered webhooks, webhook replay, **6 concurrent bookings for the last 2 seats → exactly 2 succeed**, duplicate booking and idempotency, refresh-token reuse → session family revoked, OTP attempt cap, suspension lockout, friendly errors with no stack traces, SQL-injection input.

`npm run typecheck` checks shared + API + web. For mobile: `cd mobile && npx tsc --noEmit && npx expo export --platform android`.

## 8. Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). In short: managed Postgres, the API container (`deployment/Dockerfile.api`) behind HTTPS, the web container (or Vercel), migrations as a release step, Stripe webhook pointed at the API, and EAS Build for the apps.

## 9. Production launch checklist

See [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md).

## What's built vs. next

**Built and tested (P0):** email, phone-OTP, Google and Apple sign-in; profile and verification badges; vehicles; create ride with road-distance pricing and smart suggestion; route-matching search with ranking and sorting; instant and driver-approval booking; transactional seat holds; Stripe checkout with webhook confirmation; transparent fee breakdown; driver earnings with pending/available wallet; ride history; two-way ratings; in-app and push notifications (transactional outbox); cancellations and refunds with configurable policy; admin dashboard (per-currency GMV/revenue/earnings, KPIs, charts), pricing management with versions, countries/compliance switches, user and ride management, refunds, support tickets, fraud flags, audit log; i18n in 6 languages with Arabic/Urdu RTL; offline banner and cached trips on mobile; account deletion; Safety Center with SOS, trusted contacts and safety reports.

**Schema-ready, next to build (P1/P2):** in-app chat UI (`messages`), live GPS tracking (WebSocket channel during the trip window), driver withdrawals (`payouts`, with Stripe Connect recommended for driver KYC and payouts), document upload to object storage (`driver_documents`), promo-code admin UI (redemption logic is already live in the API), referrals, AI support assistant, demand-based dynamic pricing, PostGIS for large-scale route search, admin 2FA (TOTP).
