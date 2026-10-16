import { InlineNotice } from './Design';
import { SegmentedControl } from './LayoutControls';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Share, Switch, Text, TextInput, View } from 'react-native';
import { CommunityContext, useCommunity } from './CommunityContext';
import { Sheet } from './Sheet';
import { ActionButton, Disclosure, Pill, IconButton } from './Primitives';
import { colors, createThemedStyles } from '../theme';
import { styles } from '../appStyles';
import { supabase } from '../lib/supabase';
import { loadPostById, loadTopicPosts, createIdempotencyKey } from '../lib/repositories';
import * as api from '../lib/communityDepth';
import type { Circle, CirclePost, PostComment, Profile } from '../types';
import { CircleChat, CircleChatList } from './CommunityMessages';

const depthStyles = createThemedStyles(() => ({
  body: { color: colors.ink, fontSize: 16, lineHeight: 24 },
  hint: { color: colors.muted, fontSize: 14, lineHeight: 21 },
}));
export function CommunityField({
  label,
  value,
  onChange,
  max = 120,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  max?: number;
  disabled?: boolean;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={depthStyles.hint}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        maxLength={max}
        multiline={max > 120}
        style={[styles.field, max > 120 && { minHeight: 100, textAlignVertical: 'top' }]}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}
function Toggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 }}>
      <Text style={[depthStyles.body, { flex: 1 }]}>{label}</Text>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} />
    </View>
  );
}
function useTask() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return {
    busy,
    error,
    run: async (fn: () => Promise<void>) => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      setError('');
      try {
        await fn();
      } catch (e) {
        if (alive.current)
          setError(e instanceof Error ? e.message : ((e as any)?.message ?? 'Please try again.'));
      } finally {
        lock.current = false;
        if (alive.current) setBusy(false);
      }
    },
  };
}
export function CommunityProvider({
  profile,
  circles,
  onChanged,
  onOpenPost,
  catchupRequest = 0,
  children,
}: {
  profile: Profile;
  circles: Circle[];
  onChanged: () => void;
  onOpenPost: (p: CirclePost) => void;
  catchupRequest?: number;
  children: React.ReactNode;
}) {
  const [panel, setPanel] = useState<{
      kind: 'library' | 'participate' | 'host' | 'invite' | 'chat';
      circle: Circle;
      post?: CirclePost;
    } | null>(null),
    [showCatchup, setCatchup] = useState(false),
    [revision, setRevision] = useState(0);
  const seenCatchup = useRef(catchupRequest);
  useEffect(() => {
    if (seenCatchup.current !== catchupRequest) {
      seenCatchup.current = catchupRequest;
      setCatchup(true);
    }
  }, [catchupRequest]);
  const [recognition, setRecognition] = useState<Record<string, string>>({}),
    [hostCircles, setHostCircles] = useState<Set<string>>(new Set());
  useEffect(() => {
    let active = true;
    if (supabase)
      void Promise.all([
        supabase.from('circle_recognition').select('circle_id,user_id,label'),
        supabase
          .from('circle_memberships')
          .select('circle_id,role')
          .eq('user_id', profile.id)
          .eq('status', 'member'),
      ])
        .then(([r, m]) => {
          if (active && !r.error && !m.error) {
            setRecognition(
              Object.fromEntries(
                (r.data ?? []).map((x) => [`${x.circle_id}:${x.user_id}`, x.label]),
              ),
            );
            setHostCircles(
              new Set(
                (m.data ?? [])
                  .filter((x) => ['owner', 'moderator'].includes(x.role))
                  .map((x) => x.circle_id),
              ),
            );
          }
        })
        .catch(() => {});
    else setHostCircles(new Set(circles.filter((c) => c.isOwner).map((c) => c.id)));
    return () => {
      active = false;
    };
  }, [profile.id, revision, circles.map((c) => c.id).join(',')]);
  const refresh = () => {
    setRevision((v) => v + 1);
    onChanged();
  };
  return (
    <CommunityContext.Provider
      value={{
        profile,
        circles,
        revision,
        recognition,
        hostCircles,
        refresh,
        open: (kind, circle) => setPanel({ kind, circle }),
        collect: (post) => {
          const circle = circles.find((c) => c.id === post.circleId && c.isMember);
          if (circle) setPanel({ kind: 'library', circle, post });
        },
        catchup: () => setCatchup(true),
      }}
    >
      {children}
      {panel ? (
        panel.kind === 'chat' ? (
          <CircleChat
            key={panel.circle.id}
            user={profile.id}
            circle={panel.circle}
            onClose={() => setPanel(null)}
          />
        ) : (
          <CirclePanel
            key={`${panel.kind}:${panel.circle.id}:${panel.post?.id ?? ''}`}
            {...panel}
            kind={panel.kind}
            user={profile.id}
            onClose={() => setPanel(null)}
            onOpenPost={(p) => {
              setPanel(null);
              onOpenPost(p);
            }}
            onChanged={refresh}
          />
        )
      ) : null}
      {showCatchup ? (
        <CatchupSheet
          user={profile.id}
          onClose={() => setCatchup(false)}
          onOpen={(p) => {
            setCatchup(false);
            onOpenPost(p);
          }}
        />
      ) : null}
    </CommunityContext.Provider>
  );
}
export function FeedControls() {
  const ctx = useCommunity(),
    [mode, setMode] = useState<api.FeedMode>('recommended'),
    [choices, setChoices] = useState<api.FeedChoice[]>([]),
    [preferencesOpen, setPreferencesOpen] = useState(false);
  const task = useTask();
  useEffect(() => {
    let active = true;
    if (ctx)
      void Promise.all([api.feedMode(ctx.profile.id), api.feedChoices(ctx.profile.id)])
        .then(([m, c]) => {
          if (active) {
            setMode(m);
            setChoices(c);
          }
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [ctx?.profile.id, ctx?.revision]);
  if (!ctx) return null;
  return (
    <View style={{ gap: 8, marginVertical: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
        <SegmentedControl
          label="Timeline order"
          value={mode}
          options={[
            { value: 'recommended', label: 'Recommended' },
            { value: 'latest', label: 'Latest' },
          ]}
          onChange={(m) =>
            void task.run(async () => {
              await api.setFeedMode(ctx.profile.id, m);
              setMode(m);
              ctx.refresh();
            })
          }
        />
        <IconButton label="Timeline options" icon="more" onPress={() => setPreferencesOpen(true)} />
      </View>
      {preferencesOpen ? (
        <Sheet
          title="Timeline options"
          eyebrow="YOUR TIMELINE"
          onClose={() => setPreferencesOpen(false)}
        >
          {task.error ? <InlineNotice tone="error">{task.error}</InlineNotice> : null}
          <Text style={depthStyles.hint}>
            {mode === 'recommended'
              ? 'Prioritises favourite circles, your interests, and recent conversations. Only circles you joined.'
              : 'Newest posts from your joined circles. Hidden posts and snoozed circles stay out of your timeline.'}
          </Text>
          <ActionButton
            compact
            variant="quiet"
            label="Catch up"
            onPress={() => {
              setPreferencesOpen(false);
              ctx.catchup();
            }}
          />
          <Text style={depthStyles.body}>Manage timeline preferences</Text>
          {ctx.circles
            .filter((c) => c.isMember)
            .map((c) => {
              const pref = choices.find((p) => p.circle_id === c.id);
              return (
                <View key={c.id} style={{ gap: 8, paddingVertical: 8 }}>
                  <Text style={depthStyles.body}>{c.name}</Text>
                  <Toggle
                    label={`Favourite ${c.name}`}
                    value={pref?.favourite ?? false}
                    onChange={(favourite) =>
                      void task.run(async () => {
                        await api.updateFeedChoice(ctx.profile.id, c.id, { favourite });
                        ctx.refresh();
                      })
                    }
                  />
                  {pref?.see_less || pref?.snoozed_until ? (
                    <ActionButton
                      compact
                      variant="outline"
                      label="Restore normal visibility"
                      onPress={() =>
                        void task.run(async () => {
                          await api.updateFeedChoice(ctx.profile.id, c.id, {
                            see_less: false,
                            snoozed_until: null,
                          });
                          ctx.refresh();
                        })
                      }
                    />
                  ) : null}
                </View>
              );
            })}
          <ActionButton
            compact
            variant="outline"
            label="Restore hidden posts"
            onPress={() =>
              void task.run(async () => {
                if (supabase) {
                  const r = await supabase
                    .from('hidden_posts')
                    .delete()
                    .eq('user_id', ctx.profile.id);
                  if (r.error) throw r.error;
                } else await api.storeValue(ctx.profile.id, 'hidden', []);
                ctx.refresh();
              })
            }
          />
        </Sheet>
      ) : null}
      {task.error && !preferencesOpen ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {task.error}
        </Text>
      ) : null}
    </View>
  );
}
export function CircleFeatures({
  circle,
  search,
  details,
}: {
  circle: Circle;
  search?: React.ReactNode;
  details?: React.ReactNode;
}) {
  const ctx = useCommunity();
  const task = useTask();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  return ctx && circle.isMember ? (
    <View>
      <ActionButton
        compact
        variant="quiet"
        label="Circle tools"
        onPress={() => setToolsOpen(true)}
      />
      {toolsOpen ? (
        <Sheet title="Circle tools" eyebrow={circle.name} onClose={() => setToolsOpen(false)}>
          <View style={{ gap: 8 }}>
            <ActionButton
              compact
              variant="quiet"
              label="Ask or poll"
              onPress={() => {
                setToolsOpen(false);
                ctx.open('participate', circle);
              }}
            />
            <ActionButton
              compact
              variant="quiet"
              label="Circle library"
              onPress={() => {
                setToolsOpen(false);
                ctx.open('library', circle);
              }}
            />
            <ActionButton
              compact
              variant="quiet"
              label="Circle chat"
              onPress={() => {
                setToolsOpen(false);
                ctx.open('chat', circle);
              }}
            />
          </View>
          {search}
          {details ? (
            <ActionButton
              compact
              variant="quiet"
              label="Rules, members and host tools"
              onPress={() => {
                setToolsOpen(false);
                setDetailsOpen(true);
              }}
            />
          ) : null}
          <View style={{ gap: 8 }}>
            {ctx.recognition[`${circle.id}:${ctx.profile.id}`] ? (
              <ActionButton
                compact
                variant="quiet"
                label="Remove my recognition"
                disabled={task.busy}
                onPress={() =>
                  void task.run(async () => {
                    await api.changeCircleDepth(
                      ctx.profile.id,
                      circle.id,
                      'circle_recognition',
                      { user_id: ctx.profile.id },
                      true,
                    );
                    ctx.refresh();
                  })
                }
              />
            ) : null}
            {task.error ? <Text style={{ color: colors.error }}>{task.error}</Text> : null}
            {circle.isOwner || ctx.hostCircles.has(circle.id) ? (
              <ActionButton
                compact
                variant="quiet"
                label="Host settings and recognition"
                onPress={() => {
                  setToolsOpen(false);
                  ctx.open('host', circle);
                }}
              />
            ) : null}
            <ActionButton
              compact
              variant="quiet"
              label="Invite members"
              onPress={() => {
                setToolsOpen(false);
                ctx.open('invite', circle);
              }}
            />
          </View>
        </Sheet>
      ) : null}
      {detailsOpen ? (
        <Sheet
          title="Rules, members and host tools"
          eyebrow={circle.name}
          onClose={() => setDetailsOpen(false)}
        >
          {details}
        </Sheet>
      ) : null}
    </View>
  ) : null;
}
export function GroupInbox() {
  const ctx = useCommunity();
  return ctx ? (
    <CircleChatList
      user={ctx.profile.id}
      circles={ctx.circles.filter((c) => c.isMember)}
      revision={ctx.revision}
      onOpen={(c) => ctx.open('chat', c)}
    />
  ) : null;
}

function CirclePanel({
  kind,
  circle,
  post,
  user,
  onClose,
  onOpenPost,
  onChanged,
}: {
  kind: 'library' | 'participate' | 'host' | 'invite';
  circle: Circle;
  post?: CirclePost;
  user: string;
  onClose: () => void;
  onOpenPost: (p: CirclePost) => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<api.CircleDepth | null>(null),
    [name, setName] = useState(''),
    [question, setQuestion] = useState(''),
    [options, setOptions] = useState(['', '']),
    [type, setType] = useState<'question' | 'poll'>('question'),
    [topic, setTopic] = useState<string | null>(null),
    [collection, setCollection] = useState<api.Collection | null>(null),
    [entries, setEntries] = useState<CirclePost[]>([]),
    [libraryOffset, setLibraryOffset] = useState(0),
    [libraryMore, setLibraryMore] = useState(false),
    [prompt, setPrompt] = useState(''),
    [day, setDay] = useState(1),
    [weekly, setWeekly] = useState(false),
    [chat, setChat] = useState(false),
    [slow, setSlow] = useState('0'),
    [recipient, setRecipient] = useState(''),
    [badge, setBadge] = useState('Helpful member'),
    [previewName, setPreviewName] = useState(false),
    [invite, setInvite] = useState<{ token: string; expires_at: string } | null>(null),
    [invites, setInvites] = useState<{ token: string; expires_at: string }[]>([]),
    [notice, setNotice] = useState('');
  const task = useTask(),
    request = useRef(createIdempotencyKey()),
    alive = useRef(true);
  const load = async () => {
    const d = await api.circleDepth(user, circle.id, circle.isOwner);
    if (!alive.current) return;
    setData(d);
    setPrompt(d.prompt?.question ?? 'What did you learn this week?');
    setDay(d.prompt?.weekday ?? 1);
    setWeekly(d.prompt?.enabled ?? false);
    setChat(d.chat.enabled);
    setSlow(String(d.chat.slow_seconds));
    if (kind === 'invite' && supabase && d.host) {
      const r = await supabase
        .from('circle_invites')
        .select('token,expires_at')
        .eq('circle_id', circle.id)
        .order('expires_at');
      if (r.error) throw r.error;
      if (alive.current) setInvites(r.data ?? []);
    }
  };
  useEffect(() => {
    alive.current = true;
    void task.run(load);
    return () => {
      alive.current = false;
    };
  }, []);
  const draftKey = `participation:${circle.id}`;
  useEffect(() => {
    if (kind !== 'participate') return;
    const initialRequest = request.current;
    void api.localValue<any>(user, draftKey, null).then((d) => {
      if (alive.current && request.current === initialRequest && d && typeof d === 'object') {
        setQuestion(typeof d.question === 'string' ? d.question.slice(0, 5000) : '');
        setOptions(
          Array.isArray(d.options) &&
            d.options.length >= 2 &&
            d.options.length <= 6 &&
            d.options.every((o: unknown) => typeof o === 'string' && o.length <= 120)
            ? d.options
            : ['', ''],
        );
        setType(d.type === 'poll' ? 'poll' : 'question');
        setTopic(typeof d.topic === 'string' ? d.topic : null);
        if (typeof d.request === 'string' && d.request) request.current = d.request;
      }
    });
  }, []);
  const saveDraft = (q: string, ops: string[], t: 'question' | 'poll', selectedTopic = topic) => {
    request.current = createIdempotencyKey();
    void api
      .storeValue(user, draftKey, {
        question: q,
        options: ops,
        type: t,
        topic: selectedTopic,
        request: request.current,
      })
      .catch(() => {
        if (alive.current)
          setNotice('Your draft could not be saved. Keep this screen open and try again.');
      });
  };
  const loadLibrary = async (target: api.Collection, offset = 0) => {
    const page = target.id.startsWith('topic:')
      ? await loadTopicPosts(target.id.slice(6), offset).then((posts) => ({
          posts,
          nextOffset: offset + posts.length,
          hasMore: posts.length === 20,
        }))
      : await api.collectionPage(user, target.id, offset);
    if (!alive.current) return;
    setEntries((old) =>
      offset
        ? [...old, ...page.posts.filter((p) => !old.some((previous) => previous.id === p.id))]
        : page.posts,
    );
    setLibraryOffset(page.nextOffset);
    setLibraryMore(page.hasMore);
    setCollection(target);
    setNotice('');
  };
  const change = async (
    table: Parameters<typeof api.changeCircleDepth>[2],
    values: Record<string, unknown>,
    remove = false,
  ) => {
    await api.changeCircleDepth(user, circle.id, table, values, remove);
    await load();
    onChanged();
    setNotice('Saved.');
  };
  return (
    <Sheet
      title={
        kind === 'library'
          ? 'Circle library'
          : kind === 'host'
            ? 'Community settings'
            : kind === 'invite'
              ? 'Invite members'
              : 'Ask your circle'
      }
      eyebrow={circle.name}
      onClose={task.busy ? () => {} : onClose}
      footer={
        kind === 'participate' ? (
          <ActionButton
            label={task.busy ? 'Posting…' : type === 'poll' ? 'Post poll' : 'Post question'}
            disabled={task.busy || !data}
            onPress={() =>
              void task.run(async () => {
                await api.participation(
                  user,
                  circle.id,
                  question,
                  type,
                  options,
                  topic,
                  request.current,
                );
                await api.storeValue(user, draftKey, null);
                if (alive.current) {
                  onChanged();
                  onClose();
                }
              })
            }
          />
        ) : undefined
      }
    >
      {task.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {task.error}
        </Text>
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" style={depthStyles.hint}>
          {notice}
        </Text>
      ) : null}
      {!data ? (
        <ActionButton
          label={task.busy ? 'Loading…' : 'Try again'}
          disabled={task.busy}
          onPress={() => void task.run(load)}
        />
      ) : (
        <>
          {kind === 'participate' ? (
            <>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {(['question', 'poll'] as const).map((t) => (
                  <Pill
                    key={t}
                    label={t === 'poll' ? 'Poll' : 'Question'}
                    selected={type === t}
                    onPress={() => {
                      if (task.busy) return;
                      setType(t);
                      saveDraft(question, options, t);
                    }}
                  />
                ))}
              </View>
              <CommunityField
                label={type === 'poll' ? 'Poll question' : 'Your question'}
                value={question}
                max={5000}
                disabled={task.busy}
                onChange={(q) => {
                  setQuestion(q);
                  saveDraft(q, options, type);
                }}
              />
              {type === 'poll' ? (
                <>
                  {options.map((o, i) => (
                    <View key={i} style={{ gap: 4 }}>
                      <CommunityField
                        label={`Option ${i + 1}`}
                        value={o}
                        disabled={task.busy}
                        onChange={(v) => {
                          const next = options.map((x, n) => (n === i ? v : x));
                          setOptions(next);
                          saveDraft(question, next, type);
                        }}
                      />
                      {options.length > 2 ? (
                        <ActionButton
                          compact
                          variant="outline"
                          label={`Remove option ${i + 1}`}
                          disabled={task.busy}
                          onPress={() => {
                            const next = options.filter((_, n) => n !== i);
                            setOptions(next);
                            saveDraft(question, next, type);
                          }}
                        />
                      ) : null}
                    </View>
                  ))}
                  {options.length < 6 ? (
                    <ActionButton
                      compact
                      variant="outline"
                      label="Add option"
                      disabled={task.busy}
                      onPress={() => {
                        const next = [...options, ''];
                        setOptions(next);
                        saveDraft(question, next, type);
                      }}
                    />
                  ) : null}
                  <Text style={depthStyles.hint}>
                    One vote per member. You can change your vote until this poll closes in 7 days.
                  </Text>
                </>
              ) : null}
              {data.topics.length ? (
                <>
                  <Text style={depthStyles.hint}>Topic</Text>
                  <Pill
                    label="No topic"
                    selected={!topic}
                    onPress={
                      task.busy
                        ? undefined
                        : () => {
                            setTopic(null);
                            saveDraft(question, options, type, null);
                          }
                    }
                  />
                  {data.topics.map((t) => (
                    <Pill
                      key={t.id}
                      label={t.name}
                      selected={topic === t.id}
                      onPress={
                        task.busy
                          ? undefined
                          : () => {
                              setTopic(t.id);
                              saveDraft(question, options, type, t.id);
                            }
                      }
                    />
                  ))}
                </>
              ) : null}
            </>
          ) : null}
          {kind === 'library' ? (
            <>
              <Text style={depthStyles.hint}>
                {post
                  ? 'Choose a shared collection for this post.'
                  : 'Shared posts and resources, organised by your circle.'}
              </Text>
              {collection ? (
                <>
                  <ActionButton
                    compact
                    variant="outline"
                    label="Back to collections"
                    disabled={task.busy}
                    onPress={() => setCollection(null)}
                  />
                  <Text style={depthStyles.body}>{collection.name}</Text>
                  {entries.length ? (
                    entries.map((p) => (
                      <View key={p.id} style={{ gap: 6, paddingVertical: 8 }}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Open ${p.body.slice(0, 50)}`}
                          onPress={() => onOpenPost(p)}
                        >
                          <Text style={depthStyles.body}>{p.body || 'Media post'}</Text>
                          <Text style={depthStyles.hint}>{p.author.displayName}</Text>
                        </Pressable>
                        {!collection.id.startsWith('topic:') &&
                        (collection.creator_id === user || data.host || p.collectedBy === user) ? (
                          <ActionButton
                            compact
                            variant="outline"
                            label="Remove from collection"
                            disabled={task.busy}
                            onPress={() =>
                              void task.run(async () => {
                                await api.collectPost(user, collection.id, p.id, true);
                                await loadLibrary(collection);
                              })
                            }
                          />
                        ) : null}
                      </View>
                    ))
                  ) : (
                    <Text style={depthStyles.hint}>No saved posts in this collection yet.</Text>
                  )}
                  {libraryMore ? (
                    <ActionButton
                      compact
                      variant="outline"
                      label="Load more library posts"
                      disabled={task.busy}
                      onPress={() => void task.run(() => loadLibrary(collection, libraryOffset))}
                    />
                  ) : null}
                </>
              ) : (
                <>
                  {!data.collections.length ? (
                    <InlineNotice>
                      Create the first collection to save useful posts together.
                    </InlineNotice>
                  ) : null}
                  {data.collections.map((c) => (
                    <View key={c.id} style={{ gap: 6 }}>
                      <ActionButton
                        compact
                        variant="outline"
                        label={post ? `Add to ${c.name}` : c.name}
                        disabled={task.busy}
                        onPress={() =>
                          void task.run(async () => {
                            if (post) {
                              await api.collectPost(user, c.id, post.id);
                              setNotice(`Added to ${c.name}.`);
                            } else {
                              await loadLibrary(c);
                            }
                          })
                        }
                      />
                      {(c.creator_id === user || data.host) && !post ? (
                        <ActionButton
                          compact
                          variant="outline"
                          label={`Delete collection ${c.name}`}
                          disabled={task.busy}
                          onPress={() =>
                            void task.run(() => change('circle_collections', { id: c.id }, true))
                          }
                        />
                      ) : null}
                    </View>
                  ))}
                  <CommunityField
                    label="New collection name"
                    value={name}
                    max={80}
                    onChange={setName}
                  />
                  <ActionButton
                    label="Create collection"
                    disabled={task.busy || name.trim().length < 2}
                    onPress={() =>
                      void task.run(async () => {
                        await change('circle_collections', { name: name.trim(), creator_id: user });
                        setName('');
                      })
                    }
                  />
                </>
              )}
              <Disclosure title="Topics">
                {!data.topics.length ? (
                  <Text style={depthStyles.hint}>
                    No topics yet. A host can add topics in Community settings.
                  </Text>
                ) : null}
                {data.topics.map((t) => (
                  <ActionButton
                    key={t.id}
                    compact
                    variant="outline"
                    label={`Browse ${t.name}`}
                    disabled={task.busy}
                    onPress={() =>
                      void task.run(async () => {
                        await loadLibrary({
                          id: `topic:${t.id}`,
                          circle_id: circle.id,
                          name: t.name,
                          creator_id: '',
                        });
                      })
                    }
                  />
                ))}
                <Text style={depthStyles.hint}>
                  Hosts manage topics in Community settings. Choose a topic when asking a question
                  or posting a poll.
                </Text>
              </Disclosure>
            </>
          ) : null}
          {kind === 'host' ? (
            data.host ? (
              <>
                <Disclosure title="Circle chat">
                  <Toggle label="Enable circle chat" value={chat} onChange={setChat} />
                  <CommunityField
                    label="Minimum seconds between messages (0–300)"
                    value={slow}
                    onChange={setSlow}
                    max={3}
                  />
                  <ActionButton
                    label="Save chat settings"
                    disabled={task.busy}
                    onPress={() =>
                      void task.run(async () => {
                        const seconds = Number(slow);
                        if (!Number.isInteger(seconds) || seconds < 0 || seconds > 300)
                          throw Error('Enter a whole number from 0 to 300.');
                        await change('circle_chat_settings', {
                          enabled: chat,
                          slow_seconds: seconds,
                        });
                      })
                    }
                  />
                  <Text style={depthStyles.hint}>
                    Hosts can pause chat, slow the conversation, and remove messages. Chat is off by
                    default.
                  </Text>
                </Disclosure>
                <Disclosure title="Optional weekly prompt">
                  <Toggle label="Post a weekly question" value={weekly} onChange={setWeekly} />
                  <CommunityField
                    label="Weekly question"
                    value={prompt}
                    max={500}
                    onChange={setPrompt}
                  />
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => (
                      <Pill key={d} label={d} selected={day === i} onPress={() => setDay(i)} />
                    ))}
                  </View>
                  <Text style={depthStyles.hint}>Posted once on the selected day, using UTC.</Text>
                  <ActionButton
                    label="Save weekly prompt"
                    disabled={task.busy || prompt.trim().length < 2}
                    onPress={() =>
                      void task.run(() =>
                        change('circle_prompts', {
                          question: prompt.trim(),
                          weekday: day,
                          enabled: weekly,
                        }),
                      )
                    }
                  />
                </Disclosure>
                <Disclosure title="Topics">
                  {data.topics.map((t) => (
                    <ActionButton
                      key={t.id}
                      compact
                      variant="outline"
                      label={`Remove topic ${t.name}`}
                      onPress={() =>
                        void task.run(() => change('circle_topics', { id: t.id }, true))
                      }
                    />
                  ))}
                  <CommunityField label="New topic name" value={name} max={40} onChange={setName} />
                  <ActionButton
                    label="Add topic"
                    disabled={task.busy || name.trim().length < 2}
                    onPress={() =>
                      void task.run(async () => {
                        await change('circle_topics', { name: name.trim() });
                        setName('');
                      })
                    }
                  />
                </Disclosure>
                <Disclosure title="Member recognition">
                  <Text style={depthStyles.hint}>
                    Recognise helpful contributions. Recipients can remove their recognition.
                  </Text>
                  {data.members.map((m) => (
                    <Pill
                      key={m.user_id}
                      label={m.profiles?.display_name ?? 'Member'}
                      selected={recipient === m.user_id}
                      onPress={() => setRecipient(m.user_id)}
                    />
                  ))}
                  <CommunityField
                    label="Recognition label"
                    value={badge}
                    max={40}
                    onChange={setBadge}
                  />
                  <ActionButton
                    label="Recognise member"
                    disabled={task.busy || !recipient || badge.trim().length < 2}
                    onPress={() =>
                      void task.run(() =>
                        change('circle_recognition', {
                          user_id: recipient,
                          label: badge.trim(),
                          granted_by: user,
                        }),
                      )
                    }
                  />
                  {data.recognition.map((r) => (
                    <ActionButton
                      key={r.user_id}
                      compact
                      variant="outline"
                      label={`Remove ${r.profiles?.display_name ?? 'member'}: ${r.label}`}
                      onPress={() =>
                        void task.run(() =>
                          change('circle_recognition', { user_id: r.user_id }, true),
                        )
                      }
                    />
                  ))}
                </Disclosure>
              </>
            ) : (
              <Text style={depthStyles.hint}>
                Circle hosts and moderators manage these settings.
              </Text>
            )
          ) : null}
          {kind === 'invite' ? (
            data.host ? (
              <>
                <Text style={depthStyles.hint}>
                  Invitations expire after 7 days and can be revoked. Private circles still require
                  host approval. Private content and members are never included in previews.
                </Text>
                {circle.isPrivate ? (
                  <Toggle
                    label="Allow the circle name in invitation previews"
                    value={previewName}
                    onChange={setPreviewName}
                  />
                ) : null}
                <ActionButton
                  label="Create invitation"
                  disabled={task.busy}
                  onPress={() =>
                    void task.run(async () => {
                      setInvite(await api.createInvite(user, circle.id, previewName));
                      await load();
                    })
                  }
                />
                {invite ? (
                  <>
                    <Text selectable style={depthStyles.body}>
                      {api.invitationUrl(invite.token)}
                    </Text>
                    <ActionButton
                      label="Share invitation"
                      onPress={() => void Share.share({ message: api.invitationUrl(invite.token) })}
                    />
                  </>
                ) : null}
                {invites.map((i) => (
                  <View key={i.token}>
                    <Text style={depthStyles.hint}>
                      Expires {new Date(i.expires_at).toLocaleString()}
                    </Text>
                    <ActionButton
                      compact
                      variant="outline"
                      label={`Revoke invitation ending ${i.token.slice(-6)}`}
                      disabled={task.busy}
                      onPress={() =>
                        void task.run(async () => {
                          const r = await supabase!
                            .from('circle_invites')
                            .delete()
                            .eq('circle_id', circle.id)
                            .eq('token', i.token);
                          if (r.error) throw r.error;
                          if (invite?.token === i.token) setInvite(null);
                          await load();
                        })
                      }
                    />
                  </View>
                ))}
              </>
            ) : (
              <Text style={depthStyles.hint}>Ask a host for an invitation link.</Text>
            )
          ) : null}
        </>
      )}
    </Sheet>
  );
}
function CatchupSheet({
  user,
  onClose,
  onOpen,
}: {
  user: string;
  onClose: () => void;
  onOpen: (p: CirclePost) => void;
}) {
  const [data, setData] = useState<api.Catchup | null>(null);
  const task = useTask(),
    alive = useRef(true);
  const load = async () => {
    const d = await api.catchup(user);
    if (alive.current) setData(d);
  };
  useEffect(() => {
    void task.run(load);
    return () => {
      alive.current = false;
    };
  }, []);
  const open = (id: string) =>
    void task.run(async () => {
      const p = await loadPostById(id);
      if (!p) throw Error('This post is no longer available.');
      onOpen(p);
    });
  return (
    <Sheet
      title="Your catch-up"
      eyebrow="SINCE YOUR LAST VISIT"
      onClose={onClose}
      footer={
        <ActionButton
          label="Mark caught up"
          disabled={task.busy || !data}
          onPress={() =>
            void task.run(async () => {
              await api.markCaughtUp(user);
              onClose();
            })
          }
        />
      }
    >
      <Text style={depthStyles.hint}>
        Only conversations you can access. Weekly reminders are optional in Settings →
        Notifications.
      </Text>
      {task.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.error }}>
          {task.error}
        </Text>
      ) : null}
      {!data ? (
        <ActionButton
          label="Load catch-up"
          disabled={task.busy}
          onPress={() => void task.run(load)}
        />
      ) : (
        <>
          <Text style={depthStyles.hint}>Since {new Date(data.since).toLocaleString()}</Text>
          {(
            [
              ['Unanswered questions', data.unanswered],
              ['New conversations', data.posts],
              ['Replies for you', data.replies],
            ] as const
          ).map(([title, rows]) => (
            <Disclosure key={title} title={`${title} · ${rows.length}`}>
              {rows.length ? (
                rows.map((r) => (
                  <ActionButton
                    key={r.id}
                    compact
                    variant="outline"
                    label={'body' in r ? r.body.slice(0, 160) : r.title}
                    onPress={() => open('target_id' in r ? r.target_id : r.id)}
                  />
                ))
              ) : (
                <Text style={depthStyles.hint}>You’re up to date.</Text>
              )}
            </Disclosure>
          ))}
          <Disclosure title={`Upcoming events · ${data.events.length}`}>
            {data.events.map((e) => (
              <Text key={e.id} style={depthStyles.body}>
                {e.title} · {new Date(e.starts_at).toLocaleString()}
              </Text>
            ))}
          </Disclosure>
        </>
      )}
    </Sheet>
  );
}

const helpfulCache = new Map<string, Promise<string | null>>();
export function HelpfulAnswer({ post, comment }: { post: CirclePost; comment: PostComment }) {
  const ctx = useCommunity(),
    [helpful, setHelpful] = useState<string | null>(null);
  const task = useTask();
  useEffect(() => {
    let active = true;
    if (ctx && post.postType === 'question') {
      const key = `${ctx.profile.id}:${ctx.revision}:${post.id}`;
      if (!helpfulCache.has(key)) {
        if (helpfulCache.size > 100) helpfulCache.clear();
        helpfulCache.set(key, api.loadHelpful(ctx.profile.id, post.id));
      }
      void helpfulCache
        .get(key)!
        .then((h) => {
          if (active) setHelpful(h);
        })
        .catch(() => {
          helpfulCache.delete(key);
        });
    }
    return () => {
      active = false;
    };
  }, [post.id, post.postType, ctx?.profile.id, ctx?.revision]);
  if (!ctx || post.postType !== 'question') return null;
  const allowed = ctx.hostCircles.has(post.circleId) || ctx.profile.id === post.author.id;
  return (
    <View>
      {helpful === comment.id ? (
        <Text style={{ ...depthStyles.hint, color: colors.coral }}>✓ Marked helpful</Text>
      ) : null}
      {allowed ? (
        <ActionButton
          compact
          variant="outline"
          label={helpful === comment.id ? 'Unmark helpful answer' : 'Mark helpful answer'}
          disabled={task.busy}
          onPress={() =>
            void task.run(async () => {
              await api.helpfulAnswer(
                ctx.profile.id,
                post.id,
                helpful === comment.id ? undefined : comment.id,
              );
              ctx.refresh();
            })
          }
        />
      ) : null}
      {task.error ? <Text style={{ color: colors.error }}>{task.error}</Text> : null}
    </View>
  );
}
export function MemberRecognition({ circleId, userId }: { circleId: string; userId: string }) {
  const ctx = useCommunity(),
    label = ctx?.recognition[`${circleId}:${userId}`];
  return label ? <Text style={{ ...depthStyles.hint, color: colors.coral }}>✦ {label}</Text> : null;
}

export function PostTopicPicker({
  circleId,
  selected,
  onSelect,
  disabled,
}: {
  circleId: string;
  selected: string | null;
  onSelect: (id: string | null) => void;
  disabled: boolean;
}) {
  const ctx = useCommunity(),
    [topics, setTopics] = useState<api.Topic[]>([]),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setTopics([]);
    setError('');
    if (!circleId || !ctx) return;
    const load = async () => {
      if (supabase) {
        const r = await supabase
          .from('circle_topics')
          .select('*')
          .eq('circle_id', circleId)
          .order('name');
        if (r.error) throw r.error;
        if (active) setTopics(r.data ?? []);
      } else {
        const d = await api.circleDepth(ctx.profile.id, circleId);
        if (active) setTopics(d.topics);
      }
    };
    void load().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [circleId, ctx?.profile.id, ctx?.revision]);
  return topics.length || error ? (
    <Disclosure title="Topic (optional)">
      {error ? <Text style={{ color: colors.error }}>{error}</Text> : null}
      <Pill
        label="No topic"
        selected={!selected}
        onPress={disabled ? undefined : () => onSelect(null)}
      />
      {topics.map((t) => (
        <Pill
          key={t.id}
          label={t.name}
          selected={selected === t.id}
          onPress={disabled ? undefined : () => onSelect(t.id)}
        />
      ))}
    </Disclosure>
  ) : null;
}
