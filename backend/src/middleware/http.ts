import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError, ZodTypeAny, z } from 'zod';
import { InvalidTransitionError } from '@share-ride/shared';
import { AppError, referenceId } from '../utils/errors';
import { logger } from '../utils/logger';

/** Wrap async handlers so rejections reach the error middleware. */
export const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
  (req, res, next) => { fn(req, res).catch(next); };

export function body<S extends ZodTypeAny>(schema: S, req: Request): z.output<S> { return schema.parse(req.body); }
export function query<S extends ZodTypeAny>(schema: S, req: Request): z.output<S> { return schema.parse(req.query); }

/**
 * Users never see technical errors (spec §69). Expected errors carry a friendly message;
 * unexpected ones are logged with a reference ID the user can quote to support.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Please check the highlighted fields.', details: err.flatten().fieldErrors } });
  }
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof InvalidTransitionError) {
    return res.status(409).json({ error: { code: 'INVALID_STATUS', message: 'This action is not available for the current trip status.' } });
  }
  const pgCode = (err as any)?.code;
  if (pgCode === '23505') return res.status(409).json({ error: { code: 'DUPLICATE', message: 'This already exists.' } });
  if (pgCode === '23514' && String((err as any).constraint).startsWith('seats_')) {
    return res.status(409).json({ error: { code: 'SEATS_UNAVAILABLE', message: 'Sorry, those seats were just taken.' } });
  }
  const ref = referenceId();
  logger.error({ err, ref, path: req.path, method: req.method }, 'unhandled error');
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.', referenceId: ref } });
}
