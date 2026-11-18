import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

import { AuthLayout } from '../../components/AuthLayout';
import { FormField } from '../../components/FormField';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAuth } from '../../auth/AuthContext';
import { colors, spacing } from '../../theme/tokens';
import type { AuthStackParamList } from '../../types/auth';
import { validateLogin, type FieldErrors } from '../../utils/authValidation';

type Props = NativeStackScreenProps<AuthStackParamList, 'Login'>;

export default function LoginScreen({ navigation }: Props) {
  const auth = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function submit() {
    auth.clearFeedback();
    const result = validateLogin(email, password);
    setFieldErrors(result.errors);
    if (!result.input) return;
    try { await auth.login(result.input); } catch { /* The provider exposes the safe message. */ }
  }

  return (
    <AuthLayout subtitle="Welcome back">
      <View style={styles.form}>
        {auth.error ? <Text accessibilityRole="alert" style={styles.serverError}>{auth.error}</Text> : null}
        <FormField
          label="Email address"
          testID="login-email"
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
          testID="login-password"
          value={password}
          onChangeText={(value) => { setPassword(value); setFieldErrors((current) => ({ ...current, password: '' })); }}
          secureTextEntry
          passwordToggle
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          error={fieldErrors.password}
        />
        <PrimaryButton label="Sign in" testID="login-submit" onPress={() => void submit()} loading={auth.isSubmitting} />
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>New to Sutrula Payanam?</Text>
          <Pressable accessibilityRole="button" onPress={() => { auth.clearFeedback(); navigation.navigate('Register'); }} hitSlop={8}>
            <Text style={styles.link}>Create an account</Text>
          </Pressable>
        </View>
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  serverError: { backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderRadius: 12, borderWidth: 1, color: colors.destructive, fontSize: 14, lineHeight: 20, padding: spacing.md },
  footerRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, justifyContent: 'center', paddingTop: spacing.xs },
  footerText: { color: colors.mutedForeground, fontSize: 14 },
  link: { color: colors.secondary, fontSize: 14, fontWeight: '700', minHeight: 36, paddingVertical: 8 },
});
