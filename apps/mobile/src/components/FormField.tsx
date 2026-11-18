import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, radius, spacing } from '../theme/tokens';

type Props = TextInputProps & {
  label: string;
  error?: string;
  hint?: string;
  testID: string;
  passwordToggle?: boolean;
  required?: boolean;
};

export function FormField({
  label,
  error,
  hint,
  testID,
  passwordToggle = false,
  secureTextEntry,
  required = true,
  multiline,
  ...inputProps
}: Props) {
  const [visible, setVisible] = useState(false);
  const isPassword = Boolean(secureTextEntry);

  return (
    <View style={styles.wrapper}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
        {!required ? <Text style={styles.optional}>Optional</Text> : null}
      </View>
      <View style={[styles.inputShell, multiline ? styles.inputShellMultiline : null, error ? styles.inputError : null]}>
        <TextInput
          {...inputProps}
          multiline={multiline}
          testID={testID}
          style={[styles.input, multiline ? styles.inputMultiline : null]}
          secureTextEntry={isPassword && !visible}
          accessibilityLabel={label}
          accessibilityHint={error ? `Error: ${error}` : hint}
          autoCorrect={isPassword ? false : inputProps.autoCorrect}
          placeholderTextColor={colors.subtle}
          selectionColor={colors.primary}
        />
        {passwordToggle && isPassword ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={visible ? 'Hide password' : 'Show password'}
            accessibilityState={{ selected: visible }}
            hitSlop={8}
            onPress={() => setVisible((current) => !current)}
            style={styles.toggle}
          >
            <Text style={styles.toggleText}>{visible ? 'Hide' : 'Show'}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>{error}</Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: spacing.xs },
  labelRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  label: { color: colors.foreground, fontSize: 14, fontWeight: '700' },
  required: { color: colors.primary },
  optional: { color: colors.subtle, fontSize: 12, fontWeight: '600' },
  inputShell: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: 'row',
    minHeight: 54,
  },
  inputShellMultiline: { alignItems: 'flex-start', minHeight: 104 },
  inputError: { borderColor: colors.destructive },
  input: {
    color: colors.foreground,
    flex: 1,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
  },
  inputMultiline: { minHeight: 100, paddingTop: 14, textAlignVertical: 'top' },
  toggle: { alignItems: 'center', justifyContent: 'center', minHeight: 48, minWidth: 58, paddingHorizontal: spacing.sm },
  toggleText: { color: colors.secondary, fontSize: 14, fontWeight: '800' },
  error: { color: colors.destructive, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  hint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
});
