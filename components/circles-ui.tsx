import { controlAccessibilityProps } from "../lib/control-accessibility";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextProps,
  type ViewStyle,
} from "react-native";
import { Image } from "@/components/media-image";
import { Ionicons } from "@expo/vector-icons";
import Svg, { Circle as SvgCircle } from "react-native-svg";
import {
  buttonVisualTokens,
  UI_ACCESSIBLE_COLORS,
} from "@/lib/ui-accessibility";
import { LiveAvatarRing } from "@/components/live-avatar-ring";

export const C = {
  bg: "#F9F8F5",
  paper: "#FFFFFF",
  ink: "#242825",
  /** Accessible ordinary-copy default; decorative low-contrast colors stay explicit. */
  muted: UI_ACCESSIBLE_COLORS.secondary,
  secondary: UI_ACCESSIBLE_COLORS.secondary,
  border: "#E8E9E2",
  coral: "#ED604A",
  action: UI_ACCESSIBLE_COLORS.action,
  actionPressed: UI_ACCESSIBLE_COLORS.actionPressed,
  actionDisabled: UI_ACCESSIBLE_COLORS.actionDisabled,
  actionText: UI_ACCESSIBLE_COLORS.actionText,
  soft: "#FFF0EB",
  sage: "#E9EEE5",
  green: "#718569",
};
export type IconName = React.ComponentProps<typeof Ionicons>["name"];
export function Icon({
  name,
  size = 22,
  color = C.ink,
}: {
  name: IconName;
  size?: number;
  color?: string;
}) {
  return <Ionicons name={name} size={size} color={color} />;
}
export function T({ style, ...props }: TextProps) {
  const resolved = StyleSheet.flatten(style) || {};
  const fontSize = Math.max(12, resolved.fontSize ?? 14);
  const lineHeight = Math.max(
    resolved.lineHeight ?? 21,
    Math.ceil(fontSize * 1.35),
  );
  return (
    <Text
      {...props}
      style={[{ color: C.ink, flexShrink: 1 }, style, { fontSize, lineHeight }]}
    />
  );
}

export function Heading({
  level = 1,
  ...props
}: TextProps & { level?: 1 | 2 | 3 }) {
  return (
    <T {...props} accessibilityRole="header" {...{ "aria-level": level }} />
  );
}
export function Logo({
  size = 35,
  color = C.coral,
}: {
  size?: number;
  color?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 44 44">
      <SvgCircle
        cx="17"
        cy="17"
        r="11"
        fill="none"
        stroke={color}
        strokeWidth="4.2"
      />
      <SvgCircle
        cx="28"
        cy="28"
        r="11"
        fill="none"
        stroke={color}
        strokeWidth="4.2"
      />
    </Svg>
  );
}
export function Wordmark() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Logo />
      <T
        style={{
          fontSize: 32,
          lineHeight: 40,
          letterSpacing: -1.7,
          fontWeight: "800",
        }}
      >
        circles<T style={{ color: C.coral, fontSize: 34 }}>.</T>
      </T>
    </View>
  );
}
export type AvatarProps = {
  uri?: string | null;
  name?: string;
  size?: number;
  ring?: boolean;
  /** Decorative live state supplied by the identity-aware UserAvatar wrapper. */
  live?: boolean;
  /** Stops the decorative animation while the application is backgrounded. */
  livePulse?: boolean;
};

function avatarFallback(name: string, size: number) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size,
        backgroundColor: C.sage,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <T
        style={{
          fontWeight: "700",
          color: C.secondary,
          fontSize: size * 0.34,
        }}
      >
        {name.slice(0, 1).toUpperCase() || "C"}
      </T>
    </View>
  );
}

