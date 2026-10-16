import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { act, loadSource, mountApp, native } from './react-fixture.mjs';
const publishing = loadSource('src/lib/publishing.ts');
test('Publishing validates real trim ranges and ordered subtitle timings', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(publishing.parseSubtitles('0 - 2 | Welcome\n2.5 - 5 | Hello', 10))),
    [
      { start: 0, end: 2, text: 'Welcome' },
      { start: 2.5, end: 5, text: 'Hello' },
    ],
  );
  for (const source of [
    'broken',
    '0 - 4 | One\n3 - 6 | Overlap',
    '0 - 11 | Too long',
    '3 - 2 | Backwards',
  ])
    assert.throws(() => publishing.parseSubtitles(source, 10));
  assert.equal(publishing.validateTrim(2, 7, 10).endTime, 7000);
  for (const range of [
    [-1, 2, 10],
    [5, 4, 10],
    [0, 11, 10],
    [0, 121, 130],
    [NaN, 2, 10],
  ])
    assert.throws(() => publishing.validateTrim(...range));
  assert.throws(() => publishing.validateAttachments([{ kind: 'image' }, { kind: 'video' }]));
});
test('Photo selection, ordering and publishing preserve the selected circle and all media', async (t) => {
  let submitted;
  const assets = ['one', 'two', 'three'].map((n) => ({
    uri: `file:///${n}.jpg`,
    fileName: `${n}.jpg`,
    mimeType: 'image/jpeg',
  }));
  const app = await mountApp({
    imagePicker: { launchImageLibraryAsync: async () => ({ canceled: false, assets }) },
    repositories: {
      createPost: async (input) => {
        submitted = input;
      },
    },
  });
  t.after(() => app.close());
  await act(async () => app.props('HomeScreen').onCreatePost());
  await act(async () => app.props('CreatePostSheet').onPick('image'));
  let sheet = app.props('CreatePostSheet');
  assert.equal(sheet.extraAttachments.length, 2);
  await act(async () => sheet.onChangeAttachments([sheet.extraAttachments[1], sheet.attachment]));
  await act(async () => app.props('CreatePostSheet').onSubmit());
  assert.deepEqual(
    Array.from(submitted.mediaItems, (m) => m.fileName),
    ['three.jpg', 'one.jpg'],
  );
  assert.ok(submitted.circleId);
});
test('Community writes reject account changes before sending requests', async () => {
  let writes = 0;
  const api = loadSource('src/lib/communityDepth.ts', {
    './supabase': {
      supabase: {
        auth: { getUser: async () => ({ data: { user: { id: 'another-account' } } }) },
        from: () => {
          writes++;
          throw Error('should not write');
        },
      },
    },
    './repositories': {},
    '@react-native-async-storage/async-storage': {},
  });
  await assert.rejects(api.hidePost('original', 'post'));
  await assert.rejects(api.collectPost('original', 'collection', 'post'));
  assert.equal(writes, 0);
});
test('Insert-only community tables do not require UPDATE privileges or overwrite another contributor', async () => {
  const inserted = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user' } } }) },
    from: (table) => ({
      insert: async (row) => {
        inserted.push({ table, row });
        return { data: null, error: null };
      },
      upsert: async () => {
        throw Error('UPDATE is intentionally denied');
      },
    }),
  };
  const api = loadSource('src/lib/communityDepth.ts', {
    './supabase': { supabase: client },
    './repositories': {},
  });
  await api.hidePost('user', 'post');
  await api.changeCircleDepth('user', 'circle', 'circle_topics', { name: 'Topic' });
  await api.changeCircleDepth('user', 'circle', 'circle_collections', {
    name: 'Collection',
    creator_id: 'user',
  });
  await api.collectPost('user', 'collection', 'post');
  assert.deepEqual(
    inserted.map((x) => x.table),
    ['hidden_posts', 'circle_topics', 'circle_collections', 'collection_posts'],
  );
});
test('Updating a circle read receipt preserves the mute preference', async () => {
  let written;
  const api = loadSource('src/lib/communityMedia.ts', {
    './supabase': {
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { muted: true, read_at: 'old' }, error: null }),
              }),
            }),
          }),
          upsert: async (row) => {
            written = row;
            return { data: null, error: null };
          },
        }),
      },
    },
    './communityDepth': { assertAccount: async () => {} },
    'expo-file-system/legacy': {},
  });
  await api.saveGroupPreference('user', 'circle', { read_at: 'new' });
  assert.equal(
    'muted' in written,
    false,
    'A read receipt must leave the stored mute column untouched',
  );
  assert.equal(written.read_at, 'new');
});
test('Voice recording recovers from denied permission, previews automatic completion, and stops on unmount', async (t) => {
  let granted = false,
    statusCallback,
    stops = 0,
    sent;
  const recorder = {
    isRecording: false,
    uri: 'file:///voice.m4a',
    prepareToRecordAsync: async () => {},
    record() {
      this.isRecording = true;
    },
    stop: async () => {
      stops++;
      recorder.isRecording = false;
    },
  };
  const actions = {};
  const appStates = new Set();
  const { MessageMediaComposer } = loadSource('src/components/CommunityMessages.tsx', {
    'react-native': {
      ...native,
      View: 'View',
      Text: 'Text',
      AppState: {
        addEventListener: (_name, fn) => {
          appStates.add(fn);
          return {
            remove() {
              appStates.delete(fn);
            },
          };
        },
      },
    },
    'expo-crypto': { randomUUID: () => 'aaaaaaaa-0000-4000-8000-000000000001' },
    'expo-image': { Image: 'Image' },
    'expo-image-picker': {},
    'expo-audio': {
      RecordingPresets: { HIGH_QUALITY: {} },
      useAudioRecorder: (_preset, fn) => {
        statusCallback = fn;
        return recorder;
      },
      useAudioRecorderState: () => ({ isRecording: recorder.isRecording, durationMillis: 0 }),
      requestRecordingPermissionsAsync: async () => ({ granted }),
      setAudioModeAsync: async () => {},
      useAudioPlayer: () => ({ pause() {}, play() {} }),
      useAudioPlayerStatus: () => ({ playing: false }),
    },
    './Primitives': { ActionButton: 'ActionButton', Disclosure: 'Disclosure' },
    '../appStyles': { styles: {} },
    '../theme': { colors: {} },
    '../lib/supabase': { supabase: null },
    '../lib/repositories': {},
    '../lib/communityDepth': {},
    '../lib/communityMedia': {
      sendMessageMedia: async (...args) => {
        sent = args;
      },
    },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(MessageMediaComposer, {
        user: 'user',
        target: 'peer',
        onSent: () => {
          actions.sent = true;
        },
      }),
    );
  });
  t.after(() => act(async () => renderer.unmount()));
  const press = (label) =>
    renderer.root
      .findAllByType('ActionButton')
      .find((n) => n.props.label === label)
      .props.onPress();
  await act(async () => press('Photo or voice note'));
  await act(async () => press('Record voice note'));
  assert.equal(recorder.isRecording, false);
  granted = true;
  await act(async () => press('Record voice note'));
  assert.equal(recorder.isRecording, true);
  await act(async () => statusCallback({ isFinished: true, hasError: false, url: recorder.uri }));
  await act(async () => press('Send attachment'));
  assert.equal(sent[2].kind, 'voice');
  assert.ok(sent[2].duration <= 60000);
  assert.equal(actions.sent, true);
  recorder.isRecording = true;
  await act(async () => {
    for (const fn of appStates) fn('background');
  });
  assert.ok(stops > 0);
});
test('Invitation links use only the configured HTTPS site and validate tokens', () => {
  const previous = process.env.EXPO_PUBLIC_INVITE_BASE_URL;
  process.env.EXPO_PUBLIC_INVITE_BASE_URL = 'https://example.test/circles/';
  try {
    const api = loadSource('src/lib/communityDepth.ts', {
        './supabase': { supabase: null },
        './repositories': {},
      }),
      links = loadSource('src/lib/contentLinks.ts'),
      token = 'a'.repeat(64);
    const url = api.invitationUrl(token);
    assert.equal(links.parseContentLink(url).id, token);
    assert.equal(links.parseContentLink('https://attacker.test/circles/?token=' + token), null);
    assert.equal(links.parseContentLink('circles://invite/' + token).kind, 'invite');
    assert.throws(() => api.invitationUrl('invalid'));
  } finally {
    if (previous === undefined) delete process.env.EXPO_PUBLIC_INVITE_BASE_URL;
    else process.env.EXPO_PUBLIC_INVITE_BASE_URL = previous;
  }
});

