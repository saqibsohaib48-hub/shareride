# Deployment

## Recommended production architecture

```
                 ┌────────────── CDN / WAF (Cloudflare, CloudFront) ──────────────┐
 iOS / Android ──┤                                                                  │
   (Expo/EAS)    │   web (Next.js)  ──►  API (Node, N replicas)  ──►  PostgreSQL   │
 Browsers ───────┤   Vercel or container      │      ▲                 (managed,   │
                 │                            │      │ webhooks         PITR, HA)  │
                 └────────────────────────────┼──────┼────────────────────────────┘
                                              ▼      │
                         Stripe · Google Maps / Mapbox · Twilio · Expo Push (FCM/APNs)
```

- **Database:** managed PostgreSQL 16 (AWS RDS/Aurora, GCP Cloud SQL, Azure Flexible Server, Neon, Supabase). Turn on automated backups and point-in-time recovery, encryption at rest, and private networking.
- **API:** stateless container (`deployment/Dockerfile.api`) on ECS/Fargate, Cloud Run, Azure Container Apps, Fly.io or Render. Run 2+ replicas behind a TLS-terminating load balancer with HTTPS only (HSTS is set by the API). Background jobs run in-process and use Postgres advisory locks, so any number of replicas is safe. At high volume, run a dedicated worker with `DISABLE_JOBS=true` on the web replicas.
- **Web:** Vercel (set the `NEXT_PUBLIC_*` env vars) or the `Dockerfile.web` container.
- **Mobile:** EAS Build + EAS Submit (`mobile/eas.json` has development / preview / production profiles).
- **Secrets:** AWS Secrets Manager, GCP Secret Manager or Azure Key Vault, injected as env vars. Never bake them into images.

## Release steps

```bash
# 1. Build images (from repo root)
docker build -f deployment/Dockerfile.api -t registry/share-ride-api:$SHA .
docker build -f deployment/Dockerfile.web --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
  --build-arg NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_... -t registry/share-ride-web:$SHA .

# 2. Migrate (one-off task, before switching traffic)
docker run --rm --env-file prod.env registry/share-ride-api:$SHA npx tsx src/migrate.ts

# 3. Roll out API, then web.  4. Smoke test /health and a test-mode booking.
```

**Never run the seed in production.** It refuses to anyway.

## Stripe in production
- Webhook endpoint: `https://api.example.com/webhooks/payments` (events listed in the README). Use **live** keys only in production.
- Consider **Stripe Connect** (Express accounts) for driver payouts and KYC. The `payouts` table and wallet buckets are designed for it.

## Mobile release
```bash
cd mobile
eas build --profile production --platform all
eas submit --profile production --platform ios
eas submit --profile production --platform android
```
Before release, set the bundle IDs, Google Maps SDK keys and Apple merchant ID in `app.json`, and `EXPO_PUBLIC_API_URL` / `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` in `eas.json` or EAS secrets.

## Observability
- The API logs structured JSON (pino). Ship logs to your platform (CloudWatch, Cloud Logging, Datadog). Users see a reference ID like `SR-123456` that is logged with the real error, so support can search for it.
- Alert on: 5xx rate, webhook signature failures, `refunds.status='PENDING'` older than 1h, open `fraud_flags`, and job failures (`"job failed"` log lines).

## Scaling notes
- Search pre-filters rides in SQL by time window, seats and route bounding box (indexed), then scores route compatibility in the app layer. Past roughly 100k active rides per region, move the bounding-box and route filtering to **PostGIS** (`ST_DWithin` on a `geography(LineString)` column).
- Read-heavy endpoints (`/countries`, `/currencies`, `/routes/popular`) are cache-friendly. Put the CDN in front of them.
