-- Community experience: discovery, onboarding, notifications, moderation and diagnostics.
alter table public.profiles add column if not exists onboarding_completed_at timestamptz;
alter table public.circles add column if not exists welcome_text text not null default '' check (char_length(welcome_text) <= 3000);
alter table public.circles add column if not exists last_activity_at timestamptz not null default now();
grant update (welcome_text) on public.circles to authenticated;
alter table public.posts add column if not exists client_request_id text check (char_length(client_request_id)<=128);
create unique index if not exists posts_author_request on public.posts(author_id, client_request_id) where client_request_id is not null;
create index if not exists posts_author_feed on public.posts(author_id, created_at desc, id desc) where visibility = 'published';
create index if not exists circles_search on public.circles using gin(to_tsvector('simple', name || ' ' || description || ' ' || interest));
create index if not exists profiles_search on public.profiles using gin(to_tsvector('simple', display_name || ' ' || handle || ' ' || bio));

create or replace function public.search_circles(search_text text default '', interest_filter text default '', page_offset integer default 0, page_size integer default 30)
returns setof public.circles language sql stable security invoker set search_path='' as $$
 select c.* from public.circles c
 where (c.owner_id is null or not private.are_blocked((select auth.uid()), c.owner_id))
 and (interest_filter in ('','All','For you') or lower(c.interest)=lower(interest_filter))
 and (trim(search_text)='' or to_tsvector('simple',c.name||' '||c.description||' '||c.interest) @@ websearch_to_tsquery('simple',search_text)
      or position(lower(trim(search_text)) in lower(c.name||' '||c.description||' '||c.interest))>0)
 order by case when interest_filter='For you' and exists(select 1 from public.profiles p, unnest(p.interests) i where p.id=(select auth.uid()) and lower(i)=lower(c.interest)) then 0 else 1 end,
 c.last_activity_at desc,c.id
 offset greatest(page_offset,0) limit least(greatest(page_size,1),50);
$$;
create or replace function public.search_people(search_text text default '', page_offset integer default 0, page_size integer default 20)
returns setof public.profiles language sql stable security invoker set search_path='' as $$
 select p.* from public.profiles p
 where p.id<>(select auth.uid()) and not private.are_blocked((select auth.uid()),p.id)
 and (trim(search_text)='' or position(lower(trim(search_text)) in lower(p.display_name||' '||p.handle||' '||p.bio||' '||array_to_string(p.interests,' ')))>0)
 order by (select count(*) from public.profiles me, unnest(me.interests) i where me.id=(select auth.uid()) and exists(select 1 from unnest(p.interests) pi where lower(pi)=lower(i))) desc,p.id
 offset greatest(page_offset,0) limit least(greatest(page_size,1),50);
