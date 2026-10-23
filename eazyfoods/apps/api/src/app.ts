import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { loadUser } from './lib/auth.js';
import { authRoutes } from './routes/auth.js';
import { catalogueRoutes } from './routes/catalogue.js';
import { searchRoutes } from './routes/search.js';
import { storeRoutes } from './routes/stores.js';
import { vendorRoutes } from './routes/vendor.js';
import { adminRoutes } from './routes/admin.js';
import { vendorOrderRoutes } from './routes/vendorOrders.js';
import { driverRoutes } from './routes/driver.js';
import { vendorPortalRoutes } from './routes/vendorPortal.js';
import { supportRoutes } from './routes/support.js';
import { engagementRoutes } from './routes/engagement.js';
import { recipeRoutes } from './routes/recipes.js';
import { adRoutes } from './routes/ads.js';
import { uploadRoutes } from './routes/uploads.js';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { publicDir } from './lib/storage.js';
import { cartRoutes } from './routes/cart.js';
import { accountRoutes } from './routes/account.js';
import { orderRoutes } from './routes/orders.js';
import { paymentRoutes, webhookRoutes } from './routes/payments.js';
import { contentRoutes } from './routes/content.js';

export async function buildApp() {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
  });

  await app.register(helmet);
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart);
  await app.register(fastifyStatic, { root: publicDir, prefix: '/uploads/', decorateReply: false, immutable: true, maxAge: '30d', dotfiles: 'deny' });

  app.decorateRequest('user', null);
  app.addHook('onRequest', loadUser);
  // CSRF defence in depth on top of SameSite=Lax: reject cross-origin state-changing browser requests.
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin;
    if (origin && origin !== config.WEB_ORIGIN) return reply.code(403).send({ error: 'bad_origin' });
  });

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'validation', issues: err.issues });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'error', message: err.message, ...(err.details ? { details: err.details } : {}) });
    if (config.NODE_ENV === 'test') console.error(err);
    req.log.error(err);
    pool.query('INSERT INTO error_events(message, stack, method, url, request_id, user_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [String(err.message).slice(0, 500), String(err.stack ?? '').slice(0, 4000), req.method, req.url.split('?')[0], req.id, req.user?.id ?? null]).catch(() => {});
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong on our side. Please try again.' });
  });

  app.get('/health', async () => {
    const { pool } = await import('./db/pool.js');
    await pool.query('SELECT 1');
    return { ok: true };
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(catalogueRoutes, { prefix: '/api' });
  await app.register(searchRoutes, { prefix: '/api' });
  await app.register(storeRoutes, { prefix: '/api' });
  await app.register(vendorRoutes, { prefix: '/api/vendor' });
  await app.register(vendorOrderRoutes, { prefix: '/api/vendor' });
  await app.register(vendorPortalRoutes, { prefix: '/api/vendor' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(cartRoutes, { prefix: '/api' });
  await app.register(accountRoutes, { prefix: '/api' });
  await app.register(orderRoutes, { prefix: '/api' });
  await app.register(paymentRoutes, { prefix: '/api' });
  await app.register(webhookRoutes, { prefix: '/api' });
  await app.register(contentRoutes, { prefix: '/api' });
  await app.register(driverRoutes, { prefix: '/api' });
  await app.register(supportRoutes, { prefix: '/api' });
  await app.register(engagementRoutes, { prefix: '/api' });
  await app.register(recipeRoutes, { prefix: '/api' });
  await app.register(adRoutes, { prefix: '/api' });
  await app.register(uploadRoutes, { prefix: '/api' });
  return app;
}
