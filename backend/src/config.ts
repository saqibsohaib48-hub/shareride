import 'dotenv/config';
import { z } from 'zod';

/**
 * Central configuration (spec §73–74). Secrets come ONLY from environment variables.
 * Business settings that change at runtime (platform fee, pricing, cancellation rules)
 * live in the database and are editable from the admin dashboard — not here.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().default(30),
  DATA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'DATA_ENCRYPTION_KEY must be 32 bytes hex'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  PUBLIC_WEB_URL: z.string().default('http://localhost:3000'),

  DEFAULT_COUNTRY: z.string().length(2).default('AE'),
  SUPPORTED_LANGUAGES: z.string().default('en,ar,hi,ur,fr,es'),
  BOOKING_EXPIRY_MINUTES: z.coerce.number().default(15),

  MAP_PROVIDER: z.enum(['google', 'mapbox', 'mock']).default('mock'),
  GOOGLE_MAPS_API_KEY: z.string().optional(),
  MAPBOX_ACCESS_TOKEN: z.string().optional(),

  PAYMENT_PROVIDER: z.enum(['stripe', 'mock']).default('mock'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  MOCK_WEBHOOK_SECRET: z.string().default('dev-mock-webhook-secret'),

  SMS_PROVIDER: z.enum(['twilio', 'console']).default('console'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),

  GOOGLE_OAUTH_CLIENT_IDS: z.string().optional(), // comma-separated (web, iOS, Android)
  APPLE_CLIENT_IDS: z.string().optional(),        // bundle id / services id

  PUSH_PROVIDER: z.enum(['expo', 'console']).default('console'),
  EXPO_ACCESS_TOKEN: z.string().optional(),

  EXCHANGE_RATE_API_URL: z.string().optional(), // e.g. https://open.er-api.com/v6/latest/{BASE}
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
export const config = parsed.data;

// Production guards: mock providers are dev/test only.
if (config.NODE_ENV === 'production') {
  const problems: string[] = [];
  if (config.MAP_PROVIDER === 'mock') problems.push('MAP_PROVIDER=mock is not allowed in production (road distance required)');
  if (config.PAYMENT_PROVIDER === 'mock') problems.push('PAYMENT_PROVIDER=mock is not allowed in production');
  if (config.PAYMENT_PROVIDER === 'stripe' && (!config.STRIPE_SECRET_KEY || !config.STRIPE_WEBHOOK_SECRET)) problems.push('Stripe keys missing');
  if (config.SMS_PROVIDER === 'console') problems.push('SMS_PROVIDER=console is not allowed in production');
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
}

export const isProd = config.NODE_ENV === 'production';
