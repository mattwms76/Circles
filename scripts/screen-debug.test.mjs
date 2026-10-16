import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { act, deferred, loadSource, native, mountApp, demo } from './react-fixture.mjs';

const ui = {
  'react-native': native,
  'expo-crypto': { randomUUID: () => 'aaaaaaaa-0000-4000-8000-000000000001' },
  'expo-image': { Image: 'Image' },
  'expo-image-picker': {},
  'expo-audio': {},
  './Sheet': {
    Sheet: ({ children, footer }) => React.createElement(React.Fragment, null, children, footer),
  },
  './Primitives': {
    ActionButton: 'ActionButton',
    Disclosure: ({ children }) => children,
    Pill: 'Pill',
  },
  '../theme': { colors: {} },
  '../appStyles': { styles: {} },
  '../lib/supabase': { supabase: null },
  '../lib/repositories': {},
};
const button = (renderer, label) =>
  renderer.root.findAllByType('ActionButton').find((n) => n.props.label === label);

test('An attachment disappears when the reused message no longer has media', async (t) => {
  const { MessageAttachment } = loadSource('src/components/CommunityMessages.tsx', {
    ...ui,
    '../lib/communityDepth': {},
    '../lib/communityMedia': {
      directAttachment: async (id) =>
        id === 'a' ? { storage_path: 'a.jpg', media_kind: 'photo' } : null,
      messageMediaUrl: async (path) => path,
    },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(MessageAttachment, { messageId: 'a' }));
  });
  t.after(() => act(async () => renderer.unmount()));
  assert.equal(renderer.root.findAllByType('Image').length, 1);
  await act(async () =>
    renderer.update(React.createElement(MessageAttachment, { messageId: 'b' })),
  );
  assert.equal(renderer.root.findAllByType('Image').length, 0);
});

test('Older poll responses cannot overwrite a newer realtime update', async (t) => {
  const old = deferred();
  let calls = 0,
    refresh;
  const channel = {
    on(_name, _filter, fn) {
      refresh = fn;
      return this;
    },
    subscribe() {
      return this;
    },
  };
  const { ParticipationCard } = loadSource('src/components/ParticipationCard.tsx', {
    ...ui,
    './CommunityContext': { useCommunity: () => ({ profile: { id: 'user' } }) },
    '../lib/supabase': { supabase: { channel: () => channel, removeChannel() {} } },
    '../lib/communityDepth': {
      loadPoll: () =>
        ++calls === 1 ? old.promise : Promise.resolve({ options: ['New'], votes: [] }),
    },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(ParticipationCard, { postId: 'post' }));
  });
  t.after(() => act(async () => renderer.unmount()));
  await act(async () => refresh());
  await act(async () => old.resolve({ options: ['Stale'], votes: [] }));
  assert.ok(
    renderer.root
      .findAllByType('Pressable')
      .some((n) => n.props.accessibilityLabel === 'New, 0 percent'),
  );
});

test('Rapid poll taps send only one vote while a request is pending', async (t) => {
  const pending = deferred();
  let votes = 0;
  const { ParticipationCard } = loadSource('src/components/ParticipationCard.tsx', {
    ...ui,
    './CommunityContext': { useCommunity: () => ({ profile: { id: 'user' } }) },
    '../lib/communityDepth': {
      loadPoll: async () => ({ options: ['One', 'Two'], votes: [] }),
      castVote: () => {
        votes++;
        return pending.promise;
      },
    },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(ParticipationCard, { postId: 'post' }));
  });
  t.after(() => act(async () => renderer.unmount()));
  const press = renderer.root
    .findAllByType('Pressable')
    .find((n) => n.props.accessibilityLabel === 'One, 0 percent').props.onPress;
  await act(async () => {
    press();
    press();
  });
  assert.equal(votes, 1);
  await act(async () => pending.resolve());
});

