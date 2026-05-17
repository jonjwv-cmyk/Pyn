import { StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';

export default function HomeScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Pyn' }} />
      <View style={styles.container}>
        <Text style={styles.title}>Pyn</Text>
        <Text style={styles.subtitle}>React Native + Expo. Скелет готов.</Text>
        <Text style={styles.hint}>
          Следующий шаг — собираем главные экраны.
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1F1E1B',
    padding: 24,
  },
  title: {
    color: '#F5F4EF',
    fontSize: 28,
    fontWeight: '600',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: '#A6A39B',
    fontSize: 14,
    marginTop: 8,
  },
  hint: {
    color: '#B8B5A9',
    fontSize: 12,
    marginTop: 24,
    textAlign: 'center',
  },
});
