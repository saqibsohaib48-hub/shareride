import pino from 'pino';
import { config } from '../config';

export const logger = pino({
  level: config.NODE_ENV === 'test' ? (process.env.TEST_LOG ?? 'silent') : config.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers.cookie', 'password', 'card', '*.password', '*.token'],
});
