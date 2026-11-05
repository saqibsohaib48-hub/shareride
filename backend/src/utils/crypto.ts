import crypto from 'node:crypto';
import { config } from '../config';

const key = () => Buffer.from(config.DATA_ENCRYPTION_KEY, 'hex');

/** AES-256-GCM for sensitive fields at rest (trusted-contact phone numbers, MFA secrets). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(blob: string): string {
  const [iv, tag, enc] = blob.split('.').map((s) => Buffer.from(s, 'base64url'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
