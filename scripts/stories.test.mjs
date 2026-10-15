import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createDatabase } from './db-fixture.mjs';
import { loadSource } from './react-fixture.mjs';
const read = (n) => readFileSync(new URL('../supabase/' + n, import.meta.url), 'utf8');
test('Stories restrict publishing and reading to members, protect ownership, and expire on server time', async (t) => {
  const db = await createDatabase(read('setup.sql'));
  t.after(() => db.close());
  await db.exec(read('migrations/20261014162132_circle_stories.sql'));
  const a = 'aaaaaaaa-0000-4000-8000-000000000001',
    b = 'bbbbbbbb-0000-4000-8000-000000000002',
    c = 'cccccccc-0000-4000-8000-000000000003';
  await db.query(
    "insert into auth.users(id,email) values($1,'a@test.local'),($2,'b@test.local'),($3,'c@test.local')",
    [a, b, c],
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
      "insert into circles(owner_id,name,interest,is_private) values($1,'Story circle','Art',true) returning id",
      [a],
    )
  ).rows[0].id;
  await db.exec('reset role');
  await db.query(
    "insert into circle_memberships(circle_id,user_id,status) values($1,$2,'member')",
    [circle, b],
  );
  const id = 'dddddddd-0000-4000-8000-000000000004',
    path = `${a}/${circle}/${id}.jpg`;
  await actor(a);
  await db.query("insert into storage.objects(bucket_id,name) values('story-media',$1)", [path]);
  await db.query(
    "insert into circle_stories(id,circle_id,author_id,kind,storage_path) values($1,$2,$3,'image',$4)",
    [id, circle, a, path],
  );
  const count = async () =>
    Number((await db.query('select count(*) as n from circle_stories')).rows[0].n);
  assert.equal(await count(), 1);
  await assert.rejects(
    db.query(
      "insert into circle_stories(circle_id,author_id,kind,storage_path,expires_at) values($1,$2,'image','bad',now()+interval '7 days')",
      [circle, a],
    ),
    (e) => e.code === '42501',
  );
  await assert.rejects(
    db.query("update circle_stories set caption='changed' where id=$1", [id]),
    (e) => e.code === '42501',
  );
  await actor(b);
  assert.equal(await count(), 1);
  assert.equal(
    (await db.query("select * from storage.objects where bucket_id='story-media'")).rows.length,
    1,
  );
  await db.query('delete from circle_stories where id=$1', [id]);
  assert.equal(await count(), 1);
  await assert.rejects(
    db.query(
      "insert into circle_stories(circle_id,author_id,kind,storage_path) values($1,$2,'image','bad')",
      [circle, a],
    ),
  );
  await actor(c);
  assert.equal(await count(), 0);
  assert.equal(
    (await db.query("select * from storage.objects where bucket_id='story-media'")).rows.length,
    0,
  );
  await assert.rejects(
    db.query(
      "insert into circle_stories(circle_id,author_id,kind,storage_path) values($1,$2,'image','bad')",
      [circle, c],
    ),
  );
  await assert.rejects(
    db.query("insert into storage.objects(bucket_id,name) values('story-media',$1)", [
      `${c}/${circle}/bad.jpg`,
    ]),
    (e) => e.code === '42501',
  );
  await actor(b);
  await db.query('insert into blocks(blocker_id,blocked_id) values($1,$2)', [b, a]);
  assert.equal(await count(), 0);
  await db.query('delete from blocks where blocker_id=$1', [b]);
  assert.equal(await count(), 1);
  await db.query('delete from circle_memberships where circle_id=$1 and user_id=$2', [circle, b]);
  assert.equal(await count(), 0);
  await db.exec('reset role');
  await db.query(
    "update circle_stories set created_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' where id=$1",
    [id],
  );
  await actor(a);
  assert.equal(await count(), 0);
  await db.exec('reset role');
  await db.query(
    "update circle_stories set created_at=now(),expires_at=now()+interval '24 hours' where id=$1",
    [id],
  );
  await actor(a);
  await db.query('delete from circle_stories where id=$1', [id]);
  assert.equal(await count(), 0);
  await assert.rejects(db.query('select * from story_media_cleanup'), (e) => e.code === '42501');
  await assert.rejects(db.query('select queue_expired_story_media()'), (e) => e.code === '42501');
  await db.exec('reset role');
  assert.equal((await db.query('select * from story_media_cleanup')).rows.length, 1);
  await db.query('select queue_expired_story_media()');
  assert.equal((await db.query('select * from story_media_cleanup')).rows.length, 1);
});
test('Story media validation rejects oversized, unsupported and overlong media; expiry excludes invalid dates', () => {
  const { validateStoryMedia, activeStories } = loadSource('src/lib/storyRules.ts');
  assert.doesNotThrow(() =>
    validateStoryMedia({
      uri: 'file:a',
      kind: 'video',
      mimeType: 'video/mp4',
      size: 1024,
      duration: 60,
    }),
  );
  for (const media of [
    { kind: 'video', mimeType: 'video/mp4', size: 1024, duration: 61 },
    { kind: 'video', mimeType: 'video/mp4', size: 1024 },
    { kind: 'image', mimeType: 'image/svg+xml', size: 1024 },
    { kind: 'image', mimeType: 'image/jpeg', size: 11 * 1024 * 1024 },
  ])
    assert.throws(() => validateStoryMedia(media));
  assert.equal(
    activeStories(
      [
        { createdAt: new Date(0).toISOString(), expiresAt: new Date(101).toISOString() },
        { createdAt: new Date(0).toISOString(), expiresAt: new Date(100).toISOString() },
        { createdAt: new Date(0).toISOString(), expiresAt: 'bad' },
      ],
      100,
    ).length,
    1,
  );
});

test('Stories stop at the earlier expiry or 24-hour deadline, including viewed stories', () => {
  const { activeStories, STORY_TTL_MS } = loadSource('src/lib/storyRules.ts');
  const story = {
    createdAt: new Date(0).toISOString(),
    expiresAt: new Date(STORY_TTL_MS * 2).toISOString(),
    seen: true,
  };
  assert.equal(activeStories([story], STORY_TTL_MS - 1).length, 1);
  assert.equal(activeStories([story], STORY_TTL_MS).length, 0);
  assert.equal(
    activeStories([{ ...story, expiresAt: new Date(1000).toISOString() }], 1000).length,
    0,
  );
  assert.equal(activeStories([{ ...story, createdAt: 'invalid' }], 1000).length, 0);
  assert.equal(
    activeStories([{ ...story, createdAt: new Date(2000).toISOString() }], 1000).length,
    0,
  );
});
