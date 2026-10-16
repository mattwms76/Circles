import { useCommunity } from './CommunityContext';
import { feedChoices, updateFeedChoice, hidePost } from '../lib/communityDepth';
import { Sheet } from './Sheet';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, TextInput, View } from 'react-native';
import { loadSavedPostIds, savePost, updateOwnPost } from '../lib/postActions';
import { loadPostById } from '../lib/repositories';
import { colors } from '../theme';
import type { CirclePost } from '../types';
const Context = createContext<{
  open: (post: CirclePost, report?: () => void) => void;
  showSaved: () => void;
  revision: number;
} | null>(null);
export const usePostActions = () => useContext(Context);
function Button({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={{
        padding: 14,
        minHeight: 48,
        borderRadius: 14,
        backgroundColor: label === 'Save changes' ? colors.primary : 'transparent',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Text
        style={{
          color:
            label === 'Save changes'
              ? colors.onPrimary
              : label.startsWith('Delete')
                ? colors.error
                : colors.coral,
          fontSize: 16,
          lineHeight: 24,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
export function SavedPostsButton() {
  const actions = usePostActions();
  return <Button label="Saved posts" onPress={() => actions?.showSaved()} />;
}
export function PostActionsProvider({
  userId,
  onChanged,
  onOpen,
  children,
}: {
  userId: string;
  onChanged: (id: string, body: string | null) => void;
  onOpen: (post: CirclePost) => void;
  children: React.ReactNode;
}) {
  const community = useCommunity();
  const [post, setPost] = useState<CirclePost | null>(null),
    [editing, setEditing] = useState(false),
    [body, setBody] = useState(''),
    [saved, setSaved] = useState<string[]>([]),
    [list, setList] = useState<CirclePost[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const changed = (id: string, body: string | null) => {
    setRevision((v) => v + 1);
    onChanged(id, body);
  };
  const report = useRef<(() => void) | undefined>(undefined),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    void loadSavedPostIds(userId)
      .then((ids) => {
        if (alive.current) setSaved(ids);
      })
      .catch(() => {});
    return () => {
      alive.current = false;
    };
  }, [userId]);
  const running = useRef(false);
  const run = async (fn: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const showSaved = () => {
    setList([]);
    void run(async () => {
      const ids = await loadSavedPostIds(userId);
      const posts: CirclePost[] = [];
      for (let i = 0; i < ids.length; i += 20) {
        const batch = await Promise.all(ids.slice(i, i + 20).map(loadPostById));
        posts.push(...batch.filter((p): p is CirclePost => !!p));
      }
      if (alive.current) {
        setSaved(ids);
        setList(posts);
      }
    });
  };
  return (
    <Context.Provider
      value={{
        open: (p, r) => {
          setPost(p);
          setBody(p.body);
          setEditing(false);
          setError('');
          report.current = r;
        },
        showSaved,
        revision,
      }}
    >
      {children}
      {!!post || list !== null ? (
        <Sheet
          title={post ? (editing ? 'Edit post' : 'Post options') : 'Saved posts'}
          eyebrow=""
          footer={
            post && editing ? (
              <Button
                disabled={busy}
                label="Save changes"
                onPress={() =>
                  void run(async () => {
                    await updateOwnPost(post, userId, body);
                    if (alive.current) {
                      changed(post.id, body.trim());
                      setPost(null);
                    }
                  })
                }
              />
            ) : undefined
          }
          onClose={() => {
            if (!busy) {
              setPost(null);
              setList(null);
            }
          }}
        >
          {error ? (
            <Text accessibilityRole="alert" style={{ color: colors.error }}>
              {error}
            </Text>
          ) : null}
          {busy ? <Text style={{ color: colors.muted }}>Loading…</Text> : null}
          {post ? (
            <>
              {editing ? (
                <>
                  <TextInput
                    accessibilityLabel="Edit post text"
                    multiline
                    value={body}
                    onChangeText={setBody}
                    maxLength={5000}
                    style={{
                      minHeight: 120,
                      fontSize: 16,
                      lineHeight: 24,
                      padding: 12,
                      color: colors.ink,
                      borderWidth: 1,
                      borderColor: colors.line,
                      borderRadius: 12,
                    }}
                  />
                </>
              ) : (
                <>
                  <Button
                    disabled={busy}
                    label={saved.includes(post.id) ? 'Remove from saved posts' : 'Save post'}
                    onPress={() =>
                      void run(async () => {
                        const next = !saved.includes(post.id);
                        await savePost(userId, post.id, next);
                        if (alive.current) {
                          setSaved(await loadSavedPostIds(userId));
                          setPost(null);
                        }
                      })
                    }
                  />
                  {community ? (
                    <>
                      <Button
                        label="Add to circle collection"
                        disabled={busy}
                        onPress={() => {
                          const selected = post;
                          setPost(null);
                          community.collect(selected);
                        }}
                      />
                      <Button
                        label="Favourite this circle"
                        disabled={busy}
                        onPress={() =>
                          void run(async () => {
                            const pref = (await feedChoices(userId)).find(
                              (p) => p.circle_id === post.circleId,
                            );
                            await updateFeedChoice(userId, post.circleId, {
                              favourite: !pref?.favourite,
                            });
                            setPost(null);
                            community.refresh();
                          })
                        }
                      />
                      <Button
                        label="See less from this circle"
                        disabled={busy}
                        onPress={() =>
                          void run(async () => {
                            await updateFeedChoice(userId, post.circleId, { see_less: true });
                            setPost(null);
                            community.refresh();
                          })
                        }
                      />
                      <Button
                        label="Snooze circle for 7 days"
                        disabled={busy}
                        onPress={() =>
                          void run(async () => {
                            await updateFeedChoice(userId, post.circleId, {
                              snoozed_until: new Date(Date.now() + 7 * 86400000).toISOString(),
                            });
                            setPost(null);
                            community.refresh();
                          })
                        }
                      />
                      <Button
                        label="Hide this post"
                        disabled={busy}
                        onPress={() =>
                          void run(async () => {
                            await hidePost(userId, post.id);
                            setPost(null);
                            community.refresh();
                          })
                        }
                      />
                      <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>
                        Why this post? {post.reason ?? 'A conversation in a circle you joined.'}
                      </Text>
                    </>
                  ) : null}
                  {post.author.id === userId ? (
                    <>
                      <Text style={{ color: colors.muted }}>
                        You can edit or remove your timeline posts at any time while you are a
                        member. Removal hides the post from the timeline.
                      </Text>
                      <Button label="Edit post" disabled={busy} onPress={() => setEditing(true)} />
                      <Button
                        label="Delete post"
                        disabled={busy}
                        onPress={() =>
                          Alert.alert(
                            'Delete this post?',
                            'It will be removed from the timeline.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Delete',
                                style: 'destructive',
                                onPress: () =>
                                  void run(async () => {
                                    await updateOwnPost(post, userId, null);
                                    if (alive.current) {
                                      changed(post.id, null);
                                      setPost(null);
                                    }
                                  }),
                              },
                            ],
                          )
                        }
                      />
                    </>
                  ) : report.current ? (
                    <Button
                      label="Report post"
                      onPress={() => {
                        setPost(null);
                        report.current?.();
                      }}
                    />
                  ) : null}
                </>
              )}
            </>
          ) : list?.length ? (
            list.map((item) => (
              <View key={item.id} style={{ borderBottomWidth: 1, borderColor: colors.line }}>
                <Button
                  label={`${item.circleName} · ${item.body || 'Media post'}`}
                  onPress={() => {
                    setList(null);
                    onOpen(item);
                  }}
                />
                <Button
                  label="Remove saved post"
                  disabled={busy}
                  onPress={() =>
                    void run(async () => {
                      await savePost(userId, item.id, false);
                      if (alive.current) {
                        setSaved((ids) => ids.filter((id) => id !== item.id));
                        setList((rows) => rows?.filter((p) => p.id !== item.id) ?? null);
                      }
                    })
                  }
                />
              </View>
            ))
          ) : !busy ? (
            <Text style={{ color: colors.muted }}>
              No accessible saved posts. Save a post from its options menu. Posts from circles you
              leave are hidden.
            </Text>
          ) : null}
        </Sheet>
      ) : null}
    </Context.Provider>
  );
}
