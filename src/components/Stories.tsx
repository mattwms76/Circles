import { inspectPickedMedia } from '../lib/pickedMedia';
import { readStringList } from '../lib/localData';
import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  AppState,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Sheet } from './Sheet';
import { ActionButton, Pill } from './Primitives';
import { TextInput } from 'react-native';
import { colors, createThemedStyles, typography, useReducedMotion } from '../theme';
import { createIdempotencyKey } from '../lib/repositories';
import {
  activeStories,
  STORY_TTL_MS,
  validateStoryMedia,
  type StoryMedia,
} from '../lib/storyRules';
import { loadStories, publishStory, removeStory, storyUrl, type Story } from '../lib/stories';
import type { Circle, Profile } from '../types';

function StoryRing({
  children,
  seen,
  animate,
}: {
  children: React.ReactNode;
  seen: boolean;
  animate: boolean;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    pulse.setValue(0);
    if (!animate) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      pulse.setValue(0);
    };
  }, [animate, pulse]);
  return (
    <View style={[s.ring, seen && { borderColor: colors.line }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          s.halo,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.65, 0] }),
            transform: [
              { scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) },
            ],
          },
        ]}
      />
      {children}
    </View>
  );
}

function StoryVideo({ uri, paused, onEnd }: { uri: string; paused: boolean; onEnd: () => void }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (paused) player.pause();
    else player.play();
  }, [player, paused]);
  useEffect(() => {
    const end = player.addListener('playToEnd', onEnd);
    const status = player.addListener('statusChange', (e) => setFailed(e.status === 'error'));
    return () => {
      end.remove();
      status.remove();
    };
  }, [player, onEnd]);
  return (
    <View style={{ flex: 1 }}>
      <VideoView player={player} nativeControls contentFit="contain" style={{ flex: 1 }} />
      {failed ? (
        <Text style={s.error}>Video unavailable. Close and reopen the story to retry.</Text>
      ) : null}
    </View>
  );
}
export function Stories({
  profile,
  circles,
  connected,
  enabled,
  refreshing,
  scope,
}: {
  profile: Profile;
  circles: Circle[];
  connected: boolean;
  enabled: boolean;
  refreshing: boolean;
  scope?: string;
}) {
  const [stories, setStories] = useState<Story[]>([]),
    [seen, setSeen] = useState<string[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [more, setMore] = useState(false);
  const [compose, setCompose] = useState(false),
    [circleId, setCircleId] = useState(''),
    [caption, setCaption] = useState(''),
    [media, setMedia] = useState<StoryMedia | null>(null),
    [requestId, setRequestId] = useState(createIdempotencyKey),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0);
  const [selected, setSelected] = useState<string | null>(null),
    [url, setUrl] = useState(''),
    [paused, setPaused] = useState(false),
    [foreground, setForeground] = useState(true),
    [elapsed, setElapsed] = useState(0),
    [viewerError, setViewerError] = useState(''),
    [imageReady, setImageReady] = useState(false);
  const reduced = useReducedMotion(),
    alive = useRef(true),
    epoch = useRef(0),
    submitting = useRef(false),
    picking = useRef<symbol | null>(null),
    controller = useRef<AbortController | null>(null);
  const members = circles.filter((c) => c.isMember),
    visible = activeStories(stories).filter((st) => members.some((c) => c.id === st.circleId));
  const current = visible.find((st) => st.id === selected),
    index = visible.findIndex((st) => st.id === selected);
  const seenKey = `circles:experience:${profile.id}:seen-stories`,
    demoKey = `circles:experience:${profile.id}:demo-stories`;
  useEffect(() => {
    const nextExpiry = Math.min(
      ...activeStories(stories).map((story) =>
        Math.min(Date.parse(story.expiresAt), Date.parse(story.createdAt) + STORY_TTL_MS),
      ),
    );
    if (!Number.isFinite(nextExpiry)) return;
    const timeout = setTimeout(
      () => setStories((old) => activeStories(old)),
      Math.max(0, nextExpiry - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [stories]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      epoch.current++;
      controller.current?.abort();
    };
  }, []);
  async function refresh(append = false) {
    const generation = ++epoch.current;
    setLoading(true);
    try {
      const rows = connected
        ? await loadStories(append ? stories.length : 0, scope)
        : activeStories(JSON.parse((await AsyncStorage.getItem(demoKey)) || '[]') as Story[]);
      if (!alive.current || generation !== epoch.current) return;
      setStories((old) =>
        append ? [...new Map([...old, ...rows].map((st) => [st.id, st])).values()] : rows,
      );
      setMore(connected && rows.length === 40);
      setError('');
    } catch (e) {
      if (alive.current && generation === epoch.current)
        setError(e instanceof Error ? e.message : 'Could not load stories.');
    } finally {
      if (alive.current && generation === epoch.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (enabled) void refresh();
    else {
      epoch.current++;
      setStories([]);
      setLoading(false);
    }
  }, [enabled, connected, refreshing, circles, scope]);
  useEffect(() => {
    void AsyncStorage.getItem(seenKey)
      .then((raw) => {
        if (alive.current) setSeen(readStringList(raw));
      })
      .catch(() => {});
    const timer = setInterval(() => {
      setStories((old) => activeStories(old));
      if (enabled) void refresh();
    }, 60000);
    const sub = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state === 'active' && enabled) void refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [enabled, connected, scope, seenKey]);
  function open(st: Story) {
    setPaused(false);
    setElapsed(0);
    setViewerError('');
    setSelected(st.id);
    setSeen((old) => {
      const next = [...new Set([...old, st.id])].slice(-1000);
      void AsyncStorage.setItem(seenKey, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }
  function advance(delta: number) {
    const next = visible[index + delta];
    if (next) open(next);
    else setSelected(null);
  }
  useEffect(() => {
    setUrl('');
    setImageReady(false);
    setViewerError('');
    if (!current) return;
    let active = true;
    void (connected ? storyUrl(current) : Promise.resolve(current.storagePath))
      .then((value) => {
        if (active) setUrl(value);
      })
      .catch((e) => {
        if (active) setViewerError(e.message);
      });
    return () => {
      active = false;
    };
  }, [selected, connected]);
  useEffect(() => {
    if (selected && !current) setSelected(null);
  }, [current, selected]);
  useEffect(() => {
    if (!current) return;
    const timer = setInterval(() => {
      if (Date.now() >= Date.parse(current.expiresAt)) {
        setSelected(null);
        void refresh();
        return;
      }
      if (
        current.kind === 'image' &&
        imageReady &&
        url &&
        !paused &&
        foreground &&
        !reduced &&
        !viewerError
      )
        setElapsed((value) => value + 0.25);
    }, 250);
    return () => clearInterval(timer);
  }, [current, url, paused, foreground, reduced, viewerError, imageReady]);
  useEffect(() => {
    if (elapsed >= 6) advance(1);
  }, [elapsed]);
  async function pick(kind: 'image' | 'video', camera = false) {
    if (picking.current || submitting.current) return;
    const token = Symbol();
    picking.current = token;
    const current = () => alive.current && picking.current === token;
    setError('');
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!current()) return;
        if (!permission.granted)
          throw new Error(
            'Allow camera access in device settings, or choose a file from your library.',
          );
      }
      const options = {
        mediaTypes:
          kind === 'video'
            ? (['videos'] as ImagePicker.MediaType[])
            : (['images'] as ImagePicker.MediaType[]),
        quality: 0.8,
        videoMaxDuration: 60,
        videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
      };
      const result = camera
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
      if (!current() || result.canceled || !result.assets[0]) return;
      const asset = result.assets[0],
        inspected = await inspectPickedMedia(asset, kind, 60);
      if (!current()) return;
      const next: StoryMedia = {
        uri: asset.uri,
        kind,
        ...inspected,
      };
      validateStoryMedia(next);
      setMedia(next);
      setRequestId(createIdempotencyKey());
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : 'Could not open media.');
    } finally {
      if (picking.current === token) picking.current = null;
    }
  }
  async function publish() {
    if (picking.current || submitting.current || !media || !members.some((c) => c.id === circleId))
      return;
    submitting.current = true;
    setBusy(true);
    setError('');
    setProgress(0);
    controller.current = new AbortController();
    try {
      if (connected)
        await publishStory(
          profile.id,
          circleId,
          requestId,
          caption,
          media,
          (v) => {
            if (alive.current) setProgress(v);
          },
          controller.current.signal,
        );
      else {
        const dir = `${FileSystem.documentDirectory}demo-stories/${profile.id}/`;
        await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
        const extensions: Record<string, string> = {
          'video/mp4': 'mp4',
          'video/quicktime': 'mov',
          'video/webm': 'webm',
          'image/jpeg': 'jpg',
          'image/png': 'png',
          'image/webp': 'webp',
        };
        const path = `${dir}${requestId}.${extensions[media.mimeType]}`;
        await FileSystem.copyAsync({ from: media.uri, to: path });
        const story: Story = {
          id: requestId,
          circleId,
          circleName: members.find((c) => c.id === circleId)!.name,
          authorId: profile.id,
          authorName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          caption: caption.trim(),
          kind: media.kind,
          storagePath: path,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + STORY_TTL_MS).toISOString(),
          duration: media.duration,
        };
        await AsyncStorage.setItem(
          demoKey,
          JSON.stringify([story, ...activeStories(stories).filter((st) => st.id !== requestId)]),
        );
      }
      if (alive.current) {
        setCompose(false);
        setMedia(null);
        setCaption('');
        setRequestId(createIdempotencyKey());
        await refresh();
      }
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : 'Could not publish. Retry your upload.');
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function erase(story: Story) {
    try {
      if (connected) await removeStory(story);
      else {
        await AsyncStorage.setItem(
          demoKey,
          JSON.stringify(stories.filter((st) => st.id !== story.id)),
        );
        await FileSystem.deleteAsync(story.storagePath, { idempotent: true });
      }
      if (alive.current) {
        setSelected(null);
        await refresh();
      }
    } catch (e) {
      setViewerError(e instanceof Error ? e.message : 'Could not delete story.');
    }
  }
  return (
    <View style={s.tray}>
      <View style={s.row}>
        <Text style={s.title}>Circle stories</Text>
        <Text style={s.hint}>24 hours</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add story"
          style={s.tile}
          onPress={() => {
            if (!enabled) {
              Alert.alert('Sign in to share stories');
              return;
            }
            if (!members.length) {
              Alert.alert('Join a circle first', 'Stories are shared with your circle members.');
              return;
            }
            setCircleId(members[0].id);
            setCompose(true);
            setError('');
          }}
        >
          <View style={s.add}>
            <Text style={{ fontSize: 28, color: colors.coral }}>＋</Text>
          </View>
          <Text style={s.label}>Your story</Text>
        </Pressable>
        {visible.map((st) => (
          <Pressable
            key={st.id}
            style={s.tile}
            accessibilityRole="button"
            accessibilityLabel={`${seen.includes(st.id) ? 'Viewed' : 'New'} story by ${st.authorName} in ${st.circleName}`}
            onPress={() => open(st)}
          >
            <StoryRing seen={seen.includes(st.id)} animate={!reduced && foreground}>
              {st.avatarUrl ? (
                <Image source={{ uri: st.avatarUrl }} style={s.avatar} />
              ) : (
                <Text style={s.label}>{st.authorName.charAt(0)}</Text>
              )}
            </StoryRing>
            <Text numberOfLines={1} style={s.label}>
              {st.authorId === profile.id ? 'You' : st.authorName}
            </Text>
            <Text numberOfLines={1} style={s.hint}>
              {st.circleName}
            </Text>
          </Pressable>
        ))}
        {more ? (
          <ActionButton
            compact
            variant="outline"
            label="More stories"
            disabled={loading}
            onPress={() => void refresh(true)}
          />
        ) : null}
      </ScrollView>
      {!visible.length ? (
        <Text style={s.hint}>
          {loading
            ? 'Loading stories…'
            : 'Share a moment with your circle. Photos and videos disappear after 24 hours.'}
        </Text>
      ) : null}
      {error && !compose ? (
        <View>
          <Text accessibilityRole="alert" style={s.error}>
            {error}
          </Text>
          <ActionButton
            compact
            variant="outline"
            label="Retry stories"
            onPress={() => void refresh()}
          />
        </View>
      ) : null}
      {compose ? (
        <Sheet
          title="Share a story"
          eyebrow="YOUR CIRCLE · 24 HOURS"
          onClose={() => {
            if (!busy) {
              picking.current = null;
              setCompose(false);
            }
          }}
          footer={
            <View style={{ gap: 8 }}>
              <ActionButton
                label={busy ? `Uploading · ${Math.round(progress * 100)}%` : 'Share story'}
                disabled={busy || !media || !members.some((c) => c.id === circleId)}
                onPress={() => void publish()}
              />
              {busy ? (
                <ActionButton
                  variant="outline"
                  label="Pause upload"
                  onPress={() => controller.current?.abort()}
                />
              ) : null}
            </View>
          }
        >
          <Text style={s.label}>Visible to members of</Text>
          <View style={s.wrap}>
            {members.map((c) => (
              <Pill
                key={c.id}
                label={c.name}
                selected={c.id === circleId}
                onPress={() => {
                  if (!busy) {
                    setCircleId(c.id);
                    setRequestId(createIdempotencyKey());
                  }
                }}
              />
            ))}
          </View>
          {media ? (
            <View>
              {media.kind === 'image' ? (
                <Image
                  source={{ uri: media.uri }}
                  style={{ height: 200, borderRadius: 16 }}
                  resizeMode="contain"
                />
              ) : (
                <View style={{ height: 200 }}>
                  <StoryVideo uri={media.uri} paused={!foreground} onEnd={() => {}} />
                </View>
              )}
            </View>
          ) : null}
          <View style={s.wrap}>
            {(['image', 'video'] as const).map((kind) => (
              <ActionButton
                key={kind}
                compact
                variant="outline"
                label={kind === 'image' ? 'Choose photo' : 'Choose video'}
                disabled={busy}
                onPress={() => void pick(kind)}
              />
            ))}
            <ActionButton
              compact
              variant="outline"
              label="Take photo"
              disabled={busy}
              onPress={() => void pick('image', true)}
            />
            <ActionButton
              compact
              variant="outline"
              label="Record video"
              disabled={busy}
              onPress={() => void pick('video', true)}
            />
          </View>
          <Text style={s.label}>Caption (optional)</Text>
          <TextInput
            accessibilityLabel="Story caption"
            value={caption}
            onChangeText={setCaption}
            editable={!busy}
            maxLength={280}
            multiline
            style={s.field}
          />
          <Text style={s.hint}>
            {caption.length}/280 · Photos up to 10 MB. Videos up to 60 seconds and 25 MB.
          </Text>
          {error ? (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          ) : null}
        </Sheet>
      ) : null}
      {current ? (
        <Modal animationType={reduced ? 'none' : 'fade'} onRequestClose={() => setSelected(null)}>
          <SafeAreaView style={s.viewer}>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{current.authorName}</Text>
                <Text style={s.hint}>
                  {current.circleName} · {index + 1}/{visible.length}
                </Text>
              </View>
              <ActionButton
                compact
                variant="outline"
                label="Close"
                onPress={() => setSelected(null)}
              />
            </View>
            <View style={s.track}>
              <View
                style={{
                  height: 3,
                  backgroundColor: colors.coral,
                  width: `${current.kind === 'image' ? Math.min(100, (elapsed / 6) * 100) : 100}%`,
                }}
              />
            </View>
            {viewerError ? (
              <View style={{ flex: 1, justifyContent: 'center' }}>
                <Text accessibilityRole="alert" style={s.error}>
                  {viewerError}
                </Text>
                <ActionButton
                  label="Retry story"
                  onPress={() => {
                    setSelected(null);
                    setTimeout(() => {
                      if (alive.current) open(current);
                    }, 0);
                  }}
                />
              </View>
            ) : !url ? (
              <Text style={s.hint}>Loading story…</Text>
            ) : current.kind === 'video' ? (
              <StoryVideo
                key={current.id}
                uri={url}
                paused={paused || !foreground}
                onEnd={() => advance(1)}
              />
            ) : (
              <Image
                source={{ uri: url }}
                style={{ flex: 1, width: '100%' }}
                resizeMode="contain"
                onLoad={() => setImageReady(true)}
                onError={() => setViewerError('Photo unavailable. Try reopening the story.')}
              />
            )}
            {current.caption ? <Text style={s.caption}>{current.caption}</Text> : null}
            <View style={s.wrap}>
              <ActionButton
                compact
                variant="outline"
                label="Previous"
                disabled={index <= 0}
                onPress={() => advance(-1)}
              />
              <ActionButton
                compact
                variant="outline"
                label={paused ? 'Play' : 'Pause'}
                onPress={() => setPaused(!paused)}
              />
              <ActionButton
                compact
                label={index === visible.length - 1 ? 'Done' : 'Next'}
                onPress={() => advance(1)}
              />
              {current.authorId === profile.id ? (
                <ActionButton
                  compact
                  variant="destructive"
                  label="Delete"
                  onPress={() => {
                    setPaused(true);
                    Alert.alert('Delete this story?', 'It will no longer appear in the circle.', [
                      { text: 'Keep story', style: 'cancel' },
                      { text: 'Delete', style: 'destructive', onPress: () => void erase(current) },
                    ]);
                  }}
                />
              ) : null}
            </View>
          </SafeAreaView>
        </Modal>
      ) : null}
    </View>
  );
}
const s = createThemedStyles(() => ({
  tray: { paddingHorizontal: 20, gap: 12, marginBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  title: { ...typography.section, color: colors.ink },
  label: { ...typography.secondary, fontWeight: '600', color: colors.ink },
  hint: { ...typography.caption, color: colors.muted },
  tile: { width: 82, alignItems: 'center', gap: 4 },
  ring: {
    height: 64,
    width: 64,
    borderRadius: 32,
    borderWidth: 3,
    borderColor: colors.coral,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: { height: 52, width: 52, borderRadius: 26 },
  halo: {
    position: 'absolute',
    top: -3,
    left: -3,
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: colors.coral,
  },
  add: {
    height: 64,
    width: 64,
    borderRadius: 32,
    backgroundColor: colors.lilac,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 12,
    minHeight: 80,
  },
  error: { ...typography.secondary, color: colors.error },
  viewer: { flex: 1, backgroundColor: colors.paper, padding: 16, gap: 12 },
  caption: { ...typography.body, color: colors.ink },
  track: { height: 3, backgroundColor: colors.line },
}));
