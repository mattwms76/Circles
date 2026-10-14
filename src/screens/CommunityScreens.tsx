import { ScheduleDateField, AddToCalendar } from '../components/ScheduleDateField';
import {
  CircleOverview,
  FollowSuggestions,
  experienceStyles as ex,
} from '../components/Experience';
import { groupActivity } from '../lib/experience';
import { useVideoPlayer, VideoView } from 'expo-video';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { ActionButton, Avatar, CircleTile, EmptyState, Pill } from '../components/Primitives';
import { Sheet } from './AppScreens';
import { createThemedStyles, useReducedMotion, colors } from '../theme';
import { backendReady } from '../lib/supabase';
import { joinCircle } from '../lib/repositories';
import {
  ActivityNotification,
  cancelEvent,
  CircleEvent,
  circleNotificationsEnabled,
  completeOnboarding,
  defaultNotificationSettings,
  deleteAccount,
  enableDevicePush,
  getNotificationSettings,
  isModerator,
  loadActivationMetrics,
  loadBlockedPeople,
  loadEvents,
  loadModerationQueue,
  loadWelcome,
  ModerationReport,
  NotificationSettings,
  requestPasswordReset,
  reviewReport,
  rsvpEvent,
  saveNotificationSettings,
  saveWelcome,
  scheduleEvent,
  searchDiscovery,
  setCircleNotifications,
  setNewPassword,
  unblockPerson,
  uploadAvatar,
} from '../lib/community';
import type { Circle, Profile } from '../types';

const interests = [
  'Film',
  'Gardening',
  'Art',
  'Cooking',
  'Music',
  'Slow living',
  'Books',
  'Fitness',
  'Gaming',
  'Travel',
];
const message = (error: unknown) =>
  error instanceof Error ? error.message : 'Could not save. Please try again.';
