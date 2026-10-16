import React from 'react';
import { Text, View } from 'react-native';
import { colors } from '../theme';
export function LoadingCards() {
  return (
    <View
      accessibilityLabel="Loading content"
      accessibilityRole="progressbar"
      style={{ padding: 20, gap: 16 }}
    >
      <Text style={{ color: colors.muted, fontSize: 14 }}>Gathering your conversations…</Text>
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ height: 110, borderRadius: 20, backgroundColor: colors.line }} />
      ))}
    </View>
  );
}
