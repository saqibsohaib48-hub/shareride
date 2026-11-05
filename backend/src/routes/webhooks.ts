import { Router } from 'express';
import { h } from '../middleware/http';
import { payments } from '../providers/payments';
import { handlePaymentEvent } from '../services/payments';

export const webhooksRouter = Router();

/**
 * Payment provider webhook. Mounted BEFORE the JSON parser with a raw body, because
 * signature verification must run over the exact bytes the provider sent.
 * Stripe: configure endpoint → https://api.your-domain.com/webhooks/payments
 */
webhooksRouter.post('/payments', h(async (req, res) => {
  const ev = payments.parseWebhook(req.body as Buffer, req.headers); // throws 400 on bad signature
  const out = await handlePaymentEvent(ev);
  res.json({ received: true, ...out });
}));
