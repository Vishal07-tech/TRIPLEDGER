import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme/tokens';
import type { ExpensePurpose } from '../types/trips';
import { formatMoney } from '../utils/money';

type Props = {
  title: string;
  payerName: string;
  amount: string;
  currency: string;
  purpose: ExpensePurpose;
  category?: string;
  dateLabel?: string;
  paymentMethod?: string;
  isMine?: boolean;
  testID?: string;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return `${parts[0][0] ?? ''}${parts.length > 1 ? parts[parts.length - 1][0] ?? '' : ''}`.toUpperCase();
}

export function ExpenseRow({
  title,
  payerName,
  amount,
  currency,
  purpose,
  category,
  dateLabel,
  paymentMethod,
  isMine = false,
  testID,
}: Props) {
  const isGroup = purpose === 'GROUP';
  const details = [payerName, category, paymentMethod].filter(Boolean).join(' · ');

  return (
    <View
      accessible
      accessibilityLabel={`${title}. ${isGroup ? 'Group expense' : 'Personal expense'}. ${details}. ${formatMoney(amount, currency)}.`}
      style={styles.row}
      testID={testID}
    >
      <View style={[styles.avatar, isGroup ? styles.avatarGroup : styles.avatarPersonal]}>
        <Text style={[styles.avatarText, isGroup ? styles.avatarTextGroup : styles.avatarTextPersonal]}>
          {initials(payerName)}
        </Text>
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={styles.title}>{title}</Text>
          <Text style={styles.amount}>{formatMoney(amount, currency)}</Text>
        </View>
        <Text numberOfLines={1} style={styles.details}>
          {isMine ? 'You' : payerName}
          {category ? ` · ${category}` : ''}
          {paymentMethod ? ` · ${paymentMethod}` : ''}
        </Text>
        <View style={styles.metaRow}>
          <View style={[styles.badge, isGroup ? styles.badgeGroup : styles.badgePersonal]}>
            <Text style={[styles.badgeText, isGroup ? styles.badgeTextGroup : styles.badgeTextPersonal]}>
              {isGroup ? 'Group' : 'Personal'}
            </Text>
          </View>
          {dateLabel ? <Text style={styles.date}>{dateLabel}</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'flex-start',
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  avatar: {
    alignItems: 'center',
    borderRadius: radius.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  avatarGroup: { backgroundColor: colors.successSoft },
  avatarPersonal: { backgroundColor: colors.warningSoft },
  avatarText: { fontSize: 14, fontWeight: '800' },
  avatarTextGroup: { color: colors.success },
  avatarTextPersonal: { color: colors.gold },
  body: { flex: 1, gap: 3 },
  titleRow: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.sm, justifyContent: 'space-between' },
  title: { color: colors.foreground, flex: 1, fontSize: 15, fontWeight: '800' },
  amount: { color: colors.foreground, fontSize: 16, fontWeight: '800', letterSpacing: -0.2 },
  details: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  metaRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.sm, marginTop: 2 },
  badge: { borderRadius: radius.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  badgeGroup: { backgroundColor: colors.successSoft },
  badgePersonal: { backgroundColor: colors.warningSoft },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  badgeTextGroup: { color: colors.success },
  badgeTextPersonal: { color: colors.gold },
  date: { color: colors.subtle, fontSize: 11 },
});