test('Malformed community caches fall back before rendering feed, chat or host controls', async () => {
  const api = loadSource('src/lib/communityDepth.ts', {
    '@react-native-async-storage/async-storage': {
      getItem: async () => '{"chat":null}',
      setItem: async () => {},
    },
    './supabase': { supabase: null },
    './repositories': {},
  });
  assert.equal(Array.isArray(await api.feedChoices('user')), true);
  const circle = await api.circleDepth('user', 'circle', true);
  assert.equal(circle.chat.enabled, false);
  assert.equal(circle.host, true);
});

test('A late participation draft cannot replace text already typed', async (t) => {
  const pending = deferred();
  let context,
    request = 0;
  const Context = React.createContext(null);
  const { CommunityProvider } = loadSource('src/components/CommunityDepth.tsx', {
    ...ui,
    './CommunityContext': {
      CommunityContext: Context,
      useCommunity: () => React.useContext(Context),
    },
    './CommunityMessages': {},
    '../lib/repositories': { createIdempotencyKey: () => String(++request) },
    '../lib/communityDepth': {
      circleDepth: async () => ({
        topics: [],
        collections: [],
        recognition: [],
        members: [],
        chat: { enabled: false, slow_seconds: 0 },
        prompt: null,
        host: true,
      }),
      localValue: () => pending.promise,
      storeValue: async () => {},
    },
  });
  function Probe() {
    context = React.useContext(Context);
    return null;
  }
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        CommunityProvider,
        { profile: { id: 'user' }, circles: [], onChanged() {}, onOpenPost() {} },
        React.createElement(Probe),
      ),
    );
  });
  t.after(() => act(async () => renderer.unmount()));
  await act(async () =>
    context.open('participate', { id: 'circle', name: 'Circle', isOwner: true }),
  );
  const input = () => renderer.root.findByProps({ accessibilityLabel: 'Your question' });
  await act(async () => input().props.onChangeText('New question'));
  await act(async () => pending.resolve({ question: 'Old question', options: ['A', 'B'] }));
  assert.equal(input().props.value, 'New question');
});

test('Refreshing the timeline invalidates pending pagination from the previous sort', async (t) => {
  const app = await mountApp();
  t.after(() => app.close());
  const pending = deferred();
  let calls = 0;
  app.repo.loadPosts = () =>
    ++calls === 1 ? pending.promise : Promise.resolve([{ ...demo.posts[0], id: 'new-sort' }]);
  await act(async () => {
    void app.props('HomeScreen').onLoadMore();
  });
  await act(async () => app.props('HomeScreen').onRefresh());
  await act(async () => pending.resolve([{ ...demo.posts[0], id: 'old-sort' }]));
  assert.deepEqual(
    Array.from(app.props('HomeScreen').feed, (p) => p.id),
    ['new-sort'],
  );
});

test('Library pagination advances past inaccessible posts instead of ending at an empty visible page', async () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({ post_id: String(i), added_by: 'member' }));
  const api = loadSource('src/lib/communityDepth.ts', {
    './supabase': {
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              order: () => ({
                range: async (start, end) => ({ data: rows.slice(start, end + 1), error: null }),
              }),
            }),
          }),
        }),
      },
    },
    './repositories': {
      loadPostById: async (id) => (id === '20' ? { id, body: 'Visible post' } : null),
    },
  });
  const first = await api.collectionPage('member', 'collection');
  assert.equal(first.posts.length, 0);
  assert.equal(first.hasMore, true);
  const second = await api.collectionPage('member', 'collection', first.nextOffset);
  assert.equal(second.posts[0].id, '20');
  assert.equal(second.hasMore, false);
});

