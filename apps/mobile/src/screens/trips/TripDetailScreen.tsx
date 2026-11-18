import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '../../auth/AuthContext';
import { ExpenseRow } from '../../components/ExpenseRow';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useTrip } from '../../hooks/useTrip';
import { useTripBalances } from '../../hooks/useTripBalances';
import { useTripExpenses } from '../../hooks/useTripExpenses';
import { colors, radius, shadow, spacing } from '../../theme/tokens';
import type { AppStackParamList } from '../../types/auth';
import type { Trip, TripBalances, TripExpense, TripStatus } from '../../types/trips';
import { describeApiError } from '../../utils/apiError';
import { formatMinor, parseMoneyToMinor } from '../../utils/money';
import { calculateSuggestedTransfers } from '../../utils/settlement';
import {
  countActiveMembers,
  formatTimestampDate,
  formatTripDateRange,
  formatTripStatus,
} from '../../utils/tripDisplay';
import { formatJoinCode } from '../../utils/tripForm';
import { TripMemberRow } from './components/TripMemberRow';

type Props = NativeStackScreenProps<AppStackParamList, 'TripDetail'>;

function statusColor(status: TripStatus): string {
  if (status === 'TRIP_CLOSED' || status === 'FULLY_SETTLED') return colors.success;
  if (status === 'ACTIVE') return colors.primary;
  return colors.secondary;
}

/** Only membership and missing-trip failures have wording worth showing verbatim. */
function describeError(error: unknown): string {
  return describeApiError(error, 'We could not load this trip. Check your connection and try again.');
}

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.topBar}>
      <Pressable
        accessibilityLabel="Go back"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onBack}
        style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}
        testID="trip-detail-back"
      >
        <Text style={styles.backLabel}>← Back</Text>
      </Pressable>
    </View>
  );
}

function LoadingState() {
  return (
    <View style={styles.stateContainer}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text accessibilityLiveRegion="polite" style={styles.stateBody}>Loading trip…</Text>
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.stateContainer}>
      <Text style={styles.stateEyebrow}>SOMETHING WENT WRONG</Text>
      <Text style={styles.stateTitle}>Couldn’t open this trip</Text>
      <Text accessibilityRole="alert" style={styles.stateBody}>{message}</Text>
      <View style={styles.stateAction}>
        <PrimaryButton label="Try again" onPress={onRetry} testID="trip-detail-retry" />
      </View>
    </View>
  );
}

function DetailRow({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.detailRow} testID={testID}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function SettingRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={[styles.settingValue, enabled ? styles.settingOn : styles.settingOff]}>
        {enabled ? 'Enabled' : 'Disabled'}
      </Text>
    </View>
  );
}

function SectionHeader({ title, caption }: { title: string; caption?: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
      {caption ? <Text style={styles.sectionCaption}>{caption}</Text> : null}
    </View>
  );
}

type ContentProps = {
  trip: Trip;
  expenses: TripExpense[];
  balances: TripBalances | undefined;
  expensesLoading: boolean;
  expensesError: boolean;
  currentUserId: string | undefined;
  refreshing: boolean;
  onRefresh: () => void;
  onReport: () => void;
  onOpenLocations: () => void;
  onRetryExpenses: () => void;
};

