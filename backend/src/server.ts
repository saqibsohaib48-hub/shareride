import { createApp } from './app';
import { config } from './config';
import { startJobs } from './jobs';
import { pool } from './db';
import { logger } from './utils/logger';

const app = createApp();
const server = app.listen(config.PORT, () => logger.info(`Share Ride API listening on :${config.PORT} (maps=${config.MAP_PROVIDER}, payments=${config.PAYMENT_PROVIDER})`));
if (process.env.DISABLE_JOBS !== 'true') startJobs();

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    logger.info(`${sig} received, shutting down`);
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
