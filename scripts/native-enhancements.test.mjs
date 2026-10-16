import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { act, loadSource, native, deferred } from './react-fixture.mjs';
test('Discovery filters begin closed, retain selection, and show results on dismissal', async (t) => {
  const { DiscoveryControls } = loadSource('src/components/Experience.tsx', {
    'react-native': native,
    './Primitives': { ActionButton: 'ActionButton', Avatar: 'Avatar', Pill: 'Pill', Icon: 'Icon' },
    '../theme': { colors: {}, spacing: { page: 20 }, typography: {} },
    '../lib/repositories': {},
    '../lib/community': {},
  });
  let renderer;
  const changed = [];
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(DiscoveryControls, {
        value: { privacy: 'private', sort: 'recommended', activeOnly: false },
        onChange: (v) => changed.push(v),
        onClear() {},
      }),
    );
  });
  t.after(() => act(async () => renderer.unmount()));
  assert.equal(renderer.root.findAllByType('Modal').length, 0);
  await act(async () => renderer.root.findByProps({ label: 'Filters · 1 active' }).props.onPress());
  assert.equal(renderer.root.findAllByType('Modal').length, 1);
  await act(async () => renderer.root.findByProps({ label: 'Public' }).props.onPress());
  assert.equal(changed[0].privacy, 'public');
  await act(async () => renderer.root.findByProps({ label: 'Show results' }).props.onPress());
  assert.equal(renderer.root.findAllByType('Modal').length, 0);
});
test('Circle search ignores stale results and filters across server pages', async (t) => {
  const first = deferred(),
    second = deferred();
  const requests = [];
  const { useCirclePostSearch } = loadSource('src/components/CirclePostSearch.tsx', {
    'react-native': native,
    '../theme': { colors: {}, typography: { body: { fontSize: 16, lineHeight: 24 } } },
    '../lib/repositories': {
      searchCirclePosts: (circle, text, media, offset) => {
        requests.push({ circle, text, media, offset });
        return text === 'first' ? first.promise : second.promise;
      },
    },
  });
  let state, renderer;
  function Probe() {
    state = useCirclePostSearch('circle-a');
    return null;
  }
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Probe));
  });
  t.after(() => act(async () => renderer.unmount()));
  await act(async () => state.setText('first'));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 280)));
  await act(async () => state.setText('second'));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 280)));
  await act(async () => second.resolve([{ id: 'new' }]));
  await act(async () => first.resolve([{ id: 'stale' }]));
  assert.equal(state.rows[0].id, 'new');
  assert.equal(requests[1].text, 'second');
});
test('Native date picker commits an ISO instant and cancellation does not alter the schedule', async (t) => {
  const changes = [];
  const { ScheduleDateField } = loadSource('src/components/ScheduleDateField.tsx', {
    'react-native': {
      Text: 'Text',
      View: 'View',
      Pressable: 'Pressable',
      Platform: { OS: 'android' },
    },
    '@react-native-community/datetimepicker': 'DateTimePicker',
    'expo-calendar/legacy': {},
    '../theme': { colors: {}, typography: { body: { fontSize: 16, lineHeight: 24 } } },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(ScheduleDateField, {
        value: '2026-12-01T15:00:00.000Z',
        onChangeText: (v) => changes.push(v),
      }),
    );
  });
  t.after(() => act(async () => renderer.unmount()));
  await act(async () =>
    renderer.root.findByProps({ accessibilityLabel: 'Choose date' }).props.onPress(),
  );
  await act(async () =>
    renderer.root
      .findByType('DateTimePicker')
      .props.onChange({ type: 'dismissed' }, new Date('2026-12-02')),
  );
  assert.equal(changes.length, 0);
  await act(async () =>
    renderer.root.findByProps({ accessibilityLabel: 'Choose time' }).props.onPress(),
  );
  await act(async () =>
    renderer.root
      .findByType('DateTimePicker')
      .props.onChange({ type: 'set' }, new Date('2026-12-03T17:30:00.000Z')),
  );
  assert.equal(changes[0], '2026-12-03T17:30:00.000Z');
});

test('Video errors renew private URLs once; backgrounding pauses playback and exposes retry', async (t) => {
  let status,
    appState,
    pauses = 0,
    renewals = 0;
  const replacements = [];
  let pendingRenewal;
  const player = {
    addListener: (name, fn) => {
      if (name === 'statusChange') status = fn;
      return { remove() {} };
    },
    pause: () => pauses++,
    play() {},
    replaceAsync: async (uri) => replacements.push(uri),
    generateThumbnailsAsync: async () => [{ width: 100, height: 100 }],
  };
  const { PostVideo } = loadSource('src/components/PostVideo.tsx', {
    'react-native': {
      View: 'View',
      Pressable: 'Pressable',
      Text: 'Text',
      AppState: {
        addEventListener: (_name, fn) => {
          appState = fn;
          return { remove() {} };
        },
      },
      Dimensions: { get: () => ({ height: 800 }) },
    },
    'expo-image': { Image: 'Image' },
    'expo-video': { useVideoPlayer: () => player, VideoView: 'VideoView' },
    '../lib/media': {
      refreshMediaUrl: async () => {
        renewals++;
        return pendingRenewal ? pendingRenewal.promise : 'https://renewed.example/video';
      },
    },
    '../theme': { colors: {}, typography: { body: { fontSize: 16, lineHeight: 24 } } },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(PostVideo, {
        media: {
          id: 'v',
          kind: 'video',
          url: 'https://expired.example/video',
          storagePath: 'owner/post/video',
        },
      }),
    );
  });
  t.after(() => act(async () => renderer.unmount()));
  await act(async () => status({ status: 'error' }));
  assert.equal(renewals, 1);
  assert.equal(replacements[0], 'https://renewed.example/video');
  await act(async () => status({ status: 'error' }));
  assert.equal(renewals, 1);
  assert.ok(
    renderer.root
      .findAllByType('Text')
      .some((node) => node.children.join('').includes('Tap to retry')),
  );
  await act(async () => appState('background'));
  assert.equal(pauses, 1);
  pendingRenewal = deferred();
  await act(async () => renderer.root.findAllByType('Pressable').at(-1).props.onPress());
  await act(async () =>
    renderer.update(
      React.createElement(PostVideo, {
        media: {
          id: 'new',
          kind: 'video',
          url: 'https://new.example/video',
          storagePath: 'owner/new/video',
        },
      }),
    ),
  );
  await act(async () => pendingRenewal.resolve('https://stale.example/video'));
  assert.equal(replacements.length, 1, 'old URL renewal must not replace the new video');
  assert.equal(renderer.root.findAllByType('Pressable')[0].props.accessibilityLabel, 'Play video');
});
