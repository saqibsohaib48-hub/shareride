import { useState } from 'react';
import { View } from 'react-native';
import { api } from './lib/api';
import { useApp } from './lib/app';
import { Button, ErrorBox, Field, T } from './ui';

/** OTP verification (screen 5). Logged in → verifies phone; logged out → logs in / registers by phone. */
export function OtpForm({ onDone, askName }: { onDone: (tokens: any) => void; askName?: boolean }) {
  const { t, country } = useApp();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sent, setSent] = useState(false);
  const [dev, setDev] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <View style={{ gap: 12 }}>
      <Field label={t('auth.phone')} value={phone} onChangeText={(v) => setPhone(v.replace(/[^\d+]/g, ''))} placeholder="+971501234567" keyboardType="phone-pad" textContentType="telephoneNumber" editable={!sent} />
      {!sent ? (
        <Button title={t('auth.sendCode')} loading={busy} disabled={phone.length < 8} onPress={async () => {
          setBusy(true); setError(null);
          try { const r = await api('/auth/otp/send', { method: 'POST', body: { phone } }); setSent(true); setDev(r.devCode ?? null); } catch (e) { setError(e); } finally { setBusy(false); }
        }} />
      ) : (
        <>
          <Field label={t('auth.otp')} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp" />
          {dev && <T variant="small">Dev mode — your code is {dev}</T>}
          {askName && <Field label={`${t('auth.name')} (new accounts)`} value={name} onChangeText={setName} textContentType="name" />}
          <Button title={t('auth.verify')} loading={busy} disabled={code.length !== 6} onPress={async () => {
            setBusy(true); setError(null);
            try { onDone(await api('/auth/otp/verify', { method: 'POST', body: { phone, code, name: name || undefined, countryCode: country?.code } })); } catch (e) { setError(e); } finally { setBusy(false); }
          }} />
        </>
      )}
      <ErrorBox error={error} />
    </View>
  );
}