$$;
revoke all on function public.search_circles(text,text,integer,integer),public.search_people(text,integer,integer) from public,anon;
grant execute on function public.search_circles(text,text,integer,integer),public.search_people(text,integer,integer) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('avatars','avatars',true,5242880,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
drop policy "Members upload media into their own post folder" on storage.objects;
create policy "Members upload their media" on storage.objects for insert to authenticated with check(
 (storage.foldername(name))[1]=(select auth.uid())::text and (
  (bucket_id='avatars' and exists(select 1 from public.profiles p where p.id=(select auth.uid())))
  or (bucket_id='post-media' and exists(select 1 from public.posts p where p.id::text=(storage.foldername(name))[2] and p.author_id=(select auth.uid())))
 )
);
drop policy "Authors delete their media" on storage.objects;
create policy "Authors delete their media" on storage.objects for delete to authenticated using(bucket_id in ('avatars','post-media') and (storage.foldername(name))[1]=(select auth.uid())::text);

alter table public.live_seats add column if not exists heartbeat_at timestamptz not null default now();
create or replace function private.leave_live_seat(target_session_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
 delete from public.live_seats where session_id=target_session_id and user_id=(select auth.uid()) and role='cohost';
 update public.live_seat_requests set status='cancelled',decided_at=now() where session_id=target_session_id and requester_id=(select auth.uid()) and status in ('pending','accepted');
end; $$;
create or replace function public.leave_live_seat(target_session_id uuid) returns void language sql security invoker set search_path='' as $$ select private.leave_live_seat(target_session_id); $$;
create or replace function private.heartbeat_live_seat(target_session_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 update public.live_seats s set heartbeat_at=now() where s.session_id=target_session_id and s.user_id=(select auth.uid()) and exists(select 1 from public.live_sessions l where l.id=s.session_id and l.status='live');
 if not found then raise exception 'Your live seat is no longer available'; end if;
end; $$;
create or replace function public.heartbeat_live_seat(target_session_id uuid) returns void language sql security invoker set search_path='' as $$ select private.heartbeat_live_seat(target_session_id); $$;
revoke all on function private.leave_live_seat(uuid),public.leave_live_seat(uuid),private.heartbeat_live_seat(uuid),public.heartbeat_live_seat(uuid) from public,anon;
grant execute on function private.leave_live_seat(uuid),public.leave_live_seat(uuid),private.heartbeat_live_seat(uuid),public.heartbeat_live_seat(uuid) to authenticated;
create or replace function private.expire_stale_live_seats() returns void language plpgsql security definer set search_path='' as $$
begin
 with removed as (delete from public.live_seats where role='cohost' and heartbeat_at<now()-interval '90 seconds' returning session_id,user_id)
 update public.live_seat_requests r set status='cancelled',decided_at=now() from removed d where r.session_id=d.session_id and r.requester_id=d.user_id;
end; $$;
revoke all on function private.expire_stale_live_seats() from public,anon,authenticated;

create table public.notification_preferences(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 push_enabled boolean not null default false, messages boolean not null default true, replies boolean not null default true,
 memberships boolean not null default true, live boolean not null default true, events boolean not null default true,
 quiet_enabled boolean not null default false, quiet_start time not null default '22:00', quiet_end time not null default '08:00',
 timezone text not null default 'UTC', diagnostics_enabled boolean not null default false
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon,authenticated;
grant select,insert,update on public.notification_preferences to authenticated;
create policy "Own notification preferences" on public.notification_preferences for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create table public.circle_notification_preferences(
 user_id uuid references public.profiles(id) on delete cascade, circle_id uuid references public.circles(id) on delete cascade,
 enabled boolean not null default true, primary key(user_id,circle_id)
);
alter table public.circle_notification_preferences enable row level security;
revoke all on public.circle_notification_preferences from anon,authenticated;
create index circle_notification_preferences_circle on public.circle_notification_preferences(circle_id);
grant select,insert,update on public.circle_notification_preferences to authenticated;
create policy "Own circle notification preferences" on public.circle_notification_preferences for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create table public.device_push_tokens(
 user_id uuid not null references public.profiles(id) on delete cascade, token text primary key check(token ~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$'),
 updated_at timestamptz not null default now()
);
alter table public.device_push_tokens enable row level security;
revoke all on public.device_push_tokens from anon,authenticated;
grant all on public.device_push_tokens to service_role;
grant select,delete on public.device_push_tokens to authenticated;
create policy "Own push devices" on public.device_push_tokens for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create or replace function private.register_push_token(push_token text) returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
 insert into public.device_push_tokens(user_id,token) values((select auth.uid()),push_token)
 on conflict(token) do update set user_id=excluded.user_id,updated_at=now();
end; $$;
create or replace function public.register_push_token(push_token text) returns void language sql security invoker set search_path='' as $$ select private.register_push_token(push_token); $$;
revoke all on function private.register_push_token(text),public.register_push_token(text) from public,anon;
grant execute on function private.register_push_token(text),public.register_push_token(text) to authenticated;

create table public.notifications(
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 actor_id uuid references public.profiles(id) on delete cascade, kind text not null check(kind in ('messages','replies','memberships','live','events')),
 circle_id uuid references public.circles(id) on delete cascade, target_id uuid not null,
 title text not null, body text not null, dedupe_key text not null, read_at timestamptz, created_at timestamptz not null default now(),
 unique(user_id,dedupe_key)
);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon,authenticated;
grant select,delete on public.notifications to authenticated;
grant update(read_at) on public.notifications to authenticated;
create index notifications_inbox on public.notifications(user_id,created_at desc);
create index notifications_actor on public.notifications(actor_id);
create index notifications_circle on public.notifications(circle_id);
create policy "Read own accessible notifications" on public.notifications for select to authenticated using(
 user_id=(select auth.uid()) and (actor_id is null or not private.are_blocked((select auth.uid()),actor_id))
 and (circle_id is null or private.is_circle_member(circle_id,(select auth.uid())))
 and (kind<>'messages' or exists(select 1 from public.follows f where f.follower_id=user_id and f.followee_id=actor_id) and exists(select 1 from public.follows f where f.followee_id=user_id and f.follower_id=actor_id))
);
create policy "Read receipts for own notifications" on public.notifications for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy "Delete own notifications" on public.notifications for delete to authenticated using(user_id=(select auth.uid()));
create or replace function private.notify_member(recipient uuid,actor uuid,notification_kind text,notification_circle uuid,notification_target uuid,notification_title text,notification_body text,event_key text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if recipient is null or recipient=actor or private.are_blocked(recipient,actor) then return; end if;
 if exists(select 1 from public.notification_preferences p where p.user_id=recipient and not coalesce((to_jsonb(p)->>notification_kind)::boolean,true)) then return; end if;
 if exists(select 1 from public.circle_notification_preferences p where p.user_id=recipient and p.circle_id=notification_circle and not p.enabled) then return; end if;
 insert into public.notifications(user_id,actor_id,kind,circle_id,target_id,title,body,dedupe_key)
 values(recipient,actor,notification_kind,notification_circle,notification_target,notification_title,notification_body,event_key) on conflict(user_id,dedupe_key) do nothing;
end; $$;
revoke all on function private.notify_member(uuid,uuid,text,uuid,uuid,text,text,text) from public,anon,authenticated;
create or replace function private.activity_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; parent_post public.posts;
begin
 if tg_table_name='direct_messages' then
  perform private.notify_member(new.recipient_id,new.sender_id,'messages',null,new.sender_id,'New message','A mutual follow sent you a message.','message:'||new.id);
 elsif tg_table_name='post_comments' then
  select * into parent_post from public.posts where id=new.post_id;
  perform private.notify_member(parent_post.author_id,new.author_id,'replies',parent_post.circle_id,new.post_id,'New reply','Someone replied to your post.','reply:'||new.id);
 elsif tg_table_name='circle_memberships' then
  if new.status='member' and old.status='pending' then
  select owner_id into recipient from public.circles where id=new.circle_id;
  perform private.notify_member(new.user_id,recipient,'memberships',new.circle_id,new.circle_id,'You are in!','Your circle request was approved.','membership:'||new.circle_id||':'||new.joined_at);
  end if;
 elsif tg_table_name='live_sessions' then
  for recipient in select f.follower_id from public.follows f where f.followee_id=new.host_id and (new.circle_id is null or private.is_circle_member(new.circle_id,f.follower_id)) loop
   perform private.notify_member(recipient,new.host_id,'live',new.circle_id,new.id,'Someone you follow is live','Join the conversation in Circles.','live:'||new.id);
  end loop;
 end if;
 return new;
end; $$;
revoke all on function private.activity_notifications() from public,anon,authenticated;
create trigger notify_message after insert on public.direct_messages for each row execute function private.activity_notifications();
create trigger notify_reply after insert on public.post_comments for each row execute function private.activity_notifications();
create trigger notify_membership after update on public.circle_memberships for each row execute function private.activity_notifications();
create trigger notify_live after insert on public.live_sessions for each row execute function private.activity_notifications();

create table public.circle_events(
 id uuid primary key default gen_random_uuid(),circle_id uuid not null references public.circles(id) on delete cascade,
 creator_id uuid not null references public.profiles(id) on delete cascade,title text not null check(char_length(title) between 2 and 120),
 description text not null default '' check(char_length(description)<=2000),starts_at timestamptz not null,created_at timestamptz not null default now()
);
create index circle_events_upcoming on public.circle_events(circle_id,starts_at);
create index circle_events_creator on public.circle_events(creator_id);
alter table public.circle_events enable row level security;
revoke all on public.circle_events from anon,authenticated;
grant select,insert,delete on public.circle_events to authenticated;
create policy "Members read events" on public.circle_events for select to authenticated using(private.is_circle_member(circle_id,(select auth.uid())));
create policy "Owners schedule events" on public.circle_events for insert to authenticated with check(creator_id=(select auth.uid()) and private.is_circle_owner(circle_id,(select auth.uid())) and starts_at>now());
create policy "Owners cancel events" on public.circle_events for delete to authenticated using(private.is_circle_owner(circle_id,(select auth.uid())));
create table public.event_rsvps(event_id uuid references public.circle_events(id) on delete cascade,user_id uuid references public.profiles(id) on delete cascade,primary key(event_id,user_id));
create index event_rsvps_user on public.event_rsvps(user_id);
alter table public.event_rsvps enable row level security;
revoke all on public.event_rsvps from anon,authenticated;
grant select,insert,delete on public.event_rsvps to authenticated;
create policy "Own event RSVPs" on public.event_rsvps for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and exists(select 1 from public.circle_events e where e.id=event_id and e.starts_at>now()));
create or replace function private.event_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare member_id uuid;
begin
 for member_id in select user_id from public.circle_memberships where circle_id=new.circle_id and status='member' loop
  perform private.notify_member(member_id,new.creator_id,'events',new.circle_id,new.id,'New circle event','Your circle has a new event. Open Circles for details.','event:'||new.id);
 end loop;
 return new;
end; $$;
revoke all on function private.event_notifications() from public,anon,authenticated;
create trigger notify_event after insert on public.circle_events for each row execute function private.event_notifications();

-- Roles are assigned by a trusted administrator, never by user-editable metadata.
create table public.moderators(user_id uuid primary key references public.profiles(id) on delete cascade);
alter table public.moderators enable row level security;
revoke all on public.moderators from public,anon,authenticated;
grant select on public.moderators to authenticated;
create policy "See own moderator assignment" on public.moderators for select to authenticated using(user_id=(select auth.uid()));
create or replace function private.is_moderator() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from public.moderators where user_id=(select auth.uid())); $$;
revoke all on function private.is_moderator() from public,anon;
grant execute on function private.is_moderator() to authenticated;
alter table public.reports add column if not exists resolution_note text not null default '';
alter table public.reports add column if not exists reviewed_at timestamptz;
alter table public.reports add column if not exists reviewed_by uuid references public.profiles(id) on delete set null;
create index reports_reviewed_by on public.reports(reviewed_by);
drop policy if exists "Members read their reports" on public.reports;
create policy "Moderators read report queue" on public.reports for select to authenticated using(reporter_id=(select auth.uid()) or (select private.is_moderator()));
create table private.moderation_actions(id uuid primary key default gen_random_uuid(),moderator_id uuid references public.profiles(id) on delete set null,report_id uuid references public.reports(id) on delete set null,action text not null,note text not null,created_at timestamptz not null default now());
alter table private.moderation_actions enable row level security;
revoke all on private.moderation_actions from public,anon,authenticated;
create or replace function private.review_report(report_id uuid,decision text,note text default '') returns void language plpgsql security definer set search_path='' as $$
declare item public.reports;
begin
 if not private.is_moderator() then raise exception 'Moderator access required'; end if;
 if decision not in ('dismiss','resolve','remove') or char_length(note)>1000 then raise exception 'Invalid review'; end if;
 select * into item from public.reports where id=report_id for update;
 if not found then raise exception 'Report not found'; end if;
 if decision='remove' then
  if item.target_type='post' then update public.posts set visibility='removed',moderation_locked=true where id=item.target_id;
  elsif item.target_type='message' then delete from public.direct_messages where id=item.target_id;
  elsif item.target_type='live_session' then update public.live_sessions set status='ended',ended_at=now() where id=item.target_id;
  else raise exception 'This report supports resolution or dismissal; content removal is unavailable'; end if;
 end if;
 update public.reports set status=case when decision='dismiss' then 'dismissed' else 'resolved' end,resolution_note=note,reviewed_at=now(),reviewed_by=(select auth.uid()) where id=report_id;
 insert into private.moderation_actions(moderator_id,report_id,action,note) values((select auth.uid()),report_id,decision,note);
end; $$;
create or replace function public.review_report(report_id uuid,decision text,note text default '') returns void language sql security invoker set search_path='' as $$ select private.review_report(report_id,decision,note); $$;
revoke all on function private.review_report(uuid,text,text),public.review_report(uuid,text,text) from public,anon;
grant execute on function private.review_report(uuid,text,text),public.review_report(uuid,text,text) to authenticated;

create table public.client_diagnostics(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 category text not null check(category in ('render','runtime','network','stream','upload')),code text not null check(char_length(code)<=100),
 stack text not null default '' check(char_length(stack)<=4000),created_at timestamptz not null default now()
);
alter table public.client_diagnostics enable row level security;
revoke all on public.client_diagnostics from anon,authenticated;
grant insert on public.client_diagnostics to authenticated;
grant select on public.client_diagnostics to authenticated;
create policy "Opted in diagnostic submissions" on public.client_diagnostics for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.notification_preferences p where p.user_id=(select auth.uid()) and p.diagnostics_enabled));
create policy "Moderators read diagnostics" on public.client_diagnostics for select to authenticated using((select private.is_moderator()));
create index diagnostics_user on public.client_diagnostics(user_id,created_at desc);
create or replace function private.activation_metrics() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.is_moderator() then raise exception 'Moderator access required'; end if;
 return (select jsonb_build_object('members',count(*),'onboarded',count(*) filter(where onboarding_completed_at is not null),
 'joined',count(*) filter(where exists(select 1 from public.circle_memberships m where m.user_id=p.id and m.status='member')),
 'contributed',count(*) filter(where exists(select 1 from public.posts s where s.author_id=p.id and s.visibility='published') or exists(select 1 from public.post_comments c where c.author_id=p.id))) from public.profiles p where p.created_at>now()-interval '30 days');
end; $$;
create or replace function public.activation_metrics() returns jsonb language sql security invoker set search_path='' as $$ select private.activation_metrics(); $$;
revoke all on function private.activation_metrics(),public.activation_metrics() from public,anon;
grant execute on function private.activation_metrics(),public.activation_metrics() to authenticated;

create or replace function private.record_circle_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.visibility='published' then update public.circles set last_activity_at=now() where id=new.circle_id; end if;
 return new;
end; $$;
revoke all on function private.record_circle_activity() from public,anon,authenticated;
create trigger record_circle_activity after insert or update of visibility on public.posts for each row execute function private.record_circle_activity();

-- Quiet hours use an IANA time zone, including daylight-saving changes.
create or replace function private.validate_notification_timezone() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then raise exception 'Choose a valid time zone'; end if;
 return new;
end; $$;
revoke all on function private.validate_notification_timezone() from public,anon,authenticated;
create trigger validate_notification_timezone before insert or update on public.notification_preferences for each row execute function private.validate_notification_timezone();

-- Runtime scheduler is skipped by the isolated PostgreSQL fixture.
-- runtime-schedule:start
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then alter publication supabase_realtime add table public.notifications; end if;
 perform cron.schedule('circles-expire-live-seats','* * * * *','select private.expire_stale_live_seats();');
end; $$;
-- runtime-schedule:end

-- A removed post cannot be republished by its author after a moderation decision.
alter table public.posts add column if not exists moderation_locked boolean not null default false;
revoke update on public.posts from authenticated;
grant update(body,visibility) on public.posts to authenticated;
create or replace function private.protect_moderated_post() returns trigger language plpgsql set search_path='' as $$
begin
 if old.moderation_locked and not private.is_moderator() then raise exception 'This post was removed by moderation'; end if;
 return new;
end; $$;
revoke all on function private.protect_moderated_post() from public,anon,authenticated;
create trigger protect_moderated_post before update on public.posts for each row execute function private.protect_moderated_post();
create or replace function private.moderation_queue() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not private.is_moderator() then raise exception 'Moderator access required'; end if;
 return coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('media',case when r.target_type='post' then coalesce((select jsonb_agg(jsonb_build_object('kind',pm.kind,'path',pm.storage_path)) from public.post_media pm where pm.post_id=r.target_id),'[]'::jsonb) else '[]'::jsonb end,'content',case r.target_type
 when 'post' then (select p.body from public.posts p where p.id=r.target_id)
 when 'message' then (select m.body from public.direct_messages m where m.id=r.target_id)
 when 'profile' then (select p.display_name||': '||p.bio from public.profiles p where p.id=r.target_id)
 when 'circle' then (select c.name||': '||c.description from public.circles c where c.id=r.target_id)
 when 'live_session' then (select l.title from public.live_sessions l where l.id=r.target_id) end))
 from (select * from public.reports where status in ('open','reviewing') order by created_at limit 100) r),'[]'::jsonb);
