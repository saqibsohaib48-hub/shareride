import { beforeAll, describe, expect, it } from 'vitest';
import { api, setupDb, makeDriver, signup, verifyPhone, createRide, book, pay, makeAdmin, one, q, MARINA, ABU_DHABI } from './helpers';
import { expireReservations } from '../src/services/bookings';

beforeAll(setupDb);

describe('E2E: driver signup → ride → passenger books & pays → trip → rating → earnings (spec §77)', () => {
  it('runs the full happy path with correct money everywhere', async () => {
    const driver = await makeDriver('Ahmed Khan');
    const ride = await createRide(driver);
    expect(ride.status).toBe('PUBLISHED');
    expect(ride.distanceMeters).toBeGreaterThan(100000);   // road (mock) distance, not 0
    expect(ride.seatsAvailable).toBe(3);

    const passenger = await signup('John Smith');
    const auth = { Authorization: `Bearer ${passenger.token}` };

    // Search with a nearby pickup still matches (route compatibility).
    const day = new Date(ride.departureAt);
    const search = await api().get('/rides/search').set(auth).query({
      fromLat: 25.0693, fromLng: 55.1413, toLat: ABU_DHABI.lat, toLng: ABU_DHABI.lng,
      departAfter: new Date(day.getTime() - 6 * 3600_000).toISOString(), departBefore: new Date(day.getTime() + 6 * 3600_000).toISOString(), seats: 1,
    }).expect(200);
    const hit = search.body.find((r: any) => r.id === ride.id);
    expect(hit).toBeTruthy();
    expect(hit.match.score).toBeGreaterThan(0.5);
    expect(hit.driver.name).toBe('Ahmed K.');               // privacy: first name + initial
    expect(JSON.stringify(hit)).not.toMatch(/@example\.test|\+9715/); // no email/phone leaks

    // Book 1 seat → RESERVED + seat held.
    const b = await book(passenger.token, ride.id, 1);
    expect(b.status).toBe(201);
    expect(b.body.status).toBe('RESERVED');
    expect(b.body.breakdown).toMatchObject({ grossFareMinor: 5000, platformFeeMinor: 250, passengerTotalMinor: 5000, driverEarningsMinor: 4750 });
    expect((await one(`SELECT seats_available FROM rides WHERE id = $1`, [ride.id])).seats_available).toBe(2);

    // Pay → only the webhook confirms.
    await pay(passenger.token, b.body.id);
    const confirmed = await api().get(`/bookings/${b.body.id}`).set(auth).expect(200);
    expect(confirmed.body.status).toBe('CONFIRMED');
    expect(confirmed.body.paymentStatus).toBe('PAID');

    // Driver sees the passenger + earnings, and gets notified.
    const dAuth = { Authorization: `Bearer ${driver.token}` };
    const dRide = await api().get(`/rides/${ride.id}`).set(dAuth).expect(200);
    expect(dRide.body.passengers).toHaveLength(1);
    expect(dRide.body.passengers[0].earningsMinor).toBe(4750);
    const notes = await api().get('/notifications').set(dAuth).expect(200);
    expect(notes.body.items.some((n: any) => n.type === 'PAYMENT_RECEIVED')).toBe(true);

    let earn = await api().get('/earnings').set(dAuth).expect(200);
    expect(earn.body.wallets[0]).toMatchObject({ pendingMinor: 4750, availableMinor: 0 });

    // Trip: start (move departure close), complete.
    await q(`UPDATE rides SET departure_at = now() + interval '30 minutes', arrival_estimate_at = now() + interval '90 minutes' WHERE id = $1`, [ride.id]);
    await api().post(`/rides/${ride.id}/start`).set(dAuth).expect(200);
    const done = await api().post(`/rides/${ride.id}/complete`).set(dAuth).expect(200);
    expect(done.body.status).toBe('COMPLETED');

    earn = await api().get('/earnings').set(dAuth).expect(200);
    expect(earn.body.wallets[0]).toMatchObject({ pendingMinor: 0, availableMinor: 4750 });
    expect(earn.body.items[0]).toMatchObject({ passengerPaidMinor: 5000, platformFeeMinor: 250, yourEarningsMinor: 4750, status: 'AVAILABLE' });

    // Ratings both ways; aggregates update; double rating rejected.
    await api().post('/ratings').set(auth).send({ bookingId: b.body.id, stars: 5, comment: 'Great ride!', categories: { punctuality: 5 } }).expect(201);
    await api().post('/ratings').set(auth).send({ bookingId: b.body.id, stars: 1 }).expect(409);
    await api().post('/ratings').set(dAuth).send({ bookingId: b.body.id, stars: 4 }).expect(201);
    const prof = await api().get(`/users/${driver.id}`).expect(200);
    expect(prof.body).toMatchObject({ rating: 5, ratingCount: 1, completedRides: 1 });

    // History tabs
    const hist = await api().get('/bookings').query({ tab: 'completed' }).set(auth).expect(200);
    expect(hist.body[0]).toMatchObject({ id: b.body.id, status: 'COMPLETED', rated: true });

    // Admin KPIs reflect GMV / 5% revenue / earnings.
    const admin = await makeAdmin();
    const dash = await api().get('/admin/dashboard').set('Authorization', `Bearer ${admin.token}`).expect(200);
    const aed = dash.body.money.find((m: any) => m.currency === 'AED');
    expect(aed.platformRevenueMinor + aed.driverEarningsMinor).toBe(aed.gmvMinor);
  });

  it('driver-approval mode: decline captures nothing; accept → pay → confirmed', async () => {
    const driver = await makeDriver();
    const ride = await createRide(driver, { instantBooking: false });
    const p1 = await signup('Pax One');
    const r1 = await book(p1.token, ride.id, 1);
    expect(r1.body.status).toBe('REQUESTED');
    expect((await one(`SELECT seats_available FROM rides WHERE id = $1`, [ride.id])).seats_available).toBe(3); // nothing held
    await api().post('/payments/checkout').set('Authorization', `Bearer ${p1.token}`).send({ bookingId: r1.body.id }).expect(409);
    await api().post(`/bookings/${r1.body.id}/decline`).set('Authorization', `Bearer ${driver.token}`).expect(200);
    expect((await one(`SELECT count(*)::int AS n FROM payments WHERE booking_id = $1`, [r1.body.id])).n).toBe(0);

    const p2 = await signup('Pax Two');
    const r2 = await book(p2.token, ride.id, 2);
    await api().post(`/bookings/${r2.body.id}/accept`).set('Authorization', `Bearer ${driver.token}`).expect(200);
    await pay(p2.token, r2.body.id);
    expect((await one(`SELECT status FROM bookings WHERE id = $1`, [r2.body.id])).status).toBe('CONFIRMED');
    expect((await one(`SELECT seats_available FROM rides WHERE id = $1`, [ride.id])).seats_available).toBe(1);
  });

  it('failed payment keeps the hold until expiry, then the seat is released', async () => {
    const driver = await makeDriver();
    const ride = await createRide(driver, { seats: 1 });
    const p = await signup();
    const b = await book(p.token, ride.id, 1);
    await pay(p.token, b.body.id, 'failed');
    expect((await one(`SELECT status FROM bookings WHERE id = $1`, [b.body.id])).status).toBe('RESERVED');
    await q(`UPDATE bookings SET expires_at = now() - interval '1 minute' WHERE id = $1`, [b.body.id]);
    await expireReservations();
    expect((await one(`SELECT status FROM bookings WHERE id = $1`, [b.body.id])).status).toBe('EXPIRED');
    expect((await one(`SELECT seats_available FROM rides WHERE id = $1`, [ride.id])).seats_available).toBe(1);
  });

  it('passenger cancellation > 24h refunds 100%; driver cancellation refunds everyone', async () => {
    const driver = await makeDriver();
    const ride = await createRide(driver);
    const p = await signup();
    const b = await book(p.token, ride.id, 1);
    await pay(p.token, b.body.id);
    const c = await api().post(`/bookings/${b.body.id}/cancel`).set('Authorization', `Bearer ${p.token}`).expect(200);
    expect(c.body.status).toBe('CANCELLED_BY_PASSENGER');
    expect(c.body.refundBps).toBe(10000);
    expect((await one(`SELECT status, refunded_minor FROM payments WHERE booking_id = $1`, [b.body.id]))).toMatchObject({ status: 'REFUNDED', refunded_minor: 5000 });
    expect((await one(`SELECT seats_available FROM rides WHERE id = $1`, [ride.id])).seats_available).toBe(3);

    const p2 = await signup();
    const b2 = await book(p2.token, ride.id, 2);
    await pay(p2.token, b2.body.id);
    await api().post(`/rides/${ride.id}/cancel`).set('Authorization', `Bearer ${driver.token}`).expect(200);
    expect((await one(`SELECT status FROM payments WHERE booking_id = $1`, [b2.body.id])).status).toBe('REFUNDED');
    expect((await one(`SELECT status FROM driver_earnings WHERE booking_id = $1`, [b2.body.id])).status).toBe('REVERSED');
    const w = await one(`SELECT pending_minor, available_minor FROM wallets WHERE user_id = $1`, [driver.id]);
    expect(w.pending_minor).toBe(0);
    expect(w.pending_minor).toBeGreaterThanOrEqual(0);
  });

  it('cancellation < 12h refunds 50% and the driver keeps half their earnings', async () => {
    const driver = await makeDriver();
    const ride = await createRide(driver);
    const p = await signup();
    const b = await book(p.token, ride.id, 1);
    await pay(p.token, b.body.id);
    await q(`UPDATE rides SET departure_at = now() + interval '5 hours', arrival_estimate_at = now() + interval '6 hours' WHERE id = $1`, [ride.id]);
    const c = await api().post(`/bookings/${b.body.id}/cancel`).set('Authorization', `Bearer ${p.token}`).expect(200);
    expect(c.body.refundBps).toBe(5000);
    expect((await one(`SELECT status, refunded_minor FROM payments WHERE booking_id = $1`, [b.body.id]))).toMatchObject({ status: 'PARTIALLY_REFUNDED', refunded_minor: 2500 });
    expect((await one(`SELECT net_minor FROM driver_earnings WHERE booking_id = $1`, [b.body.id])).net_minor).toBe(2375);
  });
});

