import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { performLogin } from '../lib/auth';
import { startWs } from '../lib/ws';

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    if (!login.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      const session = await performLogin(login.trim(), password);
      startWs(session.user.login, session.token);
      router.replace('/');
    } catch (err) {
      const code = (err as { code?: string }).code || (err as Error).message || 'error';
      setError(humanError(code, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.brand}>Pyn</Text>
          <Text style={styles.sub}>{t('login.title')}</Text>

          <TextInput
            value={login}
            onChangeText={setLogin}
            placeholder={t('login.login_label')}
            placeholderTextColor="#A6A39B"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
            editable={!loading}
          />
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder={t('login.password_label')}
            placeholderTextColor="#A6A39B"
            secureTextEntry
            style={styles.input}
            editable={!loading}
            onSubmitEditing={onSubmit}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            onPress={onSubmit}
            disabled={loading || !login.trim() || !password}
            style={({ pressed }) => [
              styles.button,
              (loading || !login.trim() || !password) && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
          >
            {loading ? (
              <ActivityIndicator color="#1F1E1B" />
            ) : (
              <Text style={styles.buttonText}>{t('login.submit')}</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

function humanError(code: string, t: TFunction): string {
  switch (code) {
    case 'wrong_password': return t('login.error_wrong_password');
    case 'user_not_found': return t('login.error_user_not_found');
    case 'user_inactive': return t('login.error_user_inactive');
    case 'user_suspended': return t('login.error_user_suspended');
    case 'app_blocked': return t('login.error_app_blocked');
    case 'device_wiped': return t('login.error_device_wiped');
    case 'app_version_too_old': return t('login.error_app_version_too_old');
    default: return t('login.error_login_code', { code });
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1F1E1B',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    gap: 12,
  },
  brand: {
    color: '#F5F4EF',
    fontSize: 32,
    fontWeight: '600',
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  sub: {
    color: '#A6A39B',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
  },
  input: {
    backgroundColor: '#302F2D',
    color: '#F5F4EF',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: 'rgba(108,106,96,0.25)',
  },
  button: {
    backgroundColor: '#D97757',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: '#1F1E1B',
    fontSize: 15,
    fontWeight: '600',
  },
  error: {
    color: '#E57373',
    fontSize: 13,
    textAlign: 'center',
  },
});
