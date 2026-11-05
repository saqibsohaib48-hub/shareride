import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import swaggerUi from 'swagger-ui-express';
import { config } from './config';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/http';
import { notFound } from './utils/errors';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { catalogRouter } from './routes/catalog';
import { ridesRouter } from './routes/rides';
import { bookingsRouter } from './routes/bookings';
import { webhooksRouter } from './routes/webhooks';
import { adminRouter } from './routes/admin';
import { supportRouter } from './routes/support';
import { pool } from './db';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1); // behind a TLS-terminating load balancer (HTTPS enforced at the edge)
  app.disable('x-powered-by');

  app.use(helmet({
    hsts: { maxAge: 31536000, includeSubDomains: true },
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'] } },
  }));
  const origins = config.CORS_ORIGINS.split(',').map((s) => s.trim());
  // Bearer tokens in the Authorization header (not cookies) → CSRF does not apply; CORS still restricts browsers.
  app.use(cors({ origin: (o, cb) => cb(null, !o || origins.includes(o)), credentials: false }));
  app.use(pinoHttp({ logger, autoLogging: config.NODE_ENV !== 'test' }));

  app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true, mapProvider: config.MAP_PROVIDER, paymentProvider: config.PAYMENT_PROVIDER });
  });

  // Webhooks need the raw body for signature verification → mount before express.json().
  app.use('/webhooks', express.raw({ type: '*/*', limit: '1mb' }), webhooksRouter);

  app.use(express.json({ limit: '100kb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: config.NODE_ENV === 'test' ? 100_000 : 300, standardHeaders: 'draft-7', legacyHeaders: false }));

  const here = path.dirname(fileURLToPath(import.meta.url));
  const specPath = path.resolve(here, '../../docs/openapi.yaml');
  if (fs.existsSync(specPath)) {
    const spec = YAML.parse(fs.readFileSync(specPath, 'utf8'));
    app.get('/openapi.json', (_req, res) => res.json(spec));
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec));
  }

  app.use('/auth', authRouter);
  app.use('/', usersRouter);
  app.use('/', catalogRouter);
  app.use('/', ridesRouter);
  app.use('/', bookingsRouter);
  app.use('/', supportRouter);
  app.use('/admin', adminRouter);

  app.use((_req, _res, next) => next(notFound('Endpoint')));
  app.use(errorHandler);
  return app;
}
