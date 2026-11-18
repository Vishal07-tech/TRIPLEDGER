import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FormField } from '../../components/FormField';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useCreateTrip } from '../../hooks/useCreateTrip';
import { colors, radius, shadow, spacing } from '../../theme/tokens';
import type { AppStackParamList } from '../../types/auth';
import type { Trip } from '../../types/trips';
import { describeApiError } from '../../utils/apiError';
import { formatJoinCode, parseTripDateInput, validateTripDateRange } from '../../utils/tripForm';

type Props = NativeStackScreenProps<AppStackParamList, 'CreateTrip'>;

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'] as const;

type Errors = { name?: string; startDate?: string; endDate?: string };

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The next Saturday/Sunday, so a weekend trip needs no typing at all. */
function upcomingWeekend(): { start: string; end: string } {
  const today = new Date();
  const day = today.getDay();
  const daysUntilSaturday = (6 - day + 7) % 7 || 7;
  const saturday = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysUntilSaturday);
  const sunday = new Date(saturday.getFullYear(), saturday.getMonth(), saturday.getDate() + 1);
  return { start: dateKey(saturday), end: dateKey(sunday) };
}

function JoinCodeCard({ trip, onOpen, onHome }: { trip: Trip; onOpen: () => void; onHome: () => void }) {
  const code = trip.joinCode ?? '';

  async function share() {
    try {
      await Share.share({
        message:
          `Join my trip “${trip.name}” on Sutrula Payanam.\n\n` +
          `Trip code: ${code}\n\n` +
          'Open Sutrula Payanam, choose “Join a Trip”, and enter this code.',
        title: 'Sutrula Payanam trip code',
      });
    } catch {
      // Sharing is optional; the code stays visible on screen.
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.successContent} showsVerticalScrollIndicator={false}>
      <View style={styles.successHero}>
        <View style={styles.successCheck}><Text style={styles.successCheckText}>✓</Text></View>
        <Text style={styles.successEyebrow}>TRIP CREATED</Text>
        <Text style={styles.successTitle}>{trip.name}</Text>
        <Text style={styles.successBody}>
          Share this code with the people coming along. They enter it under “Join a Trip” on their own phone.
        </Text>

        <View accessibilityLabel={`Trip code ${formatJoinCode(code)}`} style={styles.codeBox} testID="create-trip-code">
          <Text style={styles.codeLabel}>TRIP CODE</Text>
          <Text adjustsFontSizeToFit numberOfLines={1} style={styles.code}>{formatJoinCode(code)}</Text>
        </View>

        <View style={styles.successActions}>
          <PrimaryButton label="Share the code" onPress={() => void share()} testID="create-trip-share" icon="↗" />
          <PrimaryButton label="Open trip" onPress={onOpen} testID="create-trip-open" variant="secondary" />
          <PrimaryButton label="Back to home" onPress={onHome} testID="create-trip-home" variant="ghost" />
        </View>
      </View>

      <View style={styles.helperCard}>
        <Text style={styles.helperTitle}>What happens next</Text>
        <Text style={styles.helperBody}>
          Everyone who joins sees the trip, its dates and the group spending. Personal reports stay in your own
          ledger and never inflate the group total.
        </Text>
      </View>
    </ScrollView>
  );
}

