import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing } from '../theme/tokens';

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  caption?: string;
  testID?: string;
};

type Props<T extends string> = {
  label: string;
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
};

export function SegmentedControl<T extends string>({ label, options, value, onChange }: Props<T>) {
  return (
    <View accessibilityLabel={label} accessibilityRole="radiogroup" style={styles.group}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.option,
              selected ? styles.optionSelected : null,
              pressed ? styles.pressed : null,
            ]}
            testID={option.testID}
          >
            <Text style={[styles.label, selected ? styles.labelSelected : null]}>{option.label}</Text>
            {option.caption ? (
              <Text style={[styles.caption, selected ? styles.captionSelected : null]}>{option.caption}</Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: colors.muted,
    borderColor: colors.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
  },
  option: {
    borderRadius: radius.sm,
    flex: 1,
    gap: 2,
    justifyContent: 'center',
    minHeight: 56,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  optionSelected: {
    backgroundColor: colors.card,
    shadowColor: colors.ink,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  pressed: { opacity: 0.8 },
  label: { color: colors.mutedForeground, fontSize: 15, fontWeight: '700', textAlign: 'center' },
  labelSelected: { color: colors.primaryDark, fontWeight: '800' },
  caption: { color: colors.subtle, fontSize: 11, lineHeight: 15, textAlign: 'center' },
  captionSelected: { color: colors.mutedForeground },
});
