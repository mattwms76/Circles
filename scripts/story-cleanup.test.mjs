import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadSource } from './react-fixture.mjs';
import { createDatabase } from './db-fixture.mjs';
const { handleStoryCleanup } = loadSource('supabase/functions/_shared/story-cleanup.ts');

function fixture({ authorized = true, storageFails = false, clearFails = false } = {}) {
  const calls = [],
    queue = ['owner/circle/expired.jpg'];
  const admin = {
    rpc: async (name) => {
      calls.push(name);
      return { data: name === 'authorize_story_cleanup' ? authorized : null, error: null };
    },
    from: (table) => {
      assert.equal(table, 'story_media_cleanup');
      return {
        select: () => ({
          order: () => ({
            limit: async (limit) => {
              assert.equal(limit, 100);
              return { data: queue.map((storage_path) => ({ storage_path })), error: null };
            },
          }),
        }),
        delete: () => ({
          in: async (_column, paths) => {
            calls.push('clear');
            if (clearFails) return { error: new Error('database unavailable') };
            for (const path of paths) queue.splice(queue.indexOf(path), 1);
            return { error: null };
          },
        }),
      };
    },
    storage: {
      from: (bucket) => {
        assert.equal(bucket, 'story-media');
        return {
          remove: async () => {
            calls.push('remove');
            return { error: storageFails ? new Error('storage unavailable') : null };
          },
        };
      },
    },
  };
  return { calls, queue, admin };
}
const request = (secret = 'test-secret', method = 'POST') =>
  new Request('https://example.test/cleanup', {
    method,
    headers: secret ? { 'x-cleanup-secret': secret } : {},
  });
test('Retention authenticates before queue access and cannot dispatch notifications', async () => {
  for (const req of [request('', 'POST'), request('x'.repeat(201)), request('test', 'GET')]) {
    const f = fixture();
    assert.ok([401, 405].includes((await handleStoryCleanup(req, f.admin)).status));
    assert.equal(f.calls.length, 0);
  }
  const denied = fixture({ authorized: false });
  assert.equal((await handleStoryCleanup(request(), denied.admin)).status, 401);
  assert.deepEqual(denied.calls, ['authorize_story_cleanup']);
  const f = fixture();
  const result = await handleStoryCleanup(request(), f.admin);
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { removed: 1, more: false });
  assert.deepEqual(f.calls, [
    'authorize_story_cleanup',
    'queue_expired_story_media',
    'remove',
    'clear',
  ]);
  assert.equal(f.queue.length, 0);
  assert.deepEqual(await (await handleStoryCleanup(request(), f.admin)).json(), {
    removed: 0,
    more: false,
  });
});
test('Failed storage deletion or queue acknowledgement leaves work retryable', async () => {
  for (const failure of [{ storageFails: true }, { clearFails: true }]) {
    const f = fixture(failure);
    assert.equal((await handleStoryCleanup(request(), f.admin)).status, 500);
    assert.equal(f.queue.length, 1);
    if (failure.storageFails) assert.equal(f.calls.includes('clear'), false);
  }
});
test('Cleanup authentication uses a separate server-only secret without activating push', async (t) => {
  const read = (path) => readFileSync(new URL('../supabase/' + path, import.meta.url), 'utf8');
  const strip = (s) => s.replace(/-- runtime-schedule:start[\s\S]*?-- runtime-schedule:end/g, '');
  const db = await createDatabase(read('setup.sql'));
  t.after(() => db.close());
  await db.exec(strip(read('migrations/20261012145107_community_experience.sql')));
  const migration = strip(read('migrations/20261015105642_independent_story_cleanup.sql'));
  await db.exec(migration);
  const secret = (
    await db.query("select value from private.runtime_settings where key='story_cleanup_secret'")
  ).rows[0].value;
  await db.exec(migration);
  assert.equal(
    (await db.query("select value from private.runtime_settings where key='story_cleanup_secret'"))
      .rows[0].value,
    secret,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int as n from private.runtime_settings where key in ('dispatch_url','story_cleanup_url')",
      )
    ).rows[0].n,
    0,
  );
  for (const role of ['anon', 'authenticated']) {
    await db.exec('set role ' + role);
    await assert.rejects(
      db.query('select public.authorize_story_cleanup($1)', [secret]),
      (e) => e.code === '42501',
    );
    await assert.rejects(
      db.query('select value from private.runtime_settings'),
      (e) => e.code === '42501',
    );
    await db.exec('reset role');
  }
  await db.exec('set role service_role');
  assert.equal(
    (await db.query('select public.authorize_story_cleanup($1) as ok', [secret])).rows[0].ok,
    true,
  );
  assert.equal(
    (await db.query('select public.authorize_notification_dispatch($1) as ok', [secret])).rows[0]
      .ok,
    false,
  );
});

test('Community retention clears queued paths only after successful storage deletion', async () => {
  const { cleanupCommunityMedia } = loadSource('supabase/functions/_shared/community-cleanup.ts');
  for (const storageFails of [true, false]) {
    const calls = [];
    const admin = {
      rpc: async (name) => {
        calls.push(name);
        return { error: null };
      },
      from: (table) => {
        assert.equal(table, 'community_media_cleanup');
        return {
          select: () => ({
            order: () => ({
              limit: async () => ({ data: [{ storage_path: 'owner/photo.jpg' }], error: null }),
            }),
          }),
          delete: () => ({
            in: async (column, paths) => {
              calls.push('clear');
              assert.equal(column, 'storage_path');
              assert.deepEqual(paths, ['owner/photo.jpg']);
              return { error: null };
            },
          }),
        };
      },
      storage: {
        from: (bucket) => {
          assert.equal(bucket, 'community-media');
          return {
            remove: async () => {
              calls.push('remove');
              return { error: storageFails ? Error('Offline') : null };
            },
          };
        },
      },
    };
    if (storageFails) {
      await assert.rejects(cleanupCommunityMedia(admin));
      assert.equal(calls.includes('clear'), false);
    } else {
      assert.deepEqual(JSON.parse(JSON.stringify(await cleanupCommunityMedia(admin))), {
        removed: 1,
        more: false,
      });
      assert.deepEqual(calls, ['queue_abandoned_community_media', 'remove', 'clear']);
    }
  }
});
