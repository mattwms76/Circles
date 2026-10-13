import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createDatabase } from './db-fixture.mjs';
const read = (file) => readFileSync(new URL('../supabase/' + file, import.meta.url), 'utf8');
test('Threaded comments enforce access, parent integrity, reactions and deletion across all experience migrations', async (t) => {
  const db = await createDatabase(read('setup.sql'));
  t.after(() => db.close());
  for (const name of [
    '20261012145107_community_experience',
    '20261012155424_content_deletion_window',
    '20261012163503_experience_enhancements',
    '20261012164050_experience_policy_consolidation',
    '20261013063428_replies_audit_hardening',
  ])
    await db.exec(
      read('migrations/' + name + '.sql').replace(
        /-- runtime-schedule:start[\s\S]*?-- runtime-schedule:end/g,
        '',
      ),
    );
  const a = 'aaaaaaaa-0000-4000-8000-000000000001',
    b = 'bbbbbbbb-0000-4000-8000-000000000002',
    c = 'cccccccc-0000-4000-8000-000000000003';
  const rows = async (q, p = []) => (await db.query(q, p)).rows;
  const scalar = async (q, p = []) => Object.values((await rows(q, p))[0])[0];
  const as = async (id) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, role: 'authenticated' }),
    ]);
    await db.exec('set role authenticated');
  };
  await db.query(
    "insert into auth.users(id,email) values($1,'a@test.local'),($2,'b@test.local'),($3,'c@test.local')",
    [a, b, c],
  );
  await as(a);
  const circle = await scalar(
    "insert into public.circles(owner_id,name,interest,is_private) values($1,'Private replies','Art',true) returning id",
    [a],
  );
  const p = await scalar(
    "insert into public.posts(circle_id,author_id,body) values($1,$2,'First post') returning id",
    [circle, a],
  );
  const other = await scalar(
    "insert into public.posts(circle_id,author_id,body) values($1,$2,'Other post') returning id",
    [circle, a],
  );
  await as(b);
  await db.query('select public.request_circle_membership($1)', [circle]);
  await as(a);
  await db.query(
    "update public.circle_memberships set status='member' where circle_id=$1 and user_id=$2",
    [circle, b],
  );
  await as(b);
  const parent = await scalar(
    "insert into public.post_comments(post_id,author_id,body) values($1,$2,'Parent') returning id",
    [p, b],
  );
  await t.test(
    'Outsiders cannot read or reply; a member cannot forge an author or cross post boundaries',
    async () => {
      await as(c);
      assert.equal((await rows('select * from public.post_comments')).length, 0);
      await assert.rejects(
        db.query(
          "insert into public.post_comments(post_id,author_id,body,reply_to_id) values($1,$2,'Hidden',$3)",
          [p, c, parent],
        ),
        (e) => e.code === '42501',
      );
      await as(b);
      await assert.rejects(
        db.query(
          "insert into public.post_comments(post_id,author_id,body,reply_to_id) values($1,$2,'Wrong post',$3)",
          [other, b, parent],
        ),
        (e) => e.code === '42501',
      );
      await assert.rejects(
        db.query(
          "insert into public.post_comments(post_id,author_id,body) values($1,$2,'Forged')",
          [p, a],
        ),
        (e) => e.code === '42501',
      );
      await assert.rejects(
        db.query(
          "insert into public.post_comments(post_id,author_id,body) values($1,$2,repeat('x',2001))",
          [p, b],
        ),
        (e) => e.code === '23514',
      );
      await assert.rejects(
        db.query("insert into public.post_comments(post_id,author_id,body) values($1,$2,'   ')", [
          p,
          b,
        ]),
        (e) => e.code === '23514',
      );
      await assert.rejects(
        db.query('insert into public.post_comments(post_id,author_id,body) values($1,$2,$3)', [
          p,
          b,
          '\n\t',
        ]),
        (e) => e.code === '23514',
      );
    },
  );
  await t.test(
    'Deleting a parent preserves children, removes their reference, and cascades reactions and notifications',
    async () => {
      await as(a);
      const child = await scalar(
        "insert into public.post_comments(post_id,author_id,body,reply_to_id) values($1,$2,'Nested reply',$3) returning id",
        [p, a, parent],
      );
      await as(b);
      assert.equal(
        await scalar("select count(*) from public.notifications where dedupe_key='reply:'||$1", [
          child,
        ]),
        1,
        'The parent comment author must receive a reply notification',
      );
      await as(a);
      await db.query("insert into public.comment_reactions values($1,$2,'👍')", [parent, a]);
      await as(c);
      assert.equal((await rows('select * from public.comment_reactions')).length, 0);
      await assert.rejects(
        db.query("insert into public.comment_reactions values($1,$2,'👍')", [parent, c]),
        (e) => e.code === '42501',
      );
      await as(a);
      assert.equal(
        (await rows('delete from public.post_comments where id=$1 returning id', [parent])).length,
        0,
      );
      await as(b);
      await db.query('delete from public.post_comments where id=$1', [parent]);
      assert.equal(
        await scalar('select reply_to_id from public.post_comments where id=$1', [child]),
        null,
      );
      assert.equal((await rows('select * from public.comment_reactions')).length, 0);
      await as(a);
      assert.equal(
        await scalar("select count(*) from public.notifications where dedupe_key='reply:'||$1", [
          parent,
        ]),
        0,
      );
      await db.query('delete from public.post_comments where id=$1', [child]);
      await as(b);
      assert.equal(
        await scalar("select count(*) from public.notifications where dedupe_key='reply:'||$1", [
          child,
        ]),
        0,
        'Deleting the reply must also clean its comment-recipient notification',
      );
    },
  );
  await t.test(
    'Latest schema still enforces the 15-minute window and revokes departed members access',
    async () => {
      await as(b);
      const old = await scalar(
        "insert into public.post_comments(post_id,author_id,body) values($1,$2,'Expired') returning id",
        [p, b],
      );
      await db.exec('reset role');
      await db.query(
        "update public.post_comments set created_at=clock_timestamp()-interval '15 minutes' where id=$1",
        [old],
      );
      await as(b);
      assert.equal(
        (await rows('delete from public.post_comments where id=$1 returning id', [old])).length,
        0,
      );
      await as(b);
      await db.query('select public.leave_circle($1)', [circle]);
      await as(b);
      assert.equal((await rows('select * from public.post_comments')).length, 0);
    },
  );
});
