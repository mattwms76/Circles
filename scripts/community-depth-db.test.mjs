import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createDatabase } from './db-fixture.mjs';
test('Community features enforce membership, ownership, retention and opt-in rules', async (t) => {
  const read = (p) => readFileSync(new URL('../supabase/' + p, import.meta.url), 'utf8');
  const db = await createDatabase(
    read('bootstrap.list').trim().split(/\r?\n/).map(read).join('\n'),
  );
  t.after(() => db.close());
  const a = 'aaaaaaaa-0000-4000-8000-000000000001',
    b = 'bbbbbbbb-0000-4000-8000-000000000002',
    c = 'cccccccc-0000-4000-8000-000000000003';
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const scalar = async (sql, args = []) => Object.values((await rows(sql, args))[0])[0];
  const as = async (id, role = 'authenticated') => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, role }),
    ]);
    await db.exec('set role ' + role);
  };
  await db.query(
    "insert into auth.users(id,email) values($1,'host@test.local'),($2,'member@test.local'),($3,'outsider@test.local')",
    [a, b, c],
  );
  await as(a);
  const circle = await scalar(
    "insert into public.circles(owner_id,name,interest,is_private) values($1,'Private planting','Gardening',true) returning id",
    [a],
  );
  await as(b);
  await db.query('select public.request_circle_membership($1)', [circle]);
  await as(a);
  await db.query(
    "update public.circle_memberships set status='member' where circle_id=$1 and user_id=$2",
    [circle, b],
  );
  let poll, question, topic, collection, comment, message, token;
  await t.test(
    'Topics, participation and polls reject invalid options and outsider votes',
    async () => {
      topic = await scalar(
        "insert into public.circle_topics(circle_id,name) values($1,'Growing tips') returning id",
        [circle],
      );
      poll = await scalar(
        "select public.create_participation_post($1,'Which season?','poll','[\"Spring\",\"Autumn\"]',$2,'poll-1')",
        [circle, topic],
      );
      question = await scalar(
        "select public.create_participation_post($1,'How do you grow?','question',null,$2,'question-1')",
        [circle, topic],
      );
      assert.equal(
        await scalar(
          "select public.create_participation_post($1,'How do you grow?','question',null,$2,'question-1')",
          [circle, topic],
        ),
        question,
      );
      await assert.rejects(
        db.query(
          "select public.create_participation_post($1,'Bad poll','poll','[\"same\",\" SAME \"]',null,null)",
          [circle],
        ),
      );
      await as(b);
      await db.query('insert into public.poll_votes values($1,$2,0)', [poll, b]);
      await assert.rejects(
        db.query('update public.poll_votes set option_index=5 where post_id=$1', [poll]),
      );
      await as(c);
      assert.equal((await rows('select * from public.post_polls')).length, 0);
      await assert.rejects(db.query('insert into public.poll_votes values($1,$2,0)', [poll, c]));
      await assert.rejects(
        db.query(
          "select public.create_participation_post($1,'Outside?','question',null,null,null)",
          [circle],
        ),
      );
    },
  );
  await t.test(
    'Feed snoozes and hidden posts happen before pagination and remain private',
    async () => {
      await as(b);
      assert.equal((await rows("select * from public.personal_feed('latest')")).length, 2);
      await db.query('insert into public.hidden_posts values($1,$2)', [b, poll]);
      assert.equal(
        (await rows("select * from public.personal_feed('latest',0,1)"))[0].id,
        question,
      );
      await db.query(
        "insert into public.feed_preferences(user_id,circle_id,snoozed_until) values($1,$2,now()+interval '7 days')",
        [b, circle],
      );
      assert.equal((await rows('select * from public.personal_feed()')).length, 0);
      await as(a);
      assert.equal((await rows('select * from public.feed_preferences')).length, 0);
      await assert.rejects(db.query('insert into public.hidden_posts values($1,$2)', [b, poll]));
    },
  );
  await t.test(
    'Collections stay in their circle; helpful answers require author or host',
    async () => {
      await as(b);
      collection = await scalar(
        "insert into public.circle_collections(circle_id,creator_id,name) values($1,$2,'Good resources') returning id",
        [circle, b],
      );
      await db.query('insert into public.collection_posts values($1,$2,$3)', [
        collection,
        question,
        b,
      ]);
      comment = await scalar(
        "insert into public.post_comments(post_id,author_id,body) values($1,$2,'Add compost') returning id",
        [question, b],
      );
      await assert.rejects(
        db.query('insert into public.helpful_answers values($1,$2,$3)', [question, comment, b]),
      );
      await as(a);
      await db.query('insert into public.helpful_answers values($1,$2,$3)', [question, comment, a]);
      await db.query(
        "insert into public.circle_recognition(circle_id,user_id,label,granted_by) values($1,$2,'Helpful gardener',$3)",
        [circle, b, a],
      );
      await as(c);
      assert.equal((await rows('select * from public.circle_collections')).length, 0);
      assert.equal((await rows('select * from public.circle_recognition')).length, 0);
      await as(b);
      assert.equal(
        (await rows('delete from public.circle_recognition where user_id=$1 returning *', [b]))
          .length,
        1,
      );
    },
  );
  await t.test(
    'Chat is opt-in, rate limited, server dated, private, and limited to fifteen-minute own deletion',
    async () => {
      await as(b);
      await assert.rejects(
        db.query(
          "insert into public.circle_chat_messages(circle_id,author_id,body) values($1,$2,'hello')",
          [circle, b],
        ),
      );
      await as(a);
      await db.query('insert into public.circle_chat_settings values($1,true,5)', [circle]);
      await as(b);
      message = await scalar(
        "insert into public.circle_chat_messages(circle_id,author_id,body,created_at) values($1,$2,'hello',now()-interval '1 year') returning id",
        [circle, b],
      );
      assert.ok(
        Date.now() -
          Date.parse(
            await scalar('select created_at from public.circle_chat_messages where id=$1', [
              message,
            ]),
          ) <
          10000,
      );
      await assert.rejects(
        db.query(
          "insert into public.circle_chat_messages(circle_id,author_id,body) values($1,$2,'too soon')",
          [circle, b],
        ),
      );
      await as(c);
      assert.equal((await rows('select * from public.circle_chat_messages')).length, 0);
      await db.exec('reset role');
      await db.query(
        "update public.circle_chat_messages set created_at=now()-interval '16 minutes' where id=$1",
        [message],
      );
      await as(b);
      assert.equal(
        (await rows('delete from public.circle_chat_messages where id=$1 returning id', [message]))
          .length,
        0,
      );
      await as(a);
      assert.equal(
        (await rows('delete from public.circle_chat_messages where id=$1 returning id', [message]))
          .length,
        1,
      );
    },
  );
  await t.test(
    'Invitation previews disclose only host-approved metadata and private joins remain pending',
    async () => {
      await as(a);
      token = await scalar(
        'insert into public.circle_invites(circle_id,created_by) values($1,$2) returning token',
        [circle, a],
      );
      await as(null, 'anon');
      const preview = await scalar('select public.invite_preview($1)', [token]);
      assert.equal(preview.name, 'A private circle');
      assert.ok(!('circleId' in preview));
      assert.equal(await scalar("select public.invite_preview('invalid')"), null);
      await as(c);
      const redeemed = await scalar('select public.redeem_circle_invite($1)', [token]);
      assert.equal(redeemed.status, 'pending');
      assert.equal((await rows('select * from public.posts')).length, 0);
      await as(a);
      await db.query('delete from public.circle_invites where token=$1', [token]);
      await as(c);
      await assert.rejects(db.query('select public.redeem_circle_invite($1)', [token]));
    },
  );
  await t.test(
    'Upload validation blocks fabricated media, invalid subtitle fields and excessive video length',
    async () => {
      await as(b);
      await assert.rejects(
        db.query(
          "insert into public.circle_chat_messages(circle_id,author_id,media_kind,media_path,duration_ms) values($1,$2,'voice',$3,60001)",
          [circle, b, `${b}/circle/${circle}/voice.m4a`],
        ),
      );
      await as(a);
      await assert.rejects(
        db.query(
          "insert into public.post_media(post_id,owner_id,kind,storage_path,mime_type,subtitles) values($1,$2,'video','missing.mp4','video/mp4','[{\"text\":\"missing timing\"}]')",
          [question, a],
        ),
      );
    },
  );
  await t.test(
    'Completed video metadata retries remain idempotent instead of failing the one-video limit',
    async () => {
      await as(a);
      const path = `${a}/${question}/retry-video.mp4`;
      await db.query("insert into storage.objects(bucket_id,name) values('post-media',$1)", [path]);
      await db.query(
        "insert into public.post_media(post_id,owner_id,kind,storage_path,mime_type) values($1,$2,'video',$3,'video/mp4')",
        [question, a, path],
      );
      await assert.rejects(
        db.query(
          "insert into public.post_media(post_id,owner_id,kind,storage_path,mime_type) values($1,$2,'video',$3,'video/mp4')",
          [question, a, path],
        ),
        (e) => e.code === '23505',
      );
      await assert.rejects(
        db.query(
          "insert into public.post_media(post_id,owner_id,kind,storage_path,mime_type) values($1,$2,'image',$3,'image/jpeg')",
          [question, a, `${a}/${question}/another.jpg`],
        ),
      );
    },
  );
  await t.test('Catch-up excludes outsiders; reminders are disabled unless opted in', async () => {
    await as(c);
    const outside = await scalar('select public.get_catchup()');
    assert.equal(outside.posts.length, 0);
    assert.equal(outside.unanswered.length, 0);
    assert.equal(outside.events.length, 0);
    await as(b);
    const inside = await scalar('select public.get_catchup()');
    assert.equal(inside.posts.length, 2);
    await db.exec('select public.mark_caught_up()');
    assert.ok(await scalar('select caught_up_at from public.catchup_checkpoints'));
    await db.exec('reset role');
    await db.exec('select private.enqueue_weekly_digests()');
    assert.equal(await scalar("select count(*) from public.notifications where kind='digests'"), 0);
  });
});
