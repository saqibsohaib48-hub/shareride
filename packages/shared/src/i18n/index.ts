import en from './en.json';
import ar from './ar.json';
import fr from './fr.json';
import es from './es.json';
import hi from './hi.json';
import ur from './ur.json';

export type MessageKey = keyof typeof en;
type Dict = Partial<Record<MessageKey, string>>;

/** Add a language: drop a JSON file next to these and register it here (missing keys fall back to English). */
export const DICTIONARIES: Record<string, Dict> = { en, ar, fr, es, hi, ur };

export const LANGUAGES = [
  { code: 'en', name: 'English', rtl: false },
  { code: 'ar', name: 'العربية', rtl: true },
  { code: 'hi', name: 'हिन्दी', rtl: false },
  { code: 'ur', name: 'اردو', rtl: true },
  { code: 'fr', name: 'Français', rtl: false },
  { code: 'es', name: 'Español', rtl: false },
] as const;

export function isRtl(lang: string): boolean {
  return LANGUAGES.some((l) => l.code === lang && l.rtl);
}

export function translate(lang: string, key: MessageKey, vars?: Record<string, string | number>): string {
  const raw = DICTIONARIES[lang]?.[key] ?? (en as Dict)[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : `{${k}}`));
}

export function makeT(lang: string) {
  return (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
}
