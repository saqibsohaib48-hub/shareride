import request from 'supertest';
import crypto from 'node:crypto';
import { createApp } from '../src/app';
import { migrate } from '../src/migrate';
import { one, q } from '../src/db';

export const app = createApp();
export const api = () => request(app);

let ready: Promise<void> | null = null;
/** Migrate + minimal reference data (UAE, illustrative pricing). Idempotent. */
export function setupDb() {
  ready ??= (async () => {
    await migrate(false);
    await q(`INSERT INTO currencies (code, name, exponent) VALUES ('AED','UAE Dirham',2) ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO countries (code, name, currency, default_timezone, ride_creation_enabled, booking_enabled, women_only_allowed)
             VALUES ('AE','United Arab Emirates','AED','Asia/Dubai',TRUE,TRUE,TRUE) ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO pricing_rules (country_code, currency, version, base_fare_minor, per_km_minor, min_fare_minor, max_fare_minor, min_driver_price_minor, max_driver_price_minor, platform_fee_bps, fee_bearer)
             SELECT 'AE','AED',1,500,120,1000,50000,1000,50000,500,'DRIVER' WHERE NOT EXISTS (SELECT 1 FROM pricing_rules WHERE country_code = 'AE')`);
  })();
  return ready;
}

export const MARINA = { name: 'Dubai Marina, Dubai', lat: 25.0805, lng: 55.1403 };
export const ABU_DHABI = { name: 'Abu Dhabi Corniche', lat: 24.4764, lng: 54.3473 };

export async function signup(name = 'Test User') {
  const email = `t-${crypto.randomUUID()}@example.test`;
  const res = await api().post('/auth/register').send({ name, email, password: 'Passw0rd!x', countryCode: 'AE' });
  if (res.status !== 201) throw new Error(`signup failed ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken as string, refresh: res.body.refreshToken as string, id: res.body.userId as string, email };
}

export async function verifyPhone(token: string) {
  const phone = `+97150${crypto.randomInt(1000000, 9999999)}`;
  const sent = await api().post('/auth/otp/send').send({ phone });
  await api().post('/auth/otp/verify').set('Authorization', `Bearer ${token}`).send({ phone, code: sent.body.devCode }).expect(200);
}

export async function makeDriver(name = 'Ahmed Driver') {
  const u = await signup(name);
  await verifyPhone(u.token);
  const v = await api().post('/vehicles').set('Authorization', `Bearer ${u.token}`)
    .send({ make: 'Toyota', model: 'Camry', color: 'White', licensePlate: 'D 12345', vehicleType: 'sedan', seats: 5 }).expect(201);
  return { ...u, vehicleId: v.body.id as string };
}

export async function createRide(driver: { token: string; vehicleId: string }, overrides: Record<string, unknown> = {}) {
  const res = await api().post('/rides').set('Authorization', `Bearer ${driver.token}`).send({
    countryCode: 'AE', origin: MARINA, destination: ABU_DHABI,
    departureAt: new Date(Date.now() + 3 * 86400_000).toISOString(),
    seats: 3, pricePerSeatMinor: 5000, vehicleId: driver.vehicleId, instantBooking: true, ...overrides,
  });
  if (res.status !== 201) throw new Error(`createRide failed ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

export async function book(token: string, rideId: string, seats = 1) {
  return api().post('/bookings').set('Authorization', `Bearer ${token}`)
    .send({ rideId, seats, pickup: MARINA, dropoff: ABU_DHABI, idempotencyKey: crypto.randomUUID() });
}

export async function pay(token: string, bookingId: string, outcome: 'succeeded' | 'failed' = 'succeeded') {
  const co = await api().post('/payments/checkout').set('Authorization', `Bearer ${token}`).send({ bookingId }).expect(200);
  await api().post('/payments/mock/complete').set('Authorization', `Bearer ${token}`).send({ paymentId: co.body.paymentId, outcome }).expect(200);
  return co.body;
}

export async function makeAdmin(role = 'SUPER_ADMIN') {
  const u = await signup('Admin Person');
  await q(`INSERT INTO admin_users (user_id, role) VALUES ($1,$2)`, [u.id, role]);
  return u;
}

export { one, q };
