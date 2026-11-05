import crypto from 'node:crypto';

/** Expected, user-safe error. Message is shown to users; everything else becomes "Something went wrong". */
export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (code: string, msg: string, details?: unknown) => new AppError(400, code, msg, details);
export const unauthorized = (msg = 'Please log in to continue.') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = "You don't have permission to do that.") => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (what = 'Item') => new AppError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);

/** Reference IDs like SR-482913 shown to users and logged with the real error (spec §69). */
export function referenceId(): string {
  return `SR-${crypto.randomInt(100000, 999999)}`;
}
