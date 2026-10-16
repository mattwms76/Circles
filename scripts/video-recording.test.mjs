import React from 'react';
import TestRenderer from 'react-test-renderer';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, mountApp, deferred, loadSource, native } from './react-fixture.mjs';

const asset = {
  uri: 'file:///recorded.mp4',
  fileName: 'recorded.mp4',
  mimeType: 'video/mp4',
  fileSize: 1024,
  duration: 30000,
};
function camera(overrides = {}) {
  return {
    requestCameraPermissionsAsync: async () => ({ granted: true }),
    UIImagePickerControllerQualityType: { Medium: 1 },
    launchCameraAsync: async () => ({ canceled: false, assets: [asset] }),
    ...overrides,
  };
}

test('Recorded video is attached and submitted to the selected member circle', async (t) => {
  let options, submitted;
  const app = await mountApp({
    imagePicker: camera({
      launchCameraAsync: async (o) => {
        options = o;
        return { canceled: false, assets: [asset] };
      },
    }),
    repositories: {
      createPost: async (input) => {
        submitted = input;
      },
    },
  });
  t.after(() => app.close());
  await act(async () => app.props('HomeScreen').onCreatePost());
  const circle = app.props('CreatePostSheet').circles[0];
  assert.ok(circle.isMember);
  await act(async () => app.props('CreatePostSheet').onSelectCircle(circle.id));
  await act(async () => app.props('CreatePostSheet').onRecordVideo());
  assert.equal(options.videoMaxDuration, 120);
  assert.equal(options.mediaTypes[0], 'videos');
  assert.equal(app.props('CreatePostSheet').attachment.kind, 'video');
  await act(async () => app.props('CreatePostSheet').onSubmit());
  assert.equal(submitted.circleId, circle.id);
  assert.equal(submitted.media.uri, asset.uri);
});

test('Denied camera access and cancelled recording do not replace a draft', async (t) => {
  let allowed = false,
    calls = 0;
  const app = await mountApp({
    imagePicker: camera({
      requestCameraPermissionsAsync: async () => ({ granted: allowed }),
      launchCameraAsync: async () => {
        calls++;
        return { canceled: true, assets: null };
      },
    }),
  });
  t.after(() => app.close());
  await act(async () => app.props('HomeScreen').onCreatePost());
  await act(async () => app.props('CreatePostSheet').onBody('Keep my caption'));
  await act(async () => app.props('CreatePostSheet').onRecordVideo());
  assert.equal(calls, 0);
  allowed = true;
  await act(async () => app.props('CreatePostSheet').onRecordVideo());
  assert.equal(app.props('CreatePostSheet').body, 'Keep my caption');
  assert.equal(app.props('CreatePostSheet').attachment, null);
});

test('Recording completing after an account switch cannot attach to another account', async (t) => {
  const pending = deferred();
  const app = await mountApp({ imagePicker: camera({ launchCameraAsync: () => pending.promise }) });
  t.after(() => app.close());
  await act(async () => app.props('HomeScreen').onCreatePost());
  await act(async () => app.props('CreatePostSheet').onRecordVideo());
  await app.auth('SIGNED_OUT', null);
  await app.auth('SIGNED_IN', { id: 'account-b', email: 'b@test.local', user_metadata: {} });
  await act(async () => app.props('HomeScreen').onCreatePost());
  await act(async () => pending.resolve({ canceled: false, assets: [asset] }));
  assert.equal(app.props('CreatePostSheet').attachment, null);
});

test('Overlong and oversized recordings are rejected before attachment', async (t) => {
  let selected = { ...asset, duration: 120001 };
  const app = await mountApp({
    imagePicker: camera({
      launchCameraAsync: async () => ({ canceled: false, assets: [selected] }),
    }),
  });
  t.after(() => app.close());
  await act(async () => app.props('HomeScreen').onCreatePost());
  await act(async () => app.props('CreatePostSheet').onRecordVideo());
  assert.equal(app.props('CreatePostSheet').attachment, null);
  selected = { ...asset, fileSize: 26 * 1024 * 1024 };
  await act(async () => app.props('CreatePostSheet').onRecordVideo());
  assert.equal(app.props('CreatePostSheet').attachment, null);
});

