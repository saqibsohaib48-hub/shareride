# Production launch checklist

## Legal & compliance (per country / city) — spec §51–53
- [ ] Transportation regulations reviewed: is paid ride-sharing or cost-sharing permitted? Any fare caps (cost-sharing only)?
- [ ] Driver licensing, vehicle requirements and **insurance** confirmed. Set verification requirements in Admin → Countries.
- [ ] Tax registration (VAT/GST/sales tax) on the platform fee confirmed with a tax adviser. Set `tax_on_fee_bps` and enable `tax_rules`.
- [ ] Payment regulations and the merchant-of-record model confirmed with the payment provider; Stripe Connect / KYC for drivers.
- [ ] Consumer protection: refund and cancellation policy reviewed. Configure `cancellation_rules`.
- [ ] Data privacy (GDPR / UAE PDPL / DPDP India / CCPA…): DPA with processors, data-retention schedule, lawful basis, cross-border transfer review.
- [ ] Women-only options enabled only where lawful (Admin → Countries).
- [ ] Privacy Policy, Terms, Community Guidelines, Safety Policy, Refund Policy and Driver Terms drafted and **reviewed by legal counsel** per jurisdiction. Replace the templates at `/legal/*`.
- [ ] Local permits / platform licensing obtained. Ride creation and bookings are switched on only after this.
- [ ] Emergency numbers in the Safety Center verified for each launch country.

## Pricing & business configuration
- [ ] Real pricing values per country (replace seeded placeholders) after market and regulatory review.
- [ ] **Fee bearer decided** (driver vs passenger) per country.
- [ ] Ranking weights reviewed (`packages/shared/src/ranking.ts`).
- [ ] Support email / announcement settings filled in (Admin → Settings).

## Security
- [ ] `NODE_ENV=production`, with real `JWT_SECRET` and `DATA_ENCRYPTION_KEY` from a secrets manager (rotation plan documented).
- [ ] Mock providers disabled (the API enforces this at startup).
- [ ] HTTPS everywhere, with a WAF / rate limiting at the edge in addition to app-level limits.
- [ ] DB not publicly reachable. Least-privilege DB user for the app (no superuser). Backups and PITR tested with a restore drill.
- [ ] Staff accounts: unique per person, minimum roles, offboarding process. Add admin 2FA (TOTP) before giving FINANCE / SUPER_ADMIN access.
- [ ] Google Maps / Mapbox keys restricted (server IPs, app bundle IDs, web referrers).
- [ ] Stripe webhook secret set, live keys only in production, Radar rules configured.
- [ ] Dependency audit (`npm audit`) and a penetration test before public launch.
- [ ] Optional hardening: move web tokens to httpOnly cookies via a same-site BFF.

## Reliability & operations
- [ ] Monitoring and alerting (5xx, latency p95 < 500 ms, webhook failures, pending refunds, job failures).
- [ ] Log retention and PII redaction verified (auth headers and passwords are redacted by default).
- [ ] Load test of search and booking. The concurrency test for the last seat is in CI.
- [ ] Runbooks: refunds stuck, Stripe outage, maps outage, mass ride cancellation.
- [ ] Support process: SLA for SAFETY tickets (URGENT), escalation path to local authorities.

## App stores — spec §80
- [ ] App name, icon (`mobile/assets/icon.png`), splash, screenshots, descriptions in each language.
- [ ] Privacy nutrition labels (iOS) / Data safety form (Android) match what the app collects.
- [ ] **In-app account deletion** (Profile → Delete account), plus a public web URL for deletion requests.
- [ ] Support URL and privacy-policy URL live.
- [ ] Location permission strings explain trip-only use. Push permission is requested in context.
- [ ] Sign in with Apple offered on iOS (required when other social logins are offered).
- [ ] TestFlight / internal testing round complete.

## Data
- [ ] **No demo data in production.** The seed refuses to run, but double-check `SELECT count(*) FROM users WHERE is_demo`.
- [ ] Real FX source configured (`EXCHANGE_RATE_API_URL`) for display-only conversion.
