import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadSource } from './react-fixture.mjs';
const profile = { id: 'author', display_name: 'Author', handle: 'author', interests: [] };
const repository = (client) =>
  loadSource('src/lib/repositories.ts', {
    'expo-file-system/legacy': {},
    './media': {},
    '../data/demo': {},
    './supabase': { supabase: client, requireSupabase: () => client },
  });
test('Comment repository pages through 251 replies and returns stable chronological order', async () => {
  const data = Array.from({ length: 251 }, (_, i) => ({
    id: String(251 - i),
    post_id: 'post',
    body: 'Comment ' + i,
    created_at: new Date(1700000000000 + 251 - i).toISOString(),
    profiles: profile,
  }));
  const ranges = [],
    orders = [];
  const builder = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    order(...args) {
      orders.push(args);
      return this;
    },
    async range(a, b) {
      ranges.push([a, b]);
      return { data: data.slice(a, b + 1), error: null };
    },
  };
  const result = await repository({ from: () => builder }).loadPostComments('post', 300);
  assert.equal(result.length, 251);
  assert.equal(result[0].id, '1');
  assert.equal(result.at(-1).id, '251');
  assert.deepEqual(ranges, [
    [0, 199],
    [200, 299],
  ]);
  assert.ok(orders.some(([field]) => field === 'id'));
});
test('Comment repository rejects blank text and an account change before inserting', async () => {
  let inserts = 0;
  const repo = repository({
    auth: { getUser: async () => ({ data: { user: { id: 'new-account' } } }) },
    from: () => {
      inserts++;
      throw new Error('Should not insert');
    },
  });
  await assert.rejects(
    repo.createPostComment('post', 'body', undefined, 'old-account'),
    /account changed/,
  );
  await assert.rejects(repo.createPostComment('post', '   ', undefined, 'new-account'), /1–2000/);
  assert.equal(inserts, 0);
});
test('Reaction counts include rows beyond the API page limit', async () => {
  const data = Array.from({ length: 1203 }, (_, i) => ({
    comment_id: 'comment',
    user_id: String(i),
    emoji: '👍',
  }));
  const ranges = [];
  const builder = {
    select() {
      return this;
    },
    in() {
      return this;
    },
    order() {
      return this;
    },
    async range(a, b) {
      ranges.push([a, b]);
      return { data: data.slice(a, b + 1), error: null };
    },
  };
  const experience = loadSource('src/lib/experience.ts', {
    '@react-native-async-storage/async-storage': {},
    './supabase': { supabase: { from: () => builder } },
    './repositories': {},
  });
  const result = await experience.loadReactions('comment', ['comment']);
  assert.equal(result.comment.length, 1203);
  assert.equal(ranges.length, 3);
});