end; $$;
create or replace function public.moderation_queue() returns jsonb language sql security invoker set search_path='' as $$ select private.moderation_queue(); $$;
revoke all on function private.moderation_queue(),public.moderation_queue() from public,anon;
grant execute on function private.moderation_queue(),public.moderation_queue() to authenticated;

-- Deletion preserves circles with other members by transferring ownership.
create or replace function private.prepare_account_deletion(target_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare owned public.circles; successor uuid;
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'Service role required'; end if;
 for owned in select * from public.circles where owner_id=target_user for update loop
  select user_id into successor from public.circle_memberships where circle_id=owned.id and user_id<>target_user and status='member' order by joined_at,user_id limit 1;
  if successor is null then delete from public.circles where id=owned.id;
  else
   update public.circles set owner_id=successor where id=owned.id;
   update public.circle_memberships set role='owner' where circle_id=owned.id and user_id=successor;
  end if;
 end loop;
 update public.live_sessions set status='ended',ended_at=now() where host_id=target_user and status='live';
 delete from public.profiles where id=target_user;
end; $$;
create or replace function public.prepare_account_deletion(target_user uuid) returns void language sql security invoker set search_path='' as $$ select private.prepare_account_deletion(target_user); $$;
revoke all on function private.prepare_account_deletion(uuid) from public,anon,authenticated;
grant execute on function private.prepare_account_deletion(uuid) to service_role;
revoke all on function public.prepare_account_deletion(uuid) from public,anon,authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

create table public.notification_deliveries(
 id uuid primary key default gen_random_uuid(), notification_id uuid not null references public.notifications(id) on delete cascade,
 token text not null references public.device_push_tokens(token) on delete cascade,
 state text not null default 'pending' check(state in ('pending','processing','ticket','delivered','failed')),
 attempts integer not null default 0,available_at timestamptz not null default now(),receipt_id text,receipt_checked_at timestamptz,last_error text,
 unique(notification_id,token)
);
alter table public.notification_deliveries enable row level security;
revoke all on public.notification_deliveries from public,anon,authenticated;
grant all on public.notification_deliveries to service_role;
create index notification_delivery_queue on public.notification_deliveries(state,available_at);
create index notification_delivery_token on public.notification_deliveries(token);
create or replace function private.queue_push() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.notification_deliveries(notification_id,token)
 select new.id,d.token from public.device_push_tokens d join public.notification_preferences p on p.user_id=d.user_id
 where d.user_id=new.user_id and p.push_enabled on conflict do nothing;
 return new;
end; $$;
revoke all on function private.queue_push() from public,anon,authenticated;
create trigger queue_push after insert on public.notifications for each row execute function private.queue_push();
create or replace function private.claim_notification_deliveries() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'Service role required'; end if;
 -- Suppress obsolete or newly muted notifications, including blocks and unfollows.
 update public.notification_deliveries set state='failed',last_error='Retry limit reached'
 where state in ('pending','processing') and attempts>=5 and available_at<=now();
 update public.notification_deliveries d set state='failed',last_error='No longer eligible'
 from public.notifications n left join public.notification_preferences p on p.user_id=n.user_id
 where d.notification_id=n.id and d.state in ('pending','processing') and
 (n.created_at<now()-interval '24 hours' or n.read_at is not null or not coalesce(p.push_enabled,false)
 or not coalesce((to_jsonb(p)->>n.kind)::boolean,true) or private.are_blocked(n.user_id,n.actor_id)
 or not exists(select 1 from public.device_push_tokens t where t.token=d.token and t.user_id=n.user_id)
 or (n.kind='live' and not exists(select 1 from public.live_sessions l where l.id=n.target_id and l.status='live'))
 or (n.kind='events' and not exists(select 1 from public.circle_events e where e.id=n.target_id and e.starts_at>now()))
 or (n.circle_id is not null and not private.is_circle_member(n.circle_id,n.user_id))
 or exists(select 1 from public.circle_notification_preferences cp where cp.user_id=n.user_id and cp.circle_id=n.circle_id and not cp.enabled)
 or (n.kind='messages' and (not exists(select 1 from public.follows f where f.follower_id=n.user_id and f.followee_id=n.actor_id) or not exists(select 1 from public.follows f where f.follower_id=n.actor_id and f.followee_id=n.user_id))));
 with eligible as (
  select d.id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id join public.notification_preferences p on p.user_id=n.user_id
  where d.state in ('pending','processing') and d.available_at<=now() and d.attempts<5
  and (not p.quiet_enabled or p.quiet_start=p.quiet_end or not(case when p.quiet_start<p.quiet_end
   then (now() at time zone p.timezone)::time>=p.quiet_start and (now() at time zone p.timezone)::time<p.quiet_end
   else (now() at time zone p.timezone)::time>=p.quiet_start or (now() at time zone p.timezone)::time<p.quiet_end end))
  order by d.available_at,d.id limit 50 for update of d skip locked
 ), claimed as (
  update public.notification_deliveries d set state='processing',attempts=attempts+1,available_at=now()+interval '5 minutes' from eligible e where d.id=e.id returning d.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'token',d.token,'attempts',d.attempts,'notificationId',n.id,'title',n.title,'body',n.body)), '[]'::jsonb) into result from claimed d join public.notifications n on n.id=d.notification_id;
 return result;
