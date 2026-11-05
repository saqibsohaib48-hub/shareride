import { ScrollView } from 'react-native';
import { router } from 'expo-router';
import { auth } from '@/lib/api';
import { useApp } from '@/lib/app';
import { Button, T, useColors } from '@/ui';
import { OtpForm } from '@/OtpForm';

export default function VerifyPhone() {
  const { reloadMe } = useApp();
  const c = useColors();
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
      <T variant="h1">Verify your phone</T>
      <T variant="muted">A verified phone is required to offer rides. It's never shown to other members.</T>
      <OtpForm onDone={async (r) => { await auth.set(r.accessToken, r.refreshToken); await reloadMe(); router.replace('/(tabs)'); }} />
      <Button title="Later" kind="outline" onPress={() => router.replace('/(tabs)')} />
    </ScrollView>
  );
}
