import { config } from '../config.js';
import { MockProvider } from './mock.js';
import { StripeProvider } from './stripe.js';

export type NormalizedEvent = {
  id: string;
  type: 'payment_succeeded' | 'payment_failed' | 'dispute_opened' | 'other';
  providerPaymentId?: string;
  amountCents?: number;
  failureMessage?: string;
  raw: unknown;
};

export interface PaymentProvider {
  readonly name: 'mock' | 'stripe';
  createPayment(a: { amountCents: number; currency: string; orderNumber: string; email: string; idempotencyKey: string }): Promise<{ providerPaymentId: string; clientSecret: string }>;
  cancelPayment(providerPaymentId: string): Promise<void>;
  /** Throws if the signature is invalid. */
  parseWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): NormalizedEvent;
  refund(a: { providerPaymentId: string; amountCents: number; idempotencyKey: string }): Promise<{ providerRefundId: string }>;
  transfer?(a: { destinationAccount: string; amountCents: number; idempotencyKey: string }): Promise<{ transferId: string }>;
}

let provider: PaymentProvider | undefined;
export function getProvider(): PaymentProvider {
  provider ??= config.PAYMENT_PROVIDER === 'stripe' ? new StripeProvider() : new MockProvider();
  return provider;
}
