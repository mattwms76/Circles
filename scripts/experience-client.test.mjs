import assert from 'node:assert/strict';
import { test } from 'node:test';
import { experience, demo, mountChat, act } from './react-fixture.mjs';
test('Discovery combines privacy, activity and personalised ranking without mutating input', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  const circles = [
    { ...demo.circles[0], id: 'old', isPrivate: true, lastActivityAt: '2026-09-01T12:00:00Z' },
    { ...demo.circles[0], id: 'public', isPrivate: false, lastActivityAt: '2026-10-12T12:00:00Z' },
    { ...demo.circles[0], id: 'private', isPrivate: true, lastActivityAt: '2026-10-11T12:00:00Z' },
  ];
  assert.deepEqual(
    experience
      .filterDiscovery(circles, { privacy: 'private', activeOnly: true, sort: 'active' }, [], now)
      .map((c) => c.id),
    ['private'],
  );
  assert.deepEqual(
    circles.map((c) => c.id),
    ['old', 'public', 'private'],
  );
  assert.match(
    experience.recommendationReason({ ...circles[1], isMember: false }, [circles[1].interest]),
    /Matches your interest/,
  );
});
test('Activity grouping uses latest item, target and date while retaining every unread ID', () => {
  const base = {
    kind: 'messages',
    target_id: 'peer',
    title: 'Message',
    body: 'Hello',
    circle_id: null,
    read_at: null,
  };
  const groups = experience.groupActivity([
    { ...base, id: 'old', created_at: '2026-10-11T12:00:00Z' },
    { ...base, id: 'first', created_at: '2026-10-12T10:00:00Z' },
    { ...base, id: 'latest', created_at: '2026-10-12T12:00:00Z', read_at: '2026-10-12T12:01:00Z' },
    { ...base, id: 'other', target_id: 'different', created_at: '2026-10-12T11:00:00Z' },
  ]);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].latest.id, 'latest');
  assert.equal(groups[0].unread, 1);
  assert.deepEqual(
    Array.from(groups[0].items, (i) => i.id),
    ['latest', 'first'],
  );
});
test('Demo reactions toggle per user and conversation mute preferences persist', async () => {
  await experience.reactToContent('message', 'test-message', '👍', false);
  assert.equal(
    (await experience.loadReactions('message', ['test-message']))['test-message'].length,
    1,
  );
  await experience.reactToContent('message', 'test-message', '👍', true);
  assert.equal(
    (await experience.loadReactions('message', ['test-message']))['test-message'].length,
    0,
  );
  await experience.muteConversation('test-peer', true);
  assert.equal(await experience.conversationMuted('test-peer'), true);
  await experience.muteConversation('test-peer', false);
  assert.equal(await experience.conversationMuted('test-peer'), false);
});

test('Failed native message send retains draft and successful retry clears it', async (t) => {
  let fails = true,
    calls = 0;
  const chat = await mountChat({
    onSend: async (body) => {
      calls++;
      assert.equal(body, 'Keep until delivered');
      if (fails) throw new Error('Offline');
    },
  });
  t.after(() => chat.close());
  await act(async () =>
    chat.renderer.root
      .findByProps({ accessibilityLabel: 'Message' })
      .props.onChangeText('Keep until delivered'),
  );
  const send = () =>
    chat.renderer.root
      .findAllByType('ActionButton')
      .find((b) => b.props.label === 'Send')
      .props.onPress();
  await act(async () => send());
  assert.equal(calls, 1);
  assert.equal(
    chat.renderer.root.findByProps({ accessibilityLabel: 'Message' }).props.value,
    'Keep until delivered',
  );
  fails = false;
  await act(async () => send());
  assert.equal(calls, 2);
  assert.equal(chat.renderer.root.findByProps({ accessibilityLabel: 'Message' }).props.value, '');
});
