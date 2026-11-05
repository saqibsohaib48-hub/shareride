import { Db, pool, q } from '../db';
import { sendPush } from '../providers/messaging';
import { logger } from '../utils/logger';

export type NotificationType =
  | 'RIDE_REQUEST_RECEIVED' | 'RIDE_REQUEST_ACCEPTED' | 'RIDE_REQUEST_DECLINED'
  | 'PAYMENT_SUCCESSFUL' | 'PAYMENT_RECEIVED' | 'BOOKING_CONFIRMED' | 'BOOKING_EXPIRED'
  | 'RIDE_CANCELLED' | 'RIDE_STARTING_SOON' | 'RIDE_STARTED' | 'RIDE_COMPLETED'
  | 'DRIVER_APPROACHING' | 'NEW_MESSAGE' | 'REFUND_ISSUED' | 'WITHDRAWAL_COMPLETED' | 'ANNOUNCEMENT' | 'ACCOUNT';

/**
 * Write an in-app notification (inside the caller's transaction).
 * The push is delivered by `dispatchPendingPushes` AFTER commit — a rolled-back
 * transaction can never send a "payment successful" push.
 */
export async function notify(db: Db, userId: string, type: NotificationType, title: string, body: string, data: Record<string, unknown> = {}) {
  await q(`INSERT INTO notifications (user_id, type, title, body, data) VALUES ($1,$2,$3,$4,$5)`, [userId, type, title, body, JSON.stringify(data)], db);
  scheduleDispatch();
}

let timer: NodeJS.Timeout | null = null;
function scheduleDispatch() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; dispatchPendingPushes().catch((err) => logger.warn({ err }, 'push dispatch failed')); }, 250);
  timer.unref?.();
}

export async function dispatchPendingPushes(limit = 200): Promise<number> {
  const rows = await q<{ id: string; user_id: string; title: string; body: string; data: any; type: string; push: boolean }>(
    `UPDATE notifications n SET push_sent_at = now()
       FROM profiles p
      WHERE n.id IN (SELECT id FROM notifications WHERE push_sent_at IS NULL ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED)
        AND p.user_id = n.user_id
      RETURNING n.id, n.user_id, n.title, n.body, n.data, n.type, COALESCE((p.notification_prefs->>'push')::boolean, true) AS push`,
    [limit], pool);
  for (const r of rows) {
    if (!r.push) continue;
    const tokens = (await q<{ token: string }>(`SELECT token FROM device_tokens WHERE user_id = $1`, [r.user_id])).map((t) => t.token);
    await sendPush(tokens, r.title, r.body, { ...r.data, type: r.type, notificationId: r.id });
  }
  return rows.length;
}
