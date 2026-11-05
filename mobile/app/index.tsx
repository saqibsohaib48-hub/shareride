import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useApp } from '@/lib/app';

/** Splash → welcome on first launch, otherwise straight to the tabs. */
export default function Index() {
  const { ready, me } = useApp();
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => { AsyncStorage.getItem('seenWelcome').then((v) => setSeen(!!v)); }, []);
  if (!ready || seen === null) return <View style={{ flex: 1, backgroundColor: '#0e7c66', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#fff" size="large" /></View>;
  return <Redirect href={me || seen ? '/(tabs)' : '/welcome'} />;
}
