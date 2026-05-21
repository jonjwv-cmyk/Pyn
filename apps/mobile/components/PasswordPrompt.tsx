import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

/**
 * Modal с password input (RN). Аналог desktop SheetsPasswordPrompt.
 * Используется для kill switch toggle gate (Settings → Управление).
 */
export interface PasswordPromptProps {
  visible: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}

export function PasswordPrompt({ visible, onSubmit, onCancel }: PasswordPromptProps): JSX.Element {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const inputRef = useRef<TextInput | null>(null);

  useEffect(() => {
    if (visible) {
      setPassword('');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  const submit = () => {
    if (!password) return;
    onSubmit(password);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.center}
        >
          <Pressable style={styles.card} onPress={() => { /* swallow tap to keep modal open */ }}>
            <Text style={styles.title}>{t('tables.script_password_title')}</Text>
            <TextInput
              ref={inputRef}
              value={password}
              onChangeText={setPassword}
              placeholder={t('tables.script_password_placeholder')}
              placeholderTextColor="#A6A39B"
              secureTextEntry
              style={styles.input}
              onSubmitEditing={submit}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={styles.row}>
              <Pressable
                onPress={onCancel}
                style={({ pressed }) => [styles.btnGhost, pressed && styles.pressed]}
              >
                <Text style={styles.btnGhostText}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={!password}
                style={({ pressed }) => [
                  styles.btnPrimary,
                  !password && styles.btnDisabled,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.btnPrimaryText}>{t('tables.script_password_submit')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(108,106,96,0.25)',
    backgroundColor: '#302F2D',
    padding: 20,
    gap: 16,
  },
  title: {
    color: '#F5F4EF',
    fontSize: 14,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#1F1E1B',
    color: '#F5F4EF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    borderWidth: 1,
    borderColor: 'rgba(108,106,96,0.25)',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  btnGhost: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
  },
  btnGhostText: {
    color: '#B8B5A9',
    fontSize: 13,
    fontWeight: '500',
  },
  btnPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#D97757',
  },
  btnPrimaryText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '500',
  },
  btnDisabled: {
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  pressed: {
    opacity: 0.7,
  },
});
