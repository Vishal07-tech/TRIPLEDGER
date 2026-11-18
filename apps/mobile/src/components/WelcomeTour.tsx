import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, shadow, spacing } from '../theme/tokens';
import { PrimaryButton } from './PrimaryButton';

type Props = {
  visible: boolean;
  onDone: () => void;
};

const STEPS = [
  {
    icon: '✈',
    title: 'Your trips, all in one place',
    body:
      'Create a trip, or join a friend’s trip with the 8-character code they share. Everyone travelling sees the same trip, the same people and the same spending.',
    hint: 'Home · Create a trip or Join with code',
  },
  {
    icon: '₹',
    title: 'Split every expense fairly',
    body:
      'Report a personal spend or a group spend. Pick who was involved and the app divides it — a ₹120 bill shared by two people becomes ₹60 each, on every phone.',
    hint: 'Trip · Report expense',
  },
  {
    icon: '⇄',
    title: 'Always know who owes whom',
    body:
      'Each trip keeps a running settle-up list: exactly who pays whom and how much. No scribbling in notes and no arguments at the end of the trip.',
    hint: 'Trip · Settle up',
  },
  {
    icon: '◎',
    title: 'Find each other',
    body:
      'If someone wanders off, open Live location and share yours. You appear on the trip map with the distance and how fresh the position is — and you can stop sharing any time.',
    hint: 'Trip · Live location',
  },
];

export function WelcomeTour({ visible, onDone }: Props) {
  const [index, setIndex] = useState(0);
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    setIndex(0);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    entrance.setValue(0);
    Animated.timing(entrance, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    }).start();
  }, [entrance, index, visible]);

  const step = STEPS[index] ?? STEPS[0];
  const isLast = index === STEPS.length - 1;

  return (
    <Modal animationType="fade" onRequestClose={onDone} transparent visible={visible}>
      <View style={styles.backdrop}>
        <Animated.View
          style={[
            styles.card,
            {
              opacity: entrance,
              transform: [
                { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
                { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
              ],
            },
          ]}
        >
          <Pressable
            accessibilityLabel="Skip the introduction"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onDone}
            style={({ pressed }) => [styles.skip, pressed ? styles.pressed : null]}
            testID="tour-skip"
          >
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>

          <View key={step.title} style={styles.stepBody}>
            <View style={styles.mark}>
              <Text style={styles.markText}>{step.icon}</Text>
            </View>
            <Text accessibilityRole="header" style={styles.title}>{step.title}</Text>
            <Text style={styles.body}>{step.body}</Text>
            <View style={styles.hintPill}>
              <Text style={styles.hint}>{step.hint}</Text>
            </View>
          </View>

          <View style={styles.dots}>
            {STEPS.map((item, dotIndex) => (
              <View
                key={item.title}
                style={[styles.dot, dotIndex === index ? styles.dotActive : null]}
                testID={`tour-dot-${dotIndex}`}
              />
            ))}
          </View>

          <PrimaryButton
            label={isLast ? 'Start using the app' : 'Next'}
            onPress={() => {
              if (isLast) onDone();
              else setIndex((current) => current + 1);
            }}
            testID="tour-next"
          />

          <Text style={styles.counter}>
            {index + 1} of {STEPS.length}
          </Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'center',
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.sheet,
    gap: spacing.md,
    padding: spacing.lg,
    width: '100%',
    ...shadow.raised,
  },
  skip: { alignSelf: 'flex-end', minHeight: 32, paddingHorizontal: spacing.xs },
  skipText: { color: colors.mutedForeground, fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.7 },
  stepBody: { alignItems: 'center', gap: spacing.sm },
  mark: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  markText: { color: colors.primaryDark, fontSize: 30, fontWeight: '800' },
  title: { color: colors.foreground, fontSize: 22, fontWeight: '800', letterSpacing: -0.3, textAlign: 'center' },
  body: { color: colors.mutedForeground, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  hintPill: {
    backgroundColor: colors.muted,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  hint: { color: colors.gold, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  dots: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, justifyContent: 'center' },
  dot: { backgroundColor: colors.borderStrong, borderRadius: radius.pill, height: 7, width: 7 },
  dotActive: { backgroundColor: colors.primary, width: 22 },
  counter: { color: colors.subtle, fontSize: 11, textAlign: 'center' },
});
