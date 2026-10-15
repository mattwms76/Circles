import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { act, demo, loadSource, native } from './react-fixture.mjs';
const primitives = new Proxy({ formatCount: String }, { get: (o, k) => o[k] ?? String(k) });
function screenModule() {
  return loadSource('src/screens/AppScreens.tsx', {
    '../lib/contentDeletion': loadSource('src/lib/contentDeletion.ts'),
    'expo-image-picker': {},
    '@react-native-async-storage/async-storage': {
      getItem: async () => null,
      setItem: async () => {},
      removeItem: async () => {},
    },
    'react-native': native,
    'react-native-safe-area-context': {
      SafeAreaView: 'SafeAreaView',
      useSafeAreaInsets: () => ({ bottom: 0 }),
    },
    'expo-video': { useVideoPlayer: () => ({}), VideoView: 'VideoView' },
    '../lib/streaming': { AgoraVideoTile: 'AgoraVideoTile', agoraUidFor: () => 1 },
    '../components/Primitives': primitives,
    '../theme': { colors: {} },
    '../appStyles': { styles: {} },
  });
}
test('Circle tabs show posts first and expose separate event/about tools without leaking private content', async (t) => {
  const { CircleDetailScreen } = screenModule();
  const props = {
    circle: { ...demo.circles[0], isMember: true },
    tools: React.createElement('CircleTools'),
    posts: demo.posts,
    onRefresh() {},
    onBack() {},
    onJoin() {},
    onLeave() {},
    onPost() {},
    onLike() {},
    onCreatePost() {},
    onLoadMore() {},
  };
  let renderer, header;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(CircleDetailScreen, props));
  });
  const list = () => renderer.root.findByType('FlatList');
  const renderHeader = async () =>
    act(async () => {
      if (header) header.update(list().props.ListHeaderComponent);
      else header = TestRenderer.create(list().props.ListHeaderComponent);
    });
  t.after(() =>
    act(async () => {
      renderer.unmount();
      header?.unmount();
    }),
  );
  assert.equal(list().props.data.length, demo.posts.length);
  await renderHeader();
  assert.equal(header.root.findAllByType('CircleTools').length, 0);
  await act(async () =>
    header.root
      .findAllByType('Pressable')
      .filter((b) => b.props.accessibilityRole === 'tab')[1]
      .props.onPress(),
  );
  await renderHeader();
  assert.equal(list().props.data.length, 0);
  assert.equal(header.root.findByType('CircleTools').props.section, 'events');
  await act(async () =>
    header.root
      .findAllByType('Pressable')
      .filter((b) => b.props.accessibilityRole === 'tab')[2]
      .props.onPress(),
  );
  await renderHeader();
  assert.equal(header.root.findByType('CircleTools').props.section, 'about');
  await act(async () =>
    renderer.update(
      React.createElement(CircleDetailScreen, {
        ...props,
        circle: { ...props.circle, isMember: false },
      }),
    ),
  );
  await renderHeader();
  assert.equal(header.root.findAllByType('CircleTools').length, 0);
});
test('Composer keeps its publish action outside scrolling content and rejects empty posts', async (t) => {
  const { CreatePostSheet } = screenModule();
  const props = {
    circles: demo.circles,
    selectedCircleId: demo.circles[0].id,
    body: '',
    attachment: null,
    busy: false,
    error: '',
    onClose() {},
    onSubmit() {},
    onPick() {},
    onRecordVideo() {},
    onDiscard() {},
    onClearAttachment() {},
  };
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(CreatePostSheet, props));
  });
  t.after(() => act(async () => renderer.unmount()));
  const publish = () =>
    renderer.root
      .findAllByType('ActionButton')
      .find((b) => b.props.label === 'Share with your circle');
  assert.equal(publish().props.disabled, true);
  assert.equal(
    renderer.root
      .findByType('ScrollView')
      .findAllByType('ActionButton')
      .some((b) => b.props.label === 'Share with your circle'),
    false,
  );
  await act(async () =>
    renderer.update(React.createElement(CreatePostSheet, { ...props, body: 'A new thought' })),
  );
  assert.equal(publish().props.disabled, false);
  assert.equal(renderer.root.findByType('Modal').props.animationType, 'none');
  assert.equal(
    renderer.root
      .findAllByType('Pressable')
      .filter((b) => /^Add (photo|gif|upload video|record video)$/.test(b.props.accessibilityLabel))
      .length,
    4,
  );
});
test('Reaction picker shows existing reactions and opens additional choices on demand', async (t) => {
  const { ReactionBar } = loadSource('src/components/Experience.tsx', {
    'react-native': native,
    './Primitives': primitives,
    '../theme': { colors: {}, spacing: {}, typography: {} },
    '../lib/repositories': {},
    '../lib/community': {},
    '../lib/experience': { reactionEmoji: ['❤️', '👍', '😂', '🎉', '😮'] },
  });
  const calls = [];
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(ReactionBar, {
        viewerId: 'me',
        items: [{ user_id: 'other', emoji: '👍' }],
        onReact: (...args) => calls.push(args),
      }),
    );
  });
  t.after(() => act(async () => renderer.unmount()));
  assert.equal(renderer.root.findAllByType('Pressable').length, 2);
  await act(async () =>
    renderer.root
      .findAllByType('Pressable')
      .find((b) => b.props.accessibilityLabel === 'Add reaction')
      .props.onPress(),
  );
  assert.equal(renderer.root.findAllByType('Pressable').length, 6);
  await act(async () =>
    renderer.root
      .findAllByType('Pressable')
      .find((b) => b.props.accessibilityLabel === 'Add ❤️ reaction, 0')
      .props.onPress(),
  );
  assert.deepEqual(calls, [['❤️', false]]);
  assert.equal(renderer.root.findAllByType('Pressable').length, 2);
});
test('System appearance updates styles without resetting component state; reduced motion follows accessibility settings', async (t) => {
  let mode = 'light',
    listener,
    motionListener;
  const theme = loadSource('src/theme.ts', {
    'react-native': {
      StyleSheet: { create: (s) => s },
      Appearance: {
        getColorScheme: () => mode,
        addChangeListener: (fn) => {
          listener = fn;
          return { remove() {} };
        },
      },
      AccessibilityInfo: {
        isReduceMotionEnabled: async () => true,
        addEventListener: (_event, fn) => {
          motionListener = fn;
          return { remove() {} };
        },
      },
    },
  });
  const styles = theme.createThemedStyles(() => ({
    panel: { backgroundColor: theme.colors.paper },
  }));
  function Probe() {
    const appearance = theme.useThemeMode(),
      reduced = theme.useReducedMotion();
    const [draft, setDraft] = React.useState('');
    return React.createElement('Probe', {
      appearance,
      reduced,
      background: styles.panel.backgroundColor,
      draft,
      setDraft,
    });
  }
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(Probe));
  });
  t.after(() => act(async () => renderer.unmount()));
  const probe = () => renderer.root.findByType('Probe');
  await act(async () => probe().props.setDraft('Keep this draft'));
  await act(async () => {
    mode = 'dark';
    listener();
  });
  assert.equal(probe().props.background, theme.darkColors.paper);
  assert.equal(probe().props.draft, 'Keep this draft');
  assert.equal(probe().props.reduced, true);
  await act(async () => motionListener(false));
  assert.equal(probe().props.reduced, false);
});

