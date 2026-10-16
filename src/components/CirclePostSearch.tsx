import { usePostActions } from './PostActions';
import React, { useEffect, useState } from 'react';
import { Text, TextInput, View, Pressable } from 'react-native';
import { searchCirclePosts } from '../lib/repositories';
import { colors } from '../theme';
import type { CirclePost } from '../types';
export function useCirclePostSearch(circleId: string) {
  const revision = usePostActions()?.revision ?? 0;
  const [text, setText] = useState(''),
    [media, setMedia] = useState<'all' | 'image' | 'video'>('all'),
    [limit, setLimit] = useState(20),
    [rows, setRows] = useState<CirclePost[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [more, setMore] = useState(false);
  const active = !!text.trim() || media !== 'all';
  useEffect(() => {
    setText('');
    setMedia('all');
    setLimit(20);
    setRows([]);
  }, [circleId]);
  useEffect(() => {
    setLimit(20);
  }, [text, media]);
  useEffect(() => {
    let current = true;
    setRows([]);
    setError('');
    setMore(false);
    if (!active) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found: CirclePost[] = [];
          let page: CirclePost[] = [];
          for (let offset = 0; offset < limit; offset += 20) {
            page = await searchCirclePosts(circleId, text, media, offset);
            if (!current) return;
            found.push(...page);
            if (page.length < 20) break;
          }
          if (current) {
            setRows(found);
            setMore(page.length === 20);
          }
        } catch {
          if (current) setError('Search unavailable. Change a filter or try again.');
        } finally {
          if (current) setLoading(false);
        }
      })();
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [circleId, text, media, limit, active, revision]);
  return {
    text,
    setText,
    media,
    setMedia,
    rows,
    loading,
    error,
    more,
    active,
    loadMore: () => setLimit((v) => v + 20),
  };
}
export function CirclePostSearch({ search }: { search: ReturnType<typeof useCirclePostSearch> }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={{ gap: 8, marginVertical: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={{ minHeight: 48, justifyContent: 'center' }}
      >
        <Text style={{ color: colors.coral, fontSize: 16 }}>
          Search and filters{search.active ? ' · Active' : ''} {expanded ? '−' : '+'}
        </Text>
      </Pressable>
      {expanded ? (
        <>
          <TextInput
            accessibilityLabel="Search posts in this circle"
            placeholder="Search this circle’s posts"
            placeholderTextColor={colors.muted}
            value={search.text}
            onChangeText={search.setText}
            style={{
              padding: 12,
              fontSize: 16,
              minHeight: 48,
              color: colors.ink,
              borderWidth: 1,
              borderColor: colors.line,
              borderRadius: 12,
            }}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(['all', 'image', 'video'] as const).map((kind) => (
              <Pressable
                key={kind}
                accessibilityRole="button"
                accessibilityState={{ selected: kind === search.media }}
                onPress={() => search.setMedia(kind)}
                style={{
                  padding: 12,
                  borderRadius: 20,
                  backgroundColor: kind === search.media ? colors.ink : colors.surface,
                }}
              >
                <Text
                  style={{
                    fontSize: 14,
                    lineHeight: 20,
                    color: kind === search.media ? colors.paper : colors.ink,
                  }}
                >
                  {kind === 'all' ? 'All posts' : kind === 'image' ? 'Photos' : 'Videos'}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      {search.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {search.error}
        </Text>
      ) : null}
    </View>
  );
}
