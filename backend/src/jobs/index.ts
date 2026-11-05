import { config } from '../config';
import { one, pool, q } from '../db';
import { expireReservations } from '../services/bookings';
import { dispatchPendingPushes, notify } from '../services/notifications';
import { processRefund } from '../services/payments';
import { logger } from '../utils/logger';

/**
 * Background jobs. Each run is guarded by a Postgres advisory lock so that with several
 * API instances only one executes a given job at a time. For high volume, move these to a
 * dedicated worker process (same code: `tsx src/worker.ts`).
 */
async function withLock(key: number, name: string, fn: () => Promise<unknown>) {
  const got = await one<{ ok: boolean }>(`SELECT pg_try_advisory_lock($1) AS ok`, [key]);
  if (!got?.ok) return;
  try { await fn(); } catch (err) { logger.error({ err, job: name }, 'job failed'); }
  finally { await q(`SELECT pg_advisory_unlock($1)`, [key]); }
}

async function retryPendingRefunds() {
  const rows = await q(`SELECT id FROM refunds WHERE status = 'PENDING' AND created_at < now() - interval '1 minute' LIMIT 50`);
  for (const r of rows) await processRefund(r.id);
}

async function rideStartingSoon() {
  const rows = await q(
    `UPDATE rides SET updated_at = now() WHERE id IN (
       SELECT id FROM rides WHERE status = 'PUBLISHED' AND departure_at BETWEEN now() + interval '55 minutes' AND now() + interval '60 minutes')
     RETURNING id, driver_id, origin_name, dest_name`);
  for (const r of rows) {
    const pax = await q(`SELECT passenger_id FROM bookings WHERE ride_id = $1 AND status = 'CONFIRMED'`, [r.id]);
    for (const uid of [r.driver_id, ...pax.map((p) => p.passenger_id)]) {
      await notify(pool, uid, 'RIDE_STARTING_SOON', 'Ride starting in 1 hour', `${r.origin_name} → ${r.dest_name}`, { rideId: r.id });
    }
  }
}

/** Mark rides that never started as EXPIRED 6h after departure. */
async function expireStaleRides() {
  await q(`UPDATE rides SET status = 'EXPIRED', updated_at = now() WHERE status IN ('PUBLISHED','DRIVER_READY') AND departure_at < now() - interval '6 hours'
            AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.ride_id = rides.id AND b.status IN ('CONFIRMED','PASSENGER_PICKUP','IN_PROGRESS'))`);
}

/** Display-only FX refresh (spec §29). Configure EXCHANGE_RATE_API_URL with a {BASE} placeholder. */
async function refreshExchangeRates() {
  if (!config.EXCHANGE_RATE_API_URL) return;
  const currencies = (await q(`SELECT code FROM currencies`)).map((c) => c.code.trim());
  for (const base of ['USD', 'AED']) {
    const res = await fetch(config.EXCHANGE_RATE_API_URL.replace('{BASE}', base), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) continue;
    const data: any = await res.json();
    const rates = data.rates ?? data.conversion_rates ?? {};
    for (const quote of currencies) {
      if (quote === base || !(rates[quote] > 0)) continue;
      await q(`INSERT INTO exchange_rates (base, quote, rate, source, fetched_at) VALUES ($1,$2,$3,$4, now())
               ON CONFLICT (base, quote) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, fetched_at = now()`,
        [base, quote, rates[quote], new URL(config.EXCHANGE_RATE_API_URL).host]);
    }
  }
}

export function startJobs() {
  const every = (ms: number, key: number, name: string, fn: () => Promise<unknown>) => {
    const t = setInterval(() => withLock(key, name, fn), ms);
    t.unref();
  };
  every(30_000, 7001, 'expireReservations', expireReservations);
  every(5_000, 7002, 'dispatchPendingPushes', dispatchPendingPushes);
  every(120_000, 7003, 'retryPendingRefunds', retryPendingRefunds);
  every(300_000, 7004, 'rideStartingSoon', rideStartingSoon);
  every(600_000, 7005, 'expireStaleRides', expireStaleRides);
  every(6 * 3600_000, 7006, 'refreshExchangeRates', refreshExchangeRates);
  withLock(7006, 'refreshExchangeRates', refreshExchangeRates);
  logger.info('background jobs started');
}
