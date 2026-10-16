import React from 'react';
import { Pressable, Text, View, useWindowDimensions, type TextProps } from 'react-native';
import { colors, typography, radii } from '../theme';
import { Icon, type IconName } from './Icon';

export type SettingsDestination = 'notifications' | 'safety' | 'catchup';
export function useCompactLayout() {
  const { width, height, fontScale } = useWindowDimensions();
  return { compact: width < 360 || fontScale > 1.2, largeText: fontScale > 1.2, height };
}
export function AppText({
  variant = 'body',
  style,
  ...props
}: TextProps & { variant?: keyof typeof typography }) {
  return <Text {...props} style={[{ color: colors.ink }, typography[variant], style]} />;
}
export function NavigationRow({
  label,
  detail,
  icon,
  onPress,
}: {
  label: string;
  detail?: string;
  icon: IconName;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 56,
        paddingVertical: 12,
        gap: 12,
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 1,
        borderColor: colors.line,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      <Icon name={icon} color={colors.coral} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <AppText variant="body" style={{ fontWeight: '600' }}>
          {label}
        </AppText>
        {detail ? (
          <AppText variant="secondary" style={{ color: colors.muted }}>
            {detail}
          </AppText>
        ) : null}
      </View>
      <Icon name="forward" color={colors.muted} />
    </Pressable>
  );
}
export function InlineNotice({
  children,
  tone = 'info',
  onRetry,
}: {
  children: React.ReactNode;
  tone?: 'info' | 'error' | 'success';
  onRetry?: () => void;
}) {
  const color =
    tone === 'error' ? colors.error : tone === 'success' ? colors.success : colors.muted;
  return (
    <View
      style={{
        padding: 12,
        borderLeftWidth: 3,
        borderColor: color,
        borderRadius: radii.small,
        backgroundColor: colors.surface,
        gap: 8,
      }}
    >
      <Text
        accessibilityRole={tone === 'error' ? 'alert' : undefined}
        accessibilityLiveRegion="polite"
        style={[typography.secondary, { color }]}
      >
        {children}
      </Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={onRetry}
          style={{ minHeight: 48, justifyContent: 'center' }}
        >
          <AppText variant="secondary" style={{ color: colors.coral, fontWeight: '600' }}>
            Try again
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
