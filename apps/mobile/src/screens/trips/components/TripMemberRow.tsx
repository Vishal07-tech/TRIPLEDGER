import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../../../theme/tokens';
import type { TripMember, TripRole } from '../../../types/trips';
import { formatTimestampDate } from '../../../utils/tripDisplay';

const ROLE_LABELS: Record<TripRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  MEMBER: 'Member',
  VIEWER: 'Viewer',
};

type Props = {
  member: TripMember;
  isCashManager: boolean;
};

export function TripMemberRow({ member, isCashManager }: Props) {
  const role = ROLE_LABELS[member.role];
  const joined = formatTimestampDate(member.joinedAt);
  const joinedLabel = joined ? `Joined ${joined}` : null;
  const accessibilityLabel = [
    member.user.fullName,
    role,
    isCashManager ? 'Cash manager' : null,
    member.isActive ? null : 'Inactive',
    joinedLabel,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <View
      accessible
      accessibilityLabel={`${accessibilityLabel}.`}
      style={[styles.row, member.isActive ? null : styles.rowInactive]}
      testID={`trip-member-${member.id}`}
    >
      <View style={styles.identity}>
        <Text numberOfLines={1} style={styles.name}>{member.user.fullName}</Text>
        <Text numberOfLines={1} style={styles.email}>{member.user.email}</Text>
        {joinedLabel ? <Text style={styles.joined}>{joinedLabel}</Text> : null}
      </View>

      <View style={styles.badges}>
        <View style={styles.rolePill}>
          <Text style={styles.roleText}>{role}</Text>
        </View>
        {isCashManager ? (
          <View style={styles.cashPill}>
            <Text style={styles.cashText}>Cash manager</Text>
          </View>
        ) : null}
        {member.isActive ? null : (
          <View style={styles.inactivePill}>
            <Text style={styles.inactiveText}>Inactive</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  rowInactive: {
    opacity: 0.7,
  },
  identity: {
    flex: 1,
    gap: 2,
  },
  name: {
    color: colors.foreground,
    fontSize: 16,
    fontWeight: '700',
  },
  email: {
    color: colors.mutedForeground,
    fontSize: 13,
  },
  joined: {
    color: colors.mutedForeground,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  badges: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  rolePill: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  roleText: {
    color: colors.mutedForeground,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  cashPill: {
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  cashText: {
    color: colors.onPrimary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  inactivePill: {
    backgroundColor: colors.card,
    borderColor: colors.destructive,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  inactiveText: {
    color: colors.destructive,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
});
