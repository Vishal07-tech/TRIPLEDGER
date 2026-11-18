import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { AuthLayout } from '../../components/AuthLayout';
import { FormField } from '../../components/FormField';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAuth } from '../../auth/AuthContext';
import { colors, spacing } from '../../theme/tokens';
import type { AuthStackParamList } from '../../types/auth';
import { validateRegistration, type FieldErrors } from '../../utils/authValidation';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

export default function RegisterScreen({ navigation }: Props) {
  const auth = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function submit() {
    auth.clearFeedback();
    const result = validateRegistration(fullName, email, password);
    setFieldErrors(result.errors);
    if (!result.input) return;
    try { await auth.register(result.input); } catch { /* The provider exposes the safe message. */ }
  }

  return (
    <AuthLayout subtitle="Create your account">
      <View style={styles.form}>
        <Text style={styles.helper}>A few details to get your trips started.</Text>
        {auth.error ? <Text accessibilityRole="alert" style={styles.serverError}>{auth.error}</Text> : null}
        <FormField
          label="Full name"
          testID="register-full-name"
          value={fullName}
          onChangeText={(value) => { setFullName(value); setFieldErrors((current) => ({ ...current, fullName: '' })); }}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          error={fieldErrors.fullName}
        />
        <FormField
          label="Email address"
          testID="register-email"
          value={email}
          onChangeText={(value) => { setEmail(value); setFieldErrors((current) => ({ ...current, email: '' })); }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          error={fieldErrors.email}
        />
        <FormField
          label="Password"
          testID="register-password"
          value={password}
          onChangeText={(value) => { setPassword(value); setFieldErrors((current) => ({ ...current, password: '' })); }}
          secureTextEntry
          passwordToggle
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          error={fieldErrors.password}
        />
        <Text style={styles.helper}>Use at least 8 characters.</Text>
        <PrimaryButton label="Create account" testID="register-submit" onPress={() => void submit()} loading={auth.isSubmitting} />
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>Already have an account?</Text>
          <Pressable accessibilityRole="button" onPress={() => { auth.clearFeedback(); navigation.navigate('Login'); }} hitSlop={8}>
            <Text style={styles.link}>Sign in</Text>
          </Pressable>
        </View>
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  helper: { color: colors.mutedForeground, fontSize: 14, lineHeight: 20 },
  serverError: { backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderRadius: 12, borderWidth: 1, color: colors.destructive, fontSize: 14, lineHeight: 20, padding: spacing.md },
  footerRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, justifyContent: 'center', paddingTop: spacing.xs },
  footerText: { color: colors.mutedForeground, fontSize: 14 },
  link: { color: colors.secondary, fontSize: 14, fontWeight: '700', minHeight: 36, paddingVertical: 8 },
});