function TripContent({
  trip,
  expenses,
  balances,
  expensesLoading,
  expensesError,
  currentUserId,
  refreshing,
  onRefresh,
  onReport,
  onOpenLocations,
  onRetryExpenses,
}: ContentProps) {
  const activeCount = countActiveMembers(trip);
  const members = [...trip.members].sort((a, b) => Number(b.isActive) - Number(a.isActive));
  const cashManager = trip.cashManagerUserId
    ? trip.members.find((member) => member.userId === trip.cashManagerUserId)
    : undefined;
  const cashManagerLabel = trip.cashManagerUserId
    ? cashManager?.user.fullName ?? 'Unknown member'
    : 'Not assigned';

  const nameByUserId = useMemo(
    () => new Map(trip.members.map((member) => [member.userId, member.user.fullName])),
    [trip.members],
  );

  const activeExpenses = expenses.filter((expense) => expense.status === 'ACTIVE');
  const groupExpenses = activeExpenses.filter((expense) => expense.expenseType === 'GROUP');
  const myPersonalExpenses = activeExpenses.filter(
    (expense) =>
      expense.expenseType === 'PERSONAL' &&
      (expense.createdByUserId === currentUserId ||
        expense.allocations.some((allocation) => allocation.userId === currentUserId)),
  );

  const groupTotalMinor = groupExpenses.reduce(
    (total, expense) => total + parseMoneyToMinor(expense.convertedAmount ?? expense.amount),
    0,
  );
  const myGroupShareMinor = groupExpenses.reduce(
    (total, expense) =>
      total +
      expense.allocations
        .filter((allocation) => allocation.userId === currentUserId)
        .reduce((sum, allocation) => sum + parseMoneyToMinor(allocation.allocatedAmount), 0),
    0,
  );
  const myBalance = balances?.members.find((member) => member.userId === currentUserId);
  const myNetMinor = parseMoneyToMinor(myBalance?.netBalance ?? '0');
  const showBalances = Boolean(balances && balances.members.length > 0 && groupExpenses.length > 0);

  const settleUpTransfers = useMemo(
    () =>
      calculateSuggestedTransfers(
        (balances?.members ?? []).map((member) => ({
          userId: member.userId,
          fullName: member.fullName,
          netBalanceMinor: parseMoneyToMinor(member.netBalance),
        })),
      ),
    [balances],
  );

  const joinCode = trip.joinCode;
  const currentMember = trip.members.find((member) => member.userId === currentUserId);
  const canReport =
    Boolean(currentMember) &&
    currentMember!.role !== 'VIEWER' &&
    (currentMember!.role === 'OWNER' ||
      currentMember!.role === 'ADMIN' ||
      trip.settings?.allowMemberExpenseEdit !== false);
  const reportBlockedReason = !currentMember
    ? 'Only trip members can report payments.'
    : currentMember.role === 'VIEWER'
      ? 'Viewers can read this trip but cannot report payments.'
      : !canReport && trip.settings?.allowMemberExpenseEdit === false
        ? 'The owner has turned off member expense reporting for this trip.'
        : trip.status !== 'ACTIVE'
          ? 'This trip is no longer active, so new payments cannot be added.'
          : '';

  async function shareCode() {
    if (!joinCode) return;
    try {
      await Share.share({
        message:
          `Join my trip “${trip.name}” on Sutrula Payanam.\n\n` +
          `Trip code: ${joinCode}\n\n` +
          'Open Sutrula Payanam, choose “Join a Trip”, and enter this code.',
        title: 'Sutrula Payanam trip code',
      });
    } catch {
      // Sharing is optional; the code is visible on screen.
    }
  }

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={(
        <RefreshControl
          colors={[colors.primary]}
          onRefresh={onRefresh}
          progressBackgroundColor={colors.card}
          refreshing={refreshing}
          testID="trip-detail-refresh"
          tintColor={colors.primary}
        />
      )}
      testID="trip-detail-scroll"
    >
      <View style={styles.statusRow}>
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, { backgroundColor: statusColor(trip.status) }]} />
          <Text style={styles.statusText}>{formatTripStatus(trip.status)}</Text>
        </View>
        <Text style={styles.dateRange}>{formatTripDateRange(trip.startDate, trip.endDate)}</Text>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryGlow} />
        <Text style={styles.summaryEyebrow}>GROUP SPEND</Text>
        <Text style={styles.summaryTotal} testID="trip-group-total">
          {formatMinor(groupTotalMinor, trip.baseCurrency)}
        </Text>
        <Text style={styles.summaryMeta}>
          {groupExpenses.length} group {groupExpenses.length === 1 ? 'expense' : 'expenses'} · {activeCount} active{' '}
          {activeCount === 1 ? 'member' : 'members'}
        </Text>

        <View style={styles.summarySplit}>
          <View style={styles.summarySplitItem}>
            <Text style={styles.summarySplitLabel}>YOUR GROUP SHARE</Text>
            <Text style={styles.summarySplitValue}>{formatMinor(myGroupShareMinor, trip.baseCurrency)}</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summarySplitItem}>
            <Text style={styles.summarySplitLabel}>YOUR BALANCE</Text>
            <Text style={styles.summarySplitValue}>
              {myNetMinor === 0
                ? 'Settled'
                : `${myNetMinor > 0 ? '+' : ''}${formatMinor(myNetMinor, trip.baseCurrency)}`}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <PrimaryButton
          accessibilityHint={
            canReport && trip.status === 'ACTIVE'
              ? 'Opens the report a payment form'
              : 'Reporting is unavailable for your role or this trip'
          }
          disabled={!canReport || trip.status !== 'ACTIVE'}
          label="Report a payment"
          onPress={onReport}
          testID="trip-report-payment"
          icon="＋"
        />
        {reportBlockedReason ? (
          <Text style={styles.closedNote} testID="trip-report-blocked">
            {reportBlockedReason}
          </Text>
        ) : null}
      </View>

      {joinCode ? (
        <View style={styles.codeCard}>
          <View style={styles.codeLeft}>
            <Text style={styles.codeLabel}>TRIP CODE</Text>
            <Text adjustsFontSizeToFit numberOfLines={1} style={styles.codeValue} testID="trip-join-code">
              {formatJoinCode(joinCode)}
            </Text>
            <Text style={styles.codeHint}>Share it only with people you want on this trip.</Text>
          </View>
          <Pressable
            accessibilityLabel="Share trip code"
            accessibilityRole="button"
            onPress={() => void shareCode()}
            style={({ pressed }) => [styles.shareButton, pressed ? styles.pressed : null]}
            testID="trip-share-code"
          >
            <Text style={styles.shareButtonText}>Share</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        accessibilityHint="Opens the live location page for this trip"
        accessibilityRole="button"
        onPress={onOpenLocations}
        style={({ pressed }) => [styles.locationCard, pressed ? styles.pressed : null]}
        testID="trip-live-location"
      >
        <View style={styles.locationIcon}>
          <Text style={styles.locationIconText}>◎</Text>
        </View>
        <View style={styles.locationText}>
          <Text style={styles.locationTitle}>Live location</Text>
          <Text style={styles.locationBody}>See where everyone on this trip is right now.</Text>
        </View>
        <Text style={styles.locationArrow}>→</Text>
      </Pressable>

      <View style={styles.card}>
        <DetailRow label="Dates" testID="trip-detail-dates" value={formatTripDateRange(trip.startDate, trip.endDate)} />
        <View style={styles.divider} />
        <DetailRow label="Base currency" testID="trip-detail-currency" value={trip.baseCurrency} />
        <View style={styles.divider} />
        <DetailRow label="Cash manager" testID="trip-detail-cash-manager" value={cashManagerLabel} />
      </View>

      <View style={styles.section}>
        <SectionHeader caption={`${groupExpenses.length}`} title="Group spending" />
        {expensesLoading ? (
          <View style={styles.inlineLoading}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.body}>Loading spending…</Text>
          </View>
        ) : expensesError ? (
          <View style={styles.inlineError}>
            <Text accessibilityRole="alert" style={styles.body}>Couldn’t load the spending list.</Text>
            <Pressable accessibilityRole="button" onPress={onRetryExpenses} testID="trip-expenses-retry">
              <Text style={styles.inlineErrorAction}>Try again</Text>
            </Pressable>
          </View>
        ) : groupExpenses.length === 0 ? (
          <View style={styles.emptySpending}>
            <Text style={styles.emptySpendingTitle}>No group spending yet</Text>
            <Text style={styles.body}>
              Report the first shared payment and it will appear here and on every member’s phone.
            </Text>
          </View>
        ) : (
          <View style={styles.expenseList}>
            {groupExpenses.map((expense) => (
              <ExpenseRow
                amount={expense.amount}
                category={expense.category}
                currency={expense.currency}
                dateLabel={formatTimestampDate(expense.date) ?? undefined}
                isMine={expense.payers.some((payer) => payer.userId === currentUserId)}
                key={expense.id}
                payerName={
                  nameByUserId.get(expense.payers[0]?.userId ?? '') ??
                  (expense.payers[0]?.userId === currentUserId ? 'You' : 'Trip member')
                }
                paymentMethod={expense.paymentMethod}
                purpose={expense.expenseType}
                testID={`trip-expense-${expense.id}`}
                title={expense.title}
              />
            ))}
          </View>
        )}
      </View>

      {myPersonalExpenses.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader caption="Only you" title="Your personal reports" />
          <View style={styles.expenseList}>
            {myPersonalExpenses.map((expense) => (
              <ExpenseRow
                amount={expense.amount}
                category={expense.category}
                currency={expense.currency}
                dateLabel={formatTimestampDate(expense.date) ?? undefined}
                isMine
                key={expense.id}
                payerName={nameByUserId.get(expense.payers[0]?.userId ?? '') ?? 'You'}
                paymentMethod={expense.paymentMethod}
                purpose={expense.expenseType}
                testID={`trip-expense-${expense.id}`}
                title={expense.title}
              />
            ))}
          </View>
        </View>
      ) : null}

      {showBalances ? (
        <View style={styles.section}>
          <SectionHeader title="Balances" />
          <View style={styles.card}>
            {balances!.members.map((member, index) => {
              const net = parseMoneyToMinor(member.netBalance);
              return (
                <View key={member.userId}>
                  {index > 0 ? <View style={styles.divider} /> : null}
                  <View style={styles.balanceRow}>
                    <View style={styles.balanceIdentity}>
                      <Text style={styles.balanceName} numberOfLines={1}>
                        {member.userId === currentUserId ? 'You' : member.fullName}
                      </Text>
                      {member.isActive ? null : <Text style={styles.balanceInactive}>Inactive</Text>}
                    </View>
                    <Text
                      style={[
                        styles.balanceValue,
                        net > 0 ? styles.balancePositive : net < 0 ? styles.balanceNegative : styles.balanceZero,
                      ]}
                    >
                      {net === 0 ? 'Settled' : `${net > 0 ? 'gets back ' : 'owes '}${formatMinor(Math.abs(net), trip.baseCurrency)}`}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
          <Text style={styles.balanceNote}>Based on recorded payments and shared expenses. Personal reports stay off the group total.</Text>
        </View>
      ) : null}

      {showBalances ? (
        <View style={styles.section}>
          <SectionHeader title="Settle up" />
          <View style={styles.card}>
            {settleUpTransfers.length === 0 ? (
              <Text style={styles.settleEmpty}>Everyone is settled up. No one owes anything.</Text>
            ) : (
              settleUpTransfers.map((transfer, index) => {
                const outbound = transfer.fromUserId === currentUserId;
                const inbound = transfer.toUserId === currentUserId;
                const label = outbound
                  ? `You pay ${transfer.toName}`
                  : inbound
                    ? `${transfer.fromName} pays you`
                    : `${transfer.fromName} pays ${transfer.toName}`;

                return (
                  <View key={`${transfer.fromUserId}-${transfer.toUserId}`}>
                    {index > 0 ? <View style={styles.divider} /> : null}
                    <View style={styles.balanceRow} testID={`settle-transfer-${transfer.fromUserId}-${transfer.toUserId}`}>
                      <View style={styles.balanceIdentity}>
                        <Text
                          style={[styles.balanceName, outbound || inbound ? styles.settleMine : null]}
                          numberOfLines={2}
                        >
                          {label}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.balanceValue,
                          outbound ? styles.balanceNegative : inbound ? styles.balancePositive : styles.balanceZero,
                        ]}
                      >
                        {formatMinor(transfer.amountMinor, trip.baseCurrency)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
          <Text style={styles.balanceNote}>
            Pay these amounts and the whole trip is square. This updates whenever a new group expense is added.
          </Text>
        </View>
      ) : null}

      {trip.description ? (
        <View style={styles.section}>
          <SectionHeader title="About" />
          <Text style={styles.body}>{trip.description}</Text>
        </View>
      ) : null}

      <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>Members</Text>
          <View style={styles.countPill}>
            <Text style={styles.countText}>
              {activeCount} active {activeCount === 1 ? 'member' : 'members'}
            </Text>
          </View>
        </View>
        {members.length === 0 ? (
          <Text style={styles.body}>No members have joined this trip yet.</Text>
        ) : (
          <View style={styles.memberList}>
            {members.map((member) => (
              <TripMemberRow
                isCashManager={member.userId === trip.cashManagerUserId}
                key={member.id}
                member={member}
              />
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <SectionHeader title="Settings" />
        {trip.settings ? (
          <View style={styles.card}>
            <SettingRow enabled={trip.settings.allowMemberExpenseEdit} label="Members can edit expenses" />
            <View style={styles.divider} />
            <SettingRow enabled={trip.settings.requireLocationConfirmation} label="Location confirmation required" />
            <View style={styles.divider} />
            <SettingRow enabled={trip.settings.allowPublicJoin} label="Public join link" />
          </View>
        ) : (
          <Text style={styles.body}>Trip settings are not configured.</Text>
        )}
      </View>
    </ScrollView>
  );
}

export default function TripDetailScreen({ navigation, route }: Props) {
  const { tripId, tripName } = route.params;
  const { user } = useAuth();
  const { data: trip, error, isError, refetch } = useTrip(tripId);
  const expensesQuery = useTripExpenses(tripId);
  const balancesQuery = useTripBalances(tripId);
  /**
   * The refresh indicator belongs to the pull gesture only. Background
   * revalidation (for example after inheriting a stale list timestamp) must
   * not make the screen look like the user pulled it.
   */
  const [pullRefreshing, setPullRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setPullRefreshing(true);
    try {
      await Promise.all([refetch(), expensesQuery.refetch(), balancesQuery.refetch()]);
    } finally {
      setPullRefreshing(false);
    }
  }, [balancesQuery, expensesQuery, refetch]);

  const openReport = useCallback(() => {
    navigation.navigate('ReportExpense', { tripId, tripName: trip?.name ?? tripName });
  }, [navigation, trip?.name, tripId, tripName]);

  const openLocations = useCallback(() => {
    navigation.navigate('LiveLocation', { tripId, tripName: trip?.name ?? tripName });
  }, [navigation, trip?.name, tripId, tripName]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <TopBar onBack={() => navigation.goBack()} />

      <View style={styles.header}>
        <Text accessibilityRole="header" numberOfLines={2} style={styles.headerTitle}>{trip?.name ?? tripName}</Text>
        <Text style={styles.headerSubtitle}>Trip overview</Text>
      </View>

      {!trip ? (
        isError ? (
          <ErrorState message={describeError(error)} onRetry={() => void refetch()} />
        ) : (
          <LoadingState />
        )
      ) : (
        <View style={styles.flex}>
          {isError ? (
            <View style={styles.banner}>
              <Text accessibilityRole="alert" style={styles.bannerText}>
                Couldn’t refresh this trip. Showing the last loaded details.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void refetch()}
                style={({ pressed }) => (pressed ? styles.pressed : null)}
                testID="trip-detail-banner-retry"
              >
                <Text style={styles.bannerAction}>Try again</Text>
              </Pressable>
            </View>
          ) : null}
          <TripContent
            balances={balancesQuery.data}
            currentUserId={user?.id}
            expenses={expensesQuery.data ?? []}
            expensesError={expensesQuery.isError}
            expensesLoading={expensesQuery.isPending}
            onRefresh={() => void refresh()}
            onReport={openReport}
            onOpenLocations={openLocations}
            onRetryExpenses={() => void expensesQuery.refetch()}
            refreshing={pullRefreshing}
            trip={trip}
          />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  topBar: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  backButton: { alignSelf: 'flex-start', justifyContent: 'center', minHeight: 48, paddingRight: spacing.md },
  backLabel: { color: colors.primaryDark, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.75 },
  header: { gap: spacing.xs, paddingBottom: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  headerTitle: { color: colors.foreground, fontSize: 28, fontWeight: '800', letterSpacing: -0.6, lineHeight: 34 },
  headerSubtitle: {
    color: colors.mutedForeground,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  content: { flexGrow: 1, gap: spacing.lg, paddingBottom: spacing.xxl, paddingHorizontal: spacing.lg },
  statusRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  statusPill: {
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 28,
    paddingHorizontal: spacing.sm,
  },
  statusDot: { borderRadius: 4, height: 8, width: 8 },
  statusText: { color: colors.mutedForeground, fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  dateRange: { color: colors.mutedForeground, fontSize: 12, fontWeight: '600' },
  summaryCard: {
    backgroundColor: colors.ink,
    borderRadius: radius.sheet,
    overflow: 'hidden',
    padding: spacing.lg,
    ...shadow.raised,
  },
  summaryGlow: {
    backgroundColor: colors.primary,
    borderRadius: 120,
    height: 190,
    opacity: 0.3,
    position: 'absolute',
    right: -70,
    top: -90,
    width: 190,
  },
  summaryEyebrow: { color: colors.primarySoft, fontSize: 10, fontWeight: '800', letterSpacing: 1.8 },
  summaryTotal: { color: colors.card, fontSize: 38, fontWeight: '900', letterSpacing: -1, marginTop: spacing.xs },
  summaryMeta: { color: '#CBD5E1', fontSize: 12, marginTop: 2 },
  summarySplit: { flexDirection: 'row', marginTop: spacing.lg },
  summarySplitItem: { flex: 1, gap: 2 },
  summarySplitLabel: { color: '#94A3B8', fontSize: 9, fontWeight: '800', letterSpacing: 1.2 },
  summarySplitValue: { color: colors.card, fontSize: 15, fontWeight: '800' },
  summaryDivider: { backgroundColor: 'rgba(255,255,255,0.14)', marginHorizontal: spacing.md, width: 1 },
  actions: { gap: spacing.xs },
  closedNote: { color: colors.destructive, fontSize: 12, fontWeight: '600' },
  codeCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderStrong,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
    ...shadow.card,
  },
  codeLeft: { flex: 1, gap: 2 },
  codeLabel: { color: colors.subtle, fontSize: 9, fontWeight: '800', letterSpacing: 1.6 },
  codeValue: { color: colors.foreground, fontSize: 24, fontWeight: '900', letterSpacing: 4 },
  codeHint: { color: colors.mutedForeground, fontSize: 10, lineHeight: 14 },
  shareButton: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.input,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  shareButtonText: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  locationCard: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.borderStrong,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    ...shadow.card,
  },
  locationIcon: {
    alignItems: 'center',
    backgroundColor: colors.secondarySoft,
    borderRadius: radius.input,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  locationIconText: { color: colors.secondary, fontSize: 20, fontWeight: '800' },
  locationText: { flex: 1, gap: 2 },
  locationTitle: { color: colors.foreground, fontSize: 15, fontWeight: '800' },
  locationBody: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  locationArrow: { color: colors.secondary, fontSize: 18, fontWeight: '800' },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    ...shadow.card,
  },
  detailRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  detailLabel: { color: colors.mutedForeground, fontSize: 14, fontWeight: '600' },
  detailValue: { color: colors.foreground, flexShrink: 1, fontSize: 15, fontWeight: '700', textAlign: 'right' },
  divider: { backgroundColor: colors.border, height: 1 },
  section: { gap: spacing.sm },
  sectionHeader: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  sectionHeaderRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  sectionTitle: { color: colors.foreground, fontSize: 20, fontWeight: '800', letterSpacing: -0.2 },
  sectionCaption: { color: colors.mutedForeground, fontSize: 12, fontWeight: '700' },
  countPill: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  countText: { color: colors.mutedForeground, fontSize: 12, fontWeight: '700' },
  body: { color: colors.mutedForeground, fontSize: 14, lineHeight: 21 },
  memberList: { gap: spacing.sm },
  settingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  settingLabel: { color: colors.foreground, flexShrink: 1, fontSize: 15, fontWeight: '600' },
  settingValue: { fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  settingOn: { color: colors.success },
  settingOff: { color: colors.mutedForeground },
  inlineLoading: { alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.card, flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', minHeight: 72 },
  inlineError: { backgroundColor: colors.card, borderColor: colors.destructiveSoft, borderRadius: radius.card, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  inlineErrorAction: { color: colors.primaryDark, fontSize: 13, fontWeight: '800' },
  emptySpending: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  emptySpendingTitle: { color: colors.foreground, fontSize: 15, fontWeight: '800' },
  expenseList: { gap: spacing.sm },
  balanceRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between', paddingVertical: spacing.sm },
  balanceIdentity: { flex: 1, gap: 1 },
  balanceName: { color: colors.foreground, fontSize: 14, fontWeight: '700' },
  balanceInactive: { color: colors.subtle, fontSize: 10 },
  balanceValue: { fontSize: 13, fontWeight: '800' },
  balancePositive: { color: colors.success },
  balanceNegative: { color: colors.destructive },
  balanceZero: { color: colors.mutedForeground },
  balanceNote: { color: colors.subtle, fontSize: 11, lineHeight: 16 },
  settleMine: { color: colors.primaryDark, fontWeight: '800' },
  settleEmpty: { color: colors.mutedForeground, fontSize: 13, paddingVertical: spacing.sm },
  banner: {
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    marginHorizontal: spacing.lg,
    padding: spacing.md,
  },
  bannerText: { color: colors.destructive, flex: 1, fontSize: 13, lineHeight: 18 },
  bannerAction: { color: colors.primary, fontSize: 13, fontWeight: '800' },
  stateContainer: { alignItems: 'center', flex: 1, gap: spacing.sm, justifyContent: 'center', padding: spacing.lg },
  stateEyebrow: { color: colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  stateTitle: { color: colors.foreground, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  stateBody: { color: colors.mutedForeground, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  stateAction: { marginTop: spacing.md },
});