describe('Admin pricing & compliance', () => {
  it('versioned pricing changes, recorded in history and audit log; country kill-switch blocks rides', async () => {
    const admin = await makeAdmin('FINANCE');
    const A = { Authorization: `Bearer ${admin.token}` };
    const rule = { baseFareMinor: 600, perKmMinor: 130, minFareMinor: 1000, maxFareMinor: 50000, minDriverPriceMinor: 1000, maxDriverPriceMinor: 50000, platformFeeBps: 600, feeBearer: 'DRIVER' };
    await api().post('/admin/pricing/AE').set(A).send(rule).expect(201);
    const quote = await api().post('/routes/quote').send({ countryCode: 'AE', origin: MARINA, destination: ABU_DHABI, seats: 3, pricePerSeatMinor: 5000 }).expect(200);
    expect(quote.body.platformFeeBps).toBe(600);
    expect(quote.body.fullRide).toMatchObject({ grossMinor: 15000, platformFeeMinor: 900, driverEarningsMinor: 14100 });
    const hist = await api().get('/admin/pricing').query({ country: 'AE' }).set(A).expect(200);
    expect(hist.body.length).toBeGreaterThanOrEqual(2);
    expect(hist.body.filter((r: any) => r.is_active)).toHaveLength(1);
    // restore 5%
    await api().post('/admin/pricing/AE').set(A).send({ ...rule, baseFareMinor: 500, perKmMinor: 120, platformFeeBps: 500 }).expect(201);
    expect((await one(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'admin.pricing_update'`)).n).toBeGreaterThanOrEqual(2);

    // FINANCE cannot toggle countries
    await api().patch('/admin/countries/AE').set(A).send({ rideCreationEnabled: false }).expect(403);
    const sa = await makeAdmin('SUPER_ADMIN');
    await api().patch('/admin/countries/AE').set('Authorization', `Bearer ${sa.token}`).send({ rideCreationEnabled: false }).expect(200);
    const driver = await makeDriver();
    await expect(createRide(driver)).rejects.toThrow(/RIDES_DISABLED/);
    await api().patch('/admin/countries/AE').set('Authorization', `Bearer ${sa.token}`).send({ rideCreationEnabled: true }).expect(200);
  });

  it('rejects driver prices outside admin limits and requires phone verification', async () => {
    const d = await makeDriver();
    await expect(createRide(d, { pricePerSeatMinor: 100 })).rejects.toThrow(/PRICE_BELOW_MINIMUM/);
    const unverified = await signup();
    const v = await api().post('/vehicles').set('Authorization', `Bearer ${unverified.token}`).send({ make: 'Kia', model: 'Rio', color: 'Red', licensePlate: 'X1', vehicleType: 'sedan', seats: 5 });
    await expect(createRide({ token: unverified.token, vehicleId: v.body.id })).rejects.toThrow(/VERIFICATION_REQUIRED/);
    await verifyPhone(unverified.token);
    await createRide({ token: unverified.token, vehicleId: v.body.id });
  });
});
