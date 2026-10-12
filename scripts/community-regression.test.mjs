import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createDatabase } from "./db-fixture.mjs";
const setup = readFileSync(
  new URL("../supabase/setup.sql", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261012145107_community_experience.sql",
    import.meta.url,
  ),
  "utf8",
).replace(/-- runtime-schedule:start[\s\S]*?-- runtime-schedule:end/g, "");
const host = "aaaaaaaa-0000-4000-8000-000000000001",
  guest = "bbbbbbbb-0000-4000-8000-000000000002",
  outsider = "cccccccc-0000-4000-8000-000000000003";
test("Community experience: real PostgreSQL permissions and flows", async (t) => {
  const db = await createDatabase(setup);
  t.after(() => db.close());
  await db.exec(migration);
  await db.exec(readFileSync(new URL("../supabase/migrations/20261012145255_community_foreign_key_indexes.sql", import.meta.url),"utf8"));
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const scalar = async (sql, args = []) =>
    Object.values((await rows(sql, args))[0])[0];
  const denied = (sql, args = [], code = "42501") =>
    assert.rejects(db.query(sql, args), (e) => e.code === code);
  const asUser = async (id, role = "authenticated") => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claims',$1,false)", [
      JSON.stringify({ sub: id, role }),
    ]);
    await db.exec(`set role ${role}`);
  };
  await db.query(
    "insert into auth.users(id,email) values($1,'host@test.local'),($2,'guest@test.local'),($3,'other@test.local')",
    [host, guest, outsider],
  );
  await asUser(host);
  const circle = await scalar(
    "insert into public.circles(owner_id,name,interest,is_private) values($1,'Astronomy circle','Science',true) returning id",
    [host],
  );
  await asUser(guest);
  await db.query("select public.request_circle_membership($1)", [circle]);
  await asUser(host);
  await db.query(
    "update public.circle_memberships set status='member' where circle_id=$1 and user_id=$2",
    [circle, guest],
  );
  let post, event, live;
  await t.test(
    "Onboarding and avatars are scoped to the signed-in member",
    async () => {
      await asUser(guest);
      await db.query(
        "update public.profiles set interests=array['Science'],onboarding_completed_at=now() where id=$1",
        [guest],
      );
      assert.ok(
        await scalar(
          "select onboarding_completed_at from public.profiles where id=$1",
          [guest],
        ),
      );
      assert.equal(
        (
          await rows(
            "update public.profiles set onboarding_completed_at=now() where id=$1 returning id",
            [host],
          )
        ).length,
        0,
      );
      await db.query(
        "insert into storage.objects(bucket_id,name) values('avatars',$1)",
        [`${guest}/photo.jpg`],
      );
      await denied(
        "insert into storage.objects(bucket_id,name) values('avatars',$1)",
        [`${host}/photo.jpg`],
      );
    },
  );
  await t.test(
    "Discovery searches beyond the first page and excludes blocked users before pagination",
    async () => {
      await asUser(host);
      for (let i = 0; i < 35; i++)
        await db.query(
          "insert into public.circles(owner_id,name,interest) values($1,$2,'Film')",
          [host, `Film group ${i}`],
        );
      await asUser(guest);
      assert.equal(
        (
          await rows(
            "select * from public.search_circles('Astronomy','All',0,30)",
          )
        ).length,
        1,
      );
      assert.equal(
        (await rows("select * from public.search_circles('','Science',0,30)"))
          .length,
        1,
      );
      assert.equal(
        (await rows("select * from public.search_circles('','All',30,30)"))
          .length,
        12,
      );
      await db.query("select public.block_user($1)", [outsider]);
      const people = await rows("select id from public.search_people('',0,20)");
      assert.deepEqual(
        people.map((p) => p.id),
        [host],
      );
      await db.query(
        "delete from public.blocks where blocker_id=$1 and blocked_id=$2",
        [guest, outsider],
      );
    },
  );
  await t.test(
    "Pinned welcomes, scheduled events and RSVPs enforce membership and ownership",
    async () => {
      await asUser(guest);
      assert.equal(
        (
          await rows(
            "update public.circles set welcome_text='Forged welcome' where id=$1 returning id",
            [circle],
          )
        ).length,
        0,
      );
      await denied(
        "insert into public.circle_events(circle_id,creator_id,title,starts_at) values($1,$2,'Not mine',now()+interval '1 hour')",
        [circle, guest],
      );
      await asUser(host);
      await db.query(
        "update public.circles set welcome_text='Welcome stargazers' where id=$1",
        [circle],
      );
      event = await scalar(
        "insert into public.circle_events(circle_id,creator_id,title,starts_at) values($1,$2,'Night sky walk',now()+interval '10 minutes') returning id",
        [circle, host],
      );
      await asUser(guest);
      await db.query(
        "insert into public.event_rsvps(event_id,user_id) values($1,$2)",
        [event, guest],
      );
      await asUser(outsider);
      assert.equal(
        (await rows("select id from public.circle_events where id=$1", [event]))
          .length,
        0,
      );
      await denied(
        "insert into public.event_rsvps(event_id,user_id) values($1,$2)",
        [event, outsider],
      );
      assert.equal(
        (
          await rows(
            "delete from public.circle_events where id=$1 returning id",
            [event],
          )
        ).length,
        0,
      );
    },
  );
  await t.test(
    "Notifications respect blocks, category preferences, and circle mutes",
    async () => {
      await asUser(guest);
      assert.equal(
        Number(
          await scalar(
            "select count(*) from public.notifications where kind='memberships'",
          ),
        ),
        1,
      );
      await denied(
        "insert into public.notifications(user_id,kind,target_id,title,body,dedupe_key) values($1,'live',$2,'Spam','Spam','forged')",
        [host, circle],
      );
      await db
        .query(
          "insert into public.notification_preferences(user_id,replies) values($1,false)",
          [host],
        )
        .then(
          () => assert.fail("Cannot change another member preferences"),
          (e) => assert.equal(e.code, "42501"),
        );
      await asUser(host);
      post = await scalar(
        "insert into public.posts(circle_id,author_id,body) values($1,$2,'Welcome post') returning id",
        [circle, host],
      );
      await db.query(
        "insert into public.notification_preferences(user_id,replies) values($1,false)",
        [host],
      );
      await asUser(guest);
      await db.query(
        "insert into public.post_comments(post_id,author_id,body) values($1,$2,'First reply')",
        [post, guest],
      );
      await asUser(host);
      assert.equal(
        Number(
          await scalar(
            "select count(*) from public.notifications where kind='replies'",
          ),
        ),
        0,
      );
      await db.query(
        "update public.notification_preferences set replies=true where user_id=$1",
        [host],
      );
      await asUser(guest);
      await db.query(
        "insert into public.post_comments(post_id,author_id,body) values($1,$2,'Second reply')",
        [post, guest],
      );
      await asUser(host);
      const notification = await scalar(
        "select id from public.notifications where kind='replies'",
      );
      await denied(
        "update public.notifications set body='Changed' where id=$1",
        [notification],
      );
      await db.query(
        "update public.notifications set read_at=now() where id=$1",
        [notification],
      );
      await db.query(
        "insert into public.circle_notification_preferences(user_id,circle_id,enabled) values($1,$2,false)",
        [host, circle],
      );
      await asUser(guest);
      await db.query(
        "insert into public.post_comments(post_id,author_id,body) values($1,$2,'Muted reply')",
        [post, guest],
      );
      await asUser(host);
      assert.equal(
        Number(
          await scalar(
            "select count(*) from public.notifications where kind='replies'",
          ),
        ),
        1,
      );
    },
  );
  await t.test(
    "Device pushes obey quiet hours, leases, preferences, and service-only access",
    async () => {
      await asUser(guest);
      await db.query(
        "insert into public.notification_preferences(user_id,push_enabled,quiet_enabled,quiet_start,quiet_end,timezone) values($1,true,true,'00:00','23:59:59','UTC')",
        [guest],
      );
      await db.query(
        "select public.register_push_token('ExpoPushToken[regression]')",
      );
      await denied("select public.claim_notification_deliveries()");
      await denied("select public.authorize_notification_dispatch('guess')");
      await denied(
        "update public.notification_preferences set timezone='Not/AZone' where user_id=$1",
        [guest],
        "P0001",
      );
      await asUser(host);
      await db.query(
        "insert into public.follows(follower_id,followee_id) values($1,$2)",
        [host, guest],
      );
      await asUser(guest);
      await db.query(
        "insert into public.follows(follower_id,followee_id) values($1,$2)",
        [guest, host],
      );
      await asUser(host);
      await db.query("select public.send_direct_message($1,'Hello')", [guest]);
      await asUser(null, "service_role");
      assert.deepEqual(
        await scalar("select public.claim_notification_deliveries()"),
        [],
      );
      await asUser(guest);
      await db.query(
        "update public.notification_preferences set quiet_enabled=false where user_id=$1",
        [guest],
      );
      await asUser(null, "service_role");
      const jobs = await scalar(
        "select public.claim_notification_deliveries()",
      );
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0].body, "A mutual follow sent you a message.");
      assert.deepEqual(
        await scalar("select public.claim_notification_deliveries()"),
        [],
        "Lease prevents concurrent workers from resending",
      );
      await asUser(guest);
      await db.query("select public.block_user($1)", [host]);
      await asUser(null, "service_role");
      await db.query(
        "update public.notification_deliveries set available_at=now()-interval '1 minute'",
      );
      assert.deepEqual(
        await scalar("select public.claim_notification_deliveries()"),
        [],
      );
      await asUser(guest);
      await db.query(
        "delete from public.blocks where blocker_id=$1 and blocked_id=$2",
        [guest, host],
      );
    },
  );
  await t.test(
    "Co-host departure frees a seat and cannot remove someone else or the host",
    async () => {
      await asUser(host);
      live = await scalar("select public.start_live_session('Test room',null)");
      await asUser(guest);
      const request = await scalar("select public.request_live_seat($1)", [
        live,
      ]);
      await asUser(host);
      await db.query("select public.decide_live_seat_request($1,true)", [
        request,
      ]);
      await asUser(guest);
      await db.query("select public.heartbeat_live_seat($1)", [live]);
      await db.query("select public.leave_live_seat($1)", [live]);
      assert.equal(
        Number(
          await scalar(
            "select count(*) from public.live_seats where session_id=$1",
            [live],
          ),
        ),
        1,
      );
      await denied("select public.heartbeat_live_seat($1)", [live], "P0001");
      await asUser(host);
      await db.query("select public.leave_live_seat($1)", [live]);
      assert.equal(
        Number(
          await scalar(
            "select count(*) from public.live_seats where session_id=$1",
            [live],
          ),
        ),
        1,
      );
    },
  );
  await t.test(
    "Event reminders deduplicate, reassigned devices stay private, and exhausted deliveries finish",
    async () => {
      await db.exec("reset role");
      await db.query("select private.enqueue_event_reminders()");
      await db.query("select private.enqueue_event_reminders()");
      await asUser(guest);
      assert.equal(
        Number(
          await scalar(
            "select count(*) from public.notifications where dedupe_key=$1",
            [`reminder:${event}`],
          ),
        ),
        1,
      );
      await asUser(outsider);
      await db.query(
        "select public.register_push_token('ExpoPushToken[regression]')",
      );
      await asUser(null, "service_role");
      assert.deepEqual(
        await scalar("select public.claim_notification_deliveries()"),
        [],
      );
      assert.equal(
        await scalar(
          "select state from public.notification_deliveries d join public.notifications n on n.id=d.notification_id where n.dedupe_key=$1",
          [`reminder:${event}`],
        ),
        "failed",
      );
      await asUser(guest);
      await db.query(
        "select public.register_push_token('ExpoPushToken[regression]')",
      );
      await asUser(host);
      await db.query(
        "insert into public.circle_events(circle_id,creator_id,title,starts_at) values($1,$2,'Second event',now()+interval '1 hour')",
        [circle, host],
      );
      await asUser(null, "service_role");
      await db.query(
        "update public.notification_deliveries set attempts=5,available_at=now()-interval '1 minute' where state='pending'",
      );
      assert.deepEqual(
        await scalar("select public.claim_notification_deliveries()"),
        [],
      );
      assert.equal(
        Number(
          await scalar(
            "select count(*) from public.notification_deliveries where last_error='Retry limit reached'",
          ),
        ),
        1,
      );
    },
  );
  await t.test(
    "Moderation cannot be self-assigned and removed posts cannot be republished",
    async () => {
      const path = `${host}/${post}/reported.jpg`;
      await asUser(host);
      await db.query(
        "insert into storage.objects(bucket_id,name) values('post-media',$1)",
        [path],
      );
      await db.query(
        "insert into public.post_media(post_id,owner_id,kind,storage_path,mime_type) values($1,$2,'image',$3,'image/jpeg')",
        [post, host, path],
      );
      await asUser(outsider);
      assert.equal(
        (await rows("select id from storage.objects where name=$1", [path]))
          .length,
        0,
      );
      await asUser(guest);
      await denied("insert into public.moderators(user_id) values($1)", [
        guest,
      ]);
      await denied("select public.moderation_queue()", [], "P0001");
      const report = await scalar(
        "insert into public.reports(reporter_id,target_type,target_id,reason) values($1,'post',$2,'Harassment') returning id",
        [guest, post],
      );
      await denied(
        "select public.review_report($1,'remove','No')",
        [report],
        "P0001",
      );
      await db.exec("reset role");
      await db.query("insert into public.moderators(user_id) values($1)", [
        outsider,
      ]);
      await asUser(outsider);
      const queue = await scalar("select public.moderation_queue()");
      assert.equal(queue[0].content, "Welcome post");
      assert.equal(queue[0].media[0].path, path);
      assert.equal(
        (await rows("select id from storage.objects where name=$1", [path]))
          .length,
        1,
      );
      await db.query(
        "select public.review_report($1,'remove','Reviewed by moderator')",
        [report],
      );
      assert.equal(
        (await rows("select id from storage.objects where name=$1", [path]))
          .length,
        0,
        "Media review access ends when the report is closed",
      );
      await asUser(host);
      await denied(
        "update public.posts set visibility='published' where id=$1",
        [post],
        "P0001",
      );
      await denied(
        "update public.posts set moderation_locked=false where id=$1",
        [post],
      );
      await asUser(guest);
      assert.equal(
        (await rows("select id from public.posts where id=$1", [post])).length,
        0,
      );
    },
  );
  await t.test(
    "Diagnostics require opt-in; activation metrics require moderator access",
    async () => {
      await asUser(guest);
      await denied(
        "insert into public.client_diagnostics(user_id,category,code) values($1,'render','Error')",
        [guest],
      );
      await db.query(
        "update public.notification_preferences set diagnostics_enabled=true where user_id=$1",
        [guest],
      );
      await db.query(
        "insert into public.client_diagnostics(user_id,category,code) values($1,'render','Error')",
        [guest],
      );
      assert.equal(
        (await rows("select * from public.client_diagnostics")).length,
        0,
      );
      await denied("select public.activation_metrics()", [], "P0001");
      await asUser(outsider);
      assert.equal(
        (await rows("select * from public.client_diagnostics")).length,
        1,
      );
      assert.equal(
        (await scalar("select public.activation_metrics()")).onboarded,
        1,
      );
    },
  );
  await t.test("Post retry keys cannot create duplicate posts", async () => {
    await asUser(guest);
    await db.query(
      "insert into public.posts(circle_id,author_id,body,client_request_id) values($1,$2,'One post','retry-key')",
      [circle, guest],
    );
    await denied(
      "insert into public.posts(circle_id,author_id,body,client_request_id) values($1,$2,'Duplicate','retry-key')",
      [circle, guest],
      "23505",
    );
  });
  await t.test(
    "Account deletion transfers owned circles and removes account-linked data",
    async () => {
      await asUser(host);
      await denied("select public.prepare_account_deletion($1)", [host]);
      await asUser(null, "service_role");
      await db.query("select public.prepare_account_deletion($1)", [host]);
      assert.equal(
        await scalar("select owner_id from public.circles where id=$1", [
          circle,
        ]),
        guest,
      );
      assert.equal(
        await scalar(
          "select role from public.circle_memberships where circle_id=$1 and user_id=$2",
          [circle, guest],
        ),
        "owner",
      );
      assert.equal(
        Number(
          await scalar("select count(*) from public.profiles where id=$1", [
            host,
          ]),
        ),
        0,
      );
      await asUser(host);
      await denied(
        "insert into storage.objects(bucket_id,name) values('avatars',$1)",
        [`${host}/after-deletion.jpg`],
      );
    },
  );
});
