import { Router } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { one, pool, q } from '../db';
import { h, body, query } from '../middleware/http';
import { requireAuth, requirePermission } from '../middleware/auth';
import { audit } from '../services/audit';
import { notify } from '../services/notifications';
import { notFound } from '../utils/errors';
import { uuid } from './schemas';

export const supportRouter = Router();
const CATEGORIES = ['PAYMENT', 'DRIVER', 'PASSENGER', 'SAFETY', 'PICKUP', 'CANCELLATION', 'REFUND', 'LOST_ITEM', 'OTHER'] as const;

supportRouter.post('/support/tickets', requireAuth, h(async (req, res) => {
  const b = body(z.object({ category: z.enum(CATEGORIES), subject: z.string().trim().min(3).max(120), body: z.string().trim().min(10).max(4000), bookingId: uuid.optional(), rideId: uuid.optional() }), req);
  const ref = `SR-${crypto.randomInt(100000, 999999)}`;
  const t = await one(
    `INSERT INTO support_tickets (reference, user_id, booking_id, ride_id, category, subject, body, priority) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, reference, category, status, subject, created_at AS "createdAt"`,
    [ref, req.user!.id, b.bookingId ?? null, b.rideId ?? null, b.category, b.subject, b.body, b.category === 'SAFETY' ? 'URGENT' : 'NORMAL']);
  await audit('support.ticket_created', { actorId: req.user!.id, entityType: 'ticket', entityId: t.id, data: { category: b.category } });
  res.status(201).json(t);
}));

supportRouter.get('/support/tickets', requireAuth, h(async (req, res) => {
  res.json(await q(`SELECT id, reference, category, status, subject, created_at AS "createdAt", updated_at AS "updatedAt" FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC`, [req.user!.id]));
}));

// ── Admin side ──
supportRouter.get('/admin/support/tickets', requirePermission('support.manage'), h(async (req, res) => {
  const p = query(z.object({ status: z.string().optional() }), req);
  res.json(await q(
    `SELECT t.*, u.name AS user_name FROM support_tickets t JOIN users u ON u.id = t.user_id
      WHERE ($1::text IS NULL OR t.status = $1) ORDER BY (t.priority = 'URGENT') DESC, t.created_at DESC LIMIT 200`, [p.status ?? null]));
}));

supportRouter.patch('/admin/support/tickets/:id', requirePermission('support.manage'), h(async (req, res) => {
  const b = body(z.object({ status: z.enum(['OPEN', 'UNDER_REVIEW', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED']).optional(), note: z.string().max(4000).optional(), internal: z.boolean().default(true) }), req);
  const id = uuid.parse(req.params.id);
  const t = await one(`UPDATE support_tickets SET status = COALESCE($2, status), assigned_to = COALESCE(assigned_to, $3), updated_at = now() WHERE id = $1 RETURNING *`, [id, b.status ?? null, req.user!.id]);
  if (!t) throw notFound('Ticket');
  if (b.note) await q(`INSERT INTO ticket_notes (ticket_id, author_id, is_internal, body) VALUES ($1,$2,$3,$4)`, [id, req.user!.id, b.internal, b.note]);
  if (b.note && !b.internal) await notify(pool, t.user_id, 'ACCOUNT', `Update on ${t.reference}`, b.note.slice(0, 200), { ticketId: id });
  await audit('admin.ticket_update', { actorId: req.user!.id, actorRole: req.user!.adminRole, entityType: 'ticket', entityId: id, data: { status: b.status }, req });
  res.json(t);
}));