test('Conversation tools expand without replacing the draft or multiline composer', async (t) => {
  const { ChatScreen } = screenModule();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(ChatScreen, {
        conversation: { peer: demo.people[0], messages: [], unread: 0 },
        profile: demo.currentUser,
        hasOlder: false,
        onSend: async () => {},
        onClose() {},
        onReport() {},
      }),
    );
  });
  t.after(() => act(async () => renderer.unmount()));
  const input = () => renderer.root.findByProps({ accessibilityLabel: 'Message' });
  const toggle = () => renderer.root.findByProps({ accessibilityLabel: 'Conversation options' });
  assert.equal(
    renderer.root.findAllByProps({ accessibilityLabel: 'Search this conversation' }).length,
    0,
  );
  assert.equal(input().props.multiline, true);
  assert.equal(input().props.submitBehavior, 'newline');
  await act(async () => input().props.onChangeText('Hello\nSee you tomorrow'));
  await act(async () => toggle().props.onPress());
  assert.equal(toggle().props.accessibilityState.expanded, true);
  assert.equal(
    renderer.root.findAllByProps({ accessibilityLabel: 'Search this conversation' }).length,
    1,
  );
  await act(async () => toggle().props.onPress());
  assert.equal(input().props.value, 'Hello\nSee you tomorrow');
});
