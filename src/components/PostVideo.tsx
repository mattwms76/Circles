import React, { useEffect, useRef, useState } from 'react';
import { AppState, Dimensions, Pressable, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoThumbnail } from 'expo-video';
import { refreshMediaUrl } from '../lib/media';
import { colors } from '../theme';
import type { PostMedia } from '../types';

export function PostVideo({ media }: { media: PostMedia }) {
  const container = useRef<View>(null);
  const player = useVideoPlayer(media.url);
  const [error, setError] = useState(false),
    [busy, setBusy] = useState(false);
  const [subtitle, setSubtitle] = useState('');
  const [poster, setPoster] = useState<VideoThumbnail | null>(null),
    [started, setStarted] = useState(false);
  const alive = useRef(true),
    renewing = useRef(false),
    generation = useRef(0);
  const retry = async () => {
    if (renewing.current) return;
    renewing.current = true;
    const request = generation.current;
    setBusy(true);
    setError(false);
    try {
      const url = media.storagePath ? await refreshMediaUrl(media.storagePath) : media.url;
      if (alive.current && request === generation.current) await player.replaceAsync(url);
    } catch {
      if (alive.current && request === generation.current) setError(true);
    } finally {
      if (request === generation.current) {
        renewing.current = false;
        if (alive.current) setBusy(false);
      }
    }
  };
  useEffect(() => {
    alive.current = true;
    generation.current++;
    const sourceGeneration = generation.current;
    renewing.current = false;
    setError(false);
    setBusy(false);
    setPoster(null);
    setStarted(false);
    let refreshed = false,
      thumbnailRequested = false;
    const status = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') {
        if (!refreshed && media.storagePath) {
          refreshed = true;
          void retry();
        } else setError(true);
      }
      if (status === 'readyToPlay') {
        setError(false);
        if (!thumbnailRequested) {
          thumbnailRequested = true;
          void player
            .generateThumbnailsAsync(0)
            .then((images) => {
              if (alive.current && sourceGeneration === generation.current)
                setPoster(images[0] ?? null);
            })
            .catch(() => {});
        }
      }
    });
    player.timeUpdateEventInterval = 0.15;
    const time = player.addListener('timeUpdate', ({ currentTime }) => {
      const cue = media.subtitles?.find((c) => currentTime >= c.start && currentTime < c.end);
      if (alive.current) setSubtitle(cue?.text ?? '');
    });
    const app = AppState.addEventListener('change', (state) => {
      if (state !== 'active') player.pause();
    });
    const timer = setInterval(
      () =>
        container.current?.measureInWindow((_x, y, _w, h) => {
          if (alive.current && (y + h <= 0 || y >= Dimensions.get('window').height)) player.pause();
        }),
      600,
    );
    return () => {
      alive.current = false;
      generation.current++;
      status.remove();
      time.remove();
      app.remove();
      clearInterval(timer);
    };
  }, [player, media.storagePath, media.url, media.subtitles]);
  return (
    <View ref={container} style={{ borderRadius: 16, overflow: 'hidden' }}>
      <VideoView
        player={player}
        style={{ width: '100%', height: 230 }}
        contentFit="cover"
        nativeControls
        fullscreenOptions={{ enable: true }}
      />
      {!started && !error ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Play video"
          onPress={() => {
            setStarted(true);
            player.play();
          }}
          style={{
            position: 'absolute',
            inset: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surface,
          }}
        >
          {media.coverUrl || poster ? (
            <Image
              source={media.coverUrl ? { uri: media.coverUrl } : poster}
              style={{ position: 'absolute', inset: 0 }}
              contentFit="cover"
            />
          ) : null}
          <Text
            style={{
              padding: 16,
              borderRadius: 30,
              backgroundColor: colors.ink,
              color: colors.paper,
            }}
          >
            ▶ Play video
          </Text>
        </Pressable>
      ) : null}
      {subtitle && started ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', bottom: 42, left: 12, right: 12, alignItems: 'center' }}
        >
          <Text
            style={{
              backgroundColor: colors.night,
              color: colors.onPrimary,
              fontSize: 16,
              lineHeight: 24,
              padding: 6,
              borderRadius: 6,
              textAlign: 'center',
            }}
          >
            {subtitle}
          </Text>
        </View>
      ) : null}
      {error || busy ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void retry()}
          style={{ padding: 16, backgroundColor: colors.surface }}
        >
          <Text style={{ color: colors.ink }}>
            {busy ? 'Reconnecting…' : 'Video unavailable · Tap to retry'}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
