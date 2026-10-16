import { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { mediaUrl } from "@/src/api/client";
import { Icon, IconName } from "@/src/components/icon";

// ------------------------------- Text --------------------------------------
export function Display({
  children,
  size = 24,
  weight = "medium",
  style,
  numberOfLines,
}: {
  children: ReactNode;
  size?: number;
  weight?: "regular" | "medium" | "semibold";
  style?: TextStyle;
  numberOfLines?: number;
}) {
  const { colors } = useTheme();
  const family =
    weight === "semibold" ? fonts.displaySemiBold : weight === "medium" ? fonts.displayMedium : fonts.displayRegular;
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[{ fontFamily: family, fontSize: size, color: colors.onSurface, lineHeight: size * 1.25 }, style]}
    >
      {children}
    </Text>
  );
}

export function Body({
  children,
  size = 14,
  weight = "regular",
  color,
  style,
  numberOfLines,
}: {
  children: ReactNode;
  size?: number;
  weight?: "regular" | "medium";
  color?: string;
  style?: TextStyle;
  numberOfLines?: number;
}) {
  const { colors } = useTheme();
  return (
    <Text
      numberOfLines={numberOfLines}
      style={[
        {
          fontFamily: weight === "medium" ? fonts.textMedium : fonts.textRegular,
          fontSize: size,
          color: color ?? colors.onSurfaceSecondary,
          lineHeight: size * 1.4,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

export function Overline({ children, style }: { children: ReactNode; style?: TextStyle }) {
  const { colors } = useTheme();
  return (
    <Text
      style={[
        {
          fontFamily: fonts.textMedium,
          fontSize: 11,
          letterSpacing: 1.2,
          textTransform: "uppercase",
          color: colors.muted,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

// ------------------------------- Button -------------------------------------
export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  disabled,
  loading,
  small,
  style,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: ViewStyle;
  testID?: string;
}) {
  const styles = useButtonStyles();
  const { colors } = useTheme();
  const bg =
    variant === "primary"
      ? colors.brandPrimary
      : variant === "danger"
        ? colors.error
        : variant === "secondary"
          ? colors.surfaceSecondary
          : "transparent";
  const fg =
    variant === "primary"
      ? colors.onBrandPrimary
      : variant === "danger"
        ? colors.onError
        : colors.onSurface;
  return (
    <Pressable
      testID={testID}
      disabled={disabled || loading}
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [
        styles.base,
        small && styles.small,
        {
          backgroundColor: bg,
          borderColor: variant === "ghost" ? colors.borderStrong : "transparent",
          borderWidth: variant === "ghost" ? 1 : 0,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={small ? 16 : 18} color={fg} /> : null}
          <Text style={[styles.label, small && styles.labelSmall, { color: fg }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const useButtonStyles = makeStyles((colors) => ({
  base: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  small: { minHeight: 38, paddingHorizontal: spacing.lg, borderRadius: radius.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  label: { fontFamily: fonts.textMedium, fontSize: 15 },
  labelSmall: { fontSize: 13 },
}));

// ------------------------------- Chip ---------------------------------------
export function Chip({
  label,
  active,
  onPress,
  testID,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={{
        height: 36,
        flexShrink: 0,
        paddingHorizontal: spacing.lg,
        borderRadius: radius.pill,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: active ? colors.brandPrimary : colors.border,
        backgroundColor: active ? colors.brandPrimary : colors.surface,
      }}
    >
      <Text
        style={{
          fontFamily: fonts.textMedium,
          fontSize: 13,
          color: active ? colors.onBrandPrimary : colors.onSurfaceSecondary,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ------------------------------ Avatar --------------------------------------
export function Avatar({
  uri,
  name,
  size = 44,
}: {
  uri?: string | null;
  name?: string;
  size?: number;
}) {
  const { colors } = useTheme();
  const initials = (name ?? "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  if (uri) {
    return (
      <Image
        source={{ uri: mediaUrl(uri) }}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceTertiary }}
        contentFit="cover"
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.brandTertiary,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: fonts.displayMedium, fontSize: size * 0.38, color: colors.onBrandTertiary }}>
        {initials}
      </Text>
    </View>
  );
}

// --------------------------- States -----------------------------------------
export function Loading() {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: spacing["2xl"] }}>
      <ActivityIndicator color={colors.brandPrimary} size="large" />
    </View>
  );
}

export function EmptyState({
  icon = "inbox",
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: "center", justifyContent: "center", padding: spacing["2xl"], gap: spacing.md }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: colors.surfaceSecondary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={28} color={colors.muted} />
      </View>
      <Display size={20} style={{ textAlign: "center" }}>
        {title}
      </Display>
      {message ? (
        <Body size={14} color={colors.muted} style={{ textAlign: "center", maxWidth: 280 }}>
          {message}
        </Body>
      ) : null}
      {action ? <View style={{ marginTop: spacing.sm }}>{action}</View> : null}
    </View>
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.divider }} />;
}
