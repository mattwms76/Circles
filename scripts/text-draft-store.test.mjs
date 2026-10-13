import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deferred, loadSource } from './react-fixture.mjs';
const { createTextDraftStore } = loadSource('src/lib/textDraftStore.ts');

test('Draft restoration waits for queued edits and preserves write ordering', async () => {
  const first = deferred(),
    files = new Map();
  let calls = 0;
  const store = createTextDraftStore({
    getItem: async (k) => files.get(k) ?? null,
    setItem: async (k, v) => {
      if (++calls === 1) await first.promise;
      files.set(k, v);
    },
  });
  const initial = store.save('account:thread', 'first');
  const version = store.version('account:thread');
  const latest = store.save('account:thread', 'latest');
  const read = store.read('account:thread');
  assert.notEqual(store.version('account:thread'), version);
  first.resolve();
  await Promise.all([initial, latest]);
  assert.equal(await read, 'latest');
});

test('A failed draft write does not block another account or the next retry', async () => {
  const files = new Map();
  let fail = true;
  const store = createTextDraftStore({
    getItem: async (k) => files.get(k) ?? null,
    setItem: async (k, v) => {
      if (k === 'a' && fail) throw new Error('Storage failed');
      files.set(k, v);
    },
  });
  await assert.rejects(store.save('a', 'unsaved'));
  await store.save('b', 'private');
  assert.equal(await store.read('b'), 'private');
  fail = false;
  await store.save('a', 'retry');
  assert.equal(await store.read('a'), 'retry');
});
