import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, deferred, demo, mountApp } from './react-fixture.mjs';

async function accountChat(t, repositories) {
  const peer = demo.people[0];
  let owner = 'account-a';
  const conversation = { id: 'chat', peer, isMutual: true, unread: 0, messages: [] };
  const app = await mountApp({
    repositories: {
      loadOwnProfile: async () => ({ ...demo.currentUser, id: owner }),
      loadPeopleAndFollows: async () => ({
        people: [peer],
        followingIds: [peer.id],
        followerIds: [peer.id],
      }),
      loadConversations: async () => [conversation],
      loadConversationMessages: async () => [],
      markConversationRead: async () => {},
      ...repositories,
    },
  });
  t.after(() => app.close());
  const open = async () => {
    await act(async () => app.props('TabBar').onChange('inbox'));
    await act(async () => app.props('InboxScreen').onConversation(conversation));
  };
  await open();
  return {
    app,
    async switchAccount() {
      await app.auth('SIGNED_OUT', null);
      owner = 'account-b';
      await app.auth('SIGNED_IN', { id: owner, email: 'b@example.test', user_metadata: {} });
      await open();
    },
  };
}

test('An earlier-message request from an old account cannot populate the new account chat', async (t) => {
  const older = deferred();
  const { app, switchAccount } = await accountChat(t, {
    loadConversationMessages: async (_peer, cursor) => (cursor ? older.promise : []),
  });
  let pending;
  await act(async () => {
    pending = app
      .props('ChatScreen')
      .onLoadOlder({ createdAt: '2026-10-15T12:00:00Z', id: 'oldest' });
  });
  await switchAccount();
  await act(async () => {
    older.resolve([
      { id: 'private-old-account', body: 'Private account A history', senderId: 'account-a' },
    ]);
    await pending;
  });
  assert.ok(
    !app.props('ChatScreen').conversation.messages.some((m) => m.id === 'private-old-account'),
  );
});

test('A completed send from an old account does not start a new-account message refresh', async (t) => {
  const sending = deferred();
  let loads = 0;
  const { app, switchAccount } = await accountChat(t, {
    sendDirectMessage: () => sending.promise,
    loadConversationMessages: async () => {
      loads++;
      return [];
    },
  });
  let pending;
  await act(async () => {
    pending = app.props('ChatScreen').onSend('Account A message');
  });
  await switchAccount();
  const initialLoads = loads;
  await act(async () => {
    sending.resolve();
    await pending;
  });
  assert.equal(loads, initialLoads);
});
