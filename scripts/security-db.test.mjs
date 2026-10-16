import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createDatabase } from './db-fixture.mjs';
const read = (p) => readFileSync(new URL('../supabase/' + p, import.meta.url), 'utf8');
const files = read('bootstrap.list').trim().split(/\r?\n/);
for (const mode of ['fresh', 'upgrade'])
  test(`${mode}: security migration closes authorization, publication, attachment, quota and purchase regressions`, async (t) => {
    const db = await createDatabase(
      (mode === 'fresh' ? files : files.slice(0, -1)).map(read).join('\n'),
    );
    t.after(() => db.close());
    if (mode === 'upgrade') await db.exec(read(files.at(-1)));
    const host = randomUUID(),
      member = randomUUID(),
      outsider = randomUUID();
    const rows = async (q, p = []) => (await db.query(q, p)).rows;
    const scalar = async (q, p = []) => Object.values((await rows(q, p))[0])[0];
    const as = async (id, role = 'authenticated') => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims',$1,false)", [
        JSON.stringify({ sub: id, role }),
      ]);
      await db.exec('set role ' + role);
    };
    await db.query(
      "insert into auth.users(id,email) values($1,'security-host@test.local'),($2,'security-member@test.local'),($3,'security-outsider@test.local')",
      [host, member, outsider],
    );
    await as(host);
    const circle = await scalar(
      "insert into public.circles(owner_id,name,interest) values($1,'Secure community','Film') returning id",
      [host],
    );
    await t.test(
      'Direct joins cannot select elevated roles; the owner can still assign and revoke roles',
      async () => {
        await as(member);
        for (const role of ['owner', 'moderator'])
          await assert.rejects(
            db.query(
              "insert into public.circle_memberships(circle_id,user_id,status,role) values($1,$2,'member',$3)",
              [circle, member, role],
            ),
            (e) => e.code === '42501',
          );
        await db.query(
          "insert into public.circle_memberships(circle_id,user_id,status) values($1,$2,'member')",
          [circle, member],
        );
        assert.equal(await scalar('select private.circle_host($1)', [circle]), false);
        await assert.rejects(
          db.query(
            "update public.circle_memberships set role='moderator' where circle_id=$1 and user_id=$2",
            [circle, member],
          ),
        );
        await as(host);
        await db.query("select public.set_circle_role($1,$2,'moderator')", [circle, member]);
        await as(member);
        assert.equal(await scalar('select private.circle_host($1)', [circle]), true);
        await as(host);
        await db.query("select public.set_circle_role($1,$2,'member')", [circle, member]);
      },
    );
    await t.test(
      'Grants deny destructive operations and forged staff metadata while preserving normal reports',
      async () => {
        await as(member);
        assert.equal(
          await scalar("select has_table_privilege('authenticated','public.posts','TRUNCATE')"),
          false,
        );
        assert.equal(
          await scalar("select has_table_privilege('anon','public.posts','TRUNCATE')"),
          false,
        );
        await assert.rejects(
          db.query(
            "insert into public.reports(reporter_id,target_type,target_id,reason,reviewed_by,resolution_note) values($1,'circle',$2,'A valid report',$3,'Forged')",
            [member, circle, host],
          ),
        );
        await db.query(
          "insert into public.reports(reporter_id,target_type,target_id,reason) values($1,'circle',$2,'A valid report')",
          [member, circle],
        );
        await db.exec('reset role');
        await db.exec('create table public.future_security_test(id integer)');
        for (const role of ['anon', 'authenticated'])
          assert.equal(
            await scalar(
              "select has_table_privilege($1,'public.future_security_test','SELECT,INSERT,UPDATE,DELETE,TRUNCATE')",
              [role],
            ),
            false,
          );
        await db.exec('drop table public.future_security_test');
        await db.exec(
          'create function public.future_security_function() returns integer language sql as $$select 1$$',
        );
        for (const role of ['anon', 'authenticated'])
          assert.equal(
            await scalar(
              "select has_function_privilege($1,'public.future_security_function()','EXECUTE')",
              [role],
            ),
            false,
          );
        await db.exec('drop function public.future_security_function()');
        await as(member);
        await assert.rejects(
          db.query("update public.profiles set bio=repeat('x',1001) where id=$1", [member]),
        );
      },
    );
    let post;
    await t.test(
      'Publication validates at commit; media-only drafts and atomic polls remain supported',
      async () => {
        await as(member);
        await assert.rejects(
          db.query("insert into public.posts(circle_id,author_id,body) values($1,$2,'')", [
            circle,
            member,
          ]),
        );
        await assert.rejects(
          db.query(
            "insert into public.posts(circle_id,author_id,body,post_type) values($1,$2,'Incomplete poll','poll')",
            [circle, member],
          ),
        );
        await assert.rejects(
          db.query(
            "insert into public.posts(circle_id,author_id,body,created_at) values($1,$2,'Future',now()+interval '100 years')",
            [circle, member],
          ),
        );
        post = await scalar(
          "insert into public.posts(circle_id,author_id,body,visibility,upload_pending) values($1,$2,'','removed',true) returning id",
          [circle, member],
        );
        await assert.rejects(
          db.query("update public.posts set visibility='published' where id=$1", [post]),
        );
        const path = `${member}/${post}/photo.jpg`;
        await db.query("insert into storage.objects(bucket_id,name) values('post-media',$1)", [
          path,
        ]);
        await db.query(
          "insert into public.post_media(post_id,owner_id,kind,storage_path,mime_type) values($1,$2,'image',$3,'image/jpeg')",
          [post, member, path],
        );
        await db.query("update public.posts set visibility='published' where id=$1", [post]);
        assert.equal(
          await scalar('select upload_pending from public.posts where id=$1', [post]),
          false,
        );
        assert.ok(
          await scalar(
            "select public.create_participation_post($1,'Which one?','poll','[\"One\",\"Two\"]',null,'secure-poll')",
            [circle],
          ),
        );
      },
    );
    await t.test(
      'Attached media stays protected after leaving; unattached own uploads can be discarded',
      async () => {
        await as(host);
        await db.query(
          'insert into public.circle_chat_settings(circle_id,enabled) values($1,true)',
          [circle],
        );
        await as(member);
        const path = `${member}/circle/${circle}/photo.jpg`;
        await db.query("insert into storage.objects(bucket_id,name) values('community-media',$1)", [
          path,
        ]);
        const message = await scalar(
          "insert into public.circle_chat_messages(circle_id,author_id,body,media_kind,media_path) values($1,$2,'','photo',$3) returning id",
          [circle, member, path],
        );
        await db.exec('reset role');
        await db.query(
          "update public.circle_chat_messages set created_at=now()-interval '1 hour' where id=$1",
          [message],
        );
        await as(member);
        assert.equal(
          (await rows('delete from storage.objects where name=$1 returning id', [path])).length,
          0,
        );
        await db.query('select public.leave_circle($1)', [circle]);
        assert.equal(
          (await rows('delete from storage.objects where name=$1 returning id', [path])).length,
          0,
        );
        await as(host);
        assert.equal(
          (await rows('select id from public.circle_chat_messages where id=$1', [message])).length,
          1,
        );
        await as(member);
        await db.query('select public.request_circle_membership($1)', [circle]);
        const draft = `${member}/circle/${circle}/unused.jpg`;
        await db.query("insert into storage.objects(bucket_id,name) values('community-media',$1)", [
          draft,
        ]);
        assert.equal(
          (await rows('delete from storage.objects where name=$1 returning id', [draft])).length,
          1,
        );
      },
    );
    await t.test(
      'Message limits cover direct writes and roll back rejected writes without changing legitimate access',
      async () => {
        await as(member);
        await db.query('insert into public.follows(follower_id,followee_id) values($1,$2)', [
          member,
          host,
        ]);
        await as(host);
        await db.query('insert into public.follows(follower_id,followee_id) values($1,$2)', [
          host,
          member,
        ]);
        await as(member);
        for (let i = 0; i < 20; i++)
          await db.query("select public.send_direct_message($1,'Allowed message')", [host]);
        await assert.rejects(
          db.query(
            "insert into public.direct_messages(sender_id,recipient_id,body) values($1,$2,'Over budget')",
            [member, host],
          ),
          /wait a minute/,
        );
        assert.equal(
          await scalar('select count(*)::int from public.direct_messages where sender_id=$1', [
            member,
          ]),
          20,
        );
        await as(outsider);
        assert.equal((await rows('select id from public.direct_messages')).length, 0);
      },
    );
    await t.test(
      'Storage quotas reject new uploads at the account limit while allowing deletion',
      async () => {
        await db.exec('reset role');
        await db.query(
          "insert into storage.objects(bucket_id,name,metadata) select 'avatars',$1||'/quota-'||n||'.jpg','{\"size\":1}'::jsonb from generate_series(1,500) n",
          [outsider],
        );
        await as(outsider);
        await assert.rejects(
          db.query("insert into storage.objects(bucket_id,name) values('avatars',$1)", [
            `${outsider}/over.jpg`,
          ]),
          /storage limit/,
        );
        await db.query("delete from storage.objects where bucket_id='avatars' and name=$1", [
          `${outsider}/quota-1.jpg`,
        ]);
        await db.query("insert into storage.objects(bucket_id,name) values('avatars',$1)", [
          `${outsider}/allowed.jpg`,
        ]);
      },
    );
    await t.test(
      'Purchase provenance rejects sandbox, blocks clients, deduplicates receipts and binds the owner',
      async () => {
        await as(member);
        await assert.rejects(
          db.query(
            "select public.credit_verified_purchase($1,'com.circles.coins.120','apple','receipt','production')",
            [member],
          ),
        );
        await as(null, 'service_role');
        await assert.rejects(
          db.query(
            "select public.credit_verified_purchase($1,'com.circles.coins.120','apple','receipt','sandbox')",
            [member],
          ),
        );
        const credit = await scalar(
          "select public.credit_verified_purchase($1,'com.circles.coins.120','apple','receipt','production')",
          [member],
        );
        assert.equal(credit, 120);
        assert.equal(
          await scalar(
            "select public.credit_verified_purchase($1,'com.circles.coins.120','apple','receipt','production')",
            [member],
          ),
          credit,
        );
        await assert.rejects(
          db.query(
            "select public.credit_verified_purchase($1,'com.circles.coins.120','apple','receipt','production')",
            [outsider],
          ),
        );
      },
    );
    await t.test(
      'Abandoned-upload cleanup leaves published and intentionally removed content intact',
      async () => {
        await db.exec('reset role');
        const draft = await scalar(
          "insert into public.posts(circle_id,author_id,body,visibility,upload_pending,created_at) values($1,$2,'','removed',true,now()-interval '8 days') returning id",
          [circle, host],
        );
        const removed = await scalar(
          "insert into public.posts(circle_id,author_id,body,visibility,created_at) values($1,$2,'Removed intentionally','removed',now()-interval '8 days') returning id",
          [circle, host],
        );
        for (const id of [draft, removed, post])
          await db.query(
            "insert into storage.objects(bucket_id,name,created_at) values('post-media',$1,now()-interval '8 days')",
            [`${host}/${id}/retention.jpg`],
          );
        await as(null, 'service_role');
        await db.query('select public.queue_abandoned_post_media()');
        assert.equal(await scalar('select count(*)::int from public.post_media_cleanup'), 1);
        await as(host);
        await assert.rejects(
          db.query("update public.posts set body='Late retry',visibility='published' where id=$1", [
            draft,
          ]),
          /expired/,
        );
        await assert.rejects(
          db.query("insert into storage.objects(bucket_id,name) values('post-media',$1)", [
            `${host}/${draft}/late.jpg`,
          ]),
          /expired/,
        );
      },
    );
    await t.test(
      'Device deregistration requires a matching device capability and survives an account switch',
      async () => {
        const token = 'ExpoPushToken[security_fixture]',
          key = randomUUID();
        await as(member);
        await db.query('select public.register_push_token($1,$2)', [token, key]);
        await assert.rejects(db.query('select public.register_push_token($1)', [token]));
        await as(outsider);
        await db.query('select public.unregister_push_device($1,$2)', [token, randomUUID()]);
        await db.exec('reset role');
        assert.equal(
          await scalar('select count(*)::int from public.device_push_tokens where token=$1', [
            token,
          ]),
          1,
        );
        await as(outsider);
        await db.query('select public.unregister_push_device($1,$2)', [token, key]);
        await db.exec('reset role');
        assert.equal(
          await scalar('select count(*)::int from public.device_push_tokens where token=$1', [
            token,
          ]),
          0,
        );
      },
    );
  });
