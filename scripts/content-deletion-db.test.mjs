import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createDatabase } from './db-fixture.mjs';
const sql = file => readFileSync(new URL(`../supabase/${file}`, import.meta.url), 'utf8');
const migration = sql('migrations/20261012155424_content_deletion_window.sql');
const alice = 'aaaaaaaa-0000-4000-8000-000000000001', bob = 'bbbbbbbb-0000-4000-8000-000000000002', outsider = 'cccccccc-0000-4000-8000-000000000003';

test('15-minute content deletion: real PostgreSQL permissions', async t => {
  const db = await createDatabase(sql('setup.sql'));
  t.after(() => db.close());
  await db.exec(sql('migrations/20261012145107_community_experience.sql').replace(/-- runtime-schedule:start[\s\S]*?-- runtime-schedule:end/g, ''));
  await db.exec(migration);
  await db.exec(migration);
  const rows = async (query, args=[]) => (await db.query(query,args)).rows;
  const scalar = async (query,args=[]) => Object.values((await rows(query,args))[0])[0];
  const as = async (id, role='authenticated') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({sub:id,role})]);
    await db.exec(`set role ${role}`);
  };
  const denied = (query,args=[]) => assert.rejects(db.query(query,args), error => error.code === '42501');
  await db.query("insert into auth.users(id,email) values($1,'alice@test.local'),($2,'bob@test.local'),($3,'other@test.local')",[alice,bob,outsider]);
  await as(alice);
  const circle = await scalar("insert into public.circles(owner_id,name,interest) values($1,'Deletion tests','Testing') returning id",[alice]);
  const post = await scalar("insert into public.posts(circle_id,author_id,body) values($1,$2,'A post') returning id",[circle,alice]);
  await db.query('insert into public.follows(follower_id,followee_id) values($1,$2)',[alice,bob]);
  await as(bob);
  await db.query('select public.request_circle_membership($1)',[circle]);
  await db.query('insert into public.follows(follower_id,followee_id) values($1,$2)',[bob,alice]);

  for (const [table, ownerColumn, prefix] of [['direct_messages','sender_id','message:'],['post_comments','author_id','reply:']]) {
    const create = async () => {
      await as(bob);
      return table === 'direct_messages'
        ? scalar('select public.send_direct_message($1,$2)',[alice,'Temporary message'])
        : scalar('insert into public.post_comments(post_id,author_id,body) values($1,$2,$3) returning id',[post,bob,'Temporary reply']);
    };
    await t.test(`${table}: only the author can delete, and recipients lose the item and notification`, async () => {
      const id = await create();
      await as(alice);
      assert.equal(Number(await scalar('select count(*) from public.notifications where dedupe_key=$1',[prefix+id])),1);
      assert.equal((await rows(`delete from public.${table} where id=$1 returning id`,[id])).length,0);
      await as(outsider);
      assert.equal((await rows(`delete from public.${table} where id=$1 returning id`,[id])).length,0);
      await as(null,'anon');
      assert.equal((await rows(`delete from public.${table} where id=$1 returning id`,[id])).length,0);
      await as(bob);
      assert.equal((await rows(`delete from public.${table} where id=$1 returning id`,[id])).length,1);
      await as(alice);
      assert.equal(Number(await scalar(`select count(*) from public.${table} where id=$1`,[id])),0);
      assert.equal(Number(await scalar('select count(*) from public.notifications where dedupe_key=$1',[prefix+id])),0);
    });
    await t.test(`${table}: deletion expires at 15 minutes and timestamps cannot be rewritten`, async () => {
      const id = await create();
      await db.exec('reset role');
      await db.query(`update public.${table} set created_at=clock_timestamp()-interval '14 minutes 59 seconds' where id=$1`,[id]);
      await as(bob);
      assert.equal((await rows(`delete from public.${table} where id=$1 returning id`,[id])).length,1);
      const expired = await create();
      await db.exec('reset role');
      await db.query(`update public.${table} set created_at=clock_timestamp()-interval '15 minutes' where id=$1`,[expired]);
      await as(bob);
      assert.equal((await rows(`delete from public.${table} where id=$1 returning id`,[expired])).length,0);
      if (table === 'direct_messages') await denied(`update public.${table} set created_at=clock_timestamp() where id=$1`,[expired]);
      else assert.equal((await rows(`update public.${table} set created_at=clock_timestamp() where id=$1 returning id`,[expired])).length,0);
      assert.equal((await rows(`delete from public.${table} where id=$1 returning id`,[expired])).length,0);
      await db.exec('reset role');
      assert.equal((await rows(`delete from public.${table} where id=$1 returning id`,[expired])).length,1,'Trusted moderation can still remove old content');
    });
    await t.test(`${table}: clients cannot choose creation timestamps or forge authorship`, async () => {
      await as(bob);
      const targetColumn = table === 'direct_messages' ? 'recipient_id' : 'post_id';
      const target = table === 'direct_messages' ? alice : post;
      await denied(`insert into public.${table}(${ownerColumn},${targetColumn},body,created_at) values($1,$2,'Future date',clock_timestamp()+interval '1 day')`,[bob,target]);
      await denied(`insert into public.${table}(${ownerColumn},${targetColumn},body) values($1,$2,'Wrong author')`,[outsider,target]);
    });
  }
});
