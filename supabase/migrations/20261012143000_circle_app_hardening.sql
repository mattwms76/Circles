-- Keep a live room only while its host is still sending heartbeats.
create extension if not exists pg_cron with schema pg_catalog;

alter table public.live_sessions
  add column if not exists host_heartbeat_at timestamptz not null default now();

create index if not exists blocks_blocked_id_idx on public.blocks (blocked_id);
create index if not exists circle_memberships_user_id_idx on public.circle_memberships (user_id);
create index if not exists circles_owner_id_idx on public.circles (owner_id);
create index if not exists follows_followee_id_idx on public.follows (followee_id);
create index if not exists live_gifts_gift_id_idx on public.live_gifts (gift_id);
create index if not exists live_gifts_recipient_id_idx on public.live_gifts (recipient_id);
create index if not exists live_seat_requests_requester_id_idx on public.live_seat_requests (requester_id);
create index if not exists live_seats_user_id_idx on public.live_seats (user_id);
create index if not exists live_sessions_circle_id_idx on public.live_sessions (circle_id);
create index if not exists live_sessions_host_id_idx on public.live_sessions (host_id);
create index if not exists live_sessions_active_heartbeat_idx on public.live_sessions (host_heartbeat_at desc) where status = 'live';
create index if not exists post_comments_author_id_idx on public.post_comments (author_id);
create index if not exists post_likes_user_id_idx on public.post_likes (user_id);
create index if not exists post_media_owner_id_idx on public.post_media (owner_id);
create index if not exists post_media_post_id_idx on public.post_media (post_id);
create index if not exists posts_author_id_idx on public.posts (author_id);
create index if not exists reports_reporter_id_idx on public.reports (reporter_id);

drop policy if exists "Members manage their own follows" on public.follows;
drop policy if exists "Members remove follows for blocked users" on public.follows;
drop policy if exists "Members see follows" on public.follows;
create policy "Members see follows" on public.follows
  for select to authenticated using (true);
create policy "Members add their own follows" on public.follows
  for insert to authenticated
  with check (follower_id = (select auth.uid()) and not private.are_blocked((select auth.uid()), followee_id));
create policy "Members remove own or blocked follows" on public.follows
  for delete to authenticated
  using (follower_id = (select auth.uid()) or (followee_id = (select auth.uid()) and private.are_blocked((select auth.uid()), follower_id)));
revoke update on public.follows from authenticated;

drop policy if exists "Members add or remove their own likes" on public.post_likes;
drop policy if exists "Members read likes for visible posts" on public.post_likes;
create policy "Members read likes for visible posts" on public.post_likes
  for select to authenticated using (exists (select 1 from public.posts p where p.id = post_id));
create policy "Members add their own likes" on public.post_likes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.posts p where p.id = post_id));
create policy "Members remove their own likes" on public.post_likes
  for delete to authenticated using (user_id = (select auth.uid()));
revoke update on public.post_likes from authenticated;

update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm']
where id = 'post-media';

create or replace function private.heartbeat_live_session(target_session_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare heartbeat_at timestamptz;
begin
  update public.live_sessions set host_heartbeat_at = now()
  where id = target_session_id and host_id = (select auth.uid()) and status = 'live'
  returning host_heartbeat_at into heartbeat_at;
  if heartbeat_at is null then raise exception 'Live room not found or you are not the host'; end if;
  return heartbeat_at;
end;
$$;
create or replace function public.heartbeat_live_session(target_session_id uuid)
returns timestamptz language sql security invoker set search_path = '' as $$
  select private.heartbeat_live_session(target_session_id);
$$;
revoke all on function private.heartbeat_live_session(uuid), public.heartbeat_live_session(uuid) from public, anon;
grant execute on function public.heartbeat_live_session(uuid) to authenticated;

create or replace function private.expire_stale_live_sessions()
returns integer language plpgsql security definer set search_path = '' as $$
declare expired integer;
begin
  update public.live_sessions
  set status = 'ended', ended_at = now()
  where status = 'live' and host_heartbeat_at < now() - interval '60 seconds';
  get diagnostics expired = row_count;
  return expired;
end;
$$;
revoke all on function private.expire_stale_live_sessions() from public, anon, authenticated;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'circles-expire-stale-live-sessions';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule('circles-expire-stale-live-sessions', '* * * * *', 'select private.expire_stale_live_sessions();');
end;
$$;

update public.circles c
set members_count = coalesce(m.member_count, 0)
from (
  select circle_id, count(*)::integer as member_count
  from public.circle_memberships where status = 'member' group by circle_id
) m
where c.id = m.circle_id;
update public.circles c set members_count = 0
where not exists (select 1 from public.circle_memberships m where m.circle_id = c.id and m.status = 'member');
