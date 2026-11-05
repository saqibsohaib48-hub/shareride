import { useState } from 'react';
import { ScrollView } from 'react-native';
import { router } from 'expo-router';
import { api, ApiError, auth } from '@/lib/api';
import { useApp } from '@/lib/app';
import { Button, ErrorBox, Field, T, useColors } from '@/ui';

export default function Register() {
  const { t, country } = useApp();
  const c = useColors();
  const [f, setF] = useState({ name: '', email: '', password: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fe = error instanceof ApiError && error.code === 'VALIDATION_ERROR' ? (error.details as Record<string, string[]>) : {};
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
      <T variant="h1">{t('auth.register')}</T>
      <Field label={t('auth.name')} value={f.name} onChangeText={(v) => setF({ ...f, name: v })} textContentType="name" error={fe.name?.[0]} />
      <Field label={t('auth.email')} value={f.email} onChangeText={(v) => setF({ ...f, email: v })} autoCapitalize="none" keyboardType="email-address" error={fe.email?.[0]} />
      <Field label={t('auth.password')} value={f.password} onChangeText={(v) => setF({ ...f, password: v })} secureTextEntry textContentType="newPassword" error={fe.password?.[0]} />
      <Field label={`${t('auth.phone')} (optional)`} value={f.phone} onChangeText={(v) => setF({ ...f, phone: v })} keyboardType="phone-pad" placeholder="+971501234567" error={fe.phone?.[0]} />
      <T variant="small">{t('auth.country')}: {country?.name ?? '—'} · change it on the welcome screen or in your profile.</T>
      <ErrorBox error={error} />
      <Button title={t('auth.register')} loading={busy} onPress={async () => {
        setBusy(true); setError(null);
        try {
          const r = await api('/auth/register', { method: 'POST', body: { ...f, phone: f.phone || undefined, countryCode: country?.code ?? 'AE' } });
          await auth.set(r.accessToken, r.refreshToken); router.replace('/verify-phone');
        } catch (e) { setError(e); } finally { setBusy(false); }
      }} />
      <Button title={t('auth.haveAccount')} kind="outline" onPress={() => router.replace('/login')} />
    </ScrollView>
  );
}
