import { randomUUID } from 'expo-crypto';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, Text, TextInput, View } from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  useAudioPlayer,
  useAudioPlayerStatus,
} from 'expo-audio';
import { Sheet } from './Sheet';
import { ActionButton, Disclosure } from './Primitives';
import { styles } from '../appStyles';
import { colors, createThemedStyles } from '../theme';
import { supabase } from '../lib/supabase';
import { reportContent } from '../lib/repositories';
import { circleDepth, localValue, storeValue, type GroupMessage } from '../lib/communityDepth';
import * as api from '../lib/communityMedia';
import type { Circle } from '../types';
const chatStyles = createThemedStyles(() => ({
  copy: { color: colors.ink, fontSize: 16, lineHeight: 24 },
  hint: { color: colors.muted, fontSize: 14, lineHeight: 20 },
}));
export function VoicePlayer({ uri }: { uri: string }) {
  const player = useAudioPlayer(uri),
    status = useAudioPlayerStatus(player);
  const [error, setError] = useState('');
  const alive = useRef(true),
    pending = useRef(false),
    foreground = useRef(
      AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
    );
  useEffect(() => {
    alive.current = true;
    setError('');
    const a = AppState.addEventListener('change', (state) => {
      foreground.current = state === 'active';
      if (state !== 'active') player.pause();
    });
    return () => {
      alive.current = false;
      a.remove();
    };
  }, [player]);
  return (
    <View style={{ gap: 6 }}>
      <ActionButton
        compact
        variant="outline"
        label={status.playing ? 'Pause voice note' : 'Play voice note'}
        onPress={() => {
          if (status.playing) player.pause();
          else {
            if (pending.current) return;
            pending.current = true;
            setError('');
            void (async () => {
              if (
                status.didJustFinish ||
                (status.duration > 0 && status.currentTime >= status.duration)
              )
                await player.seekTo(0);
              if (alive.current && foreground.current) player.play();
            })()
              .catch(() => {
                if (alive.current)
                  setError('Voice note could not play. Refresh the attachment and try again.');
              })
              .finally(() => {
                pending.current = false;
              });
          }
        }}
      />
      <Text style={chatStyles.hint}>
        {Math.floor(status.currentTime ?? 0)} / {Math.ceil(status.duration ?? 0)} seconds
      </Text>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
export function MessageAttachment({
  messageId,
  path,
  kind,
}: {
  messageId?: string;
  path?: string;
  kind?: 'photo' | 'voice';
}) {
  const [media, setMedia] = useState<{ url: string; kind: 'photo' | 'voice' } | null>(null),
    [error, setError] = useState('');
  const generation = useRef(0);
  const load = async () => {
    const gen = ++generation.current;
    try {
      const attachment = path
        ? { storage_path: path, media_kind: kind }
        : messageId
          ? await api.directAttachment(messageId)
          : null;
      if (!attachment) return;
      const url = await api.messageMediaUrl(attachment.storage_path);
      if (gen === generation.current) {
        setMedia({ url, kind: attachment.media_kind });
        setError('');
      }
    } catch {
      if (gen === generation.current) setError('Attachment unavailable.');
    }
  };
  useEffect(() => {
    setMedia(null);
    setError('');
    void load();
    return () => {
      generation.current++;
    };
  }, [messageId, path, kind]);
  return media ? (
    <View style={{ marginVertical: 8 }}>
      {media.kind === 'photo' ? (
        <Image
          source={{ uri: media.url }}
          style={{ width: 230, maxWidth: '100%', height: 210, borderRadius: 12 }}
          contentFit="contain"
          onError={() => setError('Photo could not load.')}
        />
      ) : (
        <VoicePlayer uri={media.url} />
      )}
      <ActionButton
        compact
        variant="outline"
        label={error ? 'Retry attachment' : 'Refresh attachment'}
        onPress={() => void load()}
      />
    </View>
  ) : error ? (
    <ActionButton compact variant="outline" label="Retry attachment" onPress={() => void load()} />
  ) : null;
}
export function MessageMediaComposer({
  user,
  target,
  group = false,
  onSent,
  disabled = false,
}: {
  user: string;
  target: string;
  group?: boolean;
  onSent: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false),
    [draft, setDraft] = useState<api.MessageMedia | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    alive = useRef(true),
    foreground = useRef(
      AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
    ),
    started = useRef(0);
  const completeRecording = (uri: string, duration: number) => {
    if (!alive.current) return;
    started.current = 0;
    setDraft({
      id: randomUUID(),
      uri,
      kind: 'voice',
      mime: uri.endsWith('.webm') ? 'audio/webm' : 'audio/mp4',
      duration: Math.min(60000, Math.max(1, duration)),
    });
    void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  };
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY, (status) => {
    if (!alive.current || !started.current) return;
    if (status.hasError) {
      started.current = 0;
      setError(status.error ?? 'Recording was interrupted. Please try again.');
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    } else if (status.isFinished && status.url)
      completeRecording(status.url, Date.now() - started.current);
  });
  const state = useAudioRecorderState(recorder, 200);
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as any)?.message ?? 'Could not attach media.');
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const stop = async () => {
    const duration = Date.now() - started.current;
    try {
      if (recorder.isRecording) await recorder.stop();
      if (started.current && recorder.uri) completeRecording(recorder.uri, duration);
    } finally {
      started.current = 0;
      await setAudioModeAsync({ allowsRecording: false });
    }
  };
  useEffect(() => {
    alive.current = true;
    const a = AppState.addEventListener('change', (s) => {
      foreground.current = s === 'active';
      if (s !== 'active' && recorder.isRecording) void run(stop);
    });
    return () => {
      alive.current = false;
      a.remove();
      if (recorder.isRecording) void recorder.stop().catch(() => {});
      void setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    };
  }, [recorder]);
  useEffect(() => {
    if (state.isRecording && state.durationMillis >= 59000) void run(stop);
  }, [state.isRecording, state.durationMillis]);
  return (
    <View>
      {!open ? (
        <ActionButton
          compact
          variant="outline"
          label="Photo or voice note"
          disabled={disabled}
          onPress={() => setOpen(true)}
        />
      ) : (
        <View style={{ gap: 8, padding: 12, backgroundColor: colors.surface, borderRadius: 16 }}>
          {error ? (
            <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {error}
            </Text>
          ) : null}
          {draft ? (
            <>
              {draft.kind === 'photo' ? (
                <Image
                  source={{ uri: draft.uri }}
                  style={{ width: 120, height: 120, borderRadius: 12 }}
                />
              ) : (
                <VoicePlayer uri={draft.uri} />
              )}
              <ActionButton
                label={busy ? 'Sending…' : 'Send attachment'}
                disabled={busy || disabled}
                onPress={() =>
                  void run(async () => {
                    await api.sendMessageMedia(user, target, draft, group);
                    if (alive.current) {
                      setDraft(null);
                      setOpen(false);
                      onSent();
                    }
                  })
                }
              />
              <ActionButton
                compact
                variant="outline"
                label="Discard attachment"
                disabled={busy}
                onPress={() => setDraft(null)}
              />
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <ActionButton
                  compact
                  variant="outline"
                  label="Choose photo"
                  disabled={busy || state.isRecording || disabled}
                  onPress={() =>
                    void run(async () => {
                      const result = await ImagePicker.launchImageLibraryAsync({
                        mediaTypes: ['images'],
                        quality: 0.8,
                        allowsEditing: false,
                      });
                      if (!alive.current || result.canceled || !result.assets[0]) return;
                      const a = result.assets[0],
                        mime = a.mimeType ?? (a.uri.endsWith('.png') ? 'image/png' : 'image/jpeg');
                      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime))
                        throw Error('Choose a JPG, PNG, or WebP photo.');
                      setDraft({ id: randomUUID(), uri: a.uri, kind: 'photo', mime });
                    })
                  }
                />
                <ActionButton
                  compact
                  variant="outline"
                  label={state.isRecording ? 'Stop recording' : 'Record voice note'}
                  disabled={busy || disabled}
                  onPress={() =>
                    void run(async () => {
                      if (recorder.isRecording) {
                        await stop();
                        return;
                      }
                      const p = await requestRecordingPermissionsAsync();
                      if (!alive.current || !foreground.current) return;
                      if (!p.granted)
                        throw Error(
                          'Allow microphone access in device settings to record a voice note.',
                        );
                      let recording = false;
                      try {
                        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
                        if (!alive.current || !foreground.current) return;
                        await recorder.prepareToRecordAsync();
                        if (!alive.current || !foreground.current) return;
                        started.current = Date.now();
                        recorder.record({ forDuration: 60 });
                        recording = true;
                      } finally {
                        if (!recording) {
                          started.current = 0;
                          await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
                        }
                      }
                    })
                  }
                />
              </View>
              <Text style={chatStyles.hint}>
                {state.isRecording
                  ? `Recording · ${Math.ceil(state.durationMillis / 1000)} / 60 seconds`
                  : 'Photos up to 10 MB · Voice notes up to 60 seconds. Preview before sending.'}
              </Text>
            </>
          )}
          <ActionButton
            compact
            variant="outline"
            label="Close attachments"
            disabled={busy || state.isRecording}
            onPress={() => {
              setOpen(false);
              setDraft(null);
            }}
          />
        </View>
      )}
    </View>
  );
}
export function CircleChatList({
  user,
  circles,
  revision,
  onOpen,
}: {
  user: string;
  circles: Circle[];
  revision: number;
  onOpen: (c: Circle) => void;
}) {
  const [rows, setRows] = useState<{ circle: Circle; unread: number; muted: boolean }[]>([]),
    [error, setError] = useState(''),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      let values: ({ circle: Circle; unread: number; muted: boolean } | null)[];
      if (supabase) {
        const result = await supabase.rpc('circle_chat_inbox');
        if (result.error) throw result.error;
        values = (
          (result.data as { circle_id: string; unread: number; muted: boolean }[]) ?? []
        ).flatMap((row) => {
          const circle = circles.find((c) => c.id === row.circle_id);
          return circle ? [{ circle, unread: Number(row.unread), muted: row.muted }] : [];
        });
      } else
        values = await Promise.all(
          circles.map(async (circle) => {
            const d = await circleDepth(user, circle.id, circle.isOwner);
            if (!d.chat.enabled) return null;
            const [messages, pref] = await Promise.all([
              api.groupMessages(user, circle.id),
              api.groupPreference(user, circle.id),
            ]);
            return {
              circle,
              unread: messages.filter((m) => m.author_id !== user && m.created_at > pref.read_at)
                .length,
              muted: pref.muted,
            };
          }),
        );
      if (active) {
        setRows(values.filter((x): x is NonNullable<typeof x> => x !== null));
        setError('');
      }
    };
    void load().catch((e) => {
      if (active) setError(e.message);
    });
    const interval = setInterval(() => setVersion((v) => v + 1), 30000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [user, circles.map((c) => c.id).join(','), revision, version]);
  return (
    <Disclosure title={`Circle chats · ${rows.length}`}>
      {error ? <Text style={{ color: colors.error }}>{error}</Text> : null}
      {rows.length ? (
        rows.map((r) => (
          <ActionButton
            key={r.circle.id}
            compact
            variant="outline"
            label={`${r.circle.name}${r.muted ? ' · muted' : r.unread ? ` · ${r.unread}${r.unread === 40 ? '+' : ''} unread` : ''}`}
            onPress={() => onOpen(r.circle)}
          />
        ))
      ) : (
        <Text style={chatStyles.hint}>Chats appear here when a host enables them.</Text>
      )}
    </Disclosure>
  );
}
export function CircleChat({
  user,
  circle,
  onClose,
}: {
  user: string;
  circle: Circle;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<GroupMessage[]>([]),
    [body, setBody] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [enabled, setEnabled] = useState(false),
    [host, setHost] = useState(false),
    [muted, setMuted] = useState(false),
    [more, setMore] = useState(false),
    [ready, setReady] = useState(false);
  const alive = useRef(true),
    lock = useRef(false),
    request = useRef(randomUUID()),
    version = useRef(0),
    initialized = useRef(false),
    atBottom = useRef(true),
    scroll = useRef<ScrollView>(null);
  const load = async () => {
    const [d, m, p] = await Promise.all([
      circleDepth(user, circle.id, circle.isOwner),
      api.groupMessages(user, circle.id),
      api.groupPreference(user, circle.id),
    ]);
    const draft = !initialized.current ? await localValue(user, `chat-draft:${circle.id}`, '') : '';
    if (!alive.current) return;
    if (!initialized.current) {
      setBody(typeof draft === 'string' ? draft : '');
      initialized.current = true;
      setReady(true);
    }
    setError('');
    setRows((old) => [
      ...m,
      ...old.filter(
        (x) => !m.some((y) => y.id === x.id) && x.created_at < (m.at(-1)?.created_at ?? ''),
      ),
    ]);
    setMore(m.length === 40);
    setEnabled(d.chat.enabled);
    setHost(d.host);
    setMuted(p.muted);
    await api.saveGroupPreference(user, circle.id, { read_at: new Date().toISOString() });
  };
  const run = async (fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError((e as any)?.message ?? 'Please try again.');
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  };
  useEffect(() => {
    alive.current = true;
    void run(load);
    const timer = setInterval(() => {
      void load().catch((e) => {
        if (alive.current) setError(e.message);
      });
    }, 15000);
    const channel = supabase
      ?.channel(`circle-chat:${circle.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'circle_chat_messages',
          filter: `circle_id=eq.${circle.id}`,
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as any)?.id;
            if (alive.current) setRows((old) => old.filter((m) => m.id !== id));
          }
          void load().catch(() => {});
        },
      )
      .subscribe();
    return () => {
      alive.current = false;
      clearInterval(timer);
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [circle.id, user]);
  return (
    <Sheet
      title={circle.name}
      eyebrow="CIRCLE CHAT"
      onClose={onClose}
      scrollRef={scroll}
      onContentSizeChange={() => {
        if (atBottom.current) scroll.current?.scrollToEnd({ animated: false });
      }}
      onScroll={({ nativeEvent: e }) => {
        atBottom.current =
          e.contentSize.height - e.layoutMeasurement.height - e.contentOffset.y < 100;
      }}
      footer={
        <View style={{ gap: 8 }}>
          {error ? (
            <View style={{ gap: 6 }}>
              <Text accessibilityRole="alert" style={{ color: colors.error }}>
                {error}
              </Text>
              <ActionButton
                compact
                variant="outline"
                label="Retry chat"
                disabled={busy}
                onPress={() => void run(load)}
              />
            </View>
          ) : null}
          {enabled ? (
            <>
              <MessageMediaComposer
                user={user}
                target={circle.id}
                group
                disabled={busy || !ready}
                onSent={() => void run(load)}
              />
              <TextInput
                accessibilityLabel="Circle chat message"
                placeholder="Message your circle…"
                placeholderTextColor={colors.muted}
                style={styles.messageInput}
                value={body}
                editable={!busy && ready}
                multiline
                maxLength={2000}
                onChangeText={(s) => {
                  setBody(s);
                  version.current++;
                  request.current = randomUUID();
                  void storeValue(user, `chat-draft:${circle.id}`, s).catch(() => {
                    if (alive.current)
                      setError('Your draft could not be saved. Keep this chat open and try again.');
                  });
                }}
              />
              <ActionButton
                label={busy ? 'Sending…' : 'Send message'}
                disabled={busy || !ready || !body.trim()}
                onPress={() =>
                  void run(async () => {
                    const v = version.current;
                    await api.sendGroupMessage(user, circle.id, body, request.current);
                    if (version.current === v) {
                      setBody('');
                      await storeValue(user, `chat-draft:${circle.id}`, '');
                      request.current = randomUUID();
                    }
                    await load();
                  })
                }
              />
            </>
          ) : (
            <Text style={chatStyles.hint}>The host has paused this chat.</Text>
          )}
        </View>
      }
    >
      <ActionButton
        compact
        variant="outline"
        label={muted ? 'Unmute circle chat' : 'Mute circle chat'}
        disabled={busy}
        onPress={() =>
          void run(async () => {
            await api.saveGroupPreference(user, circle.id, { muted: !muted });
            setMuted(!muted);
          })
        }
      />
      <Text style={chatStyles.hint}>
        Members only. Hosts can remove messages. You can delete your messages for 15 minutes.
      </Text>
      {more ? (
        <ActionButton
          compact
          variant="outline"
          label="Load earlier messages"
          disabled={busy}
          onPress={() =>
            void run(async () => {
              atBottom.current = false;
              const earlier = await api.groupMessages(user, circle.id, rows.at(-1)?.created_at);
              setRows((old) => [...old, ...earlier.filter((x) => !old.some((m) => m.id === x.id))]);
              setMore(earlier.length === 40);
            })
          }
        />
      ) : null}
      {[...rows].reverse().map((m) => (
        <View
          key={m.id}
          style={{
            gap: 6,
            padding: 12,
            borderRadius: 12,
            backgroundColor: colors.surface,
            marginVertical: 4,
          }}
        >
          <Text style={chatStyles.hint}>
            {m.author_id === user ? 'You' : (m.profiles?.display_name ?? 'Member')} ·{' '}
            {new Date(m.created_at).toLocaleTimeString()}
          </Text>
          {m.body ? <Text style={chatStyles.copy}>{m.body}</Text> : null}
          {m.media_path ? <MessageAttachment path={m.media_path} kind={m.media_kind} /> : null}
          <Disclosure title="Message options">
            {host ||
            (m.author_id === user && Date.now() - new Date(m.created_at).getTime() < 900000) ? (
              <ActionButton
                compact
                variant="outline"
                label="Delete message"
                disabled={busy}
                onPress={() =>
                  void run(async () => {
                    await api.deleteGroupMessage(user, circle.id, m.id);
                    setRows((old) => old.filter((x) => x.id !== m.id));
                  })
                }
              />
            ) : null}
            <ActionButton
              compact
              variant="outline"
              label="Report message to circle moderators"
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  await reportContent({
                    targetType: 'circle',
                    targetId: circle.id,
                    reason: `Circle chat message ${m.id}: please review this message.`,
                  });
                })
              }
            />
          </Disclosure>
        </View>
      ))}
    </Sheet>
  );
}