end; $$;
create or replace function public.claim_notification_deliveries() returns jsonb language sql security invoker set search_path='' as $$ select private.claim_notification_deliveries(); $$;
revoke all on function private.claim_notification_deliveries() from public,anon,authenticated;
grant execute on function private.claim_notification_deliveries() to service_role;
revoke all on function public.claim_notification_deliveries() from public,anon,authenticated;
grant execute on function public.claim_notification_deliveries() to service_role;

create table private.runtime_settings(key text primary key,value text not null);
alter table private.runtime_settings enable row level security;
revoke all on private.runtime_settings from public,anon,authenticated;
insert into private.runtime_settings(key,value) values('dispatch_secret',gen_random_uuid()::text||gen_random_uuid()::text);
create or replace function private.authorize_notification_dispatch(provided_secret text) returns boolean language sql security definer set search_path='' as $$
 select provided_secret=(select value from private.runtime_settings where key='dispatch_secret');
$$;
create or replace function public.authorize_notification_dispatch(provided_secret text) returns boolean language sql security invoker set search_path='' as $$ select private.authorize_notification_dispatch(provided_secret); $$;
revoke all on function private.authorize_notification_dispatch(text) from public,anon,authenticated;
grant execute on function private.authorize_notification_dispatch(text) to service_role;
revoke all on function public.authorize_notification_dispatch(text) from public,anon,authenticated;
grant execute on function public.authorize_notification_dispatch(text) to service_role;
create or replace function private.enqueue_event_reminders() returns void language plpgsql security definer set search_path='' as $$
declare event_row record;
begin
 for event_row in select e.*,r.user_id from public.circle_events e join public.event_rsvps r on r.event_id=e.id where e.starts_at>now() and e.starts_at<=now()+interval '15 minutes' and private.is_circle_member(e.circle_id,r.user_id) loop
  perform private.notify_member(event_row.user_id,case when event_row.user_id=event_row.creator_id then null else event_row.creator_id end,'events',event_row.circle_id,event_row.id,'Your event starts soon','An event you joined starts in the next 15 minutes.','reminder:'||event_row.id);
 end loop;
