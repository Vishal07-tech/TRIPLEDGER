import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../auth/AuthContext';
import { FormField } from '../../components/FormField';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SegmentedControl } from '../../components/SegmentedControl';
import { useCreateExpense } from '../../hooks/useCreateExpense';
import { tripQueryKey, useTrip } from '../../hooks/useTrip';
import { tripService } from '../../services/api/tripService';
import { colors, radius, shadow, spacing } from '../../theme/tokens';
import type { AppStackParamList } from '../../types/auth';
import type { ExpensePaymentMethod, ExpensePurpose } from '../../types/trips';
import { describeApiError } from '../../utils/apiError';
import { currencySymbol, formatMinor, parseMoneyToMinor } from '../../utils/money';
import { parseAmountInput } from '../../utils/tripForm';

type Props = NativeStackScreenProps<AppStackParamList, 'ReportExpense'>;

const CATEGORIES = ['Food', 'Travel', 'Stay', 'Activities', 'Shopping', 'Other'] as const;

type Errors = { title?: string; amount?: string };

export default function ReportExpenseScreen({ navigation, route }: Props) {
  const { tripId, tripName } = route.params;
  const { user } = useAuth();
  const { data: trip } = useTrip(tripId);
  const createExpense = useCreateExpense();
  const queryClient = useQueryClient();

  const [purpose, setPurpose] = useState<ExpensePurpose>('GROUP');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>('Food');
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('UPI');
  const [errors, setErrors] = useState<Errors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeMembers = trip?.members.filter((member) => member.isActive) ?? [];
  const baseCurrency = trip?.baseCurrency ?? 'INR';
  const symbol = currencySymbol(baseCurrency);
  const amountMinor = parseMoneyToMinor(parseAmountInput(amount) ?? '0');
  const shareCount = activeMembers.length || 1;
  const perHeadMinor = Math.floor(amountMinor / shareCount);
  const cashManagerId = trip?.cashManagerUserId ?? null;
  const isCashManager = Boolean(user?.id && cashManagerId === user.id);
  const tripIsActive = !trip || trip.status === 'ACTIVE';
  const currentMember = trip?.members.find((member) => member.userId === user?.id);
  const roleCanReport =
    !trip ||
    (Boolean(currentMember) &&
      currentMember!.role !== 'VIEWER' &&
      (currentMember!.role === 'OWNER' ||
        currentMember!.role === 'ADMIN' ||
        trip.settings?.allowMemberExpenseEdit !== false));
  const reportBlockedReason = !tripIsActive
    ? 'This trip is no longer active, so new payments cannot be recorded.'
    : trip && !currentMember
      ? 'Only trip members can report payments.'
      : currentMember?.role === 'VIEWER'
        ? 'Viewers can read this trip but cannot report payments.'
        : trip && trip.settings?.allowMemberExpenseEdit === false && !roleCanReport
          ? 'The owner has turned off member expense reporting for this trip.'
          : '';
  const canSubmit = tripIsActive && roleCanReport;

  const serverError = createExpense.error
    ? describeApiError(createExpense.error, 'We could not record this payment. Check your connection and try again.')
    : '';

  async function submit() {
    if (!canSubmit || isSubmitting) return;
    const nextErrors: Errors = {};
    if (title.trim().length < 2) nextErrors.title = 'Describe what you paid for.';
    const normalizedAmount = parseAmountInput(amount);
    if (!normalizedAmount) nextErrors.amount = 'Enter an amount greater than zero, like 450 or 450.50.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !normalizedAmount) return;
    if (!trip || !user) {
      setErrors({ ...nextErrors, amount: 'This trip is still loading. Try again in a moment.' });
      return;
    }

    setIsSubmitting(true);

    // This screen can paint from a cached trip that predates the newest member
    // joining. Splitting against that copy would silently leave them out of the
    // shared expense, so read the trip fresh at submit time.
    let members = activeMembers;
    let currency = baseCurrency;
    try {
      const freshTrip = await queryClient.fetchQuery({
        queryKey: tripQueryKey(tripId),
        queryFn: () => tripService.getTrip(tripId),
        staleTime: 0,
      });
      members = freshTrip.members.filter((member) => member.isActive);
      currency = freshTrip.baseCurrency;
    } catch {
      setIsSubmitting(false);
      setErrors({
        ...nextErrors,
        amount: 'We could not refresh this trip. Check your connection and try again.',
      });
      return;
    }

    if (purpose === 'GROUP' && members.length === 0) {
      setIsSubmitting(false);
      setErrors({ ...nextErrors, amount: 'This trip has no active members to split with.' });
      return;
    }

    createExpense.mutate(
      {
        tripId,
        input: {
          title: title.trim(),
          amount: normalizedAmount,
          currency,
          category,
          expenseType: purpose,
          splitMethod: 'EQUAL',
          paymentMethod,
          date: new Date().toISOString(),
          ...(purpose === 'PERSONAL'
            ? { responsibleUserId: user.id }
            : { splits: members.map((member) => ({ userId: member.userId })) }),
          payers: [{ userId: user.id, amount: normalizedAmount }],
        },
      },
      {
        onSuccess: () => navigation.goBack(),
        onError: () => setIsSubmitting(false),
        onSettled: () => setIsSubmitting(false),
      },
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
              testID="report-expense-back"
            >
              <Text style={styles.backLabel}>← Back</Text>
            </Pressable>
            <View style={styles.tripPill}>
              <Text numberOfLines={1} style={styles.tripPillText}>{tripName}</Text>
            </View>
          </View>

          <View style={styles.heading}>
            <Text accessibilityRole="header" style={styles.title}>Report a payment</Text>
            <Text style={styles.subtitle}>First, tell us who this spending was for.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>What was this payment for?</Text>
            <SegmentedControl<ExpensePurpose>
              label="Payment purpose"
              onChange={setPurpose}
              options={[
                { value: 'PERSONAL', label: 'Personal', caption: 'Only my share', testID: 'report-purpose-personal' },
                { value: 'GROUP', label: 'Group', caption: 'Split with everyone', testID: 'report-purpose-group' },
              ]}
              value={purpose}
            />
            <View style={[styles.explain, purpose === 'GROUP' ? styles.explainGroup : styles.explainPersonal]}>
              <Text style={[styles.explainTitle, purpose === 'GROUP' ? styles.explainTitleGroup : styles.explainTitlePersonal]}>
                {purpose === 'GROUP' ? 'Everyone will see this' : 'This stays personal'}
              </Text>
              <Text style={styles.explainBody}>
                {purpose === 'GROUP'
                  ? `The amount is added to the trip total and split equally between the ${activeMembers.length || 1} active ${
                    activeMembers.length === 1 ? 'member' : 'members'
                  }. Every member sees it on their phone.`
                  : 'The amount is recorded against you only. It is left out of the group total and is not split with the crew.'}
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <FormField
              autoCapitalize="sentences"
              error={errors.title}
              label="What did you pay for?"
              onChangeText={setTitle}
              placeholder="Dinner at the beach shack"
              testID="report-expense-title"
              value={title}
            />
            <FormField
              error={errors.amount}
              keyboardType="decimal-pad"
              label={`Amount (${baseCurrency})`}
              onChangeText={setAmount}
              placeholder={`${symbol}0.00`}
              testID="report-expense-amount"
              value={amount}
            />
            <View style={styles.categoryBlock}>
              <Text style={styles.fieldLabel}>Category</Text>
              <View style={styles.chipWrap}>
                {CATEGORIES.map((option) => {
                  const selected = option === category;
                  return (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: selected }}
                      key={option}
                      onPress={() => setCategory(option)}
                      style={({ pressed }) => [
                        styles.chip,
                        selected ? styles.chipSelected : null,
                        pressed ? styles.pressed : null,
                      ]}
                      testID={`report-category-${option.toLowerCase()}`}
                    >
                      <Text style={[styles.chipText, selected ? styles.chipTextSelected : null]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>How did you pay?</Text>
            <View style={styles.chipWrap}>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: paymentMethod === 'UPI' }}
                onPress={() => setPaymentMethod('UPI')}
                style={({ pressed }) => [
                  styles.methodChip,
                  paymentMethod === 'UPI' ? styles.chipSelected : null,
                  pressed ? styles.pressed : null,
                ]}
                testID="report-method-upi"
              >
                <Text style={[styles.methodTitle, paymentMethod === 'UPI' ? styles.chipTextSelected : null]}>UPI / online</Text>
                <Text style={styles.methodCaption}>Paid from your account</Text>
              </Pressable>
              <Pressable
                accessibilityRole="radio"
                accessibilityState={{ checked: paymentMethod === 'CASH', disabled: !isCashManager }}
                disabled={!isCashManager}
                onPress={() => setPaymentMethod('CASH')}
                style={({ pressed }) => [
                  styles.methodChip,
                  paymentMethod === 'CASH' ? styles.chipSelected : null,
                  !isCashManager ? styles.chipDisabled : null,
                  pressed ? styles.pressed : null,
                ]}
                testID="report-method-cash"
              >
                <Text style={[styles.methodTitle, paymentMethod === 'CASH' ? styles.chipTextSelected : null]}>Cash</Text>
                <Text style={styles.methodCaption}>
                  {isCashManager ? 'From the group cash box' : 'Cash manager only'}
                </Text>
              </Pressable>
            </View>
            {!isCashManager ? (
              <Text style={styles.cashNote}>
                Cash payments are recorded by the trip’s cash manager. Use UPI or ask them to record it.
              </Text>
            ) : null}
          </View>

          {purpose === 'GROUP' ? (
            <View style={styles.splitCard}>
              <Text style={styles.splitEyebrow}>EQUAL SPLIT</Text>
              <Text style={styles.splitTitle}>
                {amountMinor > 0
                  ? `${formatMinor(perHeadMinor, baseCurrency)} each`
                  : `Split between ${shareCount} ${shareCount === 1 ? 'member' : 'members'}`}
              </Text>
              <Text style={styles.splitBody}>
                Shared by {activeMembers.map((member) => member.user.fullName).join(', ') || 'the active members'}.
                Adjustments for rounding are handled by the server.
              </Text>
            </View>
          ) : null}

          {reportBlockedReason ? (
            <Text accessibilityRole="alert" style={styles.closedNote} testID="report-expense-blocked">
              {reportBlockedReason}
            </Text>
          ) : null}
          {serverError ? <Text accessibilityRole="alert" style={styles.serverError}>{serverError}</Text> : null}

          <PrimaryButton
            disabled={!canSubmit}
            label={purpose === 'GROUP' ? 'Add to group spending' : 'Record personal payment'}
            loading={createExpense.isPending || isSubmitting}
            onPress={() => void submit()}
            testID="report-expense-submit"
          />
          <Text style={styles.footer}>
            Only you can report your own payments. Totals are recalculated by the Sutrula Payanam server.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.md, paddingBottom: spacing.xxl, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  topBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing.sm },
  backButton: { justifyContent: 'center', minHeight: 48, paddingRight: spacing.md },
  backLabel: { color: colors.primaryDark, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.75 },
  tripPill: {
    backgroundColor: colors.muted,
    borderRadius: radius.pill,
    maxWidth: 190,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  tripPillText: { color: colors.mutedForeground, fontSize: 11, fontWeight: '700' },
  heading: { gap: spacing.xs },
  title: { color: colors.foreground, fontSize: 30, fontWeight: '800', letterSpacing: -0.7 },
  subtitle: { color: colors.mutedForeground, fontSize: 14, lineHeight: 21 },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
    ...shadow.card,
  },
  cardTitle: { color: colors.foreground, fontSize: 16, fontWeight: '800' },
  explain: { borderRadius: radius.input, borderWidth: 1, gap: 3, padding: spacing.md },
  explainGroup: { backgroundColor: colors.successSoft, borderColor: '#A7F3D0' },
  explainPersonal: { backgroundColor: colors.warningSoft, borderColor: '#FDE68A' },
  explainTitle: { fontSize: 13, fontWeight: '800' },
  explainTitleGroup: { color: colors.success },
  explainTitlePersonal: { color: colors.gold },
  explainBody: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 },
  fieldLabel: { color: colors.foreground, fontSize: 14, fontWeight: '700' },
  categoryBlock: { gap: spacing.sm },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  chipSelected: { backgroundColor: colors.foreground, borderColor: colors.foreground },
  chipDisabled: { opacity: 0.5 },
  chipText: { color: colors.mutedForeground, fontSize: 13, fontWeight: '700' },
  chipTextSelected: { color: colors.card, fontWeight: '800' },
  methodChip: {
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: 64,
    minWidth: 130,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  methodTitle: { color: colors.foreground, fontSize: 14, fontWeight: '800' },
  methodCaption: { color: colors.mutedForeground, fontSize: 11 },
  cashNote: { color: colors.subtle, fontSize: 11, lineHeight: 16 },
  splitCard: {
    backgroundColor: colors.secondarySoft,
    borderRadius: radius.card,
    gap: spacing.xs,
    padding: spacing.md,
  },
  splitEyebrow: { color: colors.secondary, fontSize: 10, fontWeight: '800', letterSpacing: 1.5 },
  splitTitle: { color: colors.foreground, fontSize: 22, fontWeight: '800', letterSpacing: -0.4 },
  splitBody: { color: colors.mutedForeground, fontSize: 12, lineHeight: 18 },
  closedNote: { color: colors.destructive, fontSize: 13, fontWeight: '700', lineHeight: 19 },
  serverError: { color: colors.destructive, fontSize: 13, fontWeight: '700', lineHeight: 19 },
  footer: { color: colors.subtle, fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
