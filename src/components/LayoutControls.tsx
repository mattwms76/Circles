import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors, createThemedStyles } from '../theme';
import { Icon, type IconName } from './Primitives';
import { useCompactLayout } from './Design';

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  const { largeText } = useCompactLayout();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={[styles.segments, largeText && { flexBasis: '100%' }]}
    >
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="tab"
          accessibilityLabel={option.label}
          accessibilityState={{ selected: value === option.value }}
          onPress={() => onChange(option.value)}
          style={[styles.segment, value === option.value && styles.selected]}
        >
          <Text
            style={[
              styles.segmentText,
              value === option.value && { color: colors.coral, fontWeight: '700' },
            ]}
          >
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function MediaChoices({
  choices,
  disabled = false,
}: {
  choices: { label: string; icon: IconName; onPress: () => void; disabled?: boolean }[];
  disabled?: boolean;
}) {
  const { largeText } = useCompactLayout();
  return (
    <View style={styles.mediaGrid}>
      {choices.map((choice) => (
        <View key={choice.label} style={[styles.mediaCell, largeText && { width: '100%' }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={choice.label}
            disabled={disabled || choice.disabled}
            accessibilityState={{ disabled: Boolean(disabled || choice.disabled) }}
            onPress={choice.onPress}
            style={[styles.mediaChoice, (disabled || choice.disabled) && { opacity: 0.45 }]}
          >
            <Icon name={choice.icon} color={colors.coral} />
            <Text style={styles.mediaText}>{choice.label}</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = createThemedStyles(() => ({
  segments: { flexDirection: 'row', flexWrap: 'wrap', flex: 1, minWidth: 0, gap: 4 },
  segment: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 2,
    borderColor: 'transparent',
    flexShrink: 0,
  },
  selected: { borderColor: colors.coral },
  segmentText: { color: colors.muted, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  mediaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  mediaCell: { width: '50%', padding: 4 },
  mediaChoice: {
    minHeight: 56,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.controlBorder,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mediaText: {
    flex: 1,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: colors.ink,
  },
}));
