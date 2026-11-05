import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useApp } from '@/lib/app';
import { useColors } from '@/ui';

const icon = (glyph: string) => ({ color }: { color: string }) => <Text style={{ color, fontSize: 20 }}>{glyph}</Text>;

export default function TabsLayout() {
  const { t } = useApp();
  const c = useColors();
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: c.brand, tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.line }, headerStyle: { backgroundColor: c.surface }, headerTintColor: c.ink }}>
      <Tabs.Screen name="index" options={{ title: t('nav.home'), tabBarIcon: icon('⌂') }} />
      <Tabs.Screen name="search" options={{ title: t('nav.search'), tabBarIcon: icon('⌕') }} />
      <Tabs.Screen name="create" options={{ title: t('nav.create'), tabBarIcon: icon('＋') }} />
      <Tabs.Screen name="trips" options={{ title: t('nav.trips'), tabBarIcon: icon('⇄') }} />
      <Tabs.Screen name="profile" options={{ title: t('nav.profile'), tabBarIcon: icon('◉') }} />
    </Tabs>
  );
}
