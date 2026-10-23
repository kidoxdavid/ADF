import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { config, isProd } from '../config.js';
import { handleWebhook } from '../services/payments.js';
import { MockProvider } from '../payments/mock.js';
import { requireLogin } from '../lib/permissions.js';
import { getProvider } from '../payments/provider.js';
import { notFound, conflict } from '../lib/errors.js';
import { randomBytes } from 'node:crypto';

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  // The raw bytes are needed to verify the provider's signature, so JSON is not pre-parsed in this plugin.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  app.post('/webhooks/payments', async (req, reply) => {
    const result = await handleWebhook(req.body as Buffer, req.headers);
    return reply.code(200).send(result);
  });
};

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  app.get('/config', async () => ({
    payment_provider: getProvider().name,
    stripe_publishable_key: config.PAYMENT_PROVIDER === 'stripe' ? config.STRIPE_PUBLISHABLE_KEY ?? null : null,
    test_mode: config.PAYMENT_PROVIDER === 'mock',
    currency: 'CAD',
  }));

  if (!isProd && config.PAYMENT_PROVIDER === 'mock') {
    // DEV ONLY. Builds a correctly signed provider event and sends it through the real webhook handler.
    // It cannot mark anything paid by itself and does not exist in production.
    app.post<{ Params: { id: string } }>('/dev/orders/:id/simulate-payment', { preHandler: requireLogin }, async (req) => {
      const id = z.string().uuid().parse(req.params.id);
      const { outcome } = z.object({ outcome: z.enum(['succeeded', 'failed']) }).parse(req.body);
      const p = (await pool.query(
        `SELECT p.* FROM payments p JOIN orders o ON o.id = p.order_id WHERE o.id = $1 AND o.user_id = $2 ORDER BY p.created_at DESC LIMIT 1`, [id, req.user!.id])).rows[0];
      if (!p) throw notFound('No payment for this order');
      if (p.status !== 'requires_payment') throw conflict('not_payable', 'This payment is no longer waiting for a card.');
      const body = Buffer.from(JSON.stringify({
        id: 'evt_' + randomBytes(8).toString('hex'), type: outcome === 'succeeded' ? 'payment.succeeded' : 'payment.failed',
        payment_id: p.provider_payment_id, amount_cents: p.amount_cents, failure_message: outcome === 'failed' ? 'Your card was declined (simulated).' : undefined }));
      return handleWebhook(body, { 'x-mock-signature': MockProvider.sign(body) });
    });
  }
};
