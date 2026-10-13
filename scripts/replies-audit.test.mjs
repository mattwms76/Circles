import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, demo, deferred, mountApp } from './react-fixture.mjs';
const comment = (postId, id = 'sent') => ({
  id,
  postId,
  author: { ...demo.currentUser, id: 'account-a' },
  body: 'Reply A',
  createdAt: 'now',
  createdAtIso: new Date().toISOString(),
});
test('Reply completing after changing posts cannot contaminate the new thread or its draft', async (t) => {
  const pending = deferred();
  const app = await mountApp({ repositories: { createPostComment: () => pending.promise } });
  t.after(() => app.close());
  const [a, b] = app.props('HomeScreen').feed;
  await act(async () => app.props('HomeScreen').onReply(a));
  await act(async () => app.props('PostRepliesSheet').onDraft('Reply A'));
  let send;
  await act(async () => {
    send = app.props('PostRepliesSheet').onSend();
  });
  await act(async () => app.props('PostRepliesSheet').onClose());
  await act(async () => app.props('HomeScreen').onReply(b));
  await act(async () => app.props('PostRepliesSheet').onDraft('Draft B'));
  await act(async () => {
    pending.resolve(comment(a.id));
    await send;
  });
  assert.equal(app.props('PostRepliesSheet').draft, 'Draft B');
  assert.equal(app.props('PostRepliesSheet').comments.length, 0);
});
test('Reply completing after sign-out cannot restore content into another account', async (t) => {
  const pending = deferred();
  const app = await mountApp({ repositories: { createPostComment: () => pending.promise } });
  t.after(() => app.close());
  const a = app.props('HomeScreen').feed[0];
  await act(async () => app.props('HomeScreen').onReply(a));
  await act(async () => app.props('PostRepliesSheet').onDraft('Reply A'));
  let send;
  await act(async () => {
    send = app.props('PostRepliesSheet').onSend();
  });
  await app.auth('SIGNED_OUT', null);
  await app.auth('SIGNED_IN', { id: 'account-b', email: 'b@test.local', user_metadata: {} });
  await act(async () => app.props('HomeScreen').onReply(a));
  await act(async () => app.props('PostRepliesSheet').onDraft('B private draft'));
  await act(async () => {
    pending.resolve(comment(a.id));
    await send;
  });
  assert.equal(app.props('PostRepliesSheet').draft, 'B private draft');
  assert.equal(app.props('PostRepliesSheet').comments.length, 0);
});

test('Newest refresh wins even if an older request resolves last', async (t) => {
  const first = deferred(),
    second = deferred();
  let calls = 0;
  const app = await mountApp({
    repositories: { loadPostComments: () => (++calls === 1 ? first.promise : second.promise) },
  });
  t.after(() => app.close());
  const post = app.props('HomeScreen').feed[0];
  await act(async () => app.props('HomeScreen').onReply(post));
  await app.emitChange('post_comments');
  await act(async () => second.resolve([comment(post.id, 'new')]));
  await act(async () => first.resolve([comment(post.id, 'old')]));
  assert.equal(app.props('PostRepliesSheet').comments[0].id, 'new');
});
test('A refresh started before sending cannot erase the successfully posted reply', async (t) => {
  const pending = deferred();
  const app = await mountApp({
    repositories: {
      loadPostComments: () => pending.promise,
      createPostComment: async (id) => comment(id),
    },
  });
  t.after(() => app.close());
  const post = app.props('HomeScreen').feed[0];
  await act(async () => app.props('HomeScreen').onReply(post));
  await act(async () => app.props('PostRepliesSheet').onDraft('Reply A'));
  await act(async () => app.props('PostRepliesSheet').onSend());
  await act(async () => pending.resolve([]));
  assert.equal(app.props('PostRepliesSheet').comments[0].id, 'sent');
});
test('Loading failures are explicit and retryable; earlier replies can be loaded past 200', async (t) => {
  let fail = true;
  const app = await mountApp({
    repositories: {
      loadPostComments: async (id, limit) => {
        if (fail) throw new Error('Offline');
        return Array.from({ length: Math.min(limit, 251) }, (_, i) =>
          comment(id, String(251 - Math.min(limit, 251) + i)),
        );
      },
    },
  });
  t.after(() => app.close());
  await act(async () => app.props('HomeScreen').onReply(app.props('HomeScreen').feed[0]));
  assert.match(app.props('PostRepliesSheet').loadError, /Offline|Could not load replies/);
  assert.equal(app.props('PostRepliesSheet').loading, false);
  fail = false;
  await act(async () => app.props('PostRepliesSheet').onRetry());
  assert.equal(app.props('PostRepliesSheet').comments.length, 50);
  assert.equal(app.props('PostRepliesSheet').hasMore, true);
  for (let i = 0; i < 5; i++) await act(async () => app.props('PostRepliesSheet').onLoadMore());
  assert.equal(app.props('PostRepliesSheet').comments.length, 251);
  assert.equal(app.props('PostRepliesSheet').hasMore, false);
});
