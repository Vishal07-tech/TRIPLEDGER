import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme/tokens';

type Tone = 'primary' | 'secondary' | 'success';

type Props = {
  label: string;
  value: string;
  hint?: string;
  tone?: Tone;
  testID?: string;
};

const TONES: Record<Tone, { background: string; accent: string; text: string }> = {
  primary: { background: colors.primarySoft, accent: colors.primary, text: colors.primaryDark },
  secondary: { background: colors.secondarySoft, accent: colors.secondary, text: colors.secondary },
  success: { background: colors.successSoft, accent: colors.success, text: colors.success },
};

export function StatTile({ label, value, hint, tone = 'primary', testID }: Props) {
  const palette = TONES[tone];
  return (
    <View style={[styles.tile, { backgroundColor: palette.background }]} testID={testID}>
      <View style={[styles.accent, { backgroundColor: palette.accent }]} />
      <Text style={[styles.value, { color: palette.text }]} numberOfLines={1}>{value}</Text>
      <Text style={styles.label} numberOfLines={1}>{label}</Text>
      {hint ? <Text style={styles.hint} numberOfLines={1}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.card,
    flex: 1,
    gap: 2,
    minHeight: 96,
    overflow: 'hidden',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  accent: { borderRadius: radius.pill, height: 4, marginBottom: spacing.sm, width: 26 },
  value: { fontSize: 24, fontWeight: '800', letterSpacing: -0.6 },
  label: { color: colors.mutedForeground, fontSize: 12, fontWeight: '700' },
  hint: { color: colors.subtle, fontSize: 11 },
});
