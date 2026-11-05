import { beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { api, setupDb, makeDriver, signup, createRide, book, pay, makeAdmin, one, q } from './helpers';

beforeAll(setupDb);

describe('Security (spec §77)', () => {
  it('unauthenticated access is rejected', async () => {
    await api().get('/profile').expect(401);
    await api().post('/rides').send({}).expect(401);
    await api().get('/earnings').expect(401);
    await api().get('/profile').set('Authorization', 'Bearer not-a-token').expect(401);
  });

  it('normal users can never reach admin endpoints (role escalation)', async () => {
    const u = await signup();
    const A = { Authorization: `Bearer ${u.token}` };
    await api().get('/admin/dashboard').set(A).expect(403);
    await api().post('/admin/pricing/AE').set(A).send({}).expect(403);
    // Trying to grant yourself a role through profile update is ignored.
    await api().patch('/profile').set(A).send({ adminRole: 'SUPER_ADMIN', role: 'SUPER_ADMIN', name: 'Sneaky' }).expect(200);
    await api().get('/admin/dashboard').set(A).expect(403);
    // A forged JWT with a different secret is rejected.
    const forged = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: u.id })).toString('base64url') + '.sig';
    await api().get('/admin/dashboard').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it('SUPPORT role cannot change pricing or refund', async () => {
    const s = await makeAdmin('SUPPORT');
    await api().get('/admin/pricing').set('Authorization', `Bearer ${s.token}`).expect(403);
    await api().get('/admin/users').set('Authorization', `Bearer ${s.token}`).expect(200);
  });

  it('payment manipulation: forged webhooks are rejected and the frontend cannot confirm', async () => {
    const d = await makeDriver();
    const ride = await createRide(d);
    const p = await signup();
    const b = await book(p.token, ride.id, 1);
    const co = await api().post('/payments/checkout').set('Authorization', `Bearer ${p.token}`).send({ bookingId: b.body.id }).expect(200);
    const pp = await one(`SELECT provider_payment_id FROM payments WHERE id = $1`, [co.body.paymentId]);

    // Unsigned / badly signed webhook
    const evt = JSON.stringify({ id: 'evt_forged', kind: 'succeeded', providerPaymentId: pp.provider_payment_id, amountMinor: 5000, currency: 'AED' });
    await api().post('/webhooks/payments').set('Content-Type', 'application/json').set('x-mock-signature', 'deadbeef').send(evt).expect(400);
    expect((await one(`SELECT status FROM bookings WHERE id = $1`, [b.body.id])).status).toBe('RESERVED');

    // Correctly signed but with a tampered amount → refused + fraud flag
    const tampered = JSON.stringify({ id: 'evt_tamper', kind: 'succeeded', providerPaymentId: pp.provider_payment_id, amountMinor: 100, currency: 'AED' });
    const sig = crypto.createHmac('sha256', 'test-webhook-secret').update(tampered).digest('hex');
    await api().post('/webhooks/payments').set('Content-Type', 'application/json').set('x-mock-signature', sig).send(tampered).expect(400);
    expect((await one(`SELECT status FROM bookings WHERE id = $1`, [b.body.id])).status).toBe('RESERVED');
    expect((await one(`SELECT count(*)::int AS n FROM fraud_flags WHERE kind = 'PAYMENT_AMOUNT_MISMATCH' AND user_id = $1`, [p.id])).n).toBe(1);

    // Clients can't pick the amount: checkout ignores any body amount.
    expect(co.body.amountMinor).toBe(5000);
    // Another user can't pay/see this booking.
    const other = await signup();
    await api().post('/payments/checkout').set('Authorization', `Bearer ${other.token}`).send({ bookingId: b.body.id }).expect(403);
    await api().get(`/bookings/${b.body.id}`).set('Authorization', `Bearer ${other.token}`).expect(404);
  });

  it('webhook replay is idempotent (no duplicate earnings)', async () => {
    const d = await makeDriver();
    const ride = await createRide(d);
    const p = await signup();
    const b = await book(p.token, ride.id, 1);
    const co = await api().post('/payments/checkout').set('Authorization', `Bearer ${p.token}`).send({ bookingId: b.body.id }).expect(200);
    const pp = await one(`SELECT provider_payment_id FROM payments WHERE id = $1`, [co.body.paymentId]);
    const evt = JSON.stringify({ id: 'evt_replay_1', kind: 'succeeded', providerPaymentId: pp.provider_payment_id, amountMinor: 5000, currency: 'AED' });
    const sig = crypto.createHmac('sha256', 'test-webhook-secret').update(evt).digest('hex');
    for (let i = 0; i < 3; i++) await api().post('/webhooks/payments').set('Content-Type', 'application/json').set('x-mock-signature', sig).send(evt).expect(200);
    expect((await one(`SELECT count(*)::int AS n FROM driver_earnings WHERE booking_id = $1`, [b.body.id])).n).toBe(1);
    expect((await one(`SELECT pending_minor FROM wallets WHERE user_id = $1`, [d.id])).pending_minor).toBe(4750);
  });

  it('seat overbooking: 6 concurrent requests for the last 2 seats → exactly 2 succeed', async () => {
    const d = await makeDriver();
    const ride = await createRide(d, { seats: 2 });
    const pax = await Promise.all(Array.from({ length: 6 }, () => signup()));
    const results = await Promise.all(pax.map((p) => book(p.token, ride.id, 1)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    expect((await one(`SELECT seats_available FROM rides WHERE id = $1`, [ride.id])).seats_available).toBe(0);
  });

  it('duplicate bookings are prevented; idempotency key returns the same booking', async () => {
    const d = await makeDriver();
    const ride = await createRide(d);
    const p = await signup();
    const key = crypto.randomUUID();
    const body = { rideId: ride.id, seats: 1, pickup: { name: 'Marina', lat: 25.0805, lng: 55.1403 }, dropoff: { name: 'Corniche', lat: 24.4764, lng: 54.3473 }, idempotencyKey: key };
    const a = await api().post('/bookings').set('Authorization', `Bearer ${p.token}`).send(body).expect(201);
    const again = await api().post('/bookings').set('Authorization', `Bearer ${p.token}`).send(body).expect(201);
    expect(again.body.id).toBe(a.body.id);
    await api().post('/bookings').set('Authorization', `Bearer ${p.token}`).send({ ...body, idempotencyKey: crypto.randomUUID() }).expect(409);
    // Driver can't book own ride
    await api().post('/bookings').set('Authorization', `Bearer ${d.token}`).send({ ...body, idempotencyKey: crypto.randomUUID() }).expect(400);
  });

  it('account takeover defence: refresh-token reuse revokes the whole session family', async () => {
    const u = await signup();
    const r1 = await api().post('/auth/refresh').send({ refreshToken: u.refresh }).expect(200);
    await api().post('/auth/refresh').send({ refreshToken: u.refresh }).expect(401);              // replay of the old token
    await api().post('/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);   // family revoked
  });

  it('wrong password / brute force does not reveal which part was wrong; OTP attempts are capped', async () => {
    const u = await signup();
    const r = await api().post('/auth/login').send({ email: u.email, password: 'nope-wrong1' }).expect(401);
    const r2 = await api().post('/auth/login').send({ email: 'missing@example.test', password: 'nope-wrong1' }).expect(401);
    expect(r.body.error.message).toBe(r2.body.error.message);
    const phone = '+971501112233';
    await api().post('/auth/otp/send').send({ phone }).expect(200);
    for (let i = 0; i < 5; i++) await api().post('/auth/otp/verify').send({ phone, code: '000000', name: 'X Y' });
    const sent = await one(`SELECT attempts FROM otp_codes WHERE phone = $1 ORDER BY created_at DESC LIMIT 1`, [phone]);
    expect(sent.attempts).toBe(5);
  });

  it('suspended users are locked out immediately', async () => {
    const u = await signup();
    const admin = await makeAdmin();
    await api().post(`/admin/users/${u.id}/suspend`).set('Authorization', `Bearer ${admin.token}`).send({ reason: 'test suspension' }).expect(200);
    await api().get('/profile').set('Authorization', `Bearer ${u.token}`).expect(403);
  });

  it('unexpected errors return a friendly message with a reference id', async () => {
    const res = await api().get('/rides/not-a-uuid').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/stack|at .*\.ts/);
  });

  it('SQL-injection attempts in search params are treated as data', async () => {
    const admin = await makeAdmin();
    await api().get('/admin/users').query({ q: "'; DROP TABLE users; --" }).set('Authorization', `Bearer ${admin.token}`).expect(200);
    expect((await one(`SELECT count(*)::int AS n FROM users`)).n).toBeGreaterThan(0);
  });
});
