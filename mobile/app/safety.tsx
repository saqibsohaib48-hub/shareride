import { useState } from 'react';
import { Linking, ScrollView } from 'react-native';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app';
import { Button, Card, ErrorBox, Field, T, useColors } from '@/ui';

const EMERGENCY: Record<string, string> = { AE: '999', US: '911', GB: '999', IN: '112', SA: '911' };

/** Safety Center (27) + Support (28). */
export default function Safety() {
  const { country } = useApp();
  const c = useColors();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const sos = EMERGENCY[country?.code ?? ''] ?? '112';
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      <Card>
        <T variant="h2">Emergency</T>
        <Button title={`📞 Call emergency services (${sos})`} kind="danger" onPress={() => Linking.openURL(`tel:${sos}`)} />
      </Card>
      <Card>
        <T variant="h2">Trusted contact</T>
        <Field label="Name" value={name} onChangeText={setName} />
        <Field label="Phone" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+971501234567" />
        <Button title="Add contact" kind="outline" onPress={async () => { setError(null); try { await api('/profile/trusted-contacts', { method: 'POST', body: { name, phone } }); setMsg('Contact added.'); setName(''); setPhone(''); } catch (e) { setError(e); } }} />
      </Card>
      <Card>
        <T variant="h2">Report a safety issue</T>
        <Field label="Subject" value={subject} onChangeText={setSubject} />
        <Field label="What happened?" value={body} onChangeText={setBody} multiline />
        <Button title="Send to safety team" onPress={async () => { setError(null); try { const tk = await api('/support/tickets', { method: 'POST', body: { category: 'SAFETY', subject, body } }); setMsg(`Ticket ${tk.reference} created — handled with urgent priority.`); setSubject(''); setBody(''); } catch (e) { setError(e); } }} />
      </Card>
      <ErrorBox error={error} />
      {msg && <T style={{ color: c.brand }}>{msg}</T>}
    </ScrollView>
  );
}