test('Replaying a completed voice note waits until rewinding finishes', async (t) => {
  const seek = deferred();
  let plays = 0;
  const { VoicePlayer } = loadSource('src/components/CommunityMessages.tsx', {
    ...ui,
    '../lib/communityDepth': {},
    '../lib/communityMedia': {},
    'expo-audio': {
      useAudioPlayer: () => ({
        pause() {},
        play() {
          plays++;
        },
        seekTo: () => seek.promise,
      }),
      useAudioPlayerStatus: () => ({ didJustFinish: true, playing: false }),
    },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(VoicePlayer, { uri: 'voice.m4a' }));
  });
  t.after(() => act(async () => renderer.unmount()));
  await act(async () => button(renderer, 'Play voice note').props.onPress());
  assert.equal(plays, 0);
  await act(async () => seek.resolve());
  assert.equal(plays, 1);
});

test('An in-flight voice replay cannot restart playback after backgrounding', async (t) => {
  const seek = deferred();
  let plays = 0,
    appState;
  const player = {
    pause() {},
    play() {
      plays++;
    },
    seekTo: () => seek.promise,
  };
  const { VoicePlayer } = loadSource('src/components/CommunityMessages.tsx', {
    ...ui,
    '../lib/communityDepth': {},
    '../lib/communityMedia': {},
    'react-native': {
      ...native,
      View: 'View',
      Text: 'Text',
      AppState: {
        currentState: 'active',
        addEventListener: (_event, fn) => {
          appState = fn;
          return { remove() {} };
        },
      },
    },
    'expo-audio': {
      useAudioPlayer: () => player,
      useAudioPlayerStatus: () => ({ didJustFinish: true, playing: false }),
    },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(VoicePlayer, { uri: 'voice.m4a' }));
  });
  t.after(() => act(async () => renderer.unmount()));
  await act(async () => button(renderer, 'Play voice note').props.onPress());
  await act(async () => appState('background'));
  await act(async () => seek.resolve());
  assert.equal(plays, 0);
});

test('A failed voice recorder preparation releases audio recording mode', async (t) => {
  const modes = [];
  const recorder = {
    isRecording: false,
    prepareToRecordAsync: async () => {
      throw Error('No storage');
    },
    stop: async () => {},
  };
  const { MessageMediaComposer } = loadSource('src/components/CommunityMessages.tsx', {
    ...ui,
    '../lib/communityDepth': {},
    '../lib/communityMedia': {},
    'expo-audio': {
      RecordingPresets: { HIGH_QUALITY: {} },
      useAudioRecorder: () => recorder,
      useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0 }),
      requestRecordingPermissionsAsync: async () => ({ granted: true }),
      setAudioModeAsync: async (mode) => {
        modes.push(mode.allowsRecording);
      },
    },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(MessageMediaComposer, { user: 'user', target: 'peer', onSent() {} }),
    );
  });
  t.after(() => act(async () => renderer.unmount()));
  await act(async () =>
    renderer.root
      .findAllByType('Pressable')
      .find((n) => n.props.accessibilityLabel === 'Photo or voice note')
      .props.onPress(),
  );
  await act(async () => button(renderer, 'Record voice note').props.onPress());
  assert.equal(modes.at(-1), false);
});

test('Authentication tokens are accepted only on the two configured callback routes', () => {
  const { isAuthCallback } = loadSource('src/lib/contentLinks.ts');
  assert.equal(isAuthCallback('circles://auth/callback?code=one-time-code'), true);
  assert.equal(isAuthCallback('circles://auth/recovery#type=recovery'), true);
  for (const url of [
    'circles://post/post-id?code=unrelated',
    'circles://invite/' + 'a'.repeat(64) + '?code=unrelated',
    'circles://someone@auth/callback',
    'circles://auth:443/callback',
    'https://auth/callback',
    'circles://auth/other',
  ])
    assert.equal(isAuthCallback(url), false, url);
});

