import Stripe from 'stripe';
import { config } from '../config.js';
import type { NormalizedEvent, PaymentProvider } from './provider.js';

/**
 * Stripe adapter (separate charges and transfers model for marketplace payouts).
 * NOT YET VERIFIED against a live/test Stripe account: no credentials were available when this was written.
 * Before go-live: run the Stripe test-mode checklist in docs/PAYMENTS.md and confirm Connect eligibility and terms for Canada.
 */
export class StripeProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  private stripe: Stripe;

  constructor() {
    if (!config.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is required when PAYMENT_PROVIDER=stripe');
    this.stripe = new Stripe(config.STRIPE_SECRET_KEY);
  }

  async createPayment(a: { amountCents: number; currency: string; orderNumber: string; email: string; idempotencyKey: string }) {
    const pi = await this.stripe.paymentIntents.create(
      { amount: a.amountCents, currency: a.currency.toLowerCase(), receipt_email: a.email, description: `EAZyfoods order ${a.orderNumber}`,
        metadata: { order_number: a.orderNumber }, automatic_payment_methods: { enabled: true }, transfer_group: a.orderNumber },
      { idempotencyKey: a.idempotencyKey });
    return { providerPaymentId: pi.id, clientSecret: pi.client_secret! };
  }
  async cancelPayment(id: string) { await this.stripe.paymentIntents.cancel(id).catch(() => {}); }

  parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedEvent {
    const e = this.stripe.webhooks.constructEvent(raw, String(headers['stripe-signature'] ?? ''), config.STRIPE_WEBHOOK_SECRET!);
    const o = e.data.object as any;
    switch (e.type) {
      case 'payment_intent.succeeded': return { id: e.id, type: 'payment_succeeded', providerPaymentId: o.id, amountCents: o.amount_received, raw: e };
      case 'payment_intent.payment_failed': return { id: e.id, type: 'payment_failed', providerPaymentId: o.id, failureMessage: o.last_payment_error?.message, raw: e };
      case 'charge.dispute.created': return { id: e.id, type: 'dispute_opened', providerPaymentId: o.payment_intent, amountCents: o.amount, raw: e };
      default: return { id: e.id, type: 'other', raw: e };
    }
  }
  async refund(a: { providerPaymentId: string; amountCents: number; idempotencyKey: string }) {
    const r = await this.stripe.refunds.create({ payment_intent: a.providerPaymentId, amount: a.amountCents }, { idempotencyKey: a.idempotencyKey });
    return { providerRefundId: r.id };
  }
  async transfer(a: { destinationAccount: string; amountCents: number; idempotencyKey: string }) {
    const t = await this.stripe.transfers.create({ amount: a.amountCents, currency: 'cad', destination: a.destinationAccount }, { idempotencyKey: a.idempotencyKey });
    return { transferId: t.id };
  }
}
