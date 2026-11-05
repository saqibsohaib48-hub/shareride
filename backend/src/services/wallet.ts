import { Db, one, q } from '../db';

export async function ensureWallet(db: Db, userId: string, currency: string): Promise<string> {
  const row = await one<{ id: string }>(
    `INSERT INTO wallets (user_id, currency) VALUES ($1,$2)
     ON CONFLICT (user_id, currency) DO UPDATE SET updated_at = wallets.updated_at RETURNING id`, [userId, currency], db);
  return row!.id;
}

type Bucket = 'available' | 'pending' | 'withdrawn';

/**
 * Move money between wallet buckets atomically. CHECK constraints make any move that
 * would leave a bucket negative fail the whole transaction (spec §85: no negative wallets).
 */
export async function moveWallet(
  db: Db,
  walletId: string,
  delta: Partial<Record<Bucket, number>>,
  txn: { type: string; amountMinor: number; description: string; bookingId?: string; rideId?: string },
) {
  await q(
    `UPDATE wallets SET available_minor = available_minor + $2, pending_minor = pending_minor + $3,
            withdrawn_minor = withdrawn_minor + $4, updated_at = now() WHERE id = $1`,
    [walletId, delta.available ?? 0, delta.pending ?? 0, delta.withdrawn ?? 0], db);
  await q(
    `INSERT INTO wallet_transactions (wallet_id, booking_id, ride_id, type, amount_minor, description) VALUES ($1,$2,$3,$4,$5,$6)`,
    [walletId, txn.bookingId ?? null, txn.rideId ?? null, txn.type, txn.amountMinor, txn.description], db);
}