test('Recording inspection checks actual file size, duration, and MOV format', async () => {
  let info = { exists: true, isDirectory: false, size: 1024 };
  const { inspectPickedMedia } = loadSource('src/lib/pickedMedia.ts', {
    'expo-file-system/legacy': { getInfoAsync: async () => info },
  });
  const mov = await inspectPickedMedia(
    { ...asset, fileName: 'camera.MOV', mimeType: null },
    'video',
    60,
  );
  assert.equal(mov.mimeType, 'video/quicktime');
  assert.equal(mov.duration, 30);
  for (const duration of [null, undefined, NaN, 0, -1, 60001]) {
    await assert.rejects(inspectPickedMedia({ ...asset, duration }, 'video', 60));
  }
  await inspectPickedMedia({ ...asset, duration: 60000 }, 'video', 60);
  await assert.rejects(inspectPickedMedia({ ...asset, mimeType: 'video/avi' }, 'video', 60));
  info = { exists: true, isDirectory: false, size: 26 * 1024 * 1024 };
  await assert.rejects(inspectPickedMedia({ ...asset, fileSize: undefined }, 'video', 60));
  info = { exists: false };
  await assert.rejects(inspectPickedMedia(asset, 'video', 60));
});

test('Rapid recording taps open one picker and closing the composer discards its result', async (t) => {
  const pending = deferred();
  let calls = 0;
  const app = await mountApp({
    imagePicker: camera({
      launchCameraAsync: () => {
        calls++;
        return pending.promise;
      },
    }),
  });
  t.after(() => app.close());
  await act(async () => app.props('HomeScreen').onCreatePost());
  await act(async () => {
    void app.props('CreatePostSheet').onRecordVideo();
    void app.props('CreatePostSheet').onRecordVideo();
  });
  assert.equal(calls, 1);
  await act(async () => app.props('CreatePostSheet').onClose());
  await act(async () => app.props('HomeScreen').onCreatePost());
  await act(async () => pending.resolve({ canceled: false, assets: [asset] }));
  assert.equal(app.props('CreatePostSheet').attachment, null);
});

test('Failed camera launch can be retried', async (t) => {
  let attempts = 0;
  const app = await mountApp({
    imagePicker: camera({
      launchCameraAsync: async () => {
        if (++attempts === 1) throw new Error('Camera unavailable');
        return { canceled: false, assets: [asset] };
      },
    }),
  });
  t.after(() => app.close());
  await act(async () => app.props('HomeScreen').onCreatePost());
  await act(async () => app.props('CreatePostSheet').onRecordVideo());
  await act(async () => app.props('CreatePostSheet').onRecordVideo());
  assert.equal(attempts, 2);
  assert.equal(app.props('CreatePostSheet').attachment.kind, 'video');
});

test('Story recording uses the 60-second limit, publishes the chosen circle, and discards late results', async (t) => {
  let options, published, pending;
  const picker = camera({
    launchCameraAsync: async (value) => {
      options = value;
      return pending ? pending.promise : { canceled: false, assets: [asset] };
    },
  });
  const fs = { getInfoAsync: async () => ({ exists: true, size: 1024 }) };
  const { Stories } = loadSource('src/components/Stories.tsx', {
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@react-native-async-storage/async-storage': {
      getItem: async () => null,
      setItem: async () => {},
    },
    'expo-image-picker': picker,
    'expo-file-system/legacy': fs,
    'expo-video': {
      VideoView: 'VideoView',
      useVideoPlayer: () => ({ pause() {}, play() {}, addListener: () => ({ remove() {} }) }),
    },
    './Sheet': { Sheet: 'Sheet' },
    './Primitives': { ActionButton: 'ActionButton', Pill: 'Pill' },
    '../theme': { colors: {}, typography: {} },
    '../lib/repositories': { createIdempotencyKey: () => 'request-1' },
    '../lib/storyRules': loadSource('src/lib/storyRules.ts'),
    '../lib/pickedMedia': loadSource('src/lib/pickedMedia.ts', { 'expo-file-system/legacy': fs }),
    '../lib/stories': {
      loadStories: async () => [],
      publishStory: async (...args) => {
        published = args;
      },
    },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(Stories, {
        profile: { id: 'member' },
        circles: [{ id: 'circle-1', name: 'Film', isMember: true }],
        connected: true,
        enabled: true,
        refreshing: false,
      }),
    );
  });
  t.after(async () => act(async () => renderer.unmount()));
  const open = async () =>
    act(async () => renderer.root.findAllByType('Pressable')[0].props.onPress());
  const record = () =>
    renderer.root
      .findAllByType('Pressable')
      .find((n) => n.props.accessibilityLabel === 'Record video')
      .props.onPress();
  await open();
  await act(async () => record());
  assert.equal(options.videoMaxDuration, 60);
  await act(async () =>
    renderer.root.findByType('Sheet').props.footer.props.children[0].props.onPress(),
  );
  assert.equal(published[0], 'member');
  assert.equal(published[1], 'circle-1');
  assert.equal(published[4].duration, 30);
  await open();
  pending = deferred();
  await act(async () => record());
  await act(async () => renderer.root.findByType('Sheet').props.onClose());
  await open();
  await act(async () => pending.resolve({ canceled: false, assets: [asset] }));
  assert.equal(
    renderer.root.findByType('Sheet').props.footer.props.children[0].props.disabled,
    true,
  );
});