export function OnboardingSheet({
  profile,
  onComplete,
}: {
  profile: Profile;
  onComplete: (profile: Profile, introduceIn?: Circle) => void;
}) {
  const [name, setName] = useState(profile.displayName);
  const [selected, setSelected] = useState(profile.interests);
  const [avatar, setAvatar] = useState(profile.avatarUrl);
  const [step, setStep] = useState(0);
  const [suggestions, setSuggestions] = useState<Circle[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [joined, setJoined] = useState<Set<string>>(new Set());
  const [requested, setRequested] = useState<Set<string>>(new Set());
  const finish = async (introduceIn?: Circle) => {
    setBusy(true);
    setError('');
    try {
      onComplete(
        backendReady
          ? await completeOnboarding(name, selected, avatar)
          : {
              ...profile,
              displayName: name,
              interests: selected,
              avatarUrl: avatar,
              onboardingCompletedAt: new Date().toISOString(),
            },
        introduceIn,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const next = async () => {
    setBusy(true);
    setError('');
    try {
      const results = await Promise.all(
        (selected.length ? selected : ['For you']).map((interest) => searchDiscovery('', interest)),
      );
      setSuggestions(
        [...new Map(results.flatMap((r) => r.circles).map((c) => [c.id, c])).values()].slice(0, 12),
      );
      setStep(1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const photo = async () => {
    setError('');
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.75,
      });
      if (!result.canceled) {
        const asset = result.assets[0];
        setAvatar(
          backendReady ? await uploadAvatar(asset.uri, asset.mimeType ?? 'image/jpeg') : asset.uri,
        );
      }
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={
        step === 2
          ? 'Your next conversation'
          : step
            ? 'Find your first circles'
            : 'Make yourself at home'
      }
      eyebrow={`WELCOME · ${step + 1} OF 3`}
      onClose={() => {
        if (!busy) void finish();
      }}
    >
      {step === 0 ? (
        <>
          <View style={ui.center}>
            <Avatar profile={{ ...profile, avatarUrl: avatar }} size={80} />
            <ActionButton
              compact
              variant="outline"
              label="Choose profile photo"
              disabled={busy}
              onPress={() => void photo()}
            />
            <Text style={ui.hint}>Your profile photo is public.</Text>
          </View>
          <Field label="Your name" value={name} onChangeText={setName} maxLength={60} />
          <Text style={ui.label}>What brings you here?</Text>
          <View style={ui.wrap}>
            {interests.map((i) => (
              <Pill
                key={i}
                label={i}
                selected={selected.includes(i)}
                onPress={() =>
                  setSelected((old) => (old.includes(i) ? old.filter((x) => x !== i) : [...old, i]))
                }
              />
            ))}
          </View>
          <ActionButton
            label={busy ? 'Finding circles…' : 'Find my circles'}
            disabled={busy || name.trim().length < 2 || selected.length === 0}
            onPress={() => void next()}
          />
        </>
      ) : step === 1 ? (
        <>
          <Text style={ui.copy}>
            Join a few places you’d like to spend time. Private circles send a request to the host.
          </Text>
          {suggestions.map((c) => (
            <CircleTile
              key={c.id}
              circle={{ ...c, isMember: c.isMember || joined.has(c.id) }}
              requested={requested.has(c.id)}
              onJoin={() => {
                setBusy(true);
                void joinCircle(c)
                  .then((status) => {
                    if (status === 'pending') setRequested((old) => new Set(old).add(c.id));
                    else setJoined((old) => new Set(old).add(c.id));
                  })
                  .catch((e) => setError(message(e)))
                  .finally(() => setBusy(false));
              }}
              joining={busy}
            />
          ))}
          {!suggestions.length ? (
            <EmptyState
              emoji="🌱"
              title="A new beginning"
              detail="Explore more interests or start a circle of your own."
            />
          ) : null}
          <ActionButton label="Continue · meet people" disabled={busy} onPress={() => setStep(2)} />
          <ActionButton
            compact
            variant="outline"
            label="Change interests"
            disabled={busy}
            onPress={() => setStep(0)}
          />
        </>
      ) : (
        <View style={ex.stack}>
          <FollowSuggestions interests={selected} />
          <Text style={ex.title}>Start a conversation</Text>
          <Text style={ex.body}>
            Introduce yourself in a circle, ask a question, or share something you love.
          </Text>
          {requested.size ? (
            <Text style={ex.hint}>
              {requested.size} private-circle request(s) are waiting for host approval. You can
              participate once accepted; check Activity for updates.
            </Text>
          ) : null}
          {suggestions.some((c) => c.isMember || joined.has(c.id)) ? (
            <ActionButton
              label="Introduce yourself"
              disabled={busy}
              onPress={() => void finish(suggestions.find((c) => c.isMember || joined.has(c.id)))}
            />
          ) : (
            <Text style={ex.hint}>
              Join a public circle in Explore to post your first introduction while private requests
              are pending.
            </Text>
          )}
          <ActionButton
            variant="outline"
            label={busy ? 'Saving…' : 'Explore at my own pace'}
            disabled={busy}
            onPress={() => void finish()}
          />
          <ActionButton
            variant="outline"
            label="Back to circles"
            disabled={busy}
            onPress={() => setStep(1)}
          />
        </View>
      )}
      {error ? (
        <Text accessibilityRole="alert" style={ui.error}>
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}
export function Field({
  label,
  ...props
}: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={{ gap: 6, marginBottom: 14 }}>
      <Text style={ui.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={colors.muted}
        {...props}
        style={[ui.field, props.style]}
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
  onChange: (value: boolean) => void;
}) {
  return (
    <View style={ui.row}>
      <Text style={[ui.copy, { flex: 1, marginBottom: 0 }]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ true: colors.green }}
      />
    </View>
  );
}
export function SettingsSheet({
  onClose,
  onBlocksChanged,
  onDeleted,
  onModerator,
}: {
  onClose: () => void;
  onBlocksChanged: () => void;
  onDeleted: () => void;
  onModerator: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [settings, setSettings] = useState<NotificationSettings>(defaultNotificationSettings);
  const [blocked, setBlocked] = useState<Profile[]>([]);
  const [moderator, setModerator] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const load = async () => {
    setBusy(true);
    setFeedback('');
    try {
      const [s, b, m] = await Promise.all([
        getNotificationSettings(),
        loadBlockedPeople(),
        isModerator(),
      ]);
      setSettings(s);
      setBlocked(b);
      setModerator(m);
      setLoaded(true);
    } catch (e) {
      setFeedback(message(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const save = async () => {
    setBusy(true);
    try {
      if (
        !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(settings.quiet_start) ||
        !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(settings.quiet_end)
      )
        throw new Error('Use 24-hour times, for example 22:00.');
      if (backendReady) await saveNotificationSettings(settings);
      setFeedback('Preferences saved.');
    } catch (e) {
      setFeedback(message(e));
    } finally {
      setBusy(false);
    }
  };
  const enable = async (value: boolean) => {
    if (!value) {
      setSettings((s) => ({ ...s, push_enabled: false }));
      return;
    }
    setBusy(true);
    try {
      await enableDevicePush();
      setSettings((s) => ({ ...s, push_enabled: true }));
      setFeedback('Notifications enabled on this device. Save your preferences below.');
    } catch (e) {
      setFeedback(message(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await deleteAccount(password);
      onDeleted();
    } catch (e) {
      setFeedback(message(e));
    } finally {
      setBusy(false);
    }
  };
  const support = process.env.EXPO_PUBLIC_SUPPORT_EMAIL;
  if (!loaded)
    return (
      <Sheet title="Your settings" eyebrow="MAKE CIRCLES YOURS" onClose={onClose}>
        <Text style={ui.copy}>{busy ? 'Loading preferences…' : feedback}</Text>
        {!busy ? <ActionButton label="Try again" onPress={() => void load()} /> : null}
      </Sheet>
    );
  return (
    <Sheet title="Your settings" eyebrow="MAKE CIRCLES YOURS" onClose={onClose}>
      <Text style={ui.heading}>Notifications</Text>
      <Text style={ui.copy}>Activity stays in your inbox. Device alerts are optional.</Text>
      <Toggle
        label="Device notifications"
        value={settings.push_enabled}
        onChange={(v) => {
          if (!busy) void enable(v);
        }}
      />
      {(['messages', 'replies', 'memberships', 'live', 'events'] as const).map((key) => (
        <Toggle
          key={key}
          label={
            {
              messages: 'Messages',
              replies: 'Replies to my posts',
              memberships: 'Membership approvals',
              live: 'Followed hosts going live',
              events: 'Circle events and reminders',
            }[key]
          }
          value={settings[key]}
          onChange={(value) => setSettings((s) => ({ ...s, [key]: value }))}
        />
      ))}
      <Toggle
        label="Quiet hours"
        value={settings.quiet_enabled}
        onChange={(quiet_enabled) => setSettings((s) => ({ ...s, quiet_enabled }))}
      />
      {settings.quiet_enabled ? (
        <>
          <Field
            label="Quiet hours start (24-hour)"
            value={settings.quiet_start.slice(0, 5)}
            onChangeText={(quiet_start) => setSettings((s) => ({ ...s, quiet_start }))}
          />
          <Field
            label="Quiet hours end (24-hour)"
            value={settings.quiet_end.slice(0, 5)}
            onChangeText={(quiet_end) => setSettings((s) => ({ ...s, quiet_end }))}
          />
          <Field
            label="Time zone"
            value={settings.timezone}
            onChangeText={(timezone) => setSettings((s) => ({ ...s, timezone }))}
          />
        </>
      ) : null}
      <Toggle
        label="Share technical error reports"
        value={settings.diagnostics_enabled}
        onChange={(diagnostics_enabled) => setSettings((s) => ({ ...s, diagnostics_enabled }))}
      />
      <Text style={ui.hint}>
        Error codes and technical traces only. No message or post text. Reports are linked to your
        account so deletion also removes them.
      </Text>
      <ActionButton
        label={busy ? 'Saving…' : 'Save preferences'}
        disabled={busy}
        onPress={() => void save()}
      />
      <Text style={ui.heading}>Blocked members</Text>
      {blocked.length ? (
        blocked.map((p) => (
          <View key={p.id} style={ui.row}>
            <Avatar profile={p} />
            <Text style={[ui.copy, { flex: 1 }]}>{p.displayName}</Text>
            <ActionButton
              compact
              variant="outline"
              label="Unblock"
              onPress={() => {
                void unblockPerson(p.id)
                  .then(() => {
                    setBlocked((old) => old.filter((x) => x.id !== p.id));
                    onBlocksChanged();
                  })
                  .catch((e) => setFeedback(message(e)));
              }}
            />
          </View>
        ))
      ) : (
        <Text style={ui.copy}>No blocked members.</Text>
      )}
      {moderator ? (
        <ActionButton label="Open moderator tools" variant="secondary" onPress={onModerator} />
      ) : null}
      {support ? (
        <ActionButton
          label="Contact support"
          variant="outline"
          onPress={() =>
            void Linking.openURL(`mailto:${support}`).catch(() =>
              setFeedback('Could not open your email app.'),
            )
          }
        />
      ) : null}
      <Text style={ui.heading}>Your account</Text>
      <ActionButton
        label="Delete account"
        variant="outline"
        disabled={!backendReady || busy}
        onPress={() => setDeleting(!deleting)}
      />
      {deleting ? (
        <>
          <Text style={ui.copy}>
            This permanently deletes your profile, posts, messages, media, and wallet. Circles with
            other members transfer to the longest-standing member; empty circles are deleted.
          </Text>
          <Field
            label="Current password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
          />
          <Field
            label="Type DELETE to confirm"
            value={confirmation}
            onChangeText={setConfirmation}
            autoCapitalize="characters"
          />
          <ActionButton
            label={busy ? 'Deleting account…' : 'Permanently delete my account'}
            disabled={busy || confirmation !== 'DELETE' || !password}
            onPress={() =>
              Alert.alert('Permanently delete account?', 'This cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete account',
                  style: 'destructive',
                  onPress: () => void remove(),
                },
              ])
            }
          />
        </>
      ) : null}
      {feedback ? (
        <Text accessibilityLiveRegion="polite" style={ui.feedback}>
          {feedback}
        </Text>
      ) : null}
    </Sheet>
  );
}
export function RecoverySheet({
  email,
  recovery,
  onClose,
}: {
  email: string;
  recovery: boolean;
  onClose: () => void;
}) {
  const [value, setValue] = useState(recovery ? '' : email);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [complete, setComplete] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      if (recovery) await setNewPassword(value);
      else await requestPasswordReset(value);
      setFeedback(
        recovery
          ? 'Password updated. You can continue using Circles.'
          : 'If this email has an account, a reset link is on its way.',
      );
      setComplete(true);
    } catch (e) {
      setFeedback(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={recovery ? 'Choose a new password' : 'Reset your password'}
      eyebrow="YOUR ACCOUNT"
      onClose={onClose}
    >
      <Field
        label={recovery ? 'New password (at least 8 characters)' : 'Email address'}
        value={value}
        onChangeText={setValue}
        secureTextEntry={recovery}
        autoCapitalize="none"
        autoComplete={recovery ? 'new-password' : 'email'}
        keyboardType={recovery ? 'default' : 'email-address'}
      />
      <ActionButton
        label={
          complete
            ? 'Done'
            : busy
              ? 'Please wait…'
              : recovery
                ? 'Update password'
                : 'Send reset link'
        }
        disabled={busy || (!complete && (recovery ? value.length < 8 : !value.includes('@')))}
        onPress={complete ? onClose : () => void submit()}
      />
      {feedback ? (
        <Text accessibilityLiveRegion="polite" style={ui.feedback}>
          {feedback}
        </Text>
      ) : null}
    </Sheet>
  );
}
export function ActivitySheet({
  items,
  loading,
  hasMore,
  onMore,
  onRefresh,
  onOpen,
  onClose,
}: {
  items: ActivityNotification[];
  loading: boolean;
  hasMore: boolean;
  onMore: () => void;
  onRefresh: () => void;
  onOpen: (item: ActivityNotification, ids?: string[]) => void;
  onClose: () => void;
}) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const reducedMotion = useReducedMotion();
  const groups = groupActivity(items).filter((g) => !unreadOnly || g.unread > 0);
  return (
    <Modal animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={onClose}>
      <SafeAreaView style={ui.page}>
        <View style={ex.row}>
          <Text style={[ex.title, { flex: 1 }]}>Your activity</Text>
          <ActionButton compact variant="outline" label="Done" onPress={onClose} />
        </View>
        <View style={[ex.row, { marginVertical: 16 }]}>
          <Pill label="All activity" selected={!unreadOnly} onPress={() => setUnreadOnly(false)} />
          <Pill label="Unread" selected={unreadOnly} onPress={() => setUnreadOnly(true)} />
        </View>
        <FlatList
          data={groups}
          keyExtractor={(group) => group.key}
          refreshing={loading}
          onRefresh={onRefresh}
          renderItem={({ item: group }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${group.unread ? 'Unread: ' : ''}${group.latest.title}, ${group.items.length} updates. ${group.latest.body}`}
              onPress={() =>
                onOpen(
                  group.latest,
                  group.items.map((i) => i.id),
                )
              }
              style={[ui.card, group.unread > 0 && { borderColor: colors.green }]}
            >
              {group.unread > 0 ? (
                <Text style={[ex.label, { color: colors.green }]}>● {group.unread} unread</Text>
              ) : (
                <Text style={ex.hint}>Read</Text>
              )}
              <Text style={ex.label}>
                {group.latest.title}
                {group.items.length > 1 ? ` · ${group.items.length} updates` : ''}
              </Text>
              <Text style={ex.body}>{group.latest.body}</Text>
              <Text style={ex.hint}>{new Date(group.latest.created_at).toLocaleString()}</Text>
              <Text style={[ex.label, { color: colors.coral }]}>
                Open{' '}
                {group.latest.kind === 'messages'
                  ? 'conversation'
                  : group.latest.kind === 'replies'
                    ? 'post'
                    : group.latest.kind === 'live'
                      ? 'room'
                      : 'circle'}{' '}
                →
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            <EmptyState
              emoji="🌱"
              title="You’re all caught up"
              detail={
                unreadOnly
                  ? 'No unread activity.'
                  : 'Messages, replies, and circle updates will appear here.'
              }
            />
          }
          ListFooterComponent={
            hasMore ? (
              <ActionButton label="Load more activity" disabled={loading} onPress={onMore} />
            ) : null
          }
        />
      </SafeAreaView>
    </Modal>
  );
}
export function CircleTools({
  circle,
  section = 'about',
}: {
  circle: Circle;
  section?: 'about' | 'events';
}) {
  const [role, setRole] = useState(circle.isOwner ? 'owner' : 'member');
  const canOrganise = circle.isOwner || role === 'moderator';
  const [welcome, setWelcome] = useState('');
  const [editing, setEditing] = useState(false);
  const [events, setEvents] = useState<CircleEvent[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    const [w, e, n] = await Promise.all([
      loadWelcome(circle.id),
      loadEvents(circle.id),
      circleNotificationsEnabled(circle.id),
    ]);
    setWelcome(w);
    setEvents(e);
    setEnabled(n);
  };
  useEffect(() => {
    void refresh().catch((e) => setError(message(e)));
  }, [circle.id]);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  if (!circle.isMember) return null;
  return (
    <View style={{ gap: 12, marginVertical: 14 }}>
      <View style={section === 'about' ? undefined : { display: 'none' }}>
        <CircleOverview circle={circle} onRole={setRole} />

        {welcome ? (
          <View style={ui.card}>
            <Text style={ui.label}>PINNED WELCOME</Text>
            <Text style={ui.copy}>{welcome}</Text>
          </View>
        ) : null}
        <Toggle
          label="Notifications for this circle"
          value={enabled}
          onChange={(v) => {
            if (!busy) void run(() => setCircleNotifications(circle.id, v));
          }}
        />
      </View>
      {section === 'events' ? (
        <>
          <Text style={ui.heading}>Upcoming events</Text>
          {events.map((event) => (
            <View key={event.id} style={ui.card}>
              <Text style={ui.label}>{event.title}</Text>
              <Text style={ui.copy}>{new Date(event.starts_at).toLocaleString()}</Text>
              <Text style={ui.copy}>{event.description}</Text>
              <AddToCalendar
                title={event.title}
                startsAt={event.starts_at}
                description={event.description}
              />
              <ActionButton
                compact
                variant={event.attending ? 'secondary' : 'outline'}
                label={event.attending ? 'Going · cancel RSVP' : 'Join event'}
                disabled={busy}
                onPress={() => void run(() => rsvpEvent(event))}
              />
              {canOrganise ? (
                <ActionButton
                  compact
                  variant="outline"
                  label="Cancel event"
                  disabled={busy}
                  onPress={() =>
                    Alert.alert('Cancel this event?', event.title, [
                      { text: 'Keep event', style: 'cancel' },
                      {
                        text: 'Cancel event',
                        style: 'destructive',
                        onPress: () => void run(() => cancelEvent(event.id)),
                      },
                    ])
                  }
                />
              ) : null}
            </View>
          ))}
          {!events.length ? (
            <EmptyState
              emoji="◷"
              title="Time for something together"
              detail="Upcoming events will appear here. Your host can plan the first one."
            />
          ) : null}
        </>
      ) : null}
      {canOrganise ? (
        <>
          <ActionButton
            compact
            variant="outline"
            label={
              editing
                ? 'Close host tools'
                : section === 'events'
                  ? 'Schedule an event'
                  : 'Edit welcome'
            }
            onPress={() => setEditing(!editing)}
          />
          {editing ? (
            <>
              {circle.isOwner && section === 'about' ? (
                <>
                  <Field
                    label="Pinned welcome"
                    value={welcome}
                    onChangeText={setWelcome}
                    multiline
                    maxLength={3000}
                  />
                  <ActionButton
                    label="Save welcome"
                    disabled={busy}
                    onPress={() => void run(() => saveWelcome(circle.id, welcome))}
                  />
                </>
              ) : null}
              {section === 'events' ? (
                <>
                  <Field
                    label="Event title"
                    value={title}
                    onChangeText={setTitle}
                    maxLength={120}
                  />
                  <Field
                    label="Event description"
                    value={description}
                    onChangeText={setDescription}
                    multiline
                    maxLength={2000}
                  />
                  <ScheduleDateField value={date} onChangeText={setDate} />
                  <ActionButton
                    label="Schedule event"
                    disabled={busy || title.trim().length < 2}
                    onPress={() =>
                      void run(async () => {
                        await scheduleEvent(circle.id, title, description, date.replace(' ', 'T'));
                        setTitle('');
                        setDescription('');
                        setDate('');
                      })
                    }
                  />
                </>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={ui.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
export function ModeratorSheet({ onClose }: { onClose: () => void }) {
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const refresh = async () => {
    setBusy(true);
    try {
      const [r, m] = await Promise.all([loadModerationQueue(), loadActivationMetrics()]);
      setReports(r);
      setMetrics(m);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  const decide = async (id: string, decision: 'remove' | 'resolve' | 'dismiss') => {
    setBusy(true);
    try {
      await reviewReport(id, decision, note);
      setNote('');
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title="Moderator workspace" eyebrow="COMMUNITY CARE" onClose={onClose}>
      <Text style={ui.heading}>New members · last 30 days</Text>
      <Text style={ui.copy}>
        {Object.entries(metrics)
          .map(([key, value]) => `${key}: ${value}`)
          .join(' · ')}
      </Text>
      <Field label="Review note" value={note} onChangeText={setNote} multiline maxLength={1000} />
      <ActionButton
        compact
        variant="outline"
        label="Refresh queue"
        disabled={busy}
        onPress={() => void refresh()}
      />
      {reports.map((r) => (
        <View key={r.id} style={ui.card}>
          <Text style={ui.label}>{r.target_type.toUpperCase()} REPORT</Text>
          <Text style={ui.copy}>{r.reason}</Text>
          <Text style={ui.copy}>{r.content || 'Content is no longer available.'}</Text>
          {r.media?.map((m) =>
            m.url ? (
              <ReportedMedia key={m.path} kind={m.kind} url={m.url} />
            ) : (
              <Text key={m.path}>Attachment unavailable</Text>
            ),
          )}
          <View style={ui.wrap}>
            <ActionButton
              compact
              variant="outline"
              label="Dismiss"
              disabled={busy}
              onPress={() => void decide(r.id, 'dismiss')}
            />
            <ActionButton
              compact
              variant="secondary"
              label="Resolve"
              disabled={busy}
              onPress={() => void decide(r.id, 'resolve')}
            />
            {['post', 'message', 'live_session'].includes(r.target_type) ? (
              <ActionButton
                compact
                variant="destructive"
                label="Remove content"
                disabled={busy}
                onPress={() =>
                  Alert.alert(
                    'Remove reported content?',
                    'This action is recorded in the moderation log.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Remove',
                        style: 'destructive',
                        onPress: () => void decide(r.id, 'remove'),
                      },
                    ],
                  )
                }
              />
            ) : null}
          </View>
        </View>
      ))}
      {!reports.length && !busy ? <Text style={ui.copy}>No open reports.</Text> : null}
      {error ? <Text style={ui.error}>{error}</Text> : null}
    </Sheet>
  );
}
export function ReportSheet({
  onSubmit,
  onClose,
}: {
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('Harassment or bullying');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Sheet title="Report content" eyebrow="KEEP CIRCLES KIND" onClose={onClose}>
      <View style={ui.wrap}>
        {[
          'Harassment or bullying',
          'Spam or scam',
          'Harmful content',
          'Privacy concern',
          'Something else',
        ].map((r) => (
          <Pill key={r} label={r} selected={r === reason} onPress={() => setReason(r)} />
        ))}
      </View>
      <Field
        label="Tell the moderators more (optional)"
        multiline
        value={detail}
        onChangeText={setDetail}
        maxLength={800}
      />
      <ActionButton
        label={busy ? 'Sending…' : 'Submit report'}
        disabled={busy}
        onPress={() => {
          setBusy(true);
          void onSubmit(`${reason}${detail ? ': ' + detail : ''}`)
            .then(onClose)
            .catch((e) => setError(message(e)))
            .finally(() => setBusy(false));
        }}
      />
      {error ? <Text style={ui.error}>{error}</Text> : null}
    </Sheet>
  );
}
const ui = createThemedStyles(() => ({
  page: { flex: 1, padding: 20, backgroundColor: colors.paper },
  center: { alignItems: 'center', gap: 12, marginBottom: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    marginBottom: 8,
  },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.ink,
    marginTop: 20,
    marginBottom: 12,
  },
  label: { fontSize: 15, fontWeight: '700', color: colors.ink },
  copy: { fontSize: 15, lineHeight: 23, color: colors.ink, marginBottom: 10 },
  hint: { fontSize: 13, lineHeight: 20, color: colors.muted, marginBottom: 12 },
  field: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    padding: 13,
    minHeight: 48,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    marginBottom: 12,
    gap: 6,
  },
  error: { fontSize: 15, lineHeight: 22, color: colors.error, marginVertical: 12 },
  feedback: {
    fontSize: 15,
    lineHeight: 23,
    color: colors.ink,
    marginVertical: 14,
  },
}));

function ReportedMedia({ kind, url }: { kind: string; url: string }) {
  const player = useVideoPlayer(kind === 'video' ? url : null);
  return kind === 'video' ? (
    <VideoView player={player} nativeControls style={{ height: 220, width: '100%' }} />
  ) : (
    <Image
      accessibilityLabel="Reported attachment"
      source={{ uri: url }}
      resizeMode="contain"
      style={{ height: 220, width: '100%' }}
    />
  );
}