test('Read receipts and mute changes update independent columns when concurrent', async () => {
  const stored = { muted: false, read_at: 'old' };
  const api = loadSource('src/lib/communityMedia.ts', {
    './supabase': {
      supabase: {
        from: () => ({
          upsert: async (patch) => {
            await Promise.resolve();
            Object.assign(stored, patch);
            return { data: null, error: null };
          },
        }),
      },
    },
    './communityDepth': { assertAccount: async () => {} },
    'expo-file-system/legacy': {},
  });
  await Promise.all([
    api.saveGroupPreference('user', 'circle', { muted: true }),
    api.saveGroupPreference('user', 'circle', { read_at: 'new' }),
  ]);
  assert.equal(stored.muted, true);
  assert.equal(stored.read_at, 'new');
});

test('Video processing stays busy until the edited file has been retained', async (t) => {
  const trimmed = deferred(),
    retained = deferred(),
    processing = [];
  const { PublishingTools } = loadSource('src/components/PublishingTools.tsx', {
    ...ui,
    './CommunityDepth': { CommunityField: 'CommunityField' },
    '../lib/publishing': loadSource('src/lib/publishing.ts'),
    'expo-video': { useVideoPlayer: () => ({ pause() {} }), VideoView: 'VideoView' },
    'react-native-video-trim': {
      isValidFile: async () => ({ isValid: true, duration: 10000 }),
      trim: () => trimmed.promise,
    },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(PublishingTools, {
        items: [{ uri: 'file:///video.mp4', kind: 'video', durationMs: 10000 }],
        disabled: false,
        onChange: () => retained.promise,
        onProcessingChange: (value) => processing.push(value),
        onAddPhotos() {},
      }),
    );
  });
  t.after(() => act(async () => renderer.unmount()));
  await act(async () => button(renderer, 'Apply trim').props.onPress());
  assert.equal(processing.at(-1), true);
  await act(async () =>
    trimmed.resolve({ success: true, outputPath: '/trimmed.mp4', duration: 10000 }),
  );
  assert.equal(processing.at(-1), true);
  await act(async () => retained.resolve());
  assert.equal(processing.at(-1), false);
});

test('The composer blocks publishing and closing during video processing', async (t) => {
  let submits = 0,
    closes = 0;
  const { CreatePostSheet } = loadSource('src/screens/AppScreens.tsx', {
    ...ui,
    '../lib/contentDeletion': loadSource('src/lib/contentDeletion.ts'),
    'react-native-safe-area-context': {
      SafeAreaView: 'SafeAreaView',
      useSafeAreaInsets: () => ({ bottom: 0 }),
    },
    'expo-video': { useVideoPlayer: () => ({}), VideoView: 'VideoView' },
    '../lib/streaming': { AgoraVideoTile: 'AgoraVideoTile', agoraUidFor: () => 1 },
    '../components/Primitives': new Proxy(
      { formatCount: String },
      { get: (o, k) => o[k] ?? String(k) },
    ),
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(CreatePostSheet, {
        progress: 0,
        error: '',
        busy: false,
        circles: [demo.circles[0]],
        selectedCircleId: demo.circles[0].id,
        body: 'My post',
        attachment: null,
        onSubmit() {
          submits++;
        },
        onClose() {
          closes++;
        },
        onChangeAttachments() {},
        onSelectCircle() {},
        onBody() {},
        onPick() {},
        onAddPhotos() {},
        onCancel() {},
        onDiscard() {},
        onClearAttachment() {},
        onRecordVideo() {},
      }),
    );
  });
  t.after(() => act(async () => renderer.unmount()));
  await act(async () => renderer.root.findByType('PublishingTools').props.onProcessingChange(true));
  const submit = button(renderer, 'Processing video…');
  assert.equal(submit.props.disabled, true);
  await act(async () => submit.props.onPress());
  await act(async () =>
    renderer.root.findByProps({ accessibilityLabel: 'Close dialog' }).props.onPress(),
  );
  assert.equal(submits, 0);
  assert.equal(closes, 0);
  await act(async () =>
    renderer.root.findByType('PublishingTools').props.onProcessingChange(false),
  );
  await act(async () => button(renderer, 'Share with your circle').props.onPress());
  assert.equal(submits, 1);
});
