/**
 * Share Ride — DEMO / DEVELOPMENT seed data (spec §78–79).
 *
 *  - Every demo row is flagged is_demo = TRUE and demo emails use the reserved `.invalid` TLD.
 *  - Pricing values are ILLUSTRATIVE PLACEHOLDERS, not market or regulated prices. Set real
 *    values in Admin → Pricing after checking local market/regulatory data.
 *  - Refuses to run when NODE_ENV=production.
 *  - The admin account is created only from SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD env vars.
 *
 * Run: npm run db:seed   (after npm run db:migrate)
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { calculateBooking, encodePolyline, haversineMeters, sampleRoute, boundingBox, LatLng, PricingRule, DEFAULT_CANCELLATION_POLICY } from '@share-ride/shared';
import { config } from '../../backend/src/config';
import { pool, q, one, tx } from '../../backend/src/db';
import { migrate } from '../../backend/src/migrate';

if (config.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.');
  process.exit(1);
}

const CURRENCIES = [
  ['AED', 'UAE Dirham', 2, 'د.إ'], ['USD', 'US Dollar', 2, '$'], ['GBP', 'Pound Sterling', 2, '£'], ['EUR', 'Euro', 2, '€'],
  ['INR', 'Indian Rupee', 2, '₹'], ['SAR', 'Saudi Riyal', 2, '﷼'], ['QAR', 'Qatari Riyal', 2, 'ر.ق'], ['CAD', 'Canadian Dollar', 2, '$'], ['AUD', 'Australian Dollar', 2, '$'],
] as const;

// [code, name, currency, unit, tz, lang, womenOnlyAllowed]
const COUNTRIES = [
  ['AE', 'United Arab Emirates', 'AED', 'km', 'Asia/Dubai', 'en', true],
  ['US', 'United States', 'USD', 'mi', 'America/New_York', 'en', false],
  ['GB', 'United Kingdom', 'GBP', 'mi', 'Europe/London', 'en', false],
  ['IN', 'India', 'INR', 'km', 'Asia/Kolkata', 'hi', true],
  ['SA', 'Saudi Arabia', 'SAR', 'km', 'Asia/Riyadh', 'ar', true],
] as const;

// ILLUSTRATIVE placeholder pricing (minor units). NOT official market prices.
const PRICING: Record<string, Omit<PricingRule, 'countryCode' | 'currency' | 'feeBearer' | 'taxOnFeeBps' | 'suggestionSpreadBps'>> = {
  AE: { baseFareMinor: 500, perKmMinor: 120, minFareMinor: 1000, maxFareMinor: 50000, minDriverPriceMinor: 1000, maxDriverPriceMinor: 50000, platformFeeBps: 500, roundingMinor: 100 },
  US: { baseFareMinor: 200, perKmMinor: 18, minFareMinor: 500, maxFareMinor: 20000, minDriverPriceMinor: 500, maxDriverPriceMinor: 20000, platformFeeBps: 500, roundingMinor: 50 },
  GB: { baseFareMinor: 150, perKmMinor: 12, minFareMinor: 400, maxFareMinor: 15000, minDriverPriceMinor: 400, maxDriverPriceMinor: 15000, platformFeeBps: 500, roundingMinor: 50 },
  IN: { baseFareMinor: 3000, perKmMinor: 600, minFareMinor: 5000, maxFareMinor: 500000, minDriverPriceMinor: 5000, maxDriverPriceMinor: 500000, platformFeeBps: 500, roundingMinor: 1000 },
  SA: { baseFareMinor: 500, perKmMinor: 100, minFareMinor: 1000, maxFareMinor: 60000, minDriverPriceMinor: 1000, maxDriverPriceMinor: 60000, platformFeeBps: 500, roundingMinor: 100 },
};

const P = (name: string, lat: number, lng: number) => ({ name, lat, lng });
const ROUTES: Record<string, { a: ReturnType<typeof P>; b: ReturnType<typeof P>; via?: LatLng[] }[]> = {
  AE: [
    { a: P('Dubai Marina, Dubai', 25.0805, 55.1403), b: P('Abu Dhabi Corniche', 24.4764, 54.3473), via: [{ lat: 24.95, lng: 55.02 }, { lat: 24.7, lng: 54.7 }] },
    { a: P('JLT, Dubai', 25.0693, 55.1413), b: P('Yas Island, Abu Dhabi', 24.4889, 54.6081) },
    { a: P('Downtown Dubai', 25.1972, 55.2744), b: P('Ras Al Khaimah', 25.8007, 55.9762), via: [{ lat: 25.3463, lng: 55.4209 }, { lat: 25.4052, lng: 55.5136 }] },
    { a: P('Deira, Dubai', 25.2697, 55.3095), b: P('Al Ain', 24.2075, 55.7447) },
    { a: P('Sharjah City Centre', 25.3463, 55.4209), b: P('Downtown Dubai', 25.1972, 55.2744) },
  ],
  US: [
    { a: P('Manhattan, New York', 40.7831, -73.9712), b: P('Philadelphia, PA', 39.9526, -75.1652) },
    { a: P('Manhattan, New York', 40.7831, -73.9712), b: P('Boston, MA', 42.3601, -71.0589) },
    { a: P('San Francisco, CA', 37.7749, -122.4194), b: P('San Jose, CA', 37.3382, -121.8863) },
  ],
  GB: [
    { a: P("King's Cross, London", 51.5308, -0.1238), b: P('Oxford', 51.752, -1.2577) },
    { a: P('Manchester', 53.4808, -2.2426), b: P('Birmingham', 52.4862, -1.8904) },
  ],
  IN: [
    { a: P('Bandra, Mumbai', 19.0596, 72.8295), b: P('Pune', 18.5204, 73.8567) },
    { a: P('Connaught Place, New Delhi', 28.6315, 77.2167), b: P('Jaipur', 26.9124, 75.7873) },
  ],
  SA: [
    { a: P('Riyadh', 24.7136, 46.6753), b: P('Dammam', 26.4207, 50.0888) },
    { a: P('Jeddah', 21.4858, 39.1925), b: P('Riyadh', 24.7136, 46.6753) },
  ],
};

const DRIVERS: Record<string, [string, 'female' | 'male', string, string, string][]> = {
  // [name, gender, make, model, color]
  AE: [['Ahmed Al Mansoori', 'male', 'Toyota', 'Camry', 'White'], ['Fatima Hassan', 'female', 'Nissan', 'Patrol', 'Silver'], ['Rahul Menon', 'male', 'Honda', 'Accord', 'Black']],
  US: [['John Carter', 'male', 'Tesla', 'Model 3', 'Blue'], ['Maria Lopez', 'female', 'Toyota', 'RAV4', 'Grey']],
  GB: [['Oliver Smith', 'male', 'Volkswagen', 'Golf', 'Red'], ['Amelia Jones', 'female', 'Ford', 'Focus', 'White']],
  IN: [['Arjun Sharma', 'male', 'Maruti Suzuki', 'Ciaz', 'White'], ['Priya Nair', 'female', 'Hyundai', 'Creta', 'Blue']],
  SA: [['Khalid Al Harbi', 'male', 'Toyota', 'Land Cruiser', 'Black'], ['Noura Al Qahtani', 'female', 'Lexus', 'ES', 'Pearl']],
};
const PASSENGERS: Record<string, [string, 'female' | 'male'][]> = {
  AE: [['Sara Ibrahim', 'female'], ['Omar Farouk', 'male'], ['Aisha Khan', 'female'], ['David Wilson', 'male']],
  US: [['Emily Chen', 'female'], ['Michael Brown', 'male']],
  GB: [['Harry Taylor', 'male'], ['Sophie Evans', 'female']],
  IN: [['Ananya Iyer', 'female'], ['Vikram Rao', 'male']],
  SA: [['Faisal Al Otaibi', 'male'], ['Reem Al Shehri', 'female']],
};

const REVIEW_TEXT = ['Very punctual and friendly.', 'Smooth drive, clean car.', 'Great conversation, would ride again!', 'Safe driver, recommended.', 'On time and helpful with luggage.'];
const rnd = (n: number) => crypto.randomInt(0, n);

function mockRoute(a: LatLng, b: LatLng, via: LatLng[] = []) {
  const pts = [a, ...via, b];
  const dense: LatLng[] = [];
  for (let i = 0; i < pts.length - 1; i++) for (let k = 0; k < 10; k++) dense.push({ lat: pts[i].lat + ((pts[i + 1].lat - pts[i].lat) * k) / 10, lng: pts[i].lng + ((pts[i + 1].lng - pts[i].lng) * k) / 10 });
  dense.push(b);
  let straight = 0;
  for (let i = 1; i < pts.length; i++) straight += haversineMeters(pts[i - 1], pts[i]);
  const distance = Math.round(straight * 1.2);
  return { polyline: encodePolyline(dense), points: sampleRoute(dense, 200), distance, duration: Math.round(distance / (85_000 / 3600)) };
}

async function main() {
  await migrate();
  const demoPassword = process.env.SEED_DEMO_PASSWORD || 'DemoPass123';
  const demoHash = await bcrypt.hash(demoPassword, 10);

  await tx(async (c) => {
    for (const [code, name, exp, sym] of CURRENCIES) await q(`INSERT INTO currencies (code, name, exponent, symbol) VALUES ($1,$2,$3,$4) ON CONFLICT (code) DO NOTHING`, [code, name, exp, sym], c);
    for (const [code, name, cur, unit, tz, lang, women] of COUNTRIES) {
      await q(`INSERT INTO countries (code, name, currency, distance_unit, default_timezone, default_language, ride_creation_enabled, booking_enabled, women_only_allowed,
                                      verification_requirements, withdrawal_methods)
               VALUES ($1,$2,$3,$4,$5,$6,TRUE,TRUE,$7,'{"driver":["phone"],"passenger":["phone"]}','["bank_transfer"]') ON CONFLICT (code) DO NOTHING`,
        [code, name, cur, unit, tz, lang, women], c);
      const pr = PRICING[code];
      await q(`INSERT INTO pricing_rules (country_code, currency, version, base_fare_minor, per_km_minor, min_fare_minor, max_fare_minor, min_driver_price_minor, max_driver_price_minor, platform_fee_bps, fee_bearer, note)
               SELECT $1,$2,1,$3,$4,$5,$6,$7,$8,$9,'DRIVER','Illustrative placeholder — not a market price. Review before launch.'
               WHERE NOT EXISTS (SELECT 1 FROM pricing_rules WHERE country_code = $1)`,
        [code, cur, pr.baseFareMinor, pr.perKmMinor, pr.minFareMinor, pr.maxFareMinor, pr.minDriverPriceMinor, pr.maxDriverPriceMinor, pr.platformFeeBps], c);
    }
    await q(`INSERT INTO cancellation_rules (country_code, ride_type, policy) SELECT NULL, 'standard', $1 WHERE NOT EXISTS (SELECT 1 FROM cancellation_rules WHERE country_code IS NULL)`, [JSON.stringify(DEFAULT_CANCELLATION_POLICY)], c);
    await q(`INSERT INTO tax_rules (country_code, name, applies_to, rate_bps, is_active, note) SELECT 'AE','VAT','PLATFORM_FEE',500,FALSE,'Placeholder — confirm with a tax adviser before enabling.' WHERE NOT EXISTS (SELECT 1 FROM tax_rules WHERE country_code = 'AE')`, [], c);
    for (const [k, v] of [['DEFAULT_PLATFORM_FEE_BPS', 500], ['BOOKING_EXPIRY_MINUTES', config.BOOKING_EXPIRY_MINUTES], ['SUPPORT_EMAIL', 'support@example.com']] as const) {
      await q(`INSERT INTO platform_settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`, [k, JSON.stringify(v)], c);
    }
    // Display-only sample FX rates (replaced by the exchange-rate job when EXCHANGE_RATE_API_URL is set).
    const toAED: Record<string, number> = { USD: 3.6725, GBP: 4.65, EUR: 3.98, INR: 0.0438, SAR: 0.979, QAR: 1.0088, CAD: 2.66, AUD: 2.4 };
    for (const [cur, rate] of Object.entries(toAED)) {
      await q(`INSERT INTO exchange_rates (base, quote, rate, source) VALUES ($1,'AED',$2,'seed-sample') ON CONFLICT DO NOTHING`, [cur, rate], c);
      await q(`INSERT INTO exchange_rates (base, quote, rate, source) VALUES ('AED',$1,$2,'seed-sample') ON CONFLICT DO NOTHING`, [cur, 1 / rate], c);
    }
  });

  if (await one(`SELECT 1 FROM users WHERE is_demo LIMIT 1`)) {
    console.log('Demo users already exist — reference data refreshed, skipping demo users/rides.');
  } else {
    await seedDemo(demoHash);
  }

  // Development admin — credentials ONLY from env.
  if (process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD) {
    if (process.env.SEED_ADMIN_PASSWORD.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');
    const hash = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD, 12);
    const u = await one(
      `INSERT INTO users (name, email, password_hash, country_code, preferred_currency, email_verified_at, phone_verified_at)
       VALUES ('Platform Admin', lower($1), $2, 'AE', 'AED', now(), now())
       ON CONFLICT (lower(email)) WHERE email IS NOT NULL AND deleted_at IS NULL DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`,
      [process.env.SEED_ADMIN_EMAIL, hash]);
    await q(`INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [u.id]);
    await q(`INSERT INTO admin_users (user_id, role) VALUES ($1,'SUPER_ADMIN') ON CONFLICT (user_id) DO UPDATE SET role = 'SUPER_ADMIN'`, [u.id]);
    console.log(`Admin ready: ${process.env.SEED_ADMIN_EMAIL} (SUPER_ADMIN)`);
  } else {
    console.log('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — no admin account created.');
  }
  await pool.end();
}

async function seedDemo(hash: string) {
  let phoneSeq = 1000;
  const userIds: Record<string, { drivers: { id: string; vehicle: string; gender: string }[]; passengers: { id: string; gender: string }[] }> = {};
  await tx(async (c) => {
    for (const [code, , cur] of COUNTRIES) {
      userIds[code] = { drivers: [], passengers: [] };
      const mk = async (name: string, gender: string, driver: boolean) => {
        const email = `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@demo.shareride.invalid`;
        const created = new Date(Date.now() - (200 + rnd(500)) * 86400_000);
        const u = await one(
          `INSERT INTO users (name, email, phone, password_hash, country_code, preferred_currency, phone_verified_at, email_verified_at, identity_verified_at, driver_verified_at, is_demo, created_at, trust_score)
           VALUES ($1,$2,$3,$4,$5,$6, now(), now(), CASE WHEN $7 THEN now() END, CASE WHEN $7 THEN now() END, TRUE, $8, $9) RETURNING id`,
          [name, email, `+999${String(phoneSeq++).padStart(7, '0')}`, hash, code, cur, driver, created, 60 + rnd(30)], c);
        await q(`INSERT INTO profiles (user_id, gender, languages, about) VALUES ($1,$2,$3,$4)`,
          [u.id, gender, code === 'AE' || code === 'SA' ? ['English', 'Arabic'] : code === 'IN' ? ['English', 'Hindi'] : ['English'], driver ? 'Regular commuter, happy to share the ride. (Demo profile)' : null], c);
        return u.id as string;
      };
      for (const [name, gender, make, model, color] of DRIVERS[code]) {
        const id = await mk(name, gender, true);
        const v = await one(`INSERT INTO vehicles (owner_id, make, model, year, color, license_plate, vehicle_type, seats, verification_status, is_demo) VALUES ($1,$2,$3,$4,$5,$6,$7,5,'VERIFIED',TRUE) RETURNING id`,
          [id, make, model, 2019 + rnd(6), color, `DEMO-${rnd(90000) + 10000}`, model.match(/Patrol|RAV4|Creta|Land Cruiser/) ? 'suv' : 'sedan'], c);
        userIds[code].drivers.push({ id, vehicle: v.id, gender });
      }
      for (const [name, gender] of PASSENGERS[code]) userIds[code].passengers.push({ id: await mk(name, gender, false), gender });
    }
  });

  let rideCount = 0, bookingCount = 0;
  for (const [code, , cur] of COUNTRIES) {
    const rule = await one(`SELECT * FROM pricing_rules WHERE country_code = $1 AND is_active`, [code]);
    const pr: PricingRule = { countryCode: code, currency: cur, baseFareMinor: rule.base_fare_minor, perKmMinor: rule.per_km_minor, minFareMinor: rule.min_fare_minor, maxFareMinor: rule.max_fare_minor, minDriverPriceMinor: rule.min_driver_price_minor, maxDriverPriceMinor: rule.max_driver_price_minor, platformFeeBps: rule.platform_fee_bps, feeBearer: rule.fee_bearer, taxOnFeeBps: rule.tax_on_fee_bps, roundingMinor: rule.rounding_minor, suggestionSpreadBps: rule.suggestion_spread_bps };
    const { drivers, passengers } = userIds[code];

    // ~ 30 past completed rides + upcoming rides over the next 7 days.
    const plans: { dayOffset: number; completed: boolean }[] = [];
    for (let i = 0; i < (code === 'AE' ? 40 : 12); i++) plans.push({ dayOffset: -(1 + rnd(29)), completed: true });
    for (let d = 0; d < 7; d++) for (let k = 0; k < (code === 'AE' ? 4 : 2); k++) plans.push({ dayOffset: d, completed: false });

    for (const plan of plans) {
      await tx(async (c) => {
        const route = ROUTES[code][rnd(ROUTES[code].length)];
        const driver = drivers[rnd(drivers.length)];
        const mr = mockRoute(route.a, route.b, route.via);
        const raw = pr.baseFareMinor + (pr.perKmMinor * mr.distance) / 1000;
        const price = Math.max(pr.minFareMinor, Math.min(pr.maxFareMinor, Math.round(raw / pr.roundingMinor) * pr.roundingMinor + (rnd(3) - 1) * pr.roundingMinor));
        const dep = new Date();
        dep.setUTCDate(dep.getUTCDate() + plan.dayOffset);
        dep.setUTCHours(plan.dayOffset === 0 ? Math.min(23, new Date().getUTCHours() + 2 + rnd(4)) : 3 + rnd(14), [0, 15, 30, 45][rnd(4)], 0, 0);
        if (!plan.completed && dep.getTime() < Date.now() + 30 * 60_000) dep.setTime(Date.now() + (60 + rnd(300)) * 60_000);
        const seats = 3;
        const womenOnly = driver.gender === 'female' && rnd(4) === 0 && ['AE', 'SA', 'IN'].includes(code);
        const ride = await one(
          `INSERT INTO rides (driver_id, vehicle_id, country_code, currency, pricing_rule_id, status, origin_name, origin_lat, origin_lng, dest_name, dest_lat, dest_lng,
                              departure_at, arrival_estimate_at, distance_meters, duration_seconds, seats_total, seats_available, price_per_seat_minor, suggested_price_minor,
                              instant_booking, luggage_allowed, pets_allowed, women_only, notes, is_demo, created_at, started_at, completed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,$18,$18,$19,TRUE,$20,$21,$22,TRUE,$23,$24,$25) RETURNING id`,
          [driver.id, driver.vehicle, code, cur, rule.id, plan.completed ? 'COMPLETED' : 'PUBLISHED', route.a.name, route.a.lat, route.a.lng, route.b.name, route.b.lat, route.b.lng,
           dep, new Date(dep.getTime() + mr.duration * 1000), mr.distance, mr.duration, seats, price, rnd(3) !== 0, rnd(3) === 0, womenOnly,
           rnd(2) ? 'Meeting point near the main entrance. AC on, music low. (Demo ride)' : null,
           new Date(dep.getTime() - 3 * 86400_000), plan.completed ? dep : null, plan.completed ? new Date(dep.getTime() + mr.duration * 1000) : null], c);
        const bb = boundingBox(mr.points);
        await q(`INSERT INTO ride_routes (ride_id, provider, polyline, points, min_lat, max_lat, min_lng, max_lng, is_approximate) VALUES ($1,'mock',$2,$3,$4,$5,$6,$7,TRUE)`,
          [ride.id, mr.polyline, JSON.stringify(mr.points), bb.minLat, bb.maxLat, bb.minLng, bb.maxLng], c);
        await q(`INSERT INTO ride_stops (ride_id, seq, name, lat, lng) VALUES ($1,0,$2,$3,$4),($1,1,$5,$6,$7)`, [ride.id, route.a.name, route.a.lat, route.a.lng, route.b.name, route.b.lat, route.b.lng], c);
        rideCount++;

        // Bookings
        const nBook = plan.completed ? 1 + rnd(3) : rnd(3);
        const chosen = [...passengers].sort(() => Math.random() - 0.5).filter((p) => !womenOnly || p.gender === 'female').slice(0, nBook);
        let left = seats;
        const wallet = (await one(`INSERT INTO wallets (user_id, currency) VALUES ($1,$2) ON CONFLICT (user_id, currency) DO UPDATE SET updated_at = now() RETURNING id`, [driver.id, cur], c)).id;
        for (const p of chosen) {
          const s = Math.min(left, 1 + (rnd(4) === 0 ? 1 : 0));
          if (s < 1) break;
          left -= s;
          const bd = calculateBooking(pr, price, s);
          const st = plan.completed ? 'COMPLETED' : 'CONFIRMED';
          const b = await one(
            `INSERT INTO bookings (ride_id, passenger_id, status, seats, pickup_name, pickup_lat, pickup_lng, pickup_status, dropoff_name, dropoff_lat, dropoff_lng, currency,
                                   price_per_seat_minor, gross_fare_minor, platform_fee_minor, tax_minor, passenger_total_minor, driver_earnings_minor, platform_fee_bps, fee_bearer,
                                   created_at, confirmed_at, completed_at, idempotency_key)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'APPROVED',$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20,$21,$22) RETURNING id`,
            [ride.id, p.id, st, s, route.a.name, route.a.lat, route.a.lng, route.b.name, route.b.lat, route.b.lng, cur, price, bd.grossFareMinor, bd.platformFeeMinor, bd.taxMinor,
             bd.passengerTotalMinor, bd.driverEarningsMinor, bd.platformFeeBps, bd.feeBearer, new Date(dep.getTime() - 2 * 86400_000), plan.completed ? dep : null, `seed-${crypto.randomUUID()}`], c);
          await q(`INSERT INTO ride_seats (ride_id, booking_id, seats, action) VALUES ($1,$2,$3,'ALLOCATE')`, [ride.id, b.id, s], c);
          await q(`INSERT INTO payments (booking_id, provider, provider_payment_id, status, amount_minor, currency, created_at) VALUES ($1,'mock',$2,'PAID',$3,$4,$5)`,
            [b.id, `seed_pi_${crypto.randomBytes(8).toString('hex')}`, bd.passengerTotalMinor, cur, new Date(dep.getTime() - 2 * 86400_000)], c);
          await q(`INSERT INTO driver_earnings (driver_id, booking_id, ride_id, currency, gross_minor, fee_minor, tax_minor, net_minor, status, available_at, created_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [driver.id, b.id, ride.id, cur, bd.grossFareMinor, bd.platformFeeMinor, bd.taxMinor, bd.driverEarningsMinor, plan.completed ? 'AVAILABLE' : 'PENDING', plan.completed ? dep : null, plan.completed ? dep : new Date()], c);
          await q(`UPDATE wallets SET ${plan.completed ? 'available_minor = available_minor' : 'pending_minor = pending_minor'} + $2 WHERE id = $1`, [wallet, bd.driverEarningsMinor], c);
          await q(`INSERT INTO wallet_transactions (wallet_id, booking_id, ride_id, type, amount_minor, description, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [wallet, b.id, ride.id, plan.completed ? 'EARNING_RELEASED' : 'EARNING_PENDING', bd.driverEarningsMinor, `${route.a.name} → ${route.b.name} (demo)`, plan.completed ? dep : new Date()], c);
          bookingCount++;
          if (plan.completed) {
            await q(`UPDATE users SET trips_as_passenger = trips_as_passenger + 1 WHERE id = $1`, [p.id], c);
            const stars = rnd(5) === 0 ? 4 : 5;
            const ra = await one(`INSERT INTO ratings (booking_id, ride_id, rater_id, ratee_id, ratee_role, stars, punctuality, safety, created_at) VALUES ($1,$2,$3,$4,'DRIVER',$5,$5,5,$6) RETURNING id`, [b.id, ride.id, p.id, driver.id, stars, dep], c);
            if (rnd(2)) await q(`INSERT INTO reviews (rating_id, comment) VALUES ($1,$2)`, [ra.id, REVIEW_TEXT[rnd(REVIEW_TEXT.length)]], c);
            await q(`UPDATE users SET rating_avg = round(((rating_avg * rating_count) + $2)::numeric / (rating_count + 1), 2), rating_count = rating_count + 1 WHERE id = $1`, [driver.id, stars], c);
          }
        }
        await q(`UPDATE rides SET seats_available = $2 WHERE id = $1`, [ride.id, left], c);
        if (plan.completed) await q(`UPDATE users SET rides_as_driver = rides_as_driver + 1 WHERE id = $1`, [driver.id], c);
      });
    }
  }
  console.log(`Demo data: ${Object.values(userIds).reduce((s, x) => s + x.drivers.length + x.passengers.length, 0)} users, ${rideCount} rides, ${bookingCount} bookings.`);
  console.log(`Demo login: any demo email (e.g. ahmed.al.mansoori@demo.shareride.invalid / sara.ibrahim@demo.shareride.invalid) with SEED_DEMO_PASSWORD (default "DemoPass123").`);
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
