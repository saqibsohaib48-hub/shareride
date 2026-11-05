import { ScrollView, View, Pressable, Text } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LANGUAGES } from '@share-ride/shared';
import { useApp } from '@/lib/app';
import { Button, T, useColors } from '@/ui';

/** Welcome + country & language selection (screens 2 & 6). */
export default function Welcome() {
  const { t, countries, country, setCountry, lang, setLang } = useApp();
  const c = useColors();
  const go = async (href: '/login' | '/register' | '/(tabs)') => { await AsyncStorage.setItem('seenWelcome', '1'); router.replace(href); };
  return (
    <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 24, paddingTop: 80, gap: 20 }}>
      <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff', fontSize: 30 }}>⇢</Text></View>
      <T variant="h1">{t('app.name')}</T>
      <T variant="muted">{t('app.tagline')}</T>
      <T variant="h2">{t('auth.country')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {countries.map((x) => (
          <Pressable key={x.code} accessibilityRole="radio" accessibilityState={{ selected: x.code === country?.code }} onPress={() => setCountry(x.code)}
            style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5, borderColor: x.code === country?.code ? c.brand : c.line, backgroundColor: x.code === country?.code ? c.brandSoft : c.surface }}>
            <Text style={{ color: c.ink, fontWeight: '600' }}>{x.name} · {x.currency}</Text>
          </Pressable>
        ))}
      </View>
      <T variant="h2">{t('profile.language')}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {LANGUAGES.map((l) => (
          <Pressable key={l.code} accessibilityRole="radio" accessibilityState={{ selected: l.code === lang }} onPress={() => setLang(l.code)}
            style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5, borderColor: l.code === lang ? c.brand : c.line, backgroundColor: c.surface }}>
            <Text style={{ color: c.ink }}>{l.name}</Text>
          </Pressable>
        ))}
      </View>
      <Button title={t('auth.register')} onPress={() => go('/register')} />
      <Button title={t('auth.login')} kind="outline" onPress={() => go('/login')} />
      <Button title="Browse rides first" kind="outline" onPress={() => go('/(tabs)')} />
    </ScrollView>
  );
}
