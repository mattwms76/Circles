import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import TestRenderer from 'react-test-renderer';
import { act, deferred, loadSource, native } from './react-fixture.mjs';
const fixture = (services) => {
  const module = loadSource('src/components/Experience.tsx', {
    'react-native': native,
    './Primitives': {},
    '../theme': { colors: {}, spacing: {}, typography: {} },
    '../lib/supabase': { supabase: null },
    '../lib/repositories': {},
    '../lib/community': {},
    '../lib/experience': services,
  });
  let current;
  function Probe({ ids }) {
    current = module.useContentReactions('comment', ids);
    return null;
  }
  return { Probe, get: () => current };
};
test('Slow initial reaction fetch cannot undo a successful reaction', async (t) => {
  const old = deferred();
  let calls = 0;
  const f = fixture({
    loadReactions: () =>
      ++calls === 1 ? old.promise : Promise.resolve({ comment: [{ user_id: 'me', emoji: '👍' }] }),
    reactToContent: async () => {},
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(f.Probe, { ids: ['comment'] }));
  });
  t.after(() => act(async () => renderer.unmount()));
  await act(async () => f.get().react('comment', '👍', false));
  await act(async () => old.resolve({}));
  assert.equal(f.get().reactions.comment.length, 1);
});
test('Reaction completion from a closed thread cannot replace the next thread state', async (t) => {
  const mutation = deferred();
  const f = fixture({
    loadReactions: async (_kind, ids) => Object.fromEntries(ids.map((id) => [id, []])),
    reactToContent: () => mutation.promise,
  });
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(f.Probe, { ids: ['old'] }));
  });
  t.after(() => act(async () => renderer.unmount()));
  let action;
  await act(async () => {
    action = f.get().react('old', '👍', false);
  });
  await act(async () => renderer.update(React.createElement(f.Probe, { ids: ['new'] })));
  await act(async () => {
    mutation.resolve();
    await action;
  });
  assert.deepEqual(Object.keys(f.get().reactions), ['new']);
});
