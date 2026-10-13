import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, mountApp, deferred } from './react-fixture.mjs';

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
