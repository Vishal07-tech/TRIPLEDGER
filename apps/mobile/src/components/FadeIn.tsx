import type { PropsWithChildren } from 'react';
import { useEffect, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';

type Props = PropsWithChildren<{
  /** Stagger the reveal by passing an increasing delay. */
  delay?: number;
  /** How far the element travels up as it fades in. */
  offset?: number;
  style?: StyleProp<ViewStyle>;
}>;

/**
 * Small entrance animation used across the app. Everything still renders
 * immediately for screen readers and tests; only opacity/transform animate.
 */
export function FadeIn({ children, delay = 0, offset = 14, style }: Props) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      delay,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true,
    });

    animation.start();

    return () => animation.stop();
  }, [delay, progress]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
