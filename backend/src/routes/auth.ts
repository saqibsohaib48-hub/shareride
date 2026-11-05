import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { h, body } from '../middleware/http';
import { optionalAuth, requireAuth } from '../middleware/auth';
import * as auth from '../services/auth';
import { getMe } from '../services/users';
import { country, e164 } from './schemas';

export const authRouter = Router();

// Tight limits on credential endpoints (brute-force / SMS-pumping defence).
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: config.NODE_ENV === 'test' ? 10_000 : 30, standardHeaders: 'draft-7', legacyHeaders: false });
const otpLimiter = rateLimit({ windowMs: 60 * 60_000, limit: config.NODE_ENV === 'test' ? 10_000 : 10, standardHeaders: 'draft-7', legacyHeaders: false });

const password = z.string().min(8, 'At least 8 characters').max(128).regex(/[A-Za-z]/, 'Include a letter').regex(/\d/, 'Include a number');

authRouter.post('/register', authLimiter, h(async (req, res) => {
  const b = body(z.object({ name: z.string().trim().min(2).max(80), email: z.string().email().max(200), password, phone: e164.optional(), countryCode: country }), req);
  res.status(201).json(await auth.registerEmail(b, req.get('user-agent')));
}));

authRouter.post('/login', authLimiter, h(async (req, res) => {
  const b = body(z.object({ email: z.string().email(), password: z.string().min(1).max(128) }), req);
  res.json(await auth.loginEmail(b.email, b.password, req.get('user-agent')));
}));

authRouter.post('/otp/send', otpLimiter, h(async (req, res) => {
  const b = body(z.object({ phone: e164 }), req);
  res.json(await auth.sendOtp(b.phone));
}));

authRouter.post('/otp/verify', authLimiter, optionalAuth, h(async (req, res) => {
  const b = body(z.object({ phone: e164, code: z.string().regex(/^\d{6}$/), name: z.string().trim().min(2).max(80).optional(), countryCode: country.optional() }), req);
  res.json(await auth.verifyOtp(b, req.get('user-agent'), req.user?.id));
}));

authRouter.post('/google', authLimiter, h(async (req, res) => {
  const b = body(z.object({ idToken: z.string().min(20) }), req);
  res.json(await auth.loginGoogle(b.idToken, req.get('user-agent')));
}));

authRouter.post('/apple', authLimiter, h(async (req, res) => {
  const b = body(z.object({ identityToken: z.string().min(20), fullName: z.string().max(80).optional() }), req);
  res.json(await auth.loginApple(b.identityToken, b.fullName, req.get('user-agent')));
}));

authRouter.post('/refresh', authLimiter, h(async (req, res) => {
  const b = body(z.object({ refreshToken: z.string().min(20) }), req);
  res.json(await auth.refresh(b.refreshToken, req.get('user-agent')));
}));

authRouter.post('/logout', h(async (req, res) => {
  const b = body(z.object({ refreshToken: z.string().min(20) }), req);
  await auth.logout(b.refreshToken);
  res.status(204).end();
}));

authRouter.get('/me', requireAuth, h(async (req, res) => { res.json(await getMe(req.user!.id)); }));