end; $$;
revoke all on function private.enqueue_event_reminders() from public,anon,authenticated;
-- runtime-schedule:start
create extension if not exists pg_net with schema extensions;
create or replace function private.dispatch_notifications() returns void language plpgsql security definer set search_path='' as $$
declare endpoint text; secret text;
begin
 perform private.enqueue_event_reminders();
 select value into endpoint from private.runtime_settings where key='dispatch_url';
 select value into secret from private.runtime_settings where key='dispatch_secret';
 if endpoint is not null then
  perform net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-dispatch-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=10000);
 end if;
end; $$;
revoke all on function private.dispatch_notifications() from public,anon,authenticated;
select cron.schedule('circles-dispatch-notifications','* * * * *','select private.dispatch_notifications();');
-- runtime-schedule:end

-- Combine member and moderator storage reads into one policy to avoid permissive-policy duplication.
drop policy "Members read media for posts they can read" on storage.objects;
create policy "Members read media for posts they can read" on storage.objects for select to authenticated using(
 bucket_id='avatars' or bucket_id='post-media' and (
  exists(select 1 from public.posts p where p.id::text=(storage.foldername(name))[2] and private.is_circle_member(p.circle_id,(select auth.uid())) and ((p.visibility='published' and not private.are_blocked((select auth.uid()),p.author_id)) or (p.visibility='removed' and p.author_id=(select auth.uid()))))
  or ((select private.is_moderator()) and exists(select 1 from public.reports r where r.target_type='post' and r.target_id::text=(storage.foldername(name))[2] and r.status in ('open','reviewing')))
 )
);
