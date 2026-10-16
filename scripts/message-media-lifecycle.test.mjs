import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { act, loadSource, native } from './react-fixture.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const photo = (name) => ({
  canceled: false,
  assets: [{ uri: `file:///${name}.jpg`, mimeType: 'image/jpeg' }],
});
async function composer(t, overrides = {}) {
  const recorder = {
    isRecording: false,
    prepareToRecordAsync: async () => {},
    record() {
      this.isRecording = true;
    },
    async stop() {
      this.isRecording = false;
    },
    ...overrides.recorder,
  };
  const { MessageMediaComposer } = loadSource('src/components/CommunityMessages.tsx', {
    'react-native': { ...native, View: 'View', Text: 'Text' },
    'expo-crypto': { randomUUID: () => 'media-id' },
    'expo-image': { Image: 'Image' },
    'expo-image-picker': {
      launchImageLibraryAsync: overrides.pick ?? (async () => photo('first')),
    },
    './Sheet': { Sheet: ({ children }) => React.createElement(React.Fragment, null, children) },
    'expo-audio': {
      RecordingPresets: { HIGH_QUALITY: {} },
      useAudioRecorder: () => recorder,
      useAudioRecorderState: () => ({ isRecording: recorder.isRecording, durationMillis: 0 }),
      requestRecordingPermissionsAsync: async () => ({ granted: true }),
      setAudioModeAsync: async () => {},
    },
    './Primitives': { ActionButton: 'ActionButton', Disclosure: 'Disclosure' },
    '../appStyles': { styles: {} },
    '../theme': { colors: {} },
    '../lib/supabase': { supabase: null },
    '../lib/repositories': {},
    '../lib/communityDepth': {},
    '../lib/communityMedia': { sendMessageMedia: overrides.send ?? (async () => {}) },
  });
  let renderer;
  const props = { user: 'user', target: 'first-peer', onSent() {}, ...overrides.props };
  const render = () => React.createElement(MessageMediaComposer, props);
  await act(async () => {
    renderer = TestRenderer.create(render());
  });
  t.after(() => act(async () => renderer.unmount()));
  const button = (label) =>
    renderer.root.findAllByType('ActionButton').find((n) => n.props.label === label) ??
    renderer.root.findAllByType('Pressable').find((n) => n.props.accessibilityLabel === label);
  return {
    renderer,
    recorder,
    button,
    async press(label) {
      await act(async () => {
        const control = button(label);
        assert.ok(control, `Missing ${label}`);
        control.props.onPress();
      });
    },
    async update(patch) {
      Object.assign(props, patch);
      await act(async () => renderer.update(render()));
    },
  };
}

test('Changing recipient or account discards the previous attachment draft', async (t) => {
  const app = await composer(t);
  for (const change of [{ target: 'second-peer' }, { user: 'second-user' }, { group: true }]) {
    await app.press('Photo or voice note');
    await app.press('Choose photo');
    assert.ok(app.button('Send attachment'));
    await app.update(change);
    await app.press('Photo or voice note');
    assert.ok(!app.button('Send attachment'), 'Old media must not follow a new destination');
  }
});

test('A picker opened for one conversation cannot attach its result to another', async (t) => {
  const picked = deferred();
  const app = await composer(t, { pick: () => picked.promise });
  await app.press('Photo or voice note');
  await app.press('Choose photo');
  await app.update({ target: 'second-peer' });
  await app.press('Photo or voice note');
  await act(async () => picked.resolve(photo('old-conversation')));
  assert.ok(!app.button('Send attachment'));
  assert.equal(app.button('Choose photo').props.disabled, false);
});

test('Finishing a previous upload does not close or discard a new conversation draft', async (t) => {
  const sent = deferred();
  let notifications = 0;
  const app = await composer(t, {
    send: () => sent.promise,
    props: { onSent: () => notifications++ },
  });
  await app.press('Photo or voice note');
  await app.press('Choose photo');
  await app.press('Send attachment');
  await app.update({ target: 'second-peer' });
  await app.press('Photo or voice note');
  await app.press('Choose photo');
  await act(async () => sent.resolve());
  assert.ok(app.button('Send attachment'), 'Keep the new conversation draft');
  assert.equal(app.button('Send attachment').props.disabled, false);
  assert.equal(notifications, 0, 'Do not refresh an obsolete conversation');
});

test('Recorder preparation cannot start the microphone after changing conversations', async (t) => {
  const prepared = deferred();
  let recordings = 0;
  const app = await composer(t, {
    recorder: {
      prepareToRecordAsync: () => prepared.promise,
      record() {
        recordings++;
      },
    },
  });
  await app.press('Photo or voice note');
  await app.press('Record voice note');
  await app.update({ target: 'second-peer' });
  await act(async () => prepared.resolve());
  assert.equal(recordings, 0);
});

test('Changing a voice attachment cancels pending replay and lets the new note play', async (t) => {
  const seek = deferred();
  let oldPlays = 0,
    newPlays = 0;
  const oldPlayer = {
    pause() {},
    play() {
      oldPlays++;
    },
    seekTo: () => seek.promise,
  };
  const newPlayer = {
    pause() {},
    play() {
      newPlays++;
    },
    seekTo: async () => {},
  };
  const { VoicePlayer } = loadSource('src/components/CommunityMessages.tsx', {
    'react-native': native,
    'expo-crypto': {},
    'expo-image': {},
    'expo-image-picker': {},
    'expo-audio': {
      useAudioPlayer: (uri) => (uri === 'first.m4a' ? oldPlayer : newPlayer),
      useAudioPlayerStatus: () => ({ didJustFinish: true, playing: false }),
    },
    './Primitives': { ActionButton: 'ActionButton' },
    '../appStyles': { styles: {} },
    '../theme': { colors: {} },
    '../lib/communityDepth': {},
    '../lib/communityMedia': {},
    '../lib/repositories': {},
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(VoicePlayer, { uri: 'first.m4a' }));
  });
  t.after(() => act(async () => renderer.unmount()));
  const play = () => renderer.root.findByType('ActionButton').props.onPress();
  await act(async () => play());
  await act(async () => renderer.update(React.createElement(VoicePlayer, { uri: 'second.m4a' })));
  await act(async () => play());
  assert.equal(newPlays, 1, 'The old pending seek must not block the new attachment');
  await act(async () => seek.resolve());
  assert.equal(oldPlays, 0, 'Do not play a previous attachment after its source changes');
});
