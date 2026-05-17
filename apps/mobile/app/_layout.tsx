import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#1F1E1B' },
          headerTintColor: '#F5F4EF',
          contentStyle: { backgroundColor: '#1F1E1B' },
          headerShadowVisible: false,
        }}
      />
    </SafeAreaProvider>
  );
}
