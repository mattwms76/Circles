import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const setup = readFileSync(new URL('../supabase/setup.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261012135221_fix_core_flow_authorization.sql', import.meta.url), 'utf8');
const users = ['aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003'];
const [host, guest, outsider] = users;

// Execute real PostgreSQL policies/functions. Only Supabase-owned auth/storage
// primitives are supplied here; HTTP, Realtime, cron, and native SDKs need E2E tests.
async function createDatabase(source) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant all on storage.objects to authenticated, service_role;
    create function storage.foldername(text) returns text[] language sql as $$
      select (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'), 1)-1]
    $$;
  `);
  await db.exec(source
    .replace(/^create extension .*;\r?\n/gm, '')
    .replace(/do \$\$\s*declare existing_job (?:record|bigint);[\s\S]*?end;\s*\$\$;/, '')
    .replace(/^alter publication .*;\r?$/gm, ''));
  return db;
}

for (const mode of ['bootstrap', 'migration']) {
  test(`${mode}: six core-flow regressions`, async (t) => {
    // An optional pre-fix snapshot also exercises a historical installation.
    const source = mode === 'migration' && process.env.CIRCLES_TEST_BASELINE_SQL
      ? readFileSync(process.env.CIRCLES_TEST_BASELINE_SQL, 'utf8') : setup;
    const db = await createDatabase(source);
    t.after(() => db.close());
    if (mode === 'migration') {
      // Existing deployments can retain table and column grants independently.
      await db.exec(`
        grant update on public.direct_messages to authenticated;
        grant update (body) on public.direct_messages to authenticated;
        revoke execute on function private.heartbeat_live_session(uuid) from authenticated;
      `);
      await db.exec(migration);
      await db.exec(migration); // Safe to reapply after a partially managed deployment.
    }

    const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
    const scalar = async (sql, params = []) => Object.values((await rows(sql, params))[0])[0];
    async function asUser(id, role = 'authenticated', claims = { sub: id, role }) {
      assert.ok(['authenticated', 'anon', 'service_role'].includes(role));
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
      await db.exec(`set role ${role}`);
    }
    const denied = (sql, params = [], code = '42501') => assert.rejects(db.query(sql, params), (error) => error.code === code);
    await db.query("insert into auth.users(id,email) values ($1,'host@example.test'),($2,'guest@example.test'),($3,'outsider@example.test')", users);
    await asUser(host);
    const circle = await scalar("insert into public.circles(owner_id,name,interest) values ($1,'Regression public','Testing') returning id", [host]);
    const privateCircle = await scalar("insert into public.circles(owner_id,name,interest,is_private) values ($1,'Regression private','Testing',true) returning id", [host]);
    await asUser(guest);
    assert.equal(await scalar('select public.request_circle_membership($1)', [circle]), 'member');

    await t.test('1. Recipients can mark a DM read but cannot rewrite its contents or identity', async () => {
      await asUser(host);
      await db.query('insert into public.follows(follower_id,followee_id) values ($1,$2)', [host, guest]);
      await denied("select public.send_direct_message($1,'One-way follow')", [guest], 'P0001');
      await asUser(guest);
      await db.query('insert into public.follows(follower_id,followee_id) values ($1,$2)', [guest, host]);
      await asUser(host);
      const id = await scalar("select public.send_direct_message($1,'Original message')", [guest]);
      assert.equal((await rows('update public.direct_messages set read_at=now() where id=$1 returning id', [id])).length, 0);
      await asUser(guest);
      for (const [column, expression] of Object.entries({ body: "'Forged message'", sender_id: "'" + outsider + "'", recipient_id: "'" + outsider + "'", id: 'gen_random_uuid()', created_at: 'now()' })) {
        await denied(`update public.direct_messages set ${column}=${expression} where id=$1`, [id]);
      }
      await db.query('select public.mark_conversation_read($1)', [host]);
      const message = (await rows('select body,read_at from public.direct_messages where id=$1', [id]))[0];
      assert.equal(message.body, 'Original message');
      assert.ok(message.read_at);
      await asUser(outsider);
      assert.equal((await rows('select id from public.direct_messages where id=$1', [id])).length, 0);
      assert.equal((await rows('update public.direct_messages set read_at=now() where id=$1 returning id', [id])).length, 0);
    });

    await t.test('2. Authors can upload, clean up, and publish drafts without exposing them', async () => {
      for (const [kind, mime] of [['image', 'image/jpeg'], ['gif', 'image/gif'], ['video', 'video/mp4']]) {
        await asUser(guest);
        const id = await scalar("insert into public.posts(circle_id,author_id,body,visibility) values ($1,$2,'Media draft','removed') returning id", [circle, guest]);
        const path = `${guest}/${id}/test-${kind}`;
        await db.query("insert into storage.objects(bucket_id,name) values ('post-media',$1)", [path]);
        await db.query('insert into public.post_media(post_id,owner_id,kind,storage_path,mime_type) values ($1,$2,$3,$4,$5)', [id, guest, kind, path, mime]);
        for (const viewer of [host, outsider]) {
          await asUser(viewer);
          assert.equal((await rows('select id from public.posts where id=$1', [id])).length, 0);
          assert.equal((await rows('select id from public.post_media where post_id=$1', [id])).length, 0);
          assert.equal((await rows('select id from storage.objects where name=$1', [path])).length, 0);
          assert.equal((await rows('delete from storage.objects where name=$1 returning id', [path])).length, 0);
          await denied("insert into storage.objects(bucket_id,name) values ('post-media',$1)", [path + '-forged']);
        }
        await asUser(guest);
        assert.equal((await rows('delete from storage.objects where name=$1 returning id', [path])).length, 1, 'Author can clean up a failed upload');
        await db.query("insert into storage.objects(bucket_id,name) values ('post-media',$1)", [path]);
        assert.equal((await rows("update public.posts set visibility='published' where id=$1 returning id", [id])).length, 1);
        await asUser(host);
        assert.equal((await rows('select id from public.posts where id=$1', [id])).length, 1);
        assert.equal((await rows('select id from public.post_media where post_id=$1', [id])).length, 1);
        assert.equal((await rows('select id from storage.objects where name=$1', [path])).length, 1);
        await asUser(outsider);
        assert.equal((await rows('select id from public.posts where id=$1', [id])).length, 0);
        assert.equal((await rows('select id from storage.objects where name=$1', [path])).length, 0);
      }
    });

    await t.test('3. Only the host can refresh a live heartbeat through either function', async () => {
      await asUser(host);
      const id = await scalar("select public.start_live_session('Regression live',null)");
      await db.exec('reset role');
      await db.query("update public.live_sessions set host_heartbeat_at=now()-interval '30 seconds' where id=$1", [id]);
      const before = await scalar('select host_heartbeat_at from public.live_sessions where id=$1', [id]);
      await asUser(host);
      assert.ok(new Date(await scalar('select public.heartbeat_live_session($1)', [id])) > new Date(before));
      assert.ok(await scalar('select private.heartbeat_live_session($1)', [id]));
      await asUser(guest);
      await denied('select public.heartbeat_live_session($1)', [id], 'P0001');
      await denied('select private.heartbeat_live_session($1)', [id], 'P0001');
      await asUser(null, 'anon');
      await denied('select public.heartbeat_live_session($1)', [id]);
    });

    await t.test('4. Ordinary members can leave and cancel requests; owners remain protected', async () => {
      await asUser(guest);
      assert.equal(await scalar('select public.leave_circle($1)', [circle]), 'left');
      assert.equal(await scalar('select members_count from public.circles where id=$1', [circle]), 1);
      assert.equal((await rows('select user_id from public.circle_memberships where circle_id=$1', [circle])).length, 0);
      assert.equal(await scalar('select public.leave_circle($1)', [circle]), 'not_member');
      assert.equal(await scalar('select public.request_circle_membership($1)', [privateCircle]), 'pending');
      assert.equal(await scalar('select public.leave_circle($1)', [privateCircle]), 'request_cancelled');
      assert.equal(await scalar('select public.request_circle_membership($1)', [privateCircle]), 'pending');
      assert.equal((await rows("update public.circle_memberships set status='member' where circle_id=$1 and user_id=$2 returning user_id", [privateCircle, guest])).length, 0, 'Cannot self-approve');
      await asUser(host);
      await db.query("update public.circle_memberships set status='member' where circle_id=$1 and user_id=$2", [privateCircle, guest]);
      await denied('select public.leave_circle($1)', [circle], 'P0001');
      await denied('select public.leave_circle($1)', [privateCircle], 'P0001');
      await asUser(guest);
      assert.equal(await scalar('select public.leave_circle($1)', [privateCircle]), 'left');
      assert.equal(await scalar('select members_count from public.circles where id=$1', [privateCircle]), 1);
      assert.equal((await rows('delete from public.circle_memberships where circle_id=$1 and user_id=$2 returning user_id', [circle, host])).length, 0);
      await db.query('select public.request_circle_membership($1)', [circle]);
    });

    await t.test('5. Verified service purchases credit once; clients and missing claims cannot mint coins', async () => {
      const sql = "select public.credit_coin_purchase($1,'com.circles.coins.120','regression-transaction')";
      await asUser(guest);
      await denied(sql, [guest]);
      await asUser(null, 'anon');
      await denied(sql, [guest]);
      for (const claims of [{}, { role: 'authenticated' }]) {
        await asUser(null, 'service_role', claims);
        await denied(sql, [guest], 'P0001');
      }
      await asUser(null, 'service_role');
      assert.equal(Number(await scalar(sql, [guest])), 120);
      assert.equal(Number(await scalar(sql, [guest])), 120);
      assert.equal(Number(await scalar('select count(*) from public.coin_ledger where user_id=$1', [guest])), 1);
      await asUser(guest);
      assert.equal(Number(await scalar('select balance from public.coin_wallets where user_id=$1', [guest])), 120);
      assert.equal((await rows('select balance from public.coin_wallets where user_id=$1', [host])).length, 0);
    });

    await t.test('6. Blocking is idempotent, removes both follows, and revokes messages and media', async () => {
      await asUser(host);
      await denied('select public.block_user($1)', [host], 'P0001');
      await db.query('select public.block_user($1)', [guest]);
      await db.query('select public.block_user($1)', [guest]);
      assert.equal(Number(await scalar('select count(*) from public.blocks where blocker_id=$1 and blocked_id=$2', [host, guest])), 1);
      assert.equal(Number(await scalar('select count(*) from public.follows')), 0);
      assert.equal(Number(await scalar('select count(*) from public.direct_messages')), 0);
      assert.equal(Number(await scalar('select count(*) from public.posts where author_id=$1', [guest])), 0);
      assert.equal(Number(await scalar('select count(*) from storage.objects')), 0);
      await asUser(guest);
      await denied('insert into public.follows(follower_id,followee_id) values ($1,$2)', [guest, host]);
      await denied("select public.send_direct_message($1,'Blocked message')", [host], 'P0001');
      await denied('select public.mark_conversation_read($1)', [host], 'P0001');
      assert.equal(Number(await scalar('select count(*) from public.direct_messages')), 0);
    });
  });
}
