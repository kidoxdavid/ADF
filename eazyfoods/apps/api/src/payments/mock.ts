import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import type { NormalizedEvent, PaymentProvider } from './provider.js';

/**
 * DEVELOPMENT / TEST ONLY. Holds no money and talks to no network.
 * It implements the same interface as the real provider, including signed webhooks, so the order and ledger code paths are the real ones.
 */
export class MockProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  async createPayment(a: { idempotencyKey: string }) {
    const id = 'mock_pi_' + randomBytes(8).toString('hex');
    return { providerPaymentId: id, clientSecret: id + '_secret' };
  }
  async cancelPayment() {}
  async refund() { return { providerRefundId: 'mock_re_' + randomBytes(8).toString('hex') }; }
  async transfer() { return { transferId: 'mock_tr_' + randomBytes(8).toString('hex') }; }

  static sign(raw: Buffer | string) {
    return createHmac('sha256', config.MOCK_WEBHOOK_SECRET).update(raw).digest('hex');
  }

  parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedEvent {
    const sig = String(headers['x-mock-signature'] ?? '');
    const expected = MockProvider.sign(raw);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) throw new Error('invalid signature');
    const e = JSON.parse(raw.toString('utf8'));
    const map: Record<string, NormalizedEvent['type']> = { 'payment.succeeded': 'payment_succeeded', 'payment.failed': 'payment_failed', 'dispute.opened': 'dispute_opened' };
    return { id: e.id, type: map[e.type] ?? 'other', providerPaymentId: e.payment_id, amountCents: e.amount_cents, failureMessage: e.failure_message, raw: e };
  }
}
