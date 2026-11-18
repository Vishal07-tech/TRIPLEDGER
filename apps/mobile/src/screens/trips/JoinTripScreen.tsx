import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '../../components/PrimaryButton';
import { useJoinTrip } from '../../hooks/useJoinTrip';
import { colors, radius, shadow, spacing } from '../../theme/tokens';
import type { AppStackParamList } from '../../types/auth';
import { describeApiError } from '../../utils/apiError';
import { formatJoinCode } from '../../utils/tripForm';

type Props = NativeStackScreenProps<AppStackParamList, 'JoinTrip'>;

function cleanCode(value: string) {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12);
}

export default function JoinTripScreen({ navigation }: Props) {
  const joinTrip = useJoinTrip();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const serverError = joinTrip.error
    ? describeApiError(joinTrip.error, 'We could not join that trip. Check your connection and try again.')
    : '';

  function submit() {
    const cleaned = cleanCode(code);
    if (cleaned.length < 6) {
      setError('Enter the full code, at least 6 characters.');
      return;
    }
    setError('');
    joinTrip.mutate(cleaned, {
      onSuccess: (trip) => {
        navigation.replace('TripDetail', { tripId: trip.id, tripName: trip.name });
      },
    });
  }

  const preview = formatJoinCode(code);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}
            testID="join-trip-back"
          >
            <Text style={styles.backLabel}>← Back</Text>
          </Pressable>

          <View style={styles.hero}>
            <View style={styles.heroGlow} />
            <Text style={styles.heroEyebrow}>YOU HAVE AN INVITE</Text>
            <Text accessibilityRole="header" style={styles.title}>Join a trip</Text>
            <Text style={styles.subtitle}>
              Enter the code the trip creator shared with you. Your phone will then see the trip, its members and
              every group expense.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.label}>TRIP CODE</Text>
            <TextInput
              accessibilityLabel="Trip code"
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              maxLength={12}
              onChangeText={(value) => setCode(cleanCode(value))}
              placeholder="ABCD 2345"
              placeholderTextColor={colors.subtle}
              returnKeyType="done"
              selectionColor={colors.primary}
              style={styles.codeInput}
              testID="join-trip-code"
              value={preview}
            />
            <Text style={styles.hint}>Spaces, dashes and lower-case letters are fine.</Text>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
            {serverError ? <Text accessibilityRole="alert" style={styles.error}>{serverError}</Text> : null}

            <PrimaryButton
              label="Join this trip"
              loading={joinTrip.isPending}
              onPress={submit}
              testID="join-trip-submit"
            />
          </View>

          <View style={styles.tipCard}>
            <Text style={styles.tipTitle}>Where do I find the code?</Text>
            <Text style={styles.tipBody}>
              Ask the person who created the trip to open the trip and share its code. Codes are private: anyone
              with the code can join, so only share it with your crew.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.md, paddingBottom: spacing.xxl, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  backButton: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 48, paddingRight: spacing.md },
  backLabel: { color: colors.primaryDark, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.75 },
  hero: {
    backgroundColor: colors.ink,
    borderRadius: radius.sheet,
    overflow: 'hidden',
    padding: spacing.lg,
    ...shadow.raised,
  },
  heroGlow: {
    backgroundColor: colors.primary,
    borderRadius: 110,
    height: 180,
    opacity: 0.32,
    position: 'absolute',
    right: -60,
    top: -80,
    width: 180,
  },
  heroEyebrow: { color: colors.primarySoft, fontSize: 11, fontWeight: '800', letterSpacing: 1.8 },
  title: { color: colors.card, fontSize: 30, fontWeight: '800', letterSpacing: -0.7, marginTop: spacing.sm },
  subtitle: { color: '#CBD5E1', fontSize: 13, lineHeight: 20, marginTop: spacing.sm },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
    ...shadow.card,
  },
  label: { color: colors.subtle, fontSize: 10, fontWeight: '800', letterSpacing: 2, textAlign: 'center' },
  codeInput: {
    backgroundColor: colors.muted,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    borderWidth: 1.5,
    color: colors.foreground,
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 5,
    minHeight: 72,
    paddingHorizontal: spacing.md,
    textAlign: 'center',
  },
  hint: { color: colors.mutedForeground, fontSize: 12, textAlign: 'center' },
  error: { color: colors.destructive, fontSize: 13, fontWeight: '700', lineHeight: 19, textAlign: 'center' },
  tipCard: {
    backgroundColor: colors.secondarySoft,
    borderRadius: radius.card,
    gap: spacing.xs,
    padding: spacing.md,
  },
  tipTitle: { color: colors.secondary, fontSize: 14, fontWeight: '800' },
  tipBody: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 },
});
