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

test('Shared controls and navigation retain readable contrast in both themes', async (t) => {
  let mode = 'light';
  const theme = loadSource('src/theme.ts', {
    'react-native': { ...native, Appearance: { getColorScheme: () => mode } },
  });
  const shared = loadSource('src/components/Primitives.tsx', {
    'react-native': native,
    '../theme': theme,
  });
  const { styles } = loadSource('src/appStyles.ts', { 'react-native': native, './theme': theme });
  const flat = (s) => (Array.isArray(s) ? Object.assign({}, ...s.filter(Boolean).map(flat)) : s);
  const luminance = (hex) => {
    const rgb = hex
      .replace('#', '')
      .match(/../g)
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const readable = (fg, bg) => {
    const a = luminance(fg),
      b = luminance(bg);
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${mode}: ${fg} on ${bg}`);
  };
  let renderer;
  t.after(() => act(async () => renderer?.unmount()));
  for (mode of ['light', 'dark']) {
    readable(styles.tabLabel.color, styles.tabBar.backgroundColor);
    readable(styles.tabLabelActive.color, styles.tabBar.backgroundColor);
    assert.equal(styles.field.marginBottom, undefined, 'Field spacing is owned by its form');
    assert.equal(styles.screenTitle.fontSize, theme.typography.title.fontSize);
    await act(async () => {
      renderer?.unmount();
      renderer = TestRenderer.create(
        React.createElement(shared.Pill, { label: 'Gardening', onPress() {} }),
      );
    });
    readable(
      flat(renderer.root.findByType('Text').props.style).color,
      flat(renderer.root.findByType('Pressable').props.style).backgroundColor,
    );
    await act(async () =>
      renderer.update(
        React.createElement(shared.EmptyState, {
          emoji: '○',
          title: 'Nothing yet',
          detail: 'Try again later',
        }),
      ),
    );
    const bg = renderer.root.findByType('View').props.style.backgroundColor;
    renderer.root
      .findAllByType('Text')
      .slice(1)
      .forEach((text) => readable(text.props.style.color, bg));
  }
});

test('Expandable sections hide secondary content and expose their expanded state', async (t) => {
  const { Disclosure } = loadSource('src/components/Primitives.tsx', {
    'react-native': native,
    '../theme': { colors: {}, radii: {} },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(
        Disclosure,
        { title: 'Followers · 4' },
        React.createElement('MemberList'),
      ),
    );
  });
  t.after(() => act(async () => renderer.unmount()));
  assert.equal(renderer.root.findAllByType('MemberList').length, 0);
  const toggle = () => renderer.root.findByType('Pressable');
  assert.equal(toggle().props.accessibilityState.expanded, false);
  await act(async () => toggle().props.onPress());
  assert.equal(toggle().props.accessibilityState.expanded, true);
  assert.equal(renderer.root.findAllByType('MemberList').length, 1);
});

test('Profile editing opens a dedicated dialog with a fixed save action and recoverable failure', async (t) => {
  const { ProfileScreen } = screenModule();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(ProfileScreen, {
        profile: demo.currentUser,
        circles: [],
        followers: [],
        following: [],
        walletBalance: 0,
        followerCount: 0,
        followingCount: 0,
        signedIn: true,
        profileSaving: false,
        onSaveProfile: async () => {
          throw new Error('Upload unavailable');
        },
      }),
    );
  });
  t.after(() => act(async () => renderer.unmount()));
  assert.equal(renderer.root.findAllByType('TextInput').length, 0);
  const edit = renderer.root
    .findAllByType('Pressable')
    .find((p) => p.findAllByType('Text').some((text) => text.props.children === 'Edit profile'));
  await act(async () => edit.props.onPress());
  assert.equal(renderer.root.findAllByType('Modal').length, 1);
  const modal = renderer.root.findByType('Modal');
  assert.equal(modal.findByType('ScrollView').findAllByProps({ label: 'Save profile' }).length, 0);
  await act(async () => modal.findByProps({ label: 'Save profile' }).props.onPress());
  assert.equal(renderer.root.findAllByType('Modal').length, 1);
  assert.equal(
    renderer.root.findByProps({ accessibilityLabel: 'Display name' }).props.value,
    demo.currentUser.displayName,
  );
  assert.ok(
    renderer.root
      .findAllByType('Text')
      .some((text) =>
        /Upload unavailable|Could not save your profile/.test(String(text.props.children)),
      ),
  );
});

test('Circle and live creation keep their primary actions visible and reject incomplete input', async (t) => {
  const { CreateCircleSheet, StartLiveSheet } = screenModule();
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(CreateCircleSheet, {
        name: '',
        interest: 'Art',
        description: '',
        busy: false,
        onClose() {},
        onSubmit() {},
      }),
    );
  });
  t.after(() => act(async () => renderer.unmount()));
  assert.equal(renderer.root.findByProps({ label: 'Create your circle' }).props.disabled, true);
  assert.equal(
    renderer.root.findByType('ScrollView').findAllByProps({ label: 'Create your circle' }).length,
    0,
  );
  await act(async () =>
    renderer.update(
      React.createElement(StartLiveSheet, { title: '', onClose() {}, onSubmit() {} }),
    ),
  );
  assert.equal(renderer.root.findByProps({ label: 'Start livestream' }).props.disabled, true);
  assert.equal(
    renderer.root.findByType('ScrollView').findAllByProps({ label: 'Start livestream' }).length,
    0,
  );
});
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
  assert.equal(
    header.root.findAllByType('CircleTools').length,
    0,
    'Management stays behind Circle tools',
  );
  assert.equal(header.root.findByType('CircleFeatures').props.details.props.section, 'about');
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
      .filter((b) => /^(Photo|GIF|Upload video|Record video)$/.test(b.props.accessibilityLabel))
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

test('Message actions stay hidden until selected and Reply preserves the composer draft', async (t) => {
  const { ChatScreen } = screenModule();
  const message = {
    id: 'message-1',
    senderId: demo.people[0].id,
    body: 'Meet you there',
    createdAt: 'Now',
    createdAtIso: new Date().toISOString(),
  };
  let renderer, bubble;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(ChatScreen, {
        conversation: { peer: demo.people[0], messages: [message], unread: 0 },
        profile: demo.currentUser,
        hasOlder: false,
        onSend: async () => {},
        onDelete: async () => {},
        onClose() {},
        onReport() {},
      }),
    );
  });
  t.after(() =>
    act(async () => {
      renderer.unmount();
      bubble?.unmount();
    }),
  );
  await act(async () =>
    renderer.root.findByProps({ accessibilityLabel: 'Message' }).props.onChangeText('My draft'),
  );
  await act(async () => {
    bubble = TestRenderer.create(
      renderer.root.findByType('FlatList').props.renderItem({ item: message }),
    );
  });
  assert.equal(bubble.root.findAllByProps({ accessibilityLabel: 'Add reaction' }).length, 0);
  await act(async () => bubble.root.findByType('Pressable').props.onPress());
  const reply = renderer.root
    .findAllByType('ActionButton')
    .find((button) => button.props.label === 'Reply');
  assert.ok(reply);
  await act(async () => reply.props.onPress());
  assert.equal(
    renderer.root.findByProps({ accessibilityLabel: 'Message' }).props.value,
    'My draft',
  );
  assert.ok(
    renderer.root
      .findAllByType('ActionButton')
      .some((button) => button.props.label === 'Cancel reply'),
  );
});
