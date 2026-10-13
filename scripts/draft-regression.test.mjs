import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSource } from './react-fixture.mjs';
function fixture() {
  const items = new Map();
  const files = new Set(['file:///draft-source.jpg']);
  const storage = {
    getItem: async (k) => items.get(k) ?? null,
    setItem: async (k, v) => items.set(k, v),
    removeItem: async (k) => items.delete(k),
  };
  const fs = {
    documentDirectory: 'file:///app/',
    makeDirectoryAsync: async () => {},
    copyAsync: async ({ from, to }) => {
      assert.ok(files.has(from));
      files.add(to);
    },
    deleteAsync: async (path) => {
      for (const name of files) if (name.startsWith(path)) files.delete(name);
    },
  };
  const drafts = loadSource('src/lib/drafts.ts', {
    '@react-native-async-storage/async-storage': storage,
    'expo-file-system/legacy': fs,
  });
  return { items, files, drafts };
}
test('Malformed saved drafts are ignored before reaching controlled inputs', async () => {
  const f = fixture();
  f.items.set('circles:post-draft:member', '{"body":null,"circleId":3}');
  assert.equal(await f.drafts.readDraft('member'), null);
});
test('Published demo media survives clearing the composer draft', async () => {
  const f = fixture();
  const retained = await f.drafts.retainDraftMedia('member', {
    uri: 'file:///draft-source.jpg',
    fileName: 'photo.jpg',
    mimeType: 'image/jpeg',
    kind: 'image',
  });
  assert.equal(typeof f.drafts.retainPublishedMedia, 'function');
  const published = await f.drafts.retainPublishedMedia('member', retained);
  await f.drafts.clearDraft('member');
  assert.ok(f.files.has(published.uri));
  assert.ok(!f.files.has(retained.uri));
});
