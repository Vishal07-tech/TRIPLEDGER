import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '../../components/PrimaryButton';
import { useTrips } from '../../hooks/useTrips';
import { ApiError } from '../../services/api/apiClient';
import { colors, radius, spacing } from '../../theme/tokens';
import type { AppStackParamList } from '../../types/auth';
import type { Trip } from '../../types/trips';
import { groupTrips, type TripGroup } from '../../utils/tripDisplay';
import { TripCard } from './components/TripCard';

type Props = NativeStackScreenProps<AppStackParamList, 'MyTrips'>;

function ItemSeparator() {
  return <View style={styles.itemSeparator} />;
}

function LoadingState() {
  return (
    <View style={styles.stateContainer}>
      <ActivityIndicator color={colors.primary} size="large" />
      <Text accessibilityLiveRegion="polite" style={styles.stateBody}>Loading your trips…</Text>
    </View>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.stateContainer}>
      <Text style={styles.stateEyebrow}>SOMETHING WENT WRONG</Text>
      <Text style={styles.stateTitle}>Couldn’t load your trips</Text>
      <Text accessibilityRole="alert" style={styles.stateBody}>{message}</Text>
      <View style={styles.stateAction}>
        <PrimaryButton label="Try again" onPress={onRetry} testID="my-trips-retry" />
      </View>
    </View>
  );
}

function EmptyState({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  return (
    <View style={styles.stateContainer}>
      <View style={styles.emptyMark}><Text style={styles.emptyMarkText}>T</Text></View>
      <Text style={styles.stateTitle}>No trips yet</Text>
      <Text accessibilityLiveRegion="polite" style={styles.stateBody}>
        When you create or join a trip, it will appear here with its dates, currency and members.
      </Text>
      <View style={styles.emptyActions}>
        <PrimaryButton label="Create a trip" onPress={onCreate} testID="my-trips-empty-create" />
        <PrimaryButton label="Join with a code" onPress={onJoin} testID="my-trips-empty-join" variant="secondary" />
      </View>
    </View>
  );
}

export default function MyTripsScreen({ navigation }: Props) {
  const { data, error, isError, isPending, isRefetching, refetch } = useTrips();
  const trips = data ?? [];
  const groups = groupTrips(trips);
  const errorMessage = error instanceof ApiError
    ? error.message
    : 'We could not load your trips. Check your connection and try again.';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [styles.backButton, pressed ? styles.pressed : null]}
          testID="my-trips-back"
        >
          <Text style={styles.backLabel}>← Back</Text>
        </Pressable>
        <Pressable
          accessibilityHint="Opens the create trip form"
          accessibilityLabel="Create a trip"
          accessibilityRole="button"
          onPress={() => navigation.navigate('CreateTrip')}
          style={({ pressed }) => [styles.createButton, pressed ? styles.pressed : null]}
          testID="my-trips-create"
        >
          <Text style={styles.createButtonText}>＋</Text>
        </Pressable>
      </View>

      <View style={styles.heading}>
        <Text style={styles.title}>My Trips</Text>
        <Text style={styles.subtitle}>Active, upcoming and completed trips in one place.</Text>
      </View>

      {isPending ? (
        <LoadingState />
      ) : isError ? (
        <ErrorState message={errorMessage} onRetry={() => void refetch()} />
      ) : (
        <SectionList<Trip, TripGroup>
          contentContainerStyle={styles.listContent}
          ItemSeparatorComponent={ItemSeparator}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={<EmptyState onCreate={() => navigation.navigate('CreateTrip')} onJoin={() => navigation.navigate('JoinTrip')} />}
          refreshControl={(
            <RefreshControl
              colors={[colors.primary]}
              onRefresh={() => void refetch()}
              progressBackgroundColor={colors.card}
              refreshing={isRefetching}
              testID="my-trips-refresh"
              tintColor={colors.primary}
            />
          )}
          renderItem={({ item }) => (
            <TripCard
              onPress={() => navigation.navigate('TripDetail', { tripId: item.id, tripName: item.name })}
              trip={item}
            />
          )}
          renderSectionHeader={({ section }) => (
            <View accessibilityRole="header" style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <View style={styles.sectionCountPill}>
                <Text style={styles.sectionCount}>{section.data.length}</Text>
              </View>
            </View>
          )}
          sections={groups}
          stickySectionHeadersEnabled={false}
          testID="my-trips-list"
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  createButton: {
    alignItems: 'center',
    backgroundColor: colors.foreground,
    borderRadius: radius.pill,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  createButtonText: {
    color: colors.card,
    fontSize: 22,
    fontWeight: '500',
    lineHeight: 26,
  },
  backButton: {
    alignSelf: 'flex-start',
    justifyContent: 'center',
    minHeight: 48,
    paddingRight: spacing.md,
  },
  backLabel: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.75,
  },
  heading: {
    gap: spacing.xs,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  title: {
    color: colors.foreground,
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  subtitle: {
    color: colors.mutedForeground,
    fontSize: 15,
    lineHeight: 22,
  },
  listContent: {
    flexGrow: 1,
    paddingBottom: spacing.xxl,
    paddingHorizontal: spacing.lg,
  },
  sectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  sectionTitle: {
    color: colors.foreground,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  sectionCountPill: {
    alignItems: 'center',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 28,
    minWidth: 32,
    paddingHorizontal: spacing.sm,
  },
  sectionCount: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: '700',
  },
  itemSeparator: {
    height: spacing.sm,
  },
  stateContainer: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  stateEyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  stateTitle: {
    color: colors.foreground,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  stateBody: {
    color: colors.mutedForeground,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  stateAction: {
    marginTop: spacing.md,
  },
  emptyMark: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: 32,
    height: 64,
    justifyContent: 'center',
    marginBottom: spacing.sm,
    width: 64,
  },
  emptyMarkText: {
    color: colors.onPrimary,
    fontSize: 30,
    fontWeight: '800',
  },
  emptyActions: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
