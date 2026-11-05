import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { config } from '../config';
import { logger } from '../utils/logger';

/** SMS for OTP. Twilio in production; console in dev (code printed to server log). */
export async function sendSms(to: string, body: string): Promise<void> {
  if (config.SMS_PROVIDER === 'twilio') {
    const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: tok, TWILIO_FROM: from } = config;
    if (!sid || !tok || !from) throw new Error('Twilio is not configured');
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from, Body: body }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Twilio error ${res.status}`);
    return;
  }
  logger.info({ to }, `[DEV SMS] ${body}`);
}

/**
 * Push via Expo Push Service (delivers through FCM on Android and APNs on iOS).
 * Swap for firebase-admin if you eject from Expo — the interface stays the same.
 */
const expo = new Expo({ accessToken: config.EXPO_ACCESS_TOKEN });

export async function sendPush(tokens: string[], title: string, body: string, data: Record<string, unknown>): Promise<void> {
  if (!tokens.length) return;
  if (config.PUSH_PROVIDER === 'console') {
    logger.info({ tokens: tokens.length, title }, `[DEV PUSH] ${body}`);
    return;
  }
  const messages: ExpoPushMessage[] = tokens.filter((t) => Expo.isExpoPushToken(t)).map((to) => ({ to, title, body, data, sound: 'default' }));
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try { await expo.sendPushNotificationsAsync(chunk); } catch (err) { logger.warn({ err }, 'push send failed'); }
  }
}
