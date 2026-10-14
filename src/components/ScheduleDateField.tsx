import React, { useState } from 'react';
import { Alert, Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { createEventInCalendarAsync } from 'expo-calendar/legacy';
import { colors, typography } from '../theme';

export function ScheduleDateField({
  value,
  onChangeText,
}: {
  value: string;
  onChangeText: (value: string) => void;
}) {
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  const parsed = new Date(value.replace(' ', 'T'));
  const date = Number.isFinite(parsed.getTime()) ? parsed : new Date(Date.now() + 3600000);
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ ...typography.body, color: colors.ink, fontWeight: '600' }}>
        Date and time
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {(['date', 'time'] as const).map((kind) => (
          <Pressable
            key={kind}
            accessibilityRole="button"
            accessibilityLabel={`Choose ${kind}`}
            onPress={() => setMode(kind)}
            style={{
              padding: 12,
              minHeight: 48,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 14,
            }}
          >
            <Text style={{ ...typography.body, color: colors.ink }}>
              {kind === 'date'
                ? date.toLocaleDateString()
                : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </Pressable>
        ))}
      </View>
      {mode ? (
        <DateTimePicker
          value={date}
          mode={mode}
          minimumDate={mode === 'date' ? new Date() : undefined}
          onChange={(event, selected) => {
            if (Platform.OS !== 'ios') setMode(null);
            if (event.type === 'set' && selected) onChangeText(selected.toISOString());
          }}
        />
      ) : null}
      {mode && Platform.OS === 'ios' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (!value) onChangeText(date.toISOString());
            setMode(null);
          }}
        >
          <Text style={{ ...typography.body, color: colors.coral, padding: 12, minHeight: 48 }}>
            Done
          </Text>
        </Pressable>
      ) : null}
      <Text style={{ ...typography.body, color: colors.muted }}>
        {value ? date.toLocaleString() : 'Choose a future date and time'} ·{' '}
        {Intl.DateTimeFormat().resolvedOptions().timeZone}
      </Text>
    </View>
  );
}
export function AddToCalendar({
  title,
  startsAt,
  description,
}: {
  title: string;
  startsAt: string;
  description?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        const startDate = new Date(startsAt);
        void createEventInCalendarAsync({
          title,
          startDate,
          endDate: new Date(startDate.getTime() + 3600000),
          notes: description,
        }).catch(() =>
          Alert.alert('Calendar unavailable', 'Please try again on a device with a calendar app.'),
        );
      }}
      style={{ minHeight: 48, justifyContent: 'center' }}
    >
      <Text style={{ ...typography.body, color: colors.coral, fontWeight: '600' }}>
        Add to calendar
      </Text>
    </Pressable>
  );
}
