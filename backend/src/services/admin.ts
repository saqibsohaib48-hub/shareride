import { one, q } from '../db';

/**
 * KPI dashboard (spec §16, §31, §62). Money is reported PER CURRENCY — summing AED and INR
 * would be meaningless. A display-only total in a reporting currency is added when FX rates exist.
 */
export async function dashboard(opts: { countryCode?: string; days: number; reportingCurrency: string }) {
  const params = [opts.countryCode ?? null, opts.days];
  const country = `($1::char(2) IS NULL OR r.country_code = $1)`;
  const since = `now() - ($2 || ' days')::interval`;

  const users = await one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE created_at > ${since})::int AS new_users,
            count(*) FILTER (WHERE id IN (SELECT driver_id FROM rides WHERE created_at > ${since}) OR id IN (SELECT passenger_id FROM bookings WHERE created_at > ${since}))::int AS active_users,
            count(*) FILTER (WHERE id IN (SELECT driver_id FROM rides WHERE created_at > ${since}))::int AS active_drivers,
            count(*) FILTER (WHERE id IN (SELECT passenger_id FROM bookings WHERE status IN ('CONFIRMED','IN_PROGRESS','COMPLETED') AND created_at > ${since}))::int AS active_passengers,
            count(*) FILTER (WHERE rides_as_driver > 0)::int AS drivers,
            count(*) FILTER (WHERE trips_as_passenger > 0)::int AS passengers
       FROM users WHERE status <> 'DELETED' AND ($1::char(2) IS NULL OR country_code = $1)`, params);

  const rides = await one(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
            count(*) FILTER (WHERE status IN ('CANCELLED_BY_DRIVER'))::int AS cancelled,
            COALESCE(avg(distance_meters) FILTER (WHERE status = 'COMPLETED'),0)::int AS avg_distance_m,
            COALESCE(avg((seats_total - seats_available)::numeric / seats_total) FILTER (WHERE status = 'COMPLETED'),0) AS avg_occupancy
       FROM rides r WHERE ${country} AND r.created_at > ${since}`, params);

  const money = await q(
    `SELECT b.currency,
            COALESCE(sum(b.passenger_total_minor),0)::bigint AS gmv,
            COALESCE(sum(b.platform_fee_minor - b.promo_discount_minor),0)::bigint AS platform_revenue,
            COALESCE(sum(b.driver_earnings_minor),0)::bigint AS driver_earnings,
            COALESCE(sum(b.tax_minor),0)::bigint AS tax,
            count(*)::int AS bookings,
            COALESCE(avg(b.passenger_total_minor),0)::bigint AS avg_booking_value
       FROM bookings b JOIN rides r ON r.id = b.ride_id
      WHERE ${country} AND b.status IN ('CONFIRMED','PASSENGER_PICKUP','IN_PROGRESS','COMPLETED') AND b.created_at > ${since}
      GROUP BY b.currency ORDER BY gmv DESC`, params);

  const refunds = await q(
    `SELECT p.currency, COALESCE(sum(rf.amount_minor),0)::bigint AS refunded, count(*)::int AS n
       FROM refunds rf JOIN payments p ON p.id = rf.payment_id JOIN bookings b ON b.id = p.booking_id JOIN rides r ON r.id = b.ride_id
      WHERE ${country} AND rf.status = 'SUCCEEDED' AND rf.created_at > ${since} GROUP BY p.currency`, params);

  const funnel = await one(
    `SELECT count(*)::int AS created,
            count(*) FILTER (WHERE b.status IN ('CONFIRMED','PASSENGER_PICKUP','IN_PROGRESS','COMPLETED'))::int AS converted,
            count(*) FILTER (WHERE b.status = 'CANCELLED_BY_PASSENGER')::int AS passenger_cancelled
       FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE ${country} AND b.created_at > ${since}`, params);

  const repeat = await one(
    `SELECT COALESCE(avg((n > 1)::int),0) AS repeat_rate FROM (
       SELECT b.passenger_id, count(*) AS n FROM bookings b JOIN rides r ON r.id = b.ride_id
        WHERE ${country} AND b.status IN ('CONFIRMED','IN_PROGRESS','COMPLETED') AND b.created_at > ${since} GROUP BY b.passenger_id) x`, params);

  const rating = await one(`SELECT COALESCE(avg(stars),0) AS avg FROM ratings ra JOIN rides r ON r.id = ra.ride_id WHERE ${country} AND ra.created_at > ${since}`, params);
  const pending = await one(
    `SELECT (SELECT count(*)::int FROM payouts WHERE status IN ('REQUESTED','PROCESSING')) AS withdrawals,
            (SELECT count(*)::int FROM support_tickets WHERE status IN ('OPEN','UNDER_REVIEW','WAITING_FOR_USER')) AS open_tickets,
            (SELECT count(*)::int FROM disputes WHERE status IN ('OPEN','INVESTIGATING')) AS disputes,
            (SELECT count(*)::int FROM fraud_flags WHERE status = 'OPEN') AS fraud_flags,
            (SELECT count(*)::int FROM refunds WHERE status = 'PENDING') AS pending_refunds`);

  const daily = await q(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day,
            (SELECT count(*)::int FROM rides r WHERE ${country} AND r.created_at::date = d::date) AS rides,
            (SELECT count(*)::int FROM bookings b JOIN rides r ON r.id = b.ride_id WHERE ${country} AND b.confirmed_at::date = d::date) AS bookings,
            (SELECT count(*)::int FROM users u WHERE u.created_at::date = d::date) AS new_users
       FROM generate_series(date_trunc('day', now()) - ($2 || ' days')::interval + interval '1 day', date_trunc('day', now()), interval '1 day') d
      ORDER BY d`, params);

  const dailyMoney = await q(
    `SELECT to_char(b.confirmed_at::date, 'YYYY-MM-DD') AS day, b.currency,
            sum(b.passenger_total_minor)::bigint AS gmv, sum(b.platform_fee_minor - b.promo_discount_minor)::bigint AS revenue
       FROM bookings b JOIN rides r ON r.id = b.ride_id
      WHERE ${country} AND b.confirmed_at > ${since} AND b.status IN ('CONFIRMED','PASSENGER_PICKUP','IN_PROGRESS','COMPLETED')
      GROUP BY 1, 2 ORDER BY 1`, params);

  const byCountry = await q(
    `SELECT r.country_code AS country, b.currency, count(DISTINCT r.id)::int AS rides, sum(b.passenger_total_minor)::bigint AS gmv,
            sum(b.platform_fee_minor - b.promo_discount_minor)::bigint AS revenue
       FROM bookings b JOIN rides r ON r.id = b.ride_id
      WHERE b.status IN ('CONFIRMED','PASSENGER_PICKUP','IN_PROGRESS','COMPLETED') AND b.created_at > now() - ($2 || ' days')::interval AND ($1::char(2) IS NULL OR r.country_code = $1)
      GROUP BY 1, 2 ORDER BY gmv DESC`, params);

  const rates = await q(`SELECT base, rate FROM exchange_rates WHERE quote = $1`, [opts.reportingCurrency]);
  const rateMap = new Map(rates.map((r) => [r.base.trim(), Number(r.rate)]));
  rateMap.set(opts.reportingCurrency, 1);
  const convertible = money.every((m) => rateMap.has(m.currency.trim()));
  const sumIn = (k: 'gmv' | 'platform_revenue' | 'driver_earnings') => Math.round(money.reduce((s, m) => s + Number(m[k]) * (rateMap.get(m.currency.trim()) ?? 0), 0));

  const totalRides = rides!.total || 1;
  return {
    period: { days: opts.days, countryCode: opts.countryCode ?? null },
    users: { total: users!.total, newUsers: users!.new_users, activeUsers: users!.active_users, activeDrivers: users!.active_drivers, activePassengers: users!.active_passengers, drivers: users!.drivers, passengers: users!.passengers },
    rides: {
      total: rides!.total, completed: rides!.completed, cancelled: rides!.cancelled,
      cancellationRate: rides!.cancelled / totalRides, avgDistanceMeters: rides!.avg_distance_m, avgOccupancy: Number(rides!.avg_occupancy),
    },
    money: money.map((m) => ({ currency: m.currency, gmvMinor: m.gmv, platformRevenueMinor: m.platform_revenue, driverEarningsMinor: m.driver_earnings, taxMinor: m.tax, bookings: m.bookings, avgBookingValueMinor: m.avg_booking_value })),
    reportingTotal: convertible && money.length ? { currency: opts.reportingCurrency, gmvMinor: sumIn('gmv'), platformRevenueMinor: sumIn('platform_revenue'), driverEarningsMinor: sumIn('driver_earnings'), note: 'Display-only conversion using stored exchange rates' } : null,
    refunds: refunds.map((r) => ({ currency: r.currency, refundedMinor: r.refunded, count: r.n })),
    conversion: { bookingsCreated: funnel!.created, bookingsConfirmed: funnel!.converted, rate: funnel!.created ? funnel!.converted / funnel!.created : 0, passengerCancelled: funnel!.passenger_cancelled },
    repeatBookingRate: Number(repeat!.repeat_rate),
    averageRating: Math.round(Number(rating!.avg) * 100) / 100,
    pending: { withdrawals: pending!.withdrawals, openTickets: pending!.open_tickets, disputes: pending!.disputes, fraudFlags: pending!.fraud_flags, pendingRefunds: pending!.pending_refunds },
    daily, dailyMoney, byCountry,
  };
}
