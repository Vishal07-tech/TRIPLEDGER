import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../../../theme/tokens';
import type { Trip, TripStatus } from '../../../types/trips';
import { countActiveMembers, formatTripDateRange, formatTripStatus } from '../../../utils/tripDisplay';

type Props = {
  trip: Trip;
  onPress: () => void;
};

function statusColor(status: TripStatus): string {
  if (status === 'TRIP_CLOSED' || status === 'FULLY_SETTLED') return colors.success;
  if (status === 'ACTIVE') return colors.primary;
  return colors.secondary;
}

export function TripCard({ trip, onPress }: Props) {
  const memberCount = countActiveMembers(trip);
  const dateRange = formatTripDateRange(trip.startDate, trip.endDate);
  const status = formatTripStatus(trip.status);
  const memberLabel = `${memberCount} active ${memberCount === 1 ? 'member' : 'members'}`;

  return (
    <Pressable
      accessibilityHint="Opens trip details"
      accessibilityLabel={`${trip.name}. ${dateRange}. ${trip.baseCurrency}. ${status}. ${memberLabel}.`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
      testID={`trip-card-${trip.id}`}
    >
      <View style={styles.headerRow}>
        <Text numberOfLines={2} style={styles.name}>{trip.name}</Text>
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, { backgroundColor: statusColor(trip.status) }]} />
          <Text style={styles.statusText}>{status}</Text>
        </View>
      </View>

      <Text style={styles.dateRange}>{dateRange}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.currency}>{trip.baseCurrency}</Text>
        <View style={styles.metaDot} />
        <Text style={styles.memberCount}>{memberLabel}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
    shadowColor: colors.foreground,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
  pressed: {
    opacity: 0.9,
  },
  headerRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  name: {
    color: colors.foreground,
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
    lineHeight: 26,
  },
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
  statusDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  statusText: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  dateRange: {
    color: colors.mutedForeground,
    fontSize: 15,
    lineHeight: 21,
  },
  metaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  currency: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
  },
  metaDot: {
    backgroundColor: colors.border,
    borderRadius: 2,
    height: 4,
    width: 4,
  },
  memberCount: {
    color: colors.mutedForeground,
    fontSize: 13,
    fontWeight: '600',
  },
});
