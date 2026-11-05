import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { api, auth } from '@/lib/api';
import { useApp } from '@/lib/app';
import { Button, ErrorBox, Field, T, useColors } from '@/ui';
import { OtpForm } from '@/OtpForm';

export default function Login() {
  const { t } = useApp();
  const c = useColors();
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const done = async (r: any) => { await auth.set(r.accessToken, r.refreshToken); router.replace('/(tabs)'); };
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
      <T variant="h1">{t('auth.login')}</T>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Button title={t('auth.email')} kind={mode === 'email' ? 'primary' : 'outline'} onPress={() => setMode('email')} /></View>
        <View style={{ flex: 1 }}><Button title={t('auth.withPhone')} kind={mode === 'phone' ? 'primary' : 'outline'} onPress={() => setMode('phone')} /></View>
      </View>
      {mode === 'email' ? (
        <>
          <Field label={t('auth.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" textContentType="emailAddress" />
          <Field label={t('auth.password')} value={password} onChangeText={setPassword} secureTextEntry textContentType="password" />
          <ErrorBox error={error} />
          <Button title={t('auth.login')} loading={busy} onPress={async () => {
            setBusy(true); setError(null);
            try { await done(await api('/auth/login', { method: 'POST', body: { email, password } })); } catch (e) { setError(e); } finally { setBusy(false); }
          }} />
        </>
      ) : <OtpForm askName onDone={done} />}
      <Button title={t('auth.noAccount')} kind="outline" onPress={() => router.replace('/register')} />
    </ScrollView>
  );
}
