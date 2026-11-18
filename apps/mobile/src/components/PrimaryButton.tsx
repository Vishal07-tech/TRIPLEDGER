import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, shadow } from '../theme/tokens';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  accessibilityHint?: string;
  testID?: string;
  variant?: Variant;
  icon?: string;
};

export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  accessibilityHint,
  testID,
  variant = 'primary',
  icon,
}: Props) {
  const unavailable = disabled || loading;
  const tone = variant === 'primary' ? colors.onPrimary : variant === 'danger' ? colors.destructive : colors.primary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: unavailable, busy: loading }}
      testID={testID}
      disabled={unavailable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[variant],
        unavailable ? styles.disabled : null,
        pressed && !unavailable ? styles.pressed : null,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={tone} />
      ) : (
        <Text style={[styles.label, { color: tone }]} numberOfLines={1}>
          {icon ? `${icon}  ` : ''}{label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 52,
    paddingHorizontal: 20,
  },
  primary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    ...shadow.card,
  },
  secondary: {
    backgroundColor: colors.card,
    borderColor: colors.borderStrong,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  danger: {
    backgroundColor: colors.destructiveSoft,
    borderColor: colors.destructiveSoft,
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  label: { fontSize: 16, fontWeight: '800', letterSpacing: 0.2 },
});