test('Circle chat recovers from an initial connection failure and preserves a draft on refresh', async (t) => {
  let failures = 1;
  const { CircleChat } = loadSource('src/components/CommunityMessages.tsx', {
    'react-native': {
      ...native,
      View: 'View',
      Text: 'Text',
      TextInput: 'TextInput',
      ScrollView: 'ScrollView',
    },
    'expo-crypto': { randomUUID: () => 'aaaaaaaa-0000-4000-8000-000000000001' },
    'expo-image': { Image: 'Image' },
    'expo-image-picker': {},
    'expo-audio': {
      RecordingPresets: { HIGH_QUALITY: {} },
      useAudioRecorder: () => ({ isRecording: false, stop: async () => {} }),
      useAudioRecorderState: () => ({ isRecording: false, durationMillis: 0 }),
      setAudioModeAsync: async () => {},
    },
    './Sheet': {
      Sheet: ({ children, footer }) => React.createElement(React.Fragment, null, children, footer),
    },
    './Primitives': { ActionButton: 'ActionButton', Disclosure: 'Disclosure' },
    '../appStyles': { styles: {} },
    '../theme': { colors: {} },
    '../lib/supabase': { supabase: null },
    '../lib/repositories': {},
    '../lib/communityDepth': {
      circleDepth: async () => {
        if (failures-- > 0) throw Error('Offline');
        return { chat: { enabled: true }, host: false };
      },
      localValue: async () => 'Saved draft',
      storeValue: async () => {},
    },
    '../lib/communityMedia': {
      groupMessages: async () => [],
      groupPreference: async () => ({ muted: true }),
      saveGroupPreference: async () => {},
    },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(CircleChat, {
        user: 'user',
        circle: { id: 'circle', name: 'Circle' },
        onClose() {},
      }),
    );
  });
  t.after(() => act(async () => renderer.unmount()));
  const press = (label) =>
    renderer.root
      .findAllByType('ActionButton')
      .find((n) => n.props.label === label)
      .props.onPress();
  assert.ok(
    renderer.root.findAllByType('ActionButton').some((n) => n.props.label === 'Retry chat'),
  );
  await act(async () => press('Retry chat'));
  const input = () => renderer.root.findByType('TextInput');
  assert.equal(input().props.editable, true);
  assert.equal(input().props.value, 'Saved draft');
  await act(async () => input().props.onChangeText('New draft'));
  await act(async () => press('Unmute circle chat'));
  assert.equal(input().props.value, 'New draft');
});
