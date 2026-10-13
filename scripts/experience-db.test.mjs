import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createDatabase } from './db-fixture.mjs';
const read = (name) => readFileSync(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
test('Experience features preserve ownership and private content boundaries', async (t) => {
  const db = await createDatabase(read('setup.sql'));
  t.after(() => db.close());
  for (const name of [
    '20261012145107_community_experience.sql',
    '20261012155424_content_deletion_window.sql',
    '20261012163503_experience_enhancements.sql',
    '20261012164050_experience_policy_consolidation.sql',
  ])
    await db.exec(
      read(`migrations/${name}`).replace(
        /-- runtime-schedule:start[\s\S]*?-- runtime-schedule:end/g,
        '',
      ),
    );
  const a = 'aaaaaaaa-0000-4000-8000-000000000001',
    b = 'bbbbbbbb-0000-4000-8000-000000000002',
    c = 'cccccccc-0000-4000-8000-000000000003';
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const scalar = async (sql, args = []) => Object.values((await rows(sql, args))[0])[0];
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
  await db.query('insert into public.follows(follower_id,followee_id) values($1,$2),($1,$3)', [
    a,
    b,
    c,
  ]);
  await as(b);
  await db.query('insert into public.follows(follower_id,followee_id) values($1,$2)', [b, a]);
  await as(c);
  await db.query('insert into public.follows(follower_id,followee_id) values($1,$2)', [c, a]);
  await as(a);
  const m = await scalar("select public.send_message_reply($1,'hello',null)", [b]);
  await t.test(
    'Replies cannot cross conversations; reactions cannot read private messages',
    async () => {
      await assert.rejects(
        db.query("select public.send_message_reply($1,'leak',$2)", [c, m]),
        (e) => e.code === '42501',
      );
      await as(b);
      const reply = await scalar("select public.send_message_reply($1,'answer',$2)", [a, m]);
      assert.ok(reply);
      await db.query("insert into public.message_reactions values($1,$2,'👍')", [m, b]);
      await as(c);
      assert.equal((await rows('select * from public.message_reactions')).length, 0);
      await assert.rejects(
        db.query("insert into public.message_reactions values($1,$2,'👍')", [m, c]),
        (e) => e.code === '42501',
      );
      await as(a);
      await db.query('delete from public.direct_messages where id=$1', [m]);
      assert.equal(
        await scalar('select reply_to_id from public.direct_messages where id=$1', [reply]),
        null,
      );
    },
  );
  await t.test(
    'Muting suppresses future message activity and cannot change another account',
    async () => {
      await as(b);
      await db.query('insert into public.conversation_preferences values($1,$2,true)', [b, a]);
      const before = await scalar('select count(*) from public.notifications');
      await as(a);
      await db.query("select public.send_message_reply($1,'muted',null)", [b]);
      await assert.rejects(
        db.query('insert into public.conversation_preferences values($1,$2,true)', [b, c]),
        (e) => e.code === '42501',
      );
      await as(b);
      assert.equal(await scalar('select count(*) from public.notifications'), before);
    },
  );
  await as(a);
  const circle = await scalar(
    "insert into public.circles(owner_id,name,interest,is_private) values($1,'Gardening friends','Gardening',true) returning id",
    [a],
  );
  await as(b);
  await db.query('select public.request_circle_membership($1)', [circle]);
  await as(a);
  await db.query(
    "update public.circle_memberships set status='member' where circle_id=$1 and user_id=$2",
    [circle, b],
  );
  await t.test('Role management is owner-only; moderator can schedule an event', async () => {
    await as(b);
    await assert.rejects(
      db.query("select public.set_circle_role($1,$2,'moderator')", [circle, b]),
      (e) => e.code === '42501',
    );
    await as(a);
    await db.query("select public.set_circle_role($1,$2,'moderator')", [circle, b]);
    await as(b);
    await db.query(
      "insert into public.circle_events(circle_id,creator_id,title,starts_at) values($1,$2,'Seed swap',now()+interval '1 day')",
      [circle, b],
    );
    await as(c);
    assert.equal((await rows('select * from public.circle_events')).length, 0);
  });
  await t.test('Discovery privacy filter and private scheduled-room access', async () => {
    await as(a);
    assert.equal(
      (await rows("select * from public.discover_circles('Gardening friends','','public')")).length,
      0,
    );
    const room = await scalar(
      "insert into public.scheduled_live_rooms(host_id,circle_id,title,starts_at) values($1,$2,'Seed chat',now()+interval '10 minutes') returning id",
      [a, circle],
    );
    await as(c);
    assert.equal((await rows('select * from public.scheduled_live_rooms')).length, 0);
    await assert.rejects(
      db.query('insert into public.live_reminders values($1,$2)', [room, c]),
      (e) => e.code === '42501',
    );
    await as(b);
    await db.query('insert into public.live_reminders values($1,$2)', [room, b]);
    await assert.rejects(
      db.query("select public.manage_scheduled_room($1,'start')", [room]),
      (e) => e.code === '42501',
    );
    await as(a);
    const live = await scalar("select public.manage_scheduled_room($1,'start')", [room]);
    assert.equal(await scalar("select public.manage_scheduled_room($1,'start')", [room]), live);
    await as(b);
    assert.ok((await rows('select * from public.notifications where target_id=$1', [live])).length);
  });
  await t.test(
    'Reschedules and unsubscribes clear obsolete reminders and allow a fresh reminder',
    async () => {
      await as(a);
      const room = await scalar(
        "insert into public.scheduled_live_rooms(host_id,title,starts_at) values($1,'Upcoming chat',now()+interval '10 minutes') returning id",
        [a],
      );
      await as(b);
      await db.query('insert into public.live_reminders values($1,$2)', [room, b]);
      await db.exec('reset role');
      await db.query(
        'insert into public.notification_preferences(user_id,push_enabled) values($1,true) on conflict(user_id) do update set push_enabled=true',
        [b],
      );
      await db.query(
        "insert into public.device_push_tokens(user_id,token) values($1,'ExponentPushToken[experience-test]')",
        [b],
      );
      await db.exec(
        'select private.enqueue_live_reminders(); select private.enqueue_live_reminders();',
      );
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ role: 'service_role' }),
      ]);
      const claimed = await scalar('select private.claim_notification_deliveries()');
      assert.equal(
        claimed.length,
        1,
        'Upcoming room reminder must remain eligible for device delivery',
      );
      assert.equal(
        await scalar(
          "select count(*) from public.notifications where dedupe_key='live-reminder:'||$1",
          [room],
        ),
        1,
      );
      await as(a);
      await db.query(
        "update public.scheduled_live_rooms set starts_at=now()+interval '1 day' where id=$1",
        [room],
      );
      await db.exec('reset role');
      assert.equal(
        await scalar(
          "select count(*) from public.notifications where dedupe_key='live-reminder:'||$1",
          [room],
        ),
        0,
      );
      await as(a);
      await db.query(
        "update public.scheduled_live_rooms set starts_at=now()+interval '12 minutes' where id=$1",
        [room],
      );
      await db.exec('reset role; select private.enqueue_live_reminders();');
      assert.equal(
        await scalar(
          "select count(*) from public.notifications where dedupe_key='live-reminder:'||$1",
          [room],
        ),
        1,
      );
      await as(b);
      await db.query('delete from public.live_reminders where room_id=$1', [room]);
      await db.exec('reset role');
      assert.equal(
        await scalar(
          "select count(*) from public.notifications where dedupe_key='live-reminder:'||$1",
          [room],
        ),
        0,
      );
    },
  );
});
