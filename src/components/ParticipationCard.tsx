import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useCommunity } from './CommunityContext';
import { loadPoll, castVote } from '../lib/communityDepth';
import { supabase } from '../lib/supabase';
import { colors } from '../theme';
export function ParticipationCard({ postId }: { postId: string }) {
  const ctx = useCommunity(),
    [poll, setPoll] = useState<Awaited<ReturnType<typeof loadPoll>> | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [tick, setTick] = useState(0);
  const request = useRef(0),
    votePending = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setPoll(null);
    setError('');
  }, [postId, ctx?.profile.id]);
  useEffect(() => {
    let active = true;
    const load = () => {
      const currentRequest = ++request.current;
      if (ctx)
        void loadPoll(ctx.profile.id, postId)
          .then((p) => {
            if (active && currentRequest === request.current) {
              setPoll(p);
              setError('');
            }
          })
          .catch((e) => {
            if (active && currentRequest === request.current) setError(e.message);
          });
    };
    load();
    const channel = supabase
      ?.channel(`poll:${postId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'poll_votes', filter: `post_id=eq.${postId}` },
        load,
      )
      .subscribe();
    const interval = setInterval(() => {
      load();
    }, 30000);
    return () => {
      active = false;
      clearInterval(interval);
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [postId, ctx?.profile.id, tick]);
  if (!ctx) return null;
  const mine = poll?.votes.find((v) => v.user_id === ctx.profile.id)?.option_index,
    closed = !!poll?.closes_at && Date.parse(poll.closes_at) <= Date.now();
  const vote = async (index: number | null) => {
    if (votePending.current || (poll?.closes_at && Date.parse(poll.closes_at) <= Date.now()))
      return;
    votePending.current = true;
    setBusy(true);
    setError('');
    try {
      await castVote(ctx.profile.id, postId, index);
      if (alive.current) setTick((v) => v + 1);
    } catch (e) {
      if (alive.current) setError((e as any)?.message ?? 'Could not update your vote.');
    } finally {
      votePending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <View style={{ gap: 8, marginVertical: 8 }}>
      {poll?.options.map((option, i) => {
        const count = poll.votes.filter((v) => v.option_index === i).length,
          total = poll.votes.length,
          percent = total ? Math.round((count / total) * 100) : 0;
        return (
          <Pressable
            key={i}
            disabled={busy || closed}
            accessibilityRole="button"
            accessibilityLabel={`${option}, ${percent} percent`}
            accessibilityState={{ selected: mine === i, disabled: busy || closed }}
            onPress={() => void vote(i)}
            style={{
              minHeight: 48,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: mine === i ? colors.coral : colors.line,
              overflow: 'hidden',
              padding: 12,
            }}
          >
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                bottom: 0,
                width: `${percent}%`,
                backgroundColor: colors.surface,
              }}
            />
            <Text style={{ color: colors.ink, fontSize: 16, lineHeight: 24 }}>
              {mine === i ? '✓ ' : ''}
              {option} · {percent}%
            </Text>
          </Pressable>
        );
      })}
      <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>
        {poll?.votes.length ?? 0} votes ·{' '}
        {closed
          ? 'Poll closed'
          : poll?.closes_at
            ? `Closes ${new Date(poll.closes_at).toLocaleDateString()}`
            : 'One vote per member'}
      </Text>
      {mine !== undefined && !closed ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void vote(null)}
          style={{ minHeight: 48, padding: 12 }}
        >
          <Text style={{ color: colors.coral }}>Remove my vote</Text>
        </Pressable>
      ) : null}
      {error ? (
        <Pressable accessibilityRole="button" onPress={() => setTick((v) => v + 1)}>
          <Text style={{ color: colors.error }}>{error} · Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
