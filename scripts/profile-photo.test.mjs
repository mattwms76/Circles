import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { act, deferred, demo, loadSource, mountApp, native } from './react-fixture.mjs';

const photo = { uri: 'file:///new-avatar.jpg', mimeType: 'image/jpeg' };
const uploadedUrl = 'https://example.test/avatars/account-a/new-avatar.jpg';

test('Saving a profile photo uploads for its owner and refreshes existing feed avatars', async (t) => {
  const uploads = [], saves = [];
  const app = await mountApp({
    repositories: {
      loadPosts: async () => [{ ...demo.posts[0], author: { ...demo.currentUser, id: 'account-a' } }, demo.posts[0]],
      updateOwnProfile: async (input, owner) => { saves.push({ input, owner }); return { ...app.own, ...input }; },
    },
    community: { uploadAvatar: async (...args) => { uploads.push(args); return uploadedUrl; } },
  });
  t.after(() => app.close());
  await act(async () => app.props('TabBar').onChange('profile'));
  await act(async () => app.props('ProfileScreen').onSaveProfile({ displayName: 'Updated profile', bio: 'Saved bio', interests: ['Art'] }, photo));
  assert.deepEqual(uploads, [[photo.uri, photo.mimeType, 'account-a']]);
  assert.equal(saves[0].input.avatarUrl, uploadedUrl);
  assert.equal(saves[0].owner, 'account-a');
  assert.equal(app.props('ProfileScreen').profile.avatarUrl, uploadedUrl);
  await act(async () => app.props('TabBar').onChange('home'));
  assert.equal(app.props('HomeScreen').profile.avatarUrl, uploadedUrl);
  assert.equal(app.props('HomeScreen').feed[0].author.avatarUrl, uploadedUrl);
  assert.equal(app.props('HomeScreen').feed[1].author.avatarUrl, demo.posts[0].author.avatarUrl);
});

test('Failed photo uploads preserve the saved profile and permit retry', async (t) => {
  let saves = 0;
  const app = await mountApp({
    repositories: { updateOwnProfile: async (input) => { saves++; return { ...app.own, ...input }; } },
    community: { uploadAvatar: async () => { throw new Error('Upload failed'); } },
  });
  t.after(() => app.close());
  await act(async () => app.props('TabBar').onChange('profile'));
  const input = { displayName: app.own.displayName, bio: app.own.bio, interests: app.own.interests };
  await act(async () => { await assert.rejects(app.props('ProfileScreen').onSaveProfile(input, photo), /Upload failed/); });
  assert.equal(app.props('ProfileScreen').profile.avatarUrl, app.own.avatarUrl);
  assert.equal(app.props('ProfileScreen').profileSaving, false);
  assert.equal(saves, 0);
  app.services.uploadAvatar = async () => uploadedUrl;
  await act(async () => app.props('ProfileScreen').onSaveProfile(input, photo));
  assert.equal(app.props('ProfileScreen').profile.avatarUrl, uploadedUrl);
});

test('Signing out during a photo upload prevents the profile write', async (t) => {
  const pending = deferred();
  let saves = 0;
  const app = await mountApp({
    repositories: { updateOwnProfile: async () => { saves++; return app.own; } },
    community: { uploadAvatar: () => pending.promise },
  });
  t.after(() => app.close());
  await act(async () => app.props('TabBar').onChange('profile'));
  let save;
  await act(async () => { save = app.props('ProfileScreen').onSaveProfile(app.own, photo); });
  await app.auth('SIGNED_OUT', null);
  await act(async () => { pending.resolve(uploadedUrl); await save; });
  assert.equal(saves, 0);
  assert.notEqual(app.props('ProfileScreen').profile.avatarUrl, uploadedUrl);
  assert.equal(app.props('ProfileScreen').profileSaving, false);
});

async function mountProfile(picker, onSaveProfile = async () => {}) {
  const screens = loadSource('src/screens/AppScreens.tsx', {
    '../lib/contentDeletion': loadSource('src/lib/contentDeletion.ts'),
    'expo-image-picker': { launchImageLibraryAsync: picker },
    '@react-native-async-storage/async-storage': {},
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-video': { useVideoPlayer: () => ({}), VideoView: 'VideoView' },
    '../lib/streaming': { AgoraVideoTile: 'AgoraVideoTile', agoraUidFor: () => 1 },
    '../components/Primitives': new Proxy({ formatCount: String }, { get: (o,k) => o[k] ?? String(k) }),
    '../theme': { colors: {} },
    '../appStyles': { styles: {} },
  });
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(screens.ProfileScreen, {
    profile: demo.currentUser, signedIn: true, backendReady: true, circles: [], followers: [], following: [],
    walletBalance: 0, followingCount: 0, followerCount: 0, profileSaving: false, onSaveProfile,
  })); });
  return {
    renderer,
    choose: () => renderer.root.findByProps({ accessibilityLabel: 'Change profile photo' }).props.onPress(),
    avatar: () => renderer.root.findByType('Avatar').props.profile.avatarUrl,
    save: () => renderer.root.findByProps({ label: 'Save profile' }).props.onPress(),
    cancel: () => renderer.root.findAllByType('Pressable').find(button => button.findAllByType('Text').some(text => text.props.children === 'Cancel')).props.onPress(),
    close: () => act(async () => renderer.unmount()),
  };
}

test('Profile picker previews the photo; Cancel discards it and Save includes it', async (t) => {
  let result = { canceled: true, assets: null };
  const saves = [];
  const screen = await mountProfile(async () => result, async (...args) => saves.push(args));
  t.after(() => screen.close());
  await act(async () => screen.choose());
  assert.equal(screen.avatar(), demo.currentUser.avatarUrl);
  result = { canceled: false, assets: [{ ...photo, fileSize: 1024 }] };
  await act(async () => screen.choose());
  assert.equal(screen.avatar(), photo.uri);
  assert.equal(saves.length, 0);
  await act(async () => screen.cancel());
  assert.equal(screen.avatar(), demo.currentUser.avatarUrl);
  await act(async () => screen.choose());
  await act(async () => screen.save());
  assert.equal(saves.length, 1);
  assert.equal(saves[0][1].uri, photo.uri);
  assert.equal(saves[0][1].mimeType, photo.mimeType);
});

test('Profile picker rejects unsupported and oversized photos without replacing the avatar', async (t) => {
  let asset = { uri: 'file:///animation.gif', mimeType: 'image/gif', fileSize: 1024 };
  const screen = await mountProfile(async () => ({ canceled: false, assets: [asset] }));
  t.after(() => screen.close());
  await act(async () => screen.choose());
  assert.match(screen.renderer.root.findByProps({ accessibilityRole: 'alert' }).props.children, /JPG, PNG, or WebP/);
  asset = { ...photo, fileSize: 6 * 1024 * 1024 };
  await act(async () => screen.choose());
  assert.match(screen.renderer.root.findByProps({ accessibilityRole: 'alert' }).props.children, /smaller than 5 MB/);
  assert.equal(screen.avatar(), demo.currentUser.avatarUrl);
  assert.equal(screen.renderer.root.findByProps({ accessibilityLabel: 'Change profile photo' }).props.disabled, false);
});
