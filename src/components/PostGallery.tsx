import React, { useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { PostVideo } from './PostVideo';
import { colors } from '../theme';
import type { PostMedia } from '../types';
export function PostGallery({ items }: { items: PostMedia[] }) {
  const [width, setWidth] = useState(0),
    [page, setPage] = useState(0);
  if (items[0]?.kind === 'video') return <PostVideo media={items[0]} />;
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ gap: 6 }}>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={(e) => {
          if (width) setPage(Math.round(e.nativeEvent.contentOffset.x / width));
        }}
      >
        {items.map((m, i) => (
          <Image
            key={m.id}
            accessibilityLabel={`Photo ${i + 1} of ${items.length}`}
            source={{ uri: m.url }}
            style={{ width: width || 280, height: 250, borderRadius: 16 }}
            resizeMode="cover"
          />
        ))}
      </ScrollView>
      {items.length > 1 ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.muted, fontSize: 14, textAlign: 'center' }}
        >
          {page + 1} / {items.length} · Swipe for more photos
        </Text>
      ) : null}
    </View>
  );
}
