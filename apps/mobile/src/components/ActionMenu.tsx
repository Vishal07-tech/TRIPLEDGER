import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, radius, shadow, spacing } from '../theme/tokens';

export type ActionMenuItem = {
  key: string;
  label: string;
  description?: string;
  icon: string;
  tone?: 'default' | 'danger';
  testID?: string;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  title?: string;
  subtitle?: string;
  items: ActionMenuItem[];
  onClose: () => void;
};

export function ActionMenu({ visible, title = 'Quick actions', subtitle, items, onClose }: Props) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      transparent
      visible={visible}
    >
      <View style={styles.root}>
        <Pressable
          accessibilityLabel="Close menu"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.backdrop}
          testID="action-menu-backdrop"
        />
        <View accessibilityViewIsModal style={styles.sheet} testID="action-menu">
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.title}>{title}</Text>
            <Pressable
              accessibilityLabel="Close menu"
              accessibilityRole="button"
              hitSlop={10}
              onPress={onClose}
              style={({ pressed }) => [styles.close, pressed ? styles.pressed : null]}
              testID="action-menu-close"
            >
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

          <ScrollView bounces={false} contentContainerStyle={styles.items} keyboardShouldPersistTaps="handled">
            {items.map((item) => {
              const danger = item.tone === 'danger';
              return (
                <Pressable
                  accessibilityRole="button"
                  key={item.key}
                  onPress={() => {
                    onClose();
                    item.onPress();
                  }}
                  style={({ pressed }) => [styles.item, pressed ? styles.itemPressed : null]}
                  testID={item.testID}
                >
                  <View style={[styles.icon, danger ? styles.iconDanger : null]}>
                    <Text style={[styles.iconText, danger ? styles.iconTextDanger : null]}>{item.icon}</Text>
                  </View>
                  <View style={styles.itemText}>
                    <Text style={[styles.itemLabel, danger ? styles.itemLabelDanger : null]}>{item.label}</Text>
                    {item.description ? <Text style={styles.itemDescription}>{item.description}</Text> : null}
                  </View>
                  <Text style={[styles.chevron, danger ? styles.itemLabelDanger : null]}>›</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: {
    backgroundColor: colors.overlay,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    ...shadow.raised,
  },
  handle: {
    alignSelf: 'center',
    backgroundColor: colors.borderStrong,
    borderRadius: radius.pill,
    height: 4,
    marginBottom: spacing.md,
    width: 44,
  },
  header: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  title: { color: colors.foreground, fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  close: {
    alignItems: 'center',
    backgroundColor: colors.muted,
    borderRadius: radius.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  closeText: { color: colors.mutedForeground, fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.7 },
  subtitle: { color: colors.mutedForeground, fontSize: 14, lineHeight: 20, marginTop: spacing.xs },
  items: { gap: spacing.xs, paddingTop: spacing.md },
  item: {
    alignItems: 'center',
    borderRadius: radius.input,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  itemPressed: { backgroundColor: colors.muted },
  icon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.input,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  iconDanger: { backgroundColor: colors.destructiveSoft },
  iconText: { color: colors.primaryDark, fontSize: 18, fontWeight: '800' },
  iconTextDanger: { color: colors.destructive },
  itemText: { flex: 1, gap: 2 },
  itemLabel: { color: colors.foreground, fontSize: 16, fontWeight: '800' },
  itemLabelDanger: { color: colors.destructive },
  itemDescription: { color: colors.mutedForeground, fontSize: 12, lineHeight: 17 },
  chevron: { color: colors.subtle, fontSize: 24, fontWeight: '300' },
});
