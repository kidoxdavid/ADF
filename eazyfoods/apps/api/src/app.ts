import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';
import { config } from './config.js';
import { loadUser } from './lib/auth.js';
import { authRoutes } from './routes/auth.js';
import { catalogueRoutes } from './routes/catalogue.js';
import { searchRoutes } from './routes/search.js';
import { storeRoutes } from './routes/stores.js';
import { vendorRoutes } from './routes/vendor.js';
import { adminRoutes } from './routes/admin.js';

export async function buildApp() {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] },
  });

  await app.register(helmet);
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

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
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'error', message: err.message });
    req.log.error(err);
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
  await app.register(adminRoutes, { prefix: '/api/admin' });
  return app;
}
