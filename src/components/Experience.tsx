import { Sheet } from './Sheet';
import { ScheduleDateField, AddToCalendar } from './ScheduleDateField';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, Switch, Text, TextInput, View } from 'react-native';
import { ActionButton, Avatar, Pill, Icon } from './Primitives';
import { createThemedStyles, colors, spacing, typography } from '../theme';
import { supabase } from '../lib/supabase';
import { loadLiveSessions, followUser, loadFollowing } from '../lib/repositories';
import { searchDiscovery } from '../lib/community';
import {
  defaultDiscovery,
  loadCircleOverview,
  saveCircleRules,
  setCircleRole,
  loadScheduledRooms,
  saveScheduledRoom,
  setLiveReminder,
  manageScheduledRoom,
  loadReactions,
  reactToContent,
  reactionEmoji,
  type Reaction,
  type DiscoveryOptions,
  type ScheduledRoom,
  type CircleMember,
} from '../lib/experience';
import type { Circle, LiveSession, Profile } from '../types';

export const experienceStyles = createThemedStyles(() => ({
  stack: { gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  body: { ...typography.body, color: colors.ink },
  label: { ...typography.secondary, color: colors.ink, fontWeight: '700' },
  hint: { ...typography.secondary, color: colors.muted },
  title: { ...typography.section, color: colors.ink },
  field: {
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderColor: colors.controlBorder,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    minHeight: 48,
  },
  error: { ...typography.secondary, color: colors.error },
  quiet: { minHeight: 48, minWidth: 48, paddingHorizontal: 8, justifyContent: 'center' },
  quote: {
    borderLeftWidth: 3,
    borderColor: colors.coral,
    padding: 8,
    backgroundColor: colors.paper,
    borderRadius: 8,
  },
}));
const s = experienceStyles;
const message = (e: unknown) =>
  e instanceof Error ? e.message : 'Could not save. Please try again.';
export function LabeledField({
  label,
  ...props
}: React.ComponentProps<typeof TextInput> & { label: string }) {
  return (
    <View style={s.stack}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[s.field, props.style]}
      />
    </View>
  );
}
export function DiscoveryControls({
  value,
  onChange,
  onClear,
}: {
  value: DiscoveryOptions;
  onChange: (v: DiscoveryOptions) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const count =
    Number(value.privacy !== 'all') +
    Number(value.sort !== 'recommended') +
    Number(value.activeOnly);
  return (
    <View style={{ paddingHorizontal: spacing.page, gap: 12, marginBottom: 16 }}>
      <ActionButton
        compact
        variant="outline"
        label={`Filters${count ? ` · ${count} active` : ''}`}
        onPress={() => setOpen(true)}
      />
      {open ? (
        <Sheet
          title="Filter circles"
          eyebrow=""
          onClose={() => setOpen(false)}
          footer={<ActionButton label="Show results" onPress={() => setOpen(false)} />}
        >
          <Text style={s.label}>Membership</Text>
          <View style={s.row}>
            {(['all', 'public', 'private'] as const).map((privacy) => (
              <Pill
                key={privacy}
                label={
                  privacy === 'all' ? 'Any circle' : privacy === 'public' ? 'Public' : 'Private'
                }
                selected={value.privacy === privacy}
                onPress={() => onChange({ ...value, privacy })}
              />
            ))}
          </View>
          <Text style={s.label}>Sort circles</Text>
          <View style={s.row}>
            {(['recommended', 'active', 'popular', 'newest'] as const).map((sort) => (
              <Pill
                key={sort}
                label={
                  {
                    recommended: 'For you',
                    active: 'Recently active',
                    popular: 'Popular',
                    newest: 'New',
                  }[sort]
                }
                selected={value.sort === sort}
                onPress={() => onChange({ ...value, sort })}
              />
            ))}
          </View>
          <View style={s.row}>
            <Text style={[s.label, { flex: 1 }]}>Active in the last 7 days</Text>
            <Switch
              accessibilityLabel="Active in the last seven days"
              value={value.activeOnly}
              onValueChange={(activeOnly) => onChange({ ...value, activeOnly })}
            />
          </View>
          <ActionButton
            compact
            variant="outline"
            label="Clear search and filters"
            onPress={() => {
              onChange(defaultDiscovery);
              onClear();
            }}
          />
        </Sheet>
      ) : null}
    </View>
  );
}
export function useContentReactions(kind: 'message' | 'comment', ids: string[]) {
  const [reactions, setReactions] = useState<Record<string, Reaction[]>>({}),
    [error, setError] = useState('');
  const pending = useRef(new Set<string>()),
    epoch = useRef(0),
    request = useRef(0),
    refreshRef = useRef<() => Promise<void>>(async () => {});
  const key = ids.join(',');
  useEffect(() => {
    const scope = ++epoch.current;
    setReactions({});
    setError('');
    const refresh = async () => {
      const version = ++request.current;
      try {
        const result = await loadReactions(kind, ids);
        if (epoch.current === scope && request.current === version) {
          setReactions(result);
          setError('');
        }
      } catch (e) {
        if (epoch.current === scope && request.current === version) setError(message(e));
      }
    };
    refreshRef.current = refresh;
    void refresh();
    const channel = supabase
      ?.channel(`reactions-${kind}-${key.slice(0, 40)}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: `${kind}_reactions` },
        () => void refresh(),
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED' && epoch.current === scope) void refresh();
      });
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active' && epoch.current === scope) void refresh();
    });
    return () => {
      epoch.current++;
      foreground.remove();
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [kind, key]);
  const react = async (id: string, emoji: string, remove: boolean) => {
    const action = `${id}:${emoji}`,
      scope = epoch.current;
    if (pending.current.has(action)) return;
    pending.current.add(action);
    request.current++;
    setError('');
    try {
      await reactToContent(kind, id, emoji, remove);
      if (epoch.current === scope) await refreshRef.current();
    } catch (e) {
      if (epoch.current === scope) setError(message(e));
    } finally {
      pending.current.delete(action);
    }
  };
  return { reactions, error, react };
}
export function ReactionBar({
  items = [],
  viewerId,
  onReact,
  light = false,
  allowPicker = true,
}: {
  items?: Reaction[];
  viewerId: string;
  onReact: (emoji: string, remove: boolean) => void;
  light?: boolean;
  allowPicker?: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  return (
    <View style={s.row}>
      {reactionEmoji
        .filter((emoji) => choosing || items.some((item) => item.emoji === emoji))
        .map((emoji) => {
          const count = items.filter((r) => r.emoji === emoji).length,
            selected = items.some((r) => r.emoji === emoji && r.user_id === viewerId);
          return (
            <Pressable
              key={emoji}
              accessibilityRole="button"
              accessibilityLabel={`${selected ? 'Remove' : 'Add'} ${emoji} reaction, ${count}`}
              accessibilityState={{ selected }}
              onPress={() => {
                onReact(emoji, selected);
                setChoosing(false);
              }}
              style={[
                s.quiet,
                {
                  borderRadius: 12,
                  backgroundColor: selected ? colors.lilac : light ? '#ffffff18' : colors.paper,
                },
              ]}
            >
              <Text
                style={{
                  fontSize: 14,
                  color: selected ? colors.ink : light ? 'white' : colors.ink,
                }}
              >
                {emoji}
                {count ? ` ${count}` : ''}
              </Text>
            </Pressable>
          );
        })}
      {allowPicker ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={choosing ? 'Close reactions' : 'Add reaction'}
          accessibilityState={{ expanded: choosing }}
          onPress={() => setChoosing(!choosing)}
          style={s.quiet}
        >
          <Icon name="plus" color={light ? 'white' : colors.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}
export function FollowSuggestions({ interests }: { interests: string[] }) {
  const [people, setPeople] = useState<Profile[]>([]),
    [following, setFollowing] = useState(new Set<string>()),
    [error, setError] = useState(''),
    [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void Promise.all([searchDiscovery('', interests[0] ?? 'For you'), loadFollowing()])
      .then(([r, f]) => {
        if (active) {
          setPeople(r.people.slice(0, 5));
          setFollowing(new Set(f.map((p) => p.id)));
        }
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [interests.join(',')]);
  return (
    <View style={s.stack}>
      <Text style={s.title}>Meet your people</Text>
      <Text style={s.body}>
        Follow people who share your interests. When you follow each other, you can send direct
        messages.
      </Text>
      {people.map((p) => (
        <View key={p.id} style={s.card}>
          <View style={s.row}>
            <Avatar profile={p} />
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{p.displayName}</Text>
              <Text style={s.hint}>
                {p.interests.filter((i) => interests.includes(i)).join(' · ') ||
                  p.bio ||
                  'A member of the Circles community'}
              </Text>
            </View>
          </View>
          <ActionButton
            compact
            variant={following.has(p.id) ? 'secondary' : 'outline'}
            disabled={busy !== null || following.has(p.id)}
            label={following.has(p.id) ? 'Following' : busy === p.id ? 'Following…' : 'Follow'}
            onPress={() => {
              setBusy(p.id);
              void (supabase ? followUser(p.id) : Promise.resolve())
                .then(() => setFollowing((old) => new Set([...old, p.id])))
                .catch((e) => setError(message(e)))
                .finally(() => setBusy(null));
            }}
          />
        </View>
      ))}
      {!people.length && !error ? (
        <Text style={s.hint}>You can discover more people in Explore after joining a circle.</Text>
      ) : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
    </View>
  );
}
export function CircleOverview({
  circle,
  onRole,
}: {
  circle: Circle;
  onRole?: (role: string) => void;
}) {
  const [rules, setRules] = useState(''),
    [members, setMembers] = useState<CircleMember[]>([]),
    [editing, setEditing] = useState(false),
    [limit, setLimit] = useState(100),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = async () => {
    const result = await loadCircleOverview(circle, limit);
    setRules(result.rules);
    setMembers(result.members);
    onRole?.(result.ownRole ?? 'member');
  };
  useEffect(() => {
    let active = true;
    void loadCircleOverview(circle, limit)
      .then((r) => {
        if (!active) return;
        setRules(r.rules);
        setMembers(r.members);
        onRole?.(r.ownRole ?? 'member');
      })
      .catch((e) => {
        if (active) setError(message(e));
      });
    return () => {
      active = false;
    };
  }, [circle.id, limit]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={s.card}>
      <Text style={s.title}>Community overview</Text>
      <Text style={s.body}>{circle.description}</Text>
      <Text style={s.label}>Circle rules</Text>
      {editing ? (
        <LabeledField
          label="Rules for your circle"
          value={rules}
          onChangeText={setRules}
          multiline
          maxLength={3000}
        />
      ) : (
        <Text style={s.body}>
          {rules || 'Be kind, respect privacy, and keep conversations relevant to this circle.'}
        </Text>
      )}
      {circle.isOwner ? (
        <ActionButton
          compact
          variant="outline"
          disabled={busy}
          label={editing ? 'Save rules' : 'Edit rules'}
          onPress={() => {
            if (editing)
              void run(async () => {
                await saveCircleRules(circle, rules);
                setEditing(false);
              });
            else setEditing(true);
          }}
        />
      ) : null}
      <Text style={s.label}>Members and roles</Text>
      <Text style={s.hint}>
        Owners manage access and roles. Moderators can organise and cancel events.
      </Text>
      {members.map((m) => (
        <View key={m.user_id} style={s.stack}>
          <View style={s.row}>
            <Avatar profile={m.profile} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{m.profile.displayName}</Text>
              <Text style={s.hint}>{m.role}</Text>
            </View>
          </View>
          {circle.isOwner && m.role !== 'owner' ? (
            <ActionButton
              compact
              variant="outline"
              disabled={busy}
              label={m.role === 'moderator' ? 'Remove moderator role' : 'Make moderator'}
              onPress={() =>
                void run(() =>
                  setCircleRole(
                    circle.id,
                    m.user_id,
                    m.role === 'moderator' ? 'member' : 'moderator',
                  ),
                )
              }
            />
          ) : null}
        </View>
      ))}
      {members.length === limit ? (
        <ActionButton
          compact
          variant="outline"
          label="More members"
          disabled={busy}
          onPress={() => setLimit((old) => old + 100)}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
export function ScheduledRooms({
  profile,
  circles,
  onLive,
}: {
  profile: Profile;
  circles: Circle[];
  onLive: (room: LiveSession) => void;
}) {
  const [hostTools, setHostTools] = useState<string | null>(null);
  const [rooms, setRooms] = useState<ScheduledRoom[]>([]),
    [editing, setEditing] = useState<string | null>(null),
    [title, setTitle] = useState(''),
    [date, setDate] = useState(''),
    [circle, setCircle] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const refresh = () => loadScheduledRooms().then(setRooms);
  useEffect(() => {
    let active = true;
    const reload = () =>
      void loadScheduledRooms()
        .then((r) => {
          if (active) setRooms(r);
        })
        .catch((e) => {
          if (active) setError(message(e));
        });
    reload();
    const interval = setInterval(reload, 30000);
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') reload();
    });
    return () => {
      active = false;
      clearInterval(interval);
      listener.remove();
    };
  }, [profile.id]);
  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ paddingHorizontal: 20, gap: 12, marginBottom: 24 }}>
      <Text style={s.title}>Upcoming rooms</Text>
      <ActionButton
        variant="outline"
        label="Schedule a live room"
        onPress={() => {
          setEditing('new');
          setTitle('');
          setDate('');
          setCircle(null);
        }}
      />
      {editing ? (
        <Sheet
          title={editing === 'new' ? 'Schedule a live room' : 'Edit scheduled room'}
          eyebrow="LIVE ROOMS"
          onClose={() => {
            if (!busy) setEditing(null);
          }}
          footer={
            <ActionButton
              disabled={busy || title.trim().length < 2 || !date.trim()}
              label={busy ? 'Saving…' : 'Save scheduled room'}
              onPress={() =>
                void run(async () => {
                  await saveScheduledRoom(
                    title,
                    date.replace(' ', 'T'),
                    circle,
                    editing === 'new' ? undefined : editing,
                  );
                  setEditing(null);
                })
              }
            />
          }
        >
          <LabeledField label="Room title" value={title} onChangeText={setTitle} maxLength={120} />
          <ScheduleDateField value={date} onChangeText={setDate} />
          <Text style={s.hint}>
            Time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. Reminders arrive 15
            minutes before the room.
          </Text>
          {editing === 'new' ? (
            <View style={s.row}>
              <Pill label="Everyone" selected={!circle} onPress={() => setCircle(null)} />
              {circles
                .filter((c) => c.isMember)
                .map((c) => (
                  <Pill
                    key={c.id}
                    label={c.name}
                    selected={circle === c.id}
                    onPress={() => setCircle(c.id)}
                  />
                ))}
            </View>
          ) : null}

          <ActionButton
            variant="outline"
            label="Cancel editing"
            disabled={busy}
            onPress={() => setEditing(null)}
          />
          {error ? (
            <Text accessibilityRole="alert" style={s.error}>
              {error}
            </Text>
          ) : null}
        </Sheet>
      ) : null}
      {rooms.map((room) => (
        <View key={room.id} style={s.card}>
          <Text style={s.label}>{room.title}</Text>
          <Text style={s.body}>{new Date(room.starts_at).toLocaleString()}</Text>
          <AddToCalendar title={room.title} startsAt={room.starts_at} />
          <Text style={s.hint}>
            {room.host?.displayName ?? 'You'} ·{' '}
            {room.status === 'live' ? 'Started' : room.circle_id ? 'Circle members' : 'Open room'}
          </Text>
          {room.status === 'scheduled' ? (
            <>
              <ActionButton
                compact
                variant={room.reminded ? 'secondary' : 'outline'}
                disabled={busy || Date.parse(room.starts_at) <= Date.now()}
                label={room.reminded ? 'Reminder on · turn off' : 'Remind me'}
                onPress={() => void run(() => setLiveReminder(room))}
              />
              {room.host_id === profile.id ? (
                <View style={s.stack}>
                  <ActionButton
                    compact
                    variant="outline"
                    label={hostTools === room.id ? 'Hide host actions' : 'Host actions'}
                    onPress={() => setHostTools(hostTools === room.id ? null : room.id)}
                  />
                  {hostTools === room.id ? (
                    <>
                      <ActionButton
                        compact
                        label="Start room now"
                        disabled={busy}
                        onPress={() =>
                          void run(async () => {
                            const id = await manageScheduledRoom(room.id, 'start');
                            const live = (await loadLiveSessions()).find((l) => l.id === id);
                            if (!live) throw new Error('Room started. Refresh Live to join it.');
                            onLive(live);
                          })
                        }
                      />
                      <ActionButton
                        compact
                        variant="outline"
                        label="Edit schedule"
                        disabled={busy}
                        onPress={() => {
                          setEditing(room.id);
                          setTitle(room.title);
                          const d = new Date(room.starts_at);
                          setDate(
                            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
                          );
                          setCircle(room.circle_id);
                        }}
                      />
                      <ActionButton
                        compact
                        variant="destructive"
                        label="Cancel scheduled room"
                        disabled={busy}
                        onPress={() =>
                          Alert.alert('Cancel this room?', room.title, [
                            { text: 'Keep room', style: 'cancel' },
                            {
                              text: 'Cancel room',
                              style: 'destructive',
                              onPress: () => void run(() => manageScheduledRoom(room.id, 'cancel')),
                            },
                          ])
                        }
                      />
                    </>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : (
            <ActionButton
              label="Open live room"
              onPress={() =>
                void run(async () => {
                  const live = (await loadLiveSessions()).find(
                    (l) => l.id === room.live_session_id,
                  );
                  if (!live) throw new Error('This room has ended.');
                  onLive(live);
                })
              }
            />
          )}
        </View>
      ))}
      {!rooms.length ? (
        <Text style={s.body}>Plan a conversation and give people time to join you.</Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
