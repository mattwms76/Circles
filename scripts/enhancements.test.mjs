import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { loadSource } from './react-fixture.mjs';
import { createDatabase } from './db-fixture.mjs';
const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('Content links preserve private-circle intent and reject unrelated or malformed URLs', () => {
  const { contentLink, parseContentLink } = loadSource('src/lib/contentLinks.ts');
  assert.deepEqual(
    JSON.parse(JSON.stringify(parseContentLink(contentLink('post', 'post-123', 'circle-123')))),
    { kind: 'post', id: 'post-123', circleId: 'circle-123' },
  );
  for (const url of [
    'https://post/abc',
    'circles://auth/callback',
    'circles://post/../other',
    'circles://post/%ZZ',
    'circles://post/abc?circle=bad%2Fpath',
  ])
    assert.equal(parseContentLink(url), null);
});
test('Post edits enforce ownership before writing and preserve media-only posts', async () => {
  let updates = 0;
  const chain = {
    eq() {
      return this;
    },
    select() {
      return this;
    },
    single: async () => ({ error: null }),
  };
  const api = loadSource('src/lib/postActions.ts', {
    '@react-native-async-storage/async-storage': {},
    './supabase': {
      supabase: {
        from: () => ({
          update: () => {
            updates++;
            return chain;
          },
        }),
      },
    },
  });
  const post = { id: 'p', author: { id: 'a' }, body: 'hello' };
  await assert.rejects(api.updateOwnPost(post, 'b', 'Changed'), /own posts/);
  await assert.rejects(api.updateOwnPost(post, 'a', '   '), /Write a post/);
  await api.updateOwnPost({ ...post, media: { kind: 'video' } }, 'a', '');
  await api.updateOwnPost(post, 'a', null);
  assert.equal(updates, 2);
});
test('Resumable transfers reuse previous uploads; cancellation preserves the session and ignores delayed start', async () => {
  const files = new Map();
  let instance;
  class Upload {
    constructor(file, options) {
      this.options = options;
      instance = this;
    }
    async findPreviousUploads() {
      return [{ uploadUrl: 'https://storage/upload/previous' }];
    }
    resumeFromPreviousUpload(p) {
      this.previous = p;
    }
    start() {
      this.started = true;
    }
    async abort(terminate) {
      this.terminate = terminate;
    }
  }
  const storage = {
    getItem: async (key) => files.get(key) ?? null,
    setItem: async (k, v) => files.set(k, v),
    removeItem: async (k) => files.delete(k),
    getAllKeys: async () => [...files.keys()],
    multiGet: async (keys) => keys.map((k) => [k, files.get(k)]),
  };
  const old = process.env.EXPO_PUBLIC_SUPABASE_URL;
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  try {
    const api = loadSource('src/lib/resumableUpload.ts', {
      '@react-native-async-storage/async-storage': storage,
      'tus-js-client': { Upload },
      './supabase': {
        requireSupabase: () => ({
          auth: {
            getSession: async () => ({
              data: { session: { user: { id: 'a' }, access_token: 'test' } },
              error: null,
            }),
          },
        }),
      },
    });
    const abort = new AbortController();
    const promise = api.resumableUpload(
      'post-media',
      'a/p/movie.mp4',
      'file:///movie.mp4',
      'video/mp4',
      8000000,
      () => {},
      abort.signal,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(instance.started, true);
    assert.equal(instance.previous.uploadUrl, 'https://storage/upload/previous');
    assert.equal(instance.options.chunkSize, 6 * 1024 * 1024);
    abort.abort();
    await assert.rejects(promise, /draft is saved/);
    assert.equal(instance.terminate, false);
    const next = api.resumableUpload(
      'post-media',
      'a/p/movie.mp4',
      'file:///movie.mp4',
      'video/mp4',
      8000000,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    instance.options.onSuccess();
    await next;
  } finally {
    if (old === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    else process.env.EXPO_PUBLIC_SUPABASE_URL = old;
  }
});
test('Bookmarks isolate accounts and reject inaccessible private posts; authors alone can edit/remove', async (t) => {
  const db = await createDatabase(read('supabase/setup.sql'));
  t.after(() => db.close());
  await db.exec(read('supabase/migrations/20261014130512_post_bookmarks.sql'));
  const a = 'aaaaaaaa-0000-4000-8000-000000000001',
    b = 'bbbbbbbb-0000-4000-8000-000000000002';
  await db.query(
    "insert into auth.users(id,email) values($1,'a@example.test'),($2,'b@example.test')",
    [a, b],
  );
  const actor = async (id) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, role: 'authenticated' }),
    ]);
    await db.exec('set role authenticated');
  };
  await actor(a);
  const circle = (
    await db.query(
      "insert into circles(owner_id,name,interest,is_private) values($1,'Private test','Art',true) returning id",
      [a],
    )
  ).rows[0].id;
  const post = (
    await db.query(
      "insert into posts(author_id,circle_id,body) values($1,$2,'Original') returning id",
      [a, circle],
    )
  ).rows[0].id;
  await db.query('insert into post_bookmarks(user_id,post_id) values($1,$2)', [a, post]);
  await actor(b);
  assert.equal((await db.query('select * from post_bookmarks')).rows.length, 0);
  await assert.rejects(
    db.query('insert into post_bookmarks(user_id,post_id) values($1,$2)', [b, post]),
  );
  assert.equal(
    (await db.query("update posts set body='Forged' where id=$1 returning id", [post])).rows.length,
    0,
  );
  assert.equal((await db.query('delete from post_bookmarks returning post_id')).rows.length, 0);
  await actor(a);
  assert.equal(
    (await db.query("update posts set body='Edited' where id=$1 returning body", [post])).rows[0]
      .body,
    'Edited',
  );
  await db.query("update posts set visibility='removed' where id=$1", [post]);
  await assert.rejects(
    db.query('insert into post_bookmarks(user_id,post_id) values($1,$2)', [b, post]),
  );
});
test('Shared light and dark tokens maintain readable selected controls', () => {
  const palettes = JSON.parse(read('src/design-tokens.json'));
  const luminance = (hex) => {
    const rgb = hex
      .slice(1)
      .match(/../g)
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const p of Object.values(palettes))
    for (const [fg, bg] of [
      [p.ink, p.paper],
      [p.muted, p.surface],
      [p.onPrimary, p.primary],
    ]) {
      const a = luminance(fg),
        b = luminance(bg);
      assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5);
    }
});
