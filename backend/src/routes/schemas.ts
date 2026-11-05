import { z } from 'zod';

export const placeSchema = z.object({
  name: z.string().trim().min(2).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});
export const e164 = z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use international format, e.g. +971501234567');
export const country = z.string().length(2).transform((s) => s.toUpperCase());
export const uuid = z.string().uuid();
export const money = z.number().int().positive().max(100_000_000);
export const boolish = z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).transform((v) => v === true || v === 'true' || v === '1');