export default function CreateTripScreen({ navigation }: Props) {
  const createTrip = useCreateTrip();
  const [created, setCreated] = useState<Trip | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [currency, setCurrency] = useState<string>('INR');
  const [errors, setErrors] = useState<Errors>({});

  const serverError = createTrip.error
    ? describeApiError(createTrip.error, 'We could not create the trip. Check your connection and try again.')
    : '';

  function fillWeekend() {
    const weekend = upcomingWeekend();
    setStartDate(weekend.start);
    setEndDate(weekend.end);
    setErrors((current) => ({ ...current, startDate: undefined, endDate: undefined }));
  }

  function submit() {
    const nextErrors: Errors = {};
    if (name.trim().length < 2) nextErrors.name = 'Use at least 2 characters.';
    const dateErrors = validateTripDateRange(startDate, endDate);
    Object.assign(nextErrors, dateErrors);

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const parsedStart = parseTripDateInput(startDate);
    const parsedEnd = parseTripDateInput(endDate);

    createTrip.mutate(
      {
        name: name.trim(),
        baseCurrency: currency,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(parsedStart && parsedEnd ? { startDate: parsedStart, endDate: parsedEnd } : {}),
      },
      { onSuccess: (trip) => setCreated(trip) },
    );
  }

  if (created) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <JoinCodeCard
          onHome={() => navigation.popToTop()}
          onOpen={() => navigation.replace('TripDetail', { tripId: created.id, tripName: created.name })}
          trip={created}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <Pressable
              accessibilityLabel="Go back"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => navigation.goBack()}
              style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}
              testID="create-trip-back"
            >
              <Text style={styles.backLabel}>← Back</Text>
            </Pressable>
            <View style={styles.stepPill}><Text style={styles.stepText}>NEW TRIP</Text></View>
          </View>

          <View style={styles.heading}>
            <Text accessibilityRole="header" style={styles.title}>Create a trip</Text>
            <Text style={styles.subtitle}>
              Set the basics now. We will generate a private code you can share with your crew.
            </Text>
          </View>

          <View style={styles.card}>
            <FormField
              autoCapitalize="words"
              error={errors.name}
              label="Trip name"
              onChangeText={setName}
              placeholder="Goa long weekend"
              returnKeyType="next"
              testID="create-trip-name"
              value={name}
            />
            <FormField
              hint="Optional. A short note for the group."
              label="Description"
              multiline
              onChangeText={setDescription}
              placeholder="Beach, food and a lot of sunscreen."
              required={false}
              testID="create-trip-description"
              value={description}
            />
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>When are you going?</Text>
              <Pressable
                accessibilityRole="button"
                onPress={fillWeekend}
                style={({ pressed }) => [styles.chip, pressed ? styles.pressed : null]}
                testID="create-trip-weekend"
              >
                <Text style={styles.chipText}>This weekend</Text>
              </Pressable>
            </View>
            <View style={styles.dateRow}>
              <View style={styles.dateField}>
                <FormField
                  autoCapitalize="none"
                  error={errors.startDate}
                  keyboardType="numbers-and-punctuation"
                  label="Start date"
                  onChangeText={setStartDate}
                  placeholder="YYYY-MM-DD"
                  required={false}
                  testID="create-trip-start"
                  value={startDate}
                />
              </View>
              <View style={styles.dateField}>
                <FormField
                  autoCapitalize="none"
                  error={errors.endDate}
                  keyboardType="numbers-and-punctuation"
                  label="End date"
                  onChangeText={setEndDate}
                  placeholder="YYYY-MM-DD"
                  required={false}
                  testID="create-trip-end"
                  value={endDate}
                />
              </View>
            </View>
            <Text style={styles.footnote}>Leave both empty for an open-ended trip.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Base currency</Text>
            <Text style={styles.cardHint}>Every total on this trip is reported in this currency.</Text>
            <View style={styles.currencyRow}>
              {CURRENCIES.map((option) => {
                const selected = option === currency;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    key={option}
                    onPress={() => setCurrency(option)}
                    style={({ pressed }) => [
                      styles.currencyChip,
                      selected ? styles.currencyChipSelected : null,
                      pressed ? styles.pressed : null,
                    ]}
                    testID={`create-trip-currency-${option}`}
                  >
                    <Text style={[styles.currencyText, selected ? styles.currencyTextSelected : null]}>{option}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {serverError ? <Text accessibilityRole="alert" style={styles.serverError}>{serverError}</Text> : null}

          <PrimaryButton
            label="Create trip & get code"
            loading={createTrip.isPending}
            onPress={submit}
            testID="create-trip-submit"
          />
          <Text style={styles.privacyNote}>
            Only people with the code can join. You can share it again any time from the trip screen.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.md, paddingBottom: spacing.xxl, paddingHorizontal: spacing.lg },
  topBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm },
  backButton: { justifyContent: 'center', minHeight: 48, paddingRight: spacing.md },
  backLabel: { color: colors.primaryDark, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.75 },
  stepPill: { backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 4 },
  stepText: { color: colors.primaryDark, fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  heading: { gap: spacing.xs, paddingBottom: spacing.xs },
  title: { color: colors.foreground, fontSize: 32, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { color: colors.mutedForeground, fontSize: 14, lineHeight: 21, maxWidth: 340 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
    ...shadow.card,
  },
  cardHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  cardTitle: { color: colors.foreground, fontSize: 16, fontWeight: '800' },
  cardHint: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17, marginTop: -spacing.sm },
  chip: {
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
  },
  chipText: { color: colors.primaryDark, fontSize: 11, fontWeight: '800' },
  dateRow: { flexDirection: 'row', gap: spacing.sm },
  dateField: { flex: 1 },
  footnote: { color: colors.subtle, fontSize: 11, marginTop: -spacing.xs },
  currencyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: -spacing.xs },
  currencyChip: {
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderRadius: radius.input,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 64,
    paddingHorizontal: spacing.md,
  },
  currencyChipSelected: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  currencyText: { color: colors.mutedForeground, fontSize: 13, fontWeight: '800', letterSpacing: 0.6 },
  currencyTextSelected: { color: colors.card },
  serverError: { color: colors.destructive, fontSize: 13, fontWeight: '700', lineHeight: 19 },
  privacyNote: { color: colors.subtle, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  successContent: { gap: spacing.md, paddingBottom: spacing.xxl, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  successHero: {
    alignItems: 'center',
    backgroundColor: colors.ink,
    borderRadius: radius.sheet,
    overflow: 'hidden',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    ...shadow.raised,
  },
  successCheck: {
    alignItems: 'center',
    backgroundColor: colors.success,
    borderRadius: radius.pill,
    height: 52,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: 52,
  },
  successCheckText: { color: colors.card, fontSize: 26, fontWeight: '800' },
  successEyebrow: { color: '#A7F3D0', fontSize: 11, fontWeight: '800', letterSpacing: 1.8 },
  successTitle: { color: colors.card, fontSize: 26, fontWeight: '800', letterSpacing: -0.5, marginTop: spacing.sm, textAlign: 'center' },
  successBody: { color: '#CBD5E1', fontSize: 13, lineHeight: 20, marginTop: spacing.sm, textAlign: 'center' },
  codeBox: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderRadius: radius.card,
    gap: 2,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    width: '100%',
  },
  codeLabel: { color: colors.subtle, fontSize: 10, fontWeight: '800', letterSpacing: 1.8 },
  code: { color: colors.foreground, fontSize: 38, fontWeight: '900', letterSpacing: 6 },
  successActions: { gap: spacing.sm, marginTop: spacing.lg, width: '100%' },
  helperCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  helperTitle: { color: colors.foreground, fontSize: 15, fontWeight: '800' },
  helperBody: { color: colors.mutedForeground, fontSize: 13, lineHeight: 20 },
});
