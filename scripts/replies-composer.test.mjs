import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { act, demo, deferred, loadSource, native } from './react-fixture.mjs';
function fixture(storageOverride) {
  const files = new Map();
  const storage = {
    getItem: async (k) => files.get(k) ?? null,
    setItem: async (k, v) => {
      files.set(k, v);
    },
    ...storageOverride,
  };
  const screens = loadSource('src/screens/AppScreens.tsx', {
    '../lib/contentDeletion': loadSource('src/lib/contentDeletion.ts'),
    'expo-image-picker': {},
    '@react-native-async-storage/async-storage': storage,
    'react-native': native,
    'react-native-safe-area-context': {
      SafeAreaView: 'SafeAreaView',
      useSafeAreaInsets: () => ({ bottom: 0 }),
    },
    'expo-video': {},
    '../lib/streaming': {},
    '../components/Primitives': new Proxy(
      { formatCount: String },
      { get: (o, k) => o[k] ?? String(k) },
    ),
    '../theme': { colors: {} },
    '../appStyles': { styles: {} },
  });
  function Harness({ onSend, comments = [] }) {
    const [draft, onDraft] = React.useState('');
    return React.createElement(screens.PostRepliesSheet, {
      post: demo.posts[0],
      profile: demo.currentUser,
      comments,
      draft,
      onDraft,
      onSend,
      onDelete: async () => {},
      onClose: () => {},
    });
  }
  const mount = async (props) => {
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(Harness, props));
    });
    return {
      renderer,
      input: () => renderer.root.findByProps({ accessibilityLabel: 'Your reply' }),
      button: () =>
        renderer.root
          .findAllByType('ActionButton')
          .find((b) => ['Send reply', 'Sending…'].includes(b.props.label)),
      type: async (text) =>
        act(async () =>
          renderer.root.findByProps({ accessibilityLabel: 'Your reply' }).props.onChangeText(text),
        ),
      send: async () =>
        act(async () =>
          renderer.root
            .findAllByType('ActionButton')
            .find((b) => ['Send reply', 'Sending…'].includes(b.props.label))
            .props.onPress(),
        ),
      update: async (props) =>
        act(async () => renderer.update(React.createElement(Harness, props))),
      close: async () => act(async () => renderer.unmount()),
    };
  };
  const mountChat = async (onSend) => {
    let renderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(screens.ChatScreen, {
          conversation: { peer: demo.people[0], messages: [], unread: 0 },
          profile: demo.currentUser,
          hasOlder: false,
          onClose() {},
          onReport() {},
          onSend,
        }),
      );
    });
    return {
      input: () => renderer.root.findByProps({ accessibilityLabel: 'Message' }),
      type: async (text) =>
        act(async () =>
          renderer.root.findByProps({ accessibilityLabel: 'Message' }).props.onChangeText(text),
        ),
      send: async () =>
        act(async () =>
          renderer.root
            .findAllByType('ActionButton')
            .find((b) => b.props.label === 'Send')
            .props.onPress(),
        ),
      close: async () => act(async () => renderer.unmount()),
    };
  };
  return { files, storage, mount, mountChat };
}

test('A completed message send cannot delete a newer draft after reopening the same chat', async (t) => {
  const f = fixture({ removeItem: async (key) => f.files.delete(key) }),
    pending = deferred();
  const first = await f.mountChat(() => pending.promise);
  await first.type('Sending message');
  await first.send();
  await first.close();
  const next = await f.mountChat(async () => {});
  await next.type('New private draft');
  await next.close();
  await act(async () => pending.resolve());
  const reopened = await f.mountChat(async () => {});
  t.after(() => reopened.close());
  assert.equal(reopened.input().props.value, 'New private draft');
});
test('Native composer rejects blank input, deduplicates taps, and preserves failed-send drafts', async (t) => {
  const f = fixture();
  const pending = deferred();
  let calls = 0;
  const c = await f.mount({
    onSend: () => {
      calls++;
      return pending.promise;
    },
  });
  t.after(() => c.close());
  assert.equal(c.button().props.disabled, true);
  await c.type('   ');
  assert.equal(c.button().props.disabled, true);
  await c.type('Retain on failure');
  await c.send();
  await c.send();
  assert.equal(calls, 1);
  assert.equal(c.input().props.editable, false);
  await act(async () => pending.reject(new Error('Offline')));
  assert.equal(c.input().props.value, 'Retain on failure');
  assert.equal(c.button().props.disabled, false);
  assert.ok([...f.files.values()].includes('Retain on failure'));
});
test('A send completed after closing cannot erase a newly written draft in the reopened composer', async (t) => {
  const f = fixture();
  const pending = deferred();
  const first = await f.mount({ onSend: () => pending.promise });
  await first.type('First submission');
  await first.send();
  await first.close();
  const second = await f.mount({ onSend: async () => {} });
  t.after(() => second.close());
  await second.type('New draft after reopening');
  await act(async () => pending.resolve());
  assert.equal(second.input().props.value, 'New draft after reopening');
  assert.ok([...f.files.values()].includes('New draft after reopening'));
});
test('Reply target is passed on send and is cleared when its parent is deleted', async (t) => {
  const parent = {
    id: 'parent',
    postId: demo.posts[0].id,
    author: demo.people[1],
    body: 'Parent text',
    createdAt: 'earlier',
  };
  let received;
  const f = fixture(),
    c = await f.mount({
      comments: [parent],
      onSend: async (id) => {
        received = id;
      },
    });
  t.after(() => c.close());
  await act(async () =>
    c.renderer.root
      .findAllByType('Pressable')
      .find((b) => b.props.accessibilityLabel === 'Message actions')
      .props.onPress(),
  );
  await act(async () =>
    c.renderer.root
      .findAllByType('ActionButton')
      .find((b) => b.props.label === 'Reply')
      .props.onPress(),
  );
  await c.type('Child reply');
  await c.send();
  assert.equal(received, 'parent');
  assert.equal(c.input().props.value, '');
  await act(async () =>
    c.renderer.root
      .findAllByType('ActionButton')
      .find((b) => b.props.label === 'Reply')
      .props.onPress(),
  );
  await c.update({ comments: [], onSend: async () => {} });
  assert.equal(
    c.renderer.root.findAllByType('ActionButton').filter((b) => b.props.label === 'Cancel reply')
      .length,
    0,
  );
});