export function Avatar({
  uri,
  name = "",
  size = 40,
  ring = false,
  live = false,
  livePulse = false,
}: AvatarProps) {
  return (
    <View
      style={{
        width: size + (ring ? 8 : 0),
        height: size + (ring ? 8 : 0),
        borderRadius: size,
        borderWidth: ring ? 1.7 : 0,
        borderColor: C.coral,
        padding: ring ? 2.3 : 0,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size }}
          contentFit="cover"
          transition={180}
          fallback={avatarFallback(name, size)}
        />
      ) : (
        avatarFallback(name, size)
      )}
      <LiveAvatarRing
        size={size + (ring ? 8 : 0)}
        live={live}
        animate={livePulse}
        inset={ring ? 4 : 0}
      />
    </View>
  );
}
export function Button({
  title,
  accessibilityLabel,
  onPress,
  icon,
  secondary = false,
  loading = false,
  disabled = false,
  style,
}: {
  title: string;
  accessibilityLabel?: string;
  onPress: () => void;
  icon?: IconName;
  secondary?: boolean;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  const isDisabled = disabled || loading;
  const restingTokens = buttonVisualTokens({
    secondary,
    disabled,
    loading,
    pressed: false,
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      {...controlAccessibilityProps({ disabled: isDisabled, busy: loading })}
      disabled={isDisabled}
      onPress={() => {
        if (!isDisabled) onPress();
      }}
      style={({ pressed }) => {
        const visual = buttonVisualTokens({
          secondary,
          disabled,
          loading,
          pressed,
        });
        return [
          {
            backgroundColor: visual.backgroundColor,
            borderRadius: 14,
            paddingHorizontal: 18,
            paddingVertical: 13,
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "row",
            gap: 8,
            borderWidth: secondary ? 1 : 0,
            borderColor: visual.borderColor ?? C.border,
          },
          style,
          { minHeight: 48 },
        ];
      }}
    >
      {loading ? (
        <ActivityIndicator color={restingTokens.foregroundColor} />
      ) : (
        <>
          {icon && (
            <Icon name={icon} size={18} color={restingTokens.foregroundColor} />
          )}
          <T
            style={{ color: restingTokens.foregroundColor, fontWeight: "700" }}
          >
            {title}
          </T>
        </>
      )}
    </Pressable>
  );
}
export function IconButton({
  icon,
  onPress,
  size = 22,
  color = C.ink,
  badge,
  style,
  label,
  disabled = false,
  loading = false,
}: {
  icon: IconName;
  onPress: () => void;
  size?: number;
  color?: string;
  badge?: boolean;
  style?: ViewStyle;
  label?: string;
  disabled?: boolean;
  loading?: boolean;
}) {
  const isDisabled = disabled || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label || icon}
      {...controlAccessibilityProps({ disabled: isDisabled, busy: loading })}
      disabled={isDisabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        {
          padding: 8,
          borderRadius: 30,
          opacity: isDisabled ? 0.5 : pressed ? 0.5 : 1,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
        { minWidth: 44, minHeight: 44 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <Icon name={icon} size={size} color={color} />
      )}
      {badge && (
        <View
          style={{
            position: "absolute",
            top: 6,
            right: 7,
            width: 6,
            height: 6,
            backgroundColor: C.coral,
            borderRadius: 4,
            borderWidth: 1,
            borderColor: C.bg,
          }}
        />
      )}
    </Pressable>
  );
}
export function Pill({
  title,
  selected,
  onPress,
  icon,
}: {
  title: string;
  selected?: boolean;
  onPress: () => void;
  icon?: IconName;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      {...controlAccessibilityProps({ selected: !!selected })}
      style={({ pressed }) => [
        {
          paddingHorizontal: 15,
          paddingVertical: 9,
          minHeight: 44,
          borderRadius: 24,
          backgroundColor: selected ? C.ink : C.paper,
          borderWidth: 1,
          borderColor: selected ? C.ink : C.border,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {icon && (
        <Icon name={icon} size={15} color={selected ? "#fff" : C.secondary} />
      )}
      <T
        style={{
          fontSize: 12,
          fontWeight: "600",
          lineHeight: 18,
          color: selected ? "#fff" : C.secondary,
        }}
      >
        {title}
      </T>
    </Pressable>
  );
}
export type InputProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  label?: string;
  secureTextEntry?: boolean;
  accessibilityLabel?: string;
  style?: React.ComponentPropsWithoutRef<typeof TextInput>["style"];
} & Omit<
  React.ComponentPropsWithoutRef<typeof TextInput>,
  | "value"
  | "onChangeText"
  | "placeholder"
  | "multiline"
  | "secureTextEntry"
  | "accessibilityLabel"
  | "style"
>;

export const Input = React.forwardRef<TextInput, InputProps>(function Input(
  {
    value,
    onChangeText,
    placeholder,
    multiline,
    label,
    secureTextEntry,
    accessibilityLabel,
    style,
    ...inputProps
  },
  ref,
) {
  const resolvedAccessibilityLabel = accessibilityLabel ?? label ?? placeholder;
  return (
    <View style={{ gap: 7 }}>
      {label && (
        <T style={{ fontSize: 12, fontWeight: "700", color: C.secondary }}>
          {label}
        </T>
      )}
      <TextInput
        ref={ref}
        {...inputProps}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        accessibilityLabel={resolvedAccessibilityLabel}
        placeholderTextColor={inputProps.placeholderTextColor ?? C.secondary}
        multiline={multiline}
        secureTextEntry={secureTextEntry}
        style={[
          {
            backgroundColor: C.bg,
            padding: 14,
            borderWidth: 1,
            borderColor: C.border,
            borderRadius: 12,
            color: C.ink,
            fontSize: 16,
            lineHeight: 22,
            minHeight: multiline ? 110 : 48,
            textAlignVertical: multiline ? "top" : "center",
          },
          style,
        ]}
      />
    </View>
  );
});
export function Empty({
  icon = "planet-outline",
  title,
  text,
  action,
  onAction,
  actionLoading = false,
  actionDisabled = false,
  headingLevel = 1,
}: {
  icon?: IconName;
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
  actionLoading?: boolean;
  actionDisabled?: boolean;
  headingLevel?: 1 | 2 | 3;
}) {
  return (
    <View
      style={{
        alignItems: "center",
        paddingVertical: 32,
        paddingHorizontal: 16,
        gap: 12,
      }}
    >
      <View
        style={{
          width: 66,
          height: 66,
          borderRadius: 33,
          backgroundColor: C.soft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={28} color={C.coral} />
      </View>
      <Heading
        level={headingLevel}
        style={{ fontSize: 19, fontWeight: "700", textAlign: "center" }}
      >
        {title}
      </Heading>
      <T style={{ color: C.secondary, textAlign: "center", maxWidth: 330 }}>
        {text}
      </T>
      {action && onAction && (
        <Button
          title={action}
          onPress={onAction}
          loading={actionLoading}
          disabled={actionDisabled}
          style={{ marginTop: 8 }}
        />
      )}
    </View>
  );
}
export function Loading() {
  return (
    <View style={{ paddingVertical: 45, alignItems: "center", gap: 12 }}>
      <ActivityIndicator color={C.coral} />
      <T style={{ color: C.secondary, fontSize: 12 }}>
        Bringing your world together…
      </T>
    </View>
  );
}
export const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  card: {
    backgroundColor: C.paper,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 18,
  },
  title: {
    fontSize: 29,
    lineHeight: 36,
    fontWeight: "800",
    letterSpacing: -1.2,
  },
  eyebrow: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    letterSpacing: 1.1,
    color: C.muted,
  },
  divider: { height: 1, backgroundColor: C.border },
});
export const photo = {
  mountains:
    "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/ZgGJzfWyY9fwJoZLPkvxrP.jpg",
  lake: "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/zbRoFfVCeGtCAfdL7AfjC.jpg",
  coffee:
    "https://files.manuscdn.com/search-media/310519663989254838/h8FkA94wGqT5j3lFnFB1M8/VNHqQTYTLh8nDJ2u4aeb8i.jpeg",
};
export function ago(date: string) {
  const minutes = Math.max(
    1,
    Math.floor((Date.now() - new Date(date).getTime()) / 60000),
  );
  return minutes < 60
    ? `${minutes}m`
    : minutes < 1440
      ? `${Math.floor(minutes / 60)}h`
      : `${Math.floor(minutes / 1440)}d`;
}
