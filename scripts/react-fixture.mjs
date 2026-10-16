import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import ts from 'typescript';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
export { act };
export const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
export function loadSource(file, mocks = {}) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(
    code,
    {
      module,
      exports: module.exports,
      require: (name) => {
        if (name in mocks)
          return name.endsWith('/theme')
            ? {
                createThemedStyles: (factory) => factory(),
                useThemeMode: () => 'light',
                useReducedMotion: () => true,
                ...mocks[name],
              }
            : mocks[name];
        if (name.endsWith('/secureStorage'))
          return {
            secureStorage: mocks['@react-native-async-storage/async-storage'] ?? {
              getItem: async () => null,
              setItem: async () => {},
              removeItem: async () => {},
              getAllKeys: async () => [],
              multiRemove: async () => {},
            },
          };
        if (name.endsWith('/authFlow')) return { beginAuthFlow: async () => {} };
        if (name.endsWith('/pushDevice'))
          return {
            deregisterPushDevice: async () => {},
            flushPendingPushDeregistration: async () => {},
            registerPushDevice: async () => {},
          };
        if (name === '@react-native-async-storage/async-storage')
          return { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} };
        if (name.endsWith('/Sheet'))
          return loadSource('src/components/Sheet.tsx', {
            'react-native': native,
            'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0, top: 0 }) },
            '../theme': { colors: {} },
            '../appStyles': { styles: {} },
          });
        if (name.endsWith('/CommunityContext')) return { useCommunity: () => null };
        if (name.endsWith('/CommunityDepth'))
          return {
            CommunityProvider: ({ children }) => children,
            FeedControls: 'FeedControls',
            CircleFeatures: 'CircleFeatures',
            GroupInbox: 'GroupInbox',
            HelpfulAnswer: 'HelpfulAnswer',
            MemberRecognition: 'MemberRecognition',
            PostTopicPicker: 'PostTopicPicker',
          };
        if (name.endsWith('/CommunityMessages'))
          return {
            MessageMediaComposer: 'MessageMediaComposer',
            MessageAttachment: 'MessageAttachment',
          };
        if (name.endsWith('/PublishingTools')) return { PublishingTools: 'PublishingTools' };
        if (name.endsWith('/ParticipationCard')) return { ParticipationCard: 'ParticipationCard' };
        if (name.endsWith('/PostGallery')) return { PostGallery: 'PostGallery' };
        if (name.endsWith('/communityDepth')) return { redeemInvite: async () => ({}) };
        if (name.endsWith('/components/Stories')) return { Stories: 'Stories' };
        if (name === './DiscoveryScreens')
          return { HomeScreen: 'HomeScreen', ExploreScreen: 'ExploreScreen' };
        if (name.endsWith('/components/LoadingCards')) return { LoadingCards: 'LoadingCards' };
        if (name === './design-tokens.json')
          return JSON.parse(
            readFileSync(new URL('../src/design-tokens.json', import.meta.url), 'utf8'),
          );
        if (name.endsWith('/lib/pickedMedia'))
          return loadSource('src/lib/pickedMedia.ts', {
            'expo-file-system/legacy': {
              getInfoAsync: async () => ({ exists: true, isDirectory: false, size: 1024 }),
            },
          });
        if (name.endsWith('/localData') || name === './localData')
          return loadSource('src/lib/localData.ts');
        if (name.endsWith('/lib/contentLinks')) return loadSource('src/lib/contentLinks.ts');
        if (name.endsWith('/components/PostActions') || name === './PostActions')
          return {
            PostActionsProvider: ({ children }) => children,
            SavedPostsButton: 'SavedPostsButton',
            usePostActions: () => null,
          };
        if (name.endsWith('/components/CirclePostSearch'))
          return {
            CirclePostSearch: 'CirclePostSearch',
            useCirclePostSearch: () => ({
              active: false,
              rows: [],
              loading: false,
              error: '',
              more: false,
            }),
          };
        if (name.endsWith('/ScheduleDateField'))
          return { ScheduleDateField: 'ScheduleDateField', AddToCalendar: 'AddToCalendar' };
        if (name === './PostVideo') return { PostVideo: 'PostVideo' };
        if (name === '../lib/textDraftStore' || name === './textDraftStore')
          return loadSource('src/lib/textDraftStore.ts');
        if (name.endsWith('/lib/experience')) return experience;
        if (name === '../lib/supabase') return { supabase: null, backendReady: false };
        if (name === '../components/Experience')
          return {
            DiscoveryControls: 'DiscoveryControls',
            ScheduledRooms: 'ScheduledRooms',
            ReactionBar: 'ReactionBar',
            experienceStyles: {},
            useContentReactions: () => ({ reactions: {}, error: '', react: async () => {} }),
          };
        if (name === 'react' || name === 'react/jsx-runtime') return require(name);
        throw new Error(`Unmocked ${name} in ${file}`);
      },
      console,
      process,
      URL,
      URLSearchParams,
      Request,
      Response,
      AbortController,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      Map,
      Set,
      Promise,
      Date,
    },
    { filename: file },
  );
  return module.exports;
}
export const demo = loadSource('src/data/demo.ts');
const experienceStorage = new Map();
export const experience = loadSource('src/lib/experience.ts', {
  '@react-native-async-storage/async-storage': {
    getItem: async (k) => experienceStorage.get(k) ?? null,
    setItem: async (k, v) => {
      experienceStorage.set(k, v);
    },
  },
  './supabase': { supabase: null },
  './repositories': {
    getDemoCurrentUser: () => demo.currentUser,
    toProfile: (r) => r,
    relativeTime: () => 'now',
  },
});

