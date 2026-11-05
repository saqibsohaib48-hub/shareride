import crypto from 'node:crypto';
import Stripe from 'stripe';
import { config } from '../config';
import { AppError } from '../utils/errors';
import { timingSafeEqualStr } from '../utils/crypto';

export interface CreatePaymentInput {
  bookingId: string;
  amountMinor: number;
  currency: string;
  description: string;
  idempotencyKey: string;
}

export interface CreatedPayment { providerPaymentId: string; clientSecret: string }

export type NormalisedEvent =
  | { eventId: string; kind: 'succeeded' | 'failed' | 'cancelled' | 'authorized'; providerPaymentId: string; amountMinor: number; currency: string; raw: unknown; failureReason?: string }
  | { eventId: string; kind: 'ignored'; raw: unknown };

/**
 * Card data never touches our servers: clients use the provider's hosted/tokenised UI
 * (Stripe PaymentElement on web, PaymentSheet on mobile — cards, Apple Pay, Google Pay, local methods).
 */
export interface PaymentProvider {
  name: 'stripe' | 'mock';
  createPayment(i: CreatePaymentInput): Promise<CreatedPayment>;
  /** Verifies the webhook signature against the RAW body. Throws on invalid signature. */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalisedEvent;
  refund(providerPaymentId: string, amountMinor: number, idempotencyKey: string): Promise<{ providerRefundId: string }>;
  cancel(providerPaymentId: string): Promise<void>;
}

const invalidSig = () => new AppError(400, 'INVALID_SIGNATURE', 'Invalid webhook signature.');

class StripeProvider implements PaymentProvider {
  name = 'stripe' as const;
  private stripe: Stripe;
  constructor(secret: string, private webhookSecret: string) {
    this.stripe = new Stripe(secret);
  }
  async createPayment(i: CreatePaymentInput): Promise<CreatedPayment> {
    // Note: Stripe amounts are in the smallest currency unit, matching our minor units.
    // For 3-decimal currencies (KWD/BHD/OMR) Stripe requires the last digit to be 0 — see docs/PAYMENTS.md.
    const pi = await this.stripe.paymentIntents.create(
      {
        amount: i.amountMinor,
        currency: i.currency.toLowerCase(),
        description: i.description,
        automatic_payment_methods: { enabled: true },
        metadata: { booking_id: i.bookingId },
      },
      { idempotencyKey: i.idempotencyKey },
    );
    return { providerPaymentId: pi.id, clientSecret: pi.client_secret! };
  }
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalisedEvent {
    let ev: Stripe.Event;
    try {
      ev = this.stripe.webhooks.constructEvent(rawBody, String(headers['stripe-signature'] ?? ''), this.webhookSecret);
    } catch {
      throw invalidSig();
    }
    const pi = ev.data.object as Stripe.PaymentIntent;
    const base = { eventId: ev.id, providerPaymentId: pi.id, amountMinor: pi.amount_received || pi.amount, currency: String(pi.currency).toUpperCase(), raw: ev };
    switch (ev.type) {
      case 'payment_intent.succeeded': return { ...base, kind: 'succeeded' };
      case 'payment_intent.amount_capturable_updated': return { ...base, kind: 'authorized' };
      case 'payment_intent.payment_failed': return { ...base, kind: 'failed', failureReason: pi.last_payment_error?.code ?? 'failed' };
      case 'payment_intent.canceled': return { ...base, kind: 'cancelled' };
      default: return { eventId: ev.id, kind: 'ignored', raw: ev };
    }
  }
  async refund(providerPaymentId: string, amountMinor: number, idempotencyKey: string) {
    const r = await this.stripe.refunds.create({ payment_intent: providerPaymentId, amount: amountMinor }, { idempotencyKey });
    return { providerRefundId: r.id };
  }
  async cancel(providerPaymentId: string) {
    try { await this.stripe.paymentIntents.cancel(providerPaymentId); } catch { /* already finalised */ }
  }
}

/**
 * DEV/TEST ONLY. Simulates a provider: events are HMAC-signed and go through the SAME webhook
 * handler as Stripe, so the "never trust the frontend" flow is exercised end-to-end.
 */
export class MockProvider implements PaymentProvider {
  name = 'mock' as const;
  constructor(private secret: string) {}
  async createPayment(i: CreatePaymentInput): Promise<CreatedPayment> {
    const id = `mock_pi_${crypto.randomBytes(8).toString('hex')}`;
    return { providerPaymentId: id, clientSecret: `${id}_secret_${crypto.randomBytes(8).toString('hex')}` };
  }
  sign(rawBody: string): string {
    return crypto.createHmac('sha256', this.secret).update(rawBody).digest('hex');
  }
  buildEvent(kind: 'succeeded' | 'failed', providerPaymentId: string, amountMinor: number, currency: string) {
    const body = JSON.stringify({ id: `mock_evt_${crypto.randomBytes(8).toString('hex')}`, kind, providerPaymentId, amountMinor, currency });
    return { body, signature: this.sign(body) };
  }
  parseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): NormalisedEvent {
    const sig = String(headers['x-mock-signature'] ?? '');
    if (!timingSafeEqualStr(sig, this.sign(rawBody.toString('utf8')))) throw invalidSig();
    const ev = JSON.parse(rawBody.toString('utf8'));
    return { eventId: ev.id, kind: ev.kind, providerPaymentId: ev.providerPaymentId, amountMinor: ev.amountMinor, currency: ev.currency, raw: ev };
  }
  async refund() { return { providerRefundId: `mock_re_${crypto.randomBytes(8).toString('hex')}` }; }
  async cancel() {}
}

export function createPaymentProvider(): PaymentProvider {
  if (config.PAYMENT_PROVIDER === 'stripe') {
    if (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required');
    return new StripeProvider(config.STRIPE_SECRET_KEY, config.STRIPE_WEBHOOK_SECRET);
  }
  return new MockProvider(config.MOCK_WEBHOOK_SECRET);
}

export const payments = createPaymentProvider();
