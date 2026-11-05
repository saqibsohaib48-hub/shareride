import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StripeProvider } from '@stripe/stripe-react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider } from '@/lib/app';

const STRIPE_PK = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

export default function Root() {
  return (
    <SafeAreaProvider>
      <StripeProvider publishableKey={STRIPE_PK} merchantIdentifier="merchant.com.example.shareride" urlScheme="shareride">
        <AppProvider>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerTintColor: '#0e7c66', headerBackTitle: 'Back' }}>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="welcome" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ title: 'Log in' }} />
            <Stack.Screen name="register" options={{ title: 'Create account' }} />
            <Stack.Screen name="verify-phone" options={{ title: 'Verify phone' }} />
            <Stack.Screen name="ride/[id]" options={{ title: 'Ride' }} />
            <Stack.Screen name="checkout/[id]" options={{ title: 'Checkout' }} />
            <Stack.Screen name="earnings" options={{ title: 'Earnings' }} />
            <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
            <Stack.Screen name="safety" options={{ title: 'Safety Center' }} />
          </Stack>
        </AppProvider>
      </StripeProvider>
    </SafeAreaProvider>
  );
}