const screenNames = [
  'HomeScreen',
  'ExploreScreen',
  'LiveScreen',
  'InboxScreen',
  'ProfileScreen',
  'PublicProfileScreen',
  'CircleDetailScreen',
  'PostRepliesSheet',
  'TabBar',
  'CreatePostSheet',
  'CreateCircleSheet',
  'StartLiveSheet',
  'LiveRoom',
  'ChatScreen',
  'OnboardingSheet',
  'SettingsSheet',
  'RecoverySheet',
  'ActivitySheet',
  'CircleTools',
  'ModeratorSheet',
  'ReportSheet',
];
export const native = new Proxy(
  {
    Platform: { OS: 'android' },
    AccessibilityInfo: { announceForAccessibility() {} },
    AppState: { addEventListener: () => ({ remove() {} }) },
    Alert: { alert() {} },
    Linking: {
      getInitialURL: async () => null,
      addEventListener: () => ({ remove() {} }),
    },
    StyleSheet: { create: (s) => s },
  },
  { get: (target, key) => target[key] ?? String(key) },
);
export async function mountApp({
  connected = true,
  repositories = {},
  community = {},
  stream = {},
  imagePicker = {},
} = {}) {
  const own = {
    ...demo.currentUser,
    id: 'account-a',
    displayName: 'Saved profile',
    bio: 'Saved bio',
    interests: ['Art'],
    onboardingCompletedAt: '2026-10-01',
  };
  let user = {
    id: own.id,
    email: 'member@test.local',
    user_metadata: { display_name: 'Old sign-up name' },
  };
  let authListener = () => {};
  let sequence = 0;
  const builder = () =>
    new Proxy(
      {},
      {
        get: (_, key) =>
          key === 'then'
            ? (resolve) => resolve({ data: [], error: null })
            : key === 'maybeSingle'
              ? async () => ({ data: { balance: 25 }, error: null })
              : key === 'single'
                ? async () => ({ data: null, error: null })
                : () => builder(),
      },
    );
  const channels = [];
  const client = {
    auth: {
      getSession: async () => ({ data: { session: user ? { user } : null } }),
      getUser: async () => ({ data: { user } }),
      onAuthStateChange(fn) {
        authListener = fn;
        return { data: { listener: null, subscription: { unsubscribe() {} } } };
      },
    },
    from: () => builder(),
    channel: () => {
      const channel = {
        active: true,
        handlers: [],
        on(_type, filter, callback) {
          this.handlers.push({ filter, callback });
          return this;
        },
        subscribe() {
          return this;
        },
      };
      channels.push(channel);
      return channel;
    },
    removeChannel: async (channel) => {
      channel.active = false;
    },
  };
  const repo = {
    createIdempotencyKey: () => `request-${++sequence}`,
    loadOwnProfile: async () => own,
    loadCircles: async () => demo.circles,
    loadPosts: async () =>
      Array.from({ length: 20 }, (_, i) => ({
        ...demo.posts[0],
        id: `initial-${i}`,
      })),
    loadLiveSessions: async () => [],
    loadGiftCatalog: async () => demo.gifts,
    loadCircleRequests: async () => [],
    loadMyPendingCircleIds: async () => [],
    loadCirclePosts: async (id) => demo.posts.filter((p) => p.circleId === id),
    loadPeopleAndFollows: async () => ({
      people: demo.people,
      followingIds: [],
      followerIds: [],
    }),
    loadFollowers: async () => [],
    loadFollowing: async () => [],
    loadConversations: async () => [],
    loadPublicProfile: async (id) => demo.people.find((p) => p.id === id),
    loadUserFollowers: async () => [],
    loadUserFollowing: async () => [],
    loadProfilePosts: async () => [],
    loadPostComments: async () => [],
    loadLiveGiftEvents: async () => [],
    joinCircle: async (c) => (c.isPrivate ? 'pending' : 'member'),
    createPost: async () => {},
    ...repositories,
  };
  const services = {
    searchDiscovery: async () => ({
      circles: demo.circles,
      people: demo.people,
    }),
    loadNotifications: async () => [],
    loadBlockedPeople: async () => [],
    signOutDevice: async () => {},
    beatLiveSeat: async () => {},
    ...community,
  };
  const files = new Map();
  const storage = {
    getItem: async (k) => files.get(k) ?? null,
    setItem: async (k, v) => {
      files.set(k, v);
    },
    removeItem: async (k) => files.delete(k),
  };
  const drafts = {
    readDraft: async () => null,
    saveDraft: async () => {},
    clearDraft: async () => {},
    retainDraftMedia: async (_id, m) => m,
    retainPublishedMedia: async (_id, m) => ({
      ...m,
      uri: 'file:///published.jpg',
    }),
  };
  const components = Object.fromEntries(screenNames.map((n) => [n, n]));
  const app = loadSource('App.tsx', {
    './src/lib/contentDeletion': loadSource('src/lib/contentDeletion.ts'),
    './src/lib/feedState': loadSource('src/lib/feedState.ts'),
    'expo-notifications': {
      addNotificationResponseReceivedListener: () => ({ remove() {} }),
      getLastNotificationResponseAsync: async () => null,
    },
    './src/screens/CommunityScreens': components,
    './src/lib/community': services,
    './src/lib/drafts': drafts,
    './src/lib/media': { clearMediaCache() {} },
    './src/lib/diagnostics': {
      AppErrorBoundary: ({ children }) => children,
      reportDiagnostic: async () => {},
    },
    '@react-native-async-storage/async-storage': storage,
    'react-native': native,
    'react-native-safe-area-context': {
      SafeAreaProvider: 'SafeAreaProvider',
      SafeAreaView: 'SafeAreaView',
    },
    'expo-image-picker': imagePicker,
    './src/lib/streaming': {
      streamProvider: {
        issueCredentials: async () => ({
          token: 'test',
          channel: 'test',
          uid: 1,
        }),
        adapter: () => stream,
      },
    },
    './src/components/CoinStore': { CoinStore: 'CoinStore' },
    './src/components/Primitives': { ActionButton: 'ActionButton' },
    './src/theme': { colors: {} },
    './src/appStyles': { styles: {} },
    './src/screens/AppScreens': components,
    './src/data/demo': demo,
    './src/lib/supabase': {
      backendReady: connected,
      supabase: connected ? client : null,
    },
    './src/lib/repositories': repo,
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(app.default));
  });
  return {
    own,
    repo,
    services,
    storage,
    files,
    renderer,
    async emitChange(table, event = 'INSERT') {
      await act(async () => {
        for (const channel of channels.filter((c) => c.active))
          for (const { filter, callback } of channel.handlers)
            if (filter.table === table && filter.event === event) callback({ new: {}, old: {} });
      });
    },
    async emitDelete(table, id) {
      await act(async () => {
        for (const channel of channels.filter((channel) => channel.active)) {
          for (const { filter, callback } of channel.handlers) {
            if (filter.table === table && filter.event === 'DELETE' && !filter.filter)
              callback({ old: { id } });
          }
        }
      });
    },
    props: (name) => renderer.root.findByType(name).props,
    count: (name) => renderer.root.findAllByType(name).length,
    async auth(event, nextUser = user) {
      user = nextUser;
      await act(async () => {
        authListener(event, user ? { user } : null);
      });
    },
    async close() {
      await act(async () => renderer.unmount());
    },
    async settleSearch() {
      await act(async () => new Promise((r) => setTimeout(r, 320)));
    },
  };
}
export async function mountChat(overrides = {}) {
  const files = new Map();
  const storage = {
    getItem: async (k) => files.get(k) ?? null,
    setItem: async (k, v) => {
      files.set(k, v);
    },
    removeItem: async (k) => files.delete(k),
  };
  const screens = loadSource('src/screens/AppScreens.tsx', {
    '../lib/contentDeletion': loadSource('src/lib/contentDeletion.ts'),
    'expo-image-picker': {},
    '@react-native-async-storage/async-storage': storage,
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-video': { useVideoPlayer: () => ({}), VideoView: 'VideoView' },
    '../lib/streaming': {
      AgoraVideoTile: 'AgoraVideoTile',
      agoraUidFor: () => 1,
    },
    '../components/Primitives': new Proxy(
      { formatCount: String },
      { get: (o, k) => o[k] ?? String(k) },
    ),
    '../theme': { colors: {} },
    '../appStyles': { styles: {} },
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(screens.ChatScreen, {
        conversation: { peer: demo.people[0], messages: [], unread: 0 },
        profile: demo.currentUser,
        hasOlder: false,
        onClose() {},
        onSend: async () => {},
        onReport() {},
        ...overrides,
      }),
    );
  });
  return {
    files,
    renderer,
    async close() {
      await act(async () => renderer.unmount());
    },
  };
}
