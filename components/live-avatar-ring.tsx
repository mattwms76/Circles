import { useEffect, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { UI_ACCESSIBLE_COLORS } from "../lib/ui-accessibility";

const LIVE_CORAL = "#ED604A";
const PULSE_CYCLE_MS = 1400;

export type LiveAvatarRingProps = {
  /** The avatar frame size, including any pre-existing story border. */
  size: number;
  live: boolean;
  animate?: boolean;
  /** Keep the live stroke separate from an existing outer story border. */
  inset?: number;
};

/**
 * A decorative overlay only: it neither changes avatar layout nor participates
 * in the parent Pressable's hit testing or accessibility focus order.
 */
export function LiveAvatarRing({
  size,
  live,
  animate = true,
  inset = 0,
}: LiveAvatarRingProps) {
  const [pulse] = useState(() => new Animated.Value(0));
  // Unknown accessibility state is intentionally conservative: no animation.
  const [reduceMotion, setReduceMotion] = useState(true);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (mounted) setReduceMotion(enabled !== false);
      })
      .catch(() => {
        if (mounted) setReduceMotion(true);
      });

    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        if (mounted) setReduceMotion(enabled !== false);
      },
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    pulse.stopAnimation();
    pulse.setValue(0);
    if (!live || !animate || reduceMotion) return;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: PULSE_CYCLE_MS / 2,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: PULSE_CYCLE_MS / 2,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();

    return () => {
      animation.stop();
      pulse.stopAnimation();
      pulse.setValue(0);
    };
  }, [animate, live, pulse, reduceMotion]);

  if (!live) return null;

  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.16, 0.7],
  });
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.04],
  });
  const pulseSize = Math.max(1, size - 2 * Math.max(0, inset));

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        styles.overlay,
        { width: size, height: size, borderRadius: size },
      ]}
    >
      <Animated.View
        style={[
          styles.pulse,
          {
            width: pulseSize,
            height: pulseSize,
            borderRadius: pulseSize,
            opacity: pulseOpacity,
            transform: [{ scale: pulseScale }],
          },
        ]}
      />
      <View
        style={[
          styles.ring,
          { width: pulseSize, height: pulseSize, borderRadius: pulseSize },
        ]}
      />
      <View style={styles.indicator}>
        <View style={styles.dot} />
        <Text style={styles.label}>LIVE</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  pulse: {
    position: "absolute",
    borderWidth: 1.5,
    borderColor: LIVE_CORAL,
  },
  ring: {
    position: "absolute",
    borderWidth: 1.4,
    borderColor: LIVE_CORAL,
  },
  indicator: {
    position: "absolute",
    right: -2,
    bottom: -2,
    minHeight: 12,
    paddingHorizontal: 4,
    borderRadius: 6,
    backgroundColor: UI_ACCESSIBLE_COLORS.action,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: UI_ACCESSIBLE_COLORS.actionText,
  },
  label: {
    color: UI_ACCESSIBLE_COLORS.actionText,
    fontSize: 7,
    lineHeight: 10,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
});
