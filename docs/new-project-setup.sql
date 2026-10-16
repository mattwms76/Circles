
-- Source: setup.sql
-- Circles database bootstrap. Apply through the Supabase SQL Editor after creating a project.
-- Public tables use RLS. Privileged transactions live in the non-exposed `private` schema.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create type public.circle_member_status as enum ('pending', 'member', 'declined');
create type public.live_status as enum ('live', 'ended');
create type public.live_seat_role as enum ('host', 'cohost');
create type public.live_request_status as enum ('pending', 'accepted', 'declined', 'cancelled');
create type public.gift_tier as enum ('tiny', 'small', 'medium', 'large', 'legendary');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  handle text not null unique,
  display_name text not null default 'New member',
  avatar_url text,
  bio text not null default '',
  interests text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references public.profiles(id) on delete set null,
  name text not null check (char_length(name) between 2 and 48),
  description text not null default '',
  interest text not null,
  is_private boolean not null default false,
  members_count integer not null default 0 check (members_count >= 0),
  cover_url text,
  cover_color text not null default '#E7E2F4',
  created_at timestamptz not null default now()
);

create table public.circle_memberships (
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status public.circle_member_status not null,
  role text not null default 'member' check (role in ('owner', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 5000),
  visibility text not null default 'published' check (visibility in ('published', 'removed')),
  created_at timestamptz not null default now(),
  check (char_length(body) > 0 or id is not null)
);

create table public.post_media (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('image', 'gif', 'video')),
  storage_path text not null unique,
  mime_type text not null,
  created_at timestamptz not null default now()
);

create table public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index post_comments_post_created_idx on public.post_comments (post_id, created_at);

create table public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create table public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);

create table public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'profile', 'circle', 'message', 'live_session')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 3 and 1000),
  status text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);

create table public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  circle_id uuid references public.circles(id) on delete set null,
  title text not null check (char_length(title) between 2 and 120),
  status public.live_status not null default 'live',
  viewer_count integer not null default 0 check (viewer_count >= 0),
  host_heartbeat_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table public.live_seats (
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.live_seat_role not null,
  joined_at timestamptz not null default now(),
  primary key (session_id, user_id)
);

create table public.live_seat_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  status public.live_request_status not null default 'pending',
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  unique (session_id, requester_id)
);

create table public.gifts (
  id text primary key,
  name text not null,
  emoji text not null,
  coin_value integer not null check (coin_value > 0),
  tier public.gift_tier not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.coin_wallets (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table public.coin_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  delta bigint not null check (delta <> 0),
  reason text not null check (reason in ('purchase', 'gift_sent', 'adjustment')),
  reference text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create table public.live_gifts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.live_sessions(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  gift_id text not null references public.gifts(id),
  coin_value integer not null check (coin_value > 0),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (sender_id, idempotency_key)
);

create table public.coin_packs (
  id text primary key,
  coin_amount integer not null check (coin_amount > 0),
  is_active boolean not null default true
);

create or replace function private.is_circle_member(target_circle_id uuid, target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.circle_memberships m where m.circle_id = target_circle_id and m.user_id = target_user_id and m.status = 'member');
$$;
create or replace function private.is_circle_owner(target_circle_id uuid, target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.circles c where c.id = target_circle_id and c.owner_id = target_user_id);
$$;
create or replace function private.is_public_circle(target_circle_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.circles c where c.id = target_circle_id and not c.is_private);
$$;
create or replace function private.are_blocked(first_user_id uuid, second_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks b where (b.blocker_id = first_user_id and b.blocked_id = second_user_id) or (b.blocker_id = second_user_id and b.blocked_id = first_user_id));
$$;
create or replace function private.can_view_live_session(target_session_id uuid, target_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.live_sessions s where s.id = target_session_id and s.status = 'live'
      and (s.host_id = target_user_id or s.circle_id is null or private.is_public_circle(s.circle_id) or private.is_circle_member(s.circle_id, target_user_id))
      and (s.host_id = target_user_id or not private.are_blocked(target_user_id, s.host_id))
  );
$$;
revoke all on function private.is_circle_member(uuid, uuid), private.is_circle_owner(uuid, uuid), private.is_public_circle(uuid), private.are_blocked(uuid, uuid), private.can_view_live_session(uuid, uuid) from public, anon;
grant execute on function private.is_circle_member(uuid, uuid), private.is_circle_owner(uuid, uuid), private.is_public_circle(uuid), private.are_blocked(uuid, uuid), private.can_view_live_session(uuid, uuid) to authenticated;

create index circles_public_discovery on public.circles (is_private, members_count desc);
create index posts_feed on public.posts (circle_id, created_at desc) where visibility = 'published';
create index direct_messages_thread on public.direct_messages (sender_id, recipient_id, created_at desc);
create index direct_messages_unread on public.direct_messages (recipient_id, sender_id, read_at) where read_at is null;
create index live_sessions_discovery on public.live_sessions (status, started_at desc);
create index live_requests_host_queue on public.live_seat_requests (session_id, status, created_at);
create index live_gifts_session on public.live_gifts (session_id, created_at desc);
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
create index if not exists post_comments_author_id_idx on public.post_comments (author_id);
create index if not exists post_likes_user_id_idx on public.post_likes (user_id);
create index if not exists post_media_owner_id_idx on public.post_media (owner_id);
create index if not exists post_media_post_id_idx on public.post_media (post_id);
create index if not exists posts_author_id_idx on public.posts (author_id);
create index if not exists reports_reporter_id_idx on public.reports (reporter_id);

create or replace function private.bootstrap_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen_handle text;
begin
  chosen_handle := lower(regexp_replace(coalesce(new.raw_user_meta_data ->> 'handle', split_part(coalesce(new.email, 'member'), '@', 1)), '[^a-zA-Z0-9_]', '', 'g'));
  if chosen_handle = '' then chosen_handle := 'member'; end if;
  insert into public.profiles (id, handle, display_name)
  values (new.id, chosen_handle || '_' || left(replace(new.id::text, '-', ''), 6), coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'New member'))
  on conflict (id) do nothing;
  insert into public.coin_wallets (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.bootstrap_profile();

create or replace function private.sync_circle_member_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'member' then
    update public.circles set members_count = members_count + 1 where id = new.circle_id;
  elsif tg_op = 'DELETE' and old.status = 'member' then
    update public.circles set members_count = greatest(members_count - 1, 0) where id = old.circle_id;
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'member' then update public.circles set members_count = members_count + 1 where id = new.circle_id; end if;
    if old.status = 'member' then update public.circles set members_count = greatest(members_count - 1, 0) where id = old.circle_id; end if;
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;
create trigger sync_circle_member_count
after insert or update or delete on public.circle_memberships
for each row execute function private.sync_circle_member_count();

create or replace function private.add_circle_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.owner_id is not null then
    insert into public.circle_memberships (circle_id, user_id, status, role)
    values (new.id, new.owner_id, 'member', 'owner')
    on conflict (circle_id, user_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger add_circle_owner_membership
after insert on public.circles
for each row execute function private.add_circle_owner_membership();

revoke all on function private.bootstrap_profile(), private.sync_circle_member_count(), private.add_circle_owner_membership() from public, anon, authenticated;

alter table public.profiles enable row level security;
alter table public.circles enable row level security;
alter table public.circle_memberships enable row level security;
alter table public.posts enable row level security;
alter table public.post_media enable row level security;
alter table public.post_likes enable row level security;
alter table public.post_comments enable row level security;
alter table public.follows enable row level security;
alter table public.direct_messages enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.live_sessions enable row level security;
alter table public.live_seats enable row level security;
alter table public.live_seat_requests enable row level security;
alter table public.gifts enable row level security;
alter table public.coin_wallets enable row level security;
alter table public.coin_ledger enable row level security;
alter table public.live_gifts enable row level security;
alter table public.coin_packs enable row level security;

create policy "Profiles are visible to signed in members" on public.profiles for select to authenticated using (true);
create policy "Members update their own profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Circle metadata is discoverable so users can request access; posts and media remain member-only.
create policy "Signed in members can discover circle listings" on public.circles for select to authenticated using (true);
create policy "Signed in members create circles for themselves" on public.circles for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Circle owners update their circles" on public.circles for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
revoke update on public.circles from authenticated;
grant update (name, description, interest, is_private, cover_url, cover_color) on public.circles to authenticated;
create policy "Members read their membership and owners read requests" on public.circle_memberships for select to authenticated using (
  user_id = (select auth.uid()) or private.is_circle_owner(circle_id, (select auth.uid()))
);
create policy "Join public circles or request private access" on public.circle_memberships for insert to authenticated with check (
  user_id = (select auth.uid()) and (private.is_public_circle(circle_id) or status = 'pending')
);
create policy "Circle owners decide membership requests" on public.circle_memberships for update to authenticated using (
  private.is_circle_owner(circle_id, (select auth.uid()))
) with check (status in ('member', 'declined') and private.is_circle_owner(circle_id, (select auth.uid())));
create policy "Members leave their own circles" on public.circle_memberships for delete to authenticated using (
  user_id = (select auth.uid()) and role <> 'owner'
);
create policy "Joined members read published circle posts" on public.posts for select to authenticated using (
  private.is_circle_member(circle_id, (select auth.uid())) and (
    (visibility = 'published' and not private.are_blocked((select auth.uid()), author_id))
    or (visibility = 'removed' and author_id = (select auth.uid()))
  )
);
create policy "Joined members create their own posts" on public.posts for insert to authenticated with check (
  author_id = (select auth.uid()) and exists (select 1 from public.circle_memberships m where m.circle_id = posts.circle_id and m.user_id = (select auth.uid()) and m.status = 'member')
);
create policy "Authors remove their posts" on public.posts for update to authenticated using (author_id = (select auth.uid())) with check (
  author_id = (select auth.uid()) and exists (select 1 from public.circle_memberships m where m.circle_id = posts.circle_id and m.user_id = (select auth.uid()) and m.status = 'member')
);
create policy "Post media follows post visibility" on public.post_media for select to authenticated using (exists (select 1 from public.posts p where p.id = post_id));
create policy "Authors register media for their own posts" on public.post_media for insert to authenticated with check (owner_id = (select auth.uid()) and exists (select 1 from public.posts p where p.id = post_id and p.author_id = (select auth.uid())));
create policy "Members read likes for visible posts" on public.post_likes for select to authenticated using (exists (select 1 from public.posts p where p.id = post_id));
create policy "Members add their own likes" on public.post_likes for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.posts p where p.id = post_id));
create policy "Members remove their own likes" on public.post_likes for delete to authenticated using (user_id = (select auth.uid()));
create policy "Circle members read comments on visible posts" on public.post_comments for select to authenticated using (
  exists (select 1 from public.posts p join public.circle_memberships m on m.circle_id = p.circle_id
    where p.id = post_id and p.visibility = 'published' and m.user_id = (select auth.uid()) and m.status = 'member')
  and not private.are_blocked((select auth.uid()), author_id)
);
create policy "Circle members write their own comments" on public.post_comments for insert to authenticated with check (
  author_id = (select auth.uid()) and exists (select 1 from public.posts p join public.circle_memberships m on m.circle_id = p.circle_id
    where p.id = post_id and p.visibility = 'published' and m.user_id = (select auth.uid()) and m.status = 'member')
  and not private.are_blocked((select auth.uid()), author_id)
);
create policy "Members see follows" on public.follows for select to authenticated using (true);
create policy "Members insert their own follows" on public.follows for insert to authenticated with check (follower_id = (select auth.uid()) and not private.are_blocked((select auth.uid()), followee_id));
create policy "Members delete permitted follows" on public.follows for delete to authenticated using (
  follower_id = (select auth.uid()) or (followee_id = (select auth.uid()) and private.are_blocked((select auth.uid()), follower_id))
);
create policy "Mutual followers see their messages" on public.direct_messages for select to authenticated using (
  (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
  and exists (select 1 from public.follows a join public.follows b on b.follower_id = a.followee_id and b.followee_id = a.follower_id where a.follower_id = sender_id and a.followee_id = recipient_id)
  and not private.are_blocked(sender_id, recipient_id)
);
create policy "Mutual followers send their own messages" on public.direct_messages for insert to authenticated with check (
  sender_id = (select auth.uid())
  and exists (select 1 from public.follows a join public.follows b on b.follower_id = a.followee_id and b.followee_id = a.follower_id where a.follower_id = sender_id and a.followee_id = recipient_id)
  and not private.are_blocked(sender_id, recipient_id)
);
create policy "Recipients mark mutual messages as read" on public.direct_messages for update to authenticated using (
  recipient_id = (select auth.uid())
  and exists (select 1 from public.follows a join public.follows b on b.follower_id = a.followee_id and b.followee_id = a.follower_id where a.follower_id = sender_id and a.followee_id = recipient_id)
  and not private.are_blocked(sender_id, recipient_id)
) with check (
  recipient_id = (select auth.uid())
  and exists (select 1 from public.follows a join public.follows b on b.follower_id = a.followee_id and b.followee_id = a.follower_id where a.follower_id = sender_id and a.followee_id = recipient_id)
  and not private.are_blocked(sender_id, recipient_id)
);
create policy "Members manage blocks they created" on public.blocks for all to authenticated using (blocker_id = (select auth.uid())) with check (blocker_id = (select auth.uid()));
create policy "Members file reports" on public.reports for insert to authenticated with check (reporter_id = (select auth.uid()) and status = 'open');
create policy "Members read their reports" on public.reports for select to authenticated using (reporter_id = (select auth.uid()));
create policy "Members see live rooms they can access" on public.live_sessions for select to authenticated using (host_id = (select auth.uid()) or private.can_view_live_session(id, (select auth.uid())));
create policy "Members read visible live seats" on public.live_seats for select to authenticated using (private.can_view_live_session(session_id, (select auth.uid())) or exists (select 1 from public.live_sessions s where s.id = session_id and s.host_id = (select auth.uid())));
create policy "Members read their requests and hosts read their queues" on public.live_seat_requests for select to authenticated using (requester_id = (select auth.uid()) or exists (select 1 from public.live_sessions s where s.id = session_id and s.host_id = (select auth.uid())));
create policy "Members see active gifts" on public.gifts for select to authenticated using (is_active);
create policy "Members read their wallet" on public.coin_wallets for select to authenticated using (user_id = (select auth.uid()));
create policy "Members read their ledger" on public.coin_ledger for select to authenticated using (user_id = (select auth.uid()));
create policy "Participants see gifts in visible live rooms" on public.live_gifts for select to authenticated using (private.can_view_live_session(session_id, (select auth.uid())));
create policy "Anyone signed in sees active coin packs" on public.coin_packs for select to authenticated using (is_active);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('post-media', 'post-media', false, 26214400, array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','video/webm'])
on conflict (id) do nothing;

create policy "Members upload media into their own post folder" on storage.objects for insert to authenticated with check (
  bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text and exists (
    select 1 from public.posts p where p.id::text = (storage.foldername(name))[2] and p.author_id = (select auth.uid())
  )
);
create policy "Members read media for posts they can read" on storage.objects for select to authenticated using (
  bucket_id = 'post-media' and exists (
    select 1 from public.posts p
    where p.id::text = (storage.foldername(name))[2]
      and private.is_circle_member(p.circle_id, (select auth.uid()))
      and (
        (p.visibility = 'published' and not private.are_blocked((select auth.uid()), p.author_id))
        or (p.visibility = 'removed' and p.author_id = (select auth.uid()))
      )
  )
);
create policy "Authors delete their media" on storage.objects for delete to authenticated using (
  bucket_id = 'post-media' and (storage.foldername(name))[1] = (select auth.uid())::text
);

create or replace function private.request_circle_membership(target_circle_id uuid)
returns public.circle_member_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  requesting_user uuid := auth.uid();
  private_circle boolean;
  result_status public.circle_member_status;
begin
  if requesting_user is null then raise exception 'Sign in required'; end if;
  select c.is_private into private_circle from public.circles c where c.id = target_circle_id;
  if private_circle is null then raise exception 'Circle not found'; end if;
  if exists (select 1 from public.circle_memberships m where m.circle_id = target_circle_id and m.user_id = requesting_user and m.status = 'member') then
    return 'member'::public.circle_member_status;
  end if;
  result_status := case when private_circle then 'pending'::public.circle_member_status else 'member'::public.circle_member_status end;
  insert into public.circle_memberships (circle_id, user_id, status)
  values (target_circle_id, requesting_user, result_status)
  on conflict (circle_id, user_id) do update set status = excluded.status, joined_at = now();
  return result_status;
end;
$$;

create or replace function public.request_circle_membership(target_circle_id uuid)
returns public.circle_member_status
language sql
security invoker
set search_path = ''
as $$ select private.request_circle_membership(target_circle_id); $$;
revoke all on function private.request_circle_membership(uuid) from public, anon;
grant execute on function private.request_circle_membership(uuid) to authenticated;
revoke all on function public.request_circle_membership(uuid) from public, anon;
grant execute on function public.request_circle_membership(uuid) to authenticated;

create or replace function public.leave_circle(target_circle_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  leaving_user uuid := (select auth.uid());
  membership_status public.circle_member_status;
begin
  if leaving_user is null then raise exception 'Sign in required'; end if;
  if private.is_circle_owner(target_circle_id, leaving_user) then
    raise exception 'Circle owners cannot leave while they own the circle';
  end if;
  -- DELETE locks the row itself and uses the member's DELETE policy. FOR UPDATE
  -- would instead require the owners-only UPDATE policy and hide ordinary members.
  delete from public.circle_memberships
    where circle_id = target_circle_id and user_id = leaving_user and role <> 'owner'
    returning status into membership_status;
  if not found then return 'not_member'; end if;
  return case when membership_status = 'pending' then 'request_cancelled' else 'left' end;
end;
$$;
revoke all on function public.leave_circle(uuid) from public, anon;
grant execute on function public.leave_circle(uuid) to authenticated;

create or replace function private.start_live_session(session_title text, target_circle_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  host_user uuid := auth.uid();
  new_session_id uuid;
begin
  if host_user is null then raise exception 'Sign in required'; end if;
  if target_circle_id is not null and not exists (select 1 from public.circle_memberships m where m.circle_id = target_circle_id and m.user_id = host_user and m.status = 'member') then raise exception 'Join the circle before streaming to it'; end if;
  insert into public.live_sessions (host_id, circle_id, title) values (host_user, target_circle_id, session_title) returning id into new_session_id;
  insert into public.live_seats (session_id, user_id, role) values (new_session_id, host_user, 'host');
  return new_session_id;
end;
$$;
create or replace function public.start_live_session(session_title text, target_circle_id uuid default null)
returns uuid language sql security invoker set search_path = '' as $$ select private.start_live_session(session_title, target_circle_id); $$;
revoke all on function private.start_live_session(text, uuid) from public, anon;
grant execute on function private.start_live_session(text, uuid) to authenticated;
revoke all on function public.start_live_session(text, uuid) from public, anon;
grant execute on function public.start_live_session(text, uuid) to authenticated;

create or replace function private.end_live_session(target_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.live_sessions set status = 'ended', ended_at = now()
  where id = target_session_id and host_id = auth.uid() and status = 'live';
  if not found then raise exception 'Live room not found or you are not the host'; end if;
end;
$$;
create or replace function public.end_live_session(target_session_id uuid)
returns void language sql security invoker set search_path = '' as $$ select private.end_live_session(target_session_id); $$;
revoke all on function private.end_live_session(uuid) from public, anon;
grant execute on function private.end_live_session(uuid) to authenticated;
revoke all on function public.end_live_session(uuid) from public, anon;
grant execute on function public.end_live_session(uuid) to authenticated;

create or replace function private.heartbeat_live_session(target_session_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare heartbeat_at timestamptz;
begin
  update public.live_sessions set host_heartbeat_at = now()
  where id = target_session_id and host_id = auth.uid() and status = 'live'
  returning host_heartbeat_at into heartbeat_at;
  if heartbeat_at is null then raise exception 'Live room not found or you are not the host'; end if;
  return heartbeat_at;
end;
$$;
create or replace function public.heartbeat_live_session(target_session_id uuid)
returns timestamptz language sql security invoker set search_path = '' as $$ select private.heartbeat_live_session(target_session_id); $$;
revoke all on function private.heartbeat_live_session(uuid), public.heartbeat_live_session(uuid) from public, anon;
grant execute on function private.heartbeat_live_session(uuid), public.heartbeat_live_session(uuid) to authenticated;

create or replace function private.expire_stale_live_sessions()
returns integer language plpgsql security definer set search_path = '' as $$
declare expired_count integer;
begin
  update public.live_sessions set status = 'ended', ended_at = now()
  where status = 'live' and host_heartbeat_at < now() - interval '60 seconds';
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;
revoke all on function private.expire_stale_live_sessions() from public, anon, authenticated;

do $$
declare existing_job record;
begin
  for existing_job in select jobid from cron.job where jobname = 'circles-expire-stale-live-sessions' loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
  perform cron.schedule('circles-expire-stale-live-sessions', '* * * * *', 'select private.expire_stale_live_sessions();');
end;
$$;

create or replace function private.request_live_seat(target_session_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare requesting_user uuid := auth.uid(); request_id uuid;
begin
  if requesting_user is null then raise exception 'Sign in required'; end if;
  if not private.can_view_live_session(target_session_id, requesting_user) then raise exception 'Live room is no longer available'; end if;
  if exists (select 1 from public.live_seats seat where seat.session_id = target_session_id and seat.user_id = requesting_user) then raise exception 'You are already on stage'; end if;
  insert into public.live_seat_requests (session_id, requester_id, status) values (target_session_id, requesting_user, 'pending')
  on conflict (session_id, requester_id) do update set status = 'pending', created_at = now() returning id into request_id;
  return request_id;
end;
$$;
create or replace function public.request_live_seat(target_session_id uuid)
returns uuid language sql security invoker set search_path = '' as $$ select private.request_live_seat(target_session_id); $$;
revoke all on function private.request_live_seat(uuid) from public, anon;
grant execute on function private.request_live_seat(uuid) to authenticated;
revoke all on function public.request_live_seat(uuid) from public, anon;
grant execute on function public.request_live_seat(uuid) to authenticated;

create or replace function private.decide_live_seat_request(target_request_id uuid, accept_request boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare req public.live_seat_requests%rowtype; host_user uuid := auth.uid();
begin
  select r.* into req from public.live_seat_requests r where r.id = target_request_id for update;
  if req.id is null then raise exception 'Request not found'; end if;
  perform 1 from public.live_sessions s where s.id = req.session_id and s.host_id = host_user and s.status = 'live' for update;
  if not found then raise exception 'Only the host can decide this request'; end if;
  if req.status <> 'pending' then raise exception 'Request is no longer pending'; end if;
  if accept_request then
    if (select count(*) from public.live_seats where session_id = req.session_id) >= 4 then raise exception 'The stage is full'; end if;
    if not private.can_view_live_session(req.session_id, req.requester_id) then raise exception 'This member cannot access the private live room'; end if;
    insert into public.live_seats (session_id, user_id, role) values (req.session_id, req.requester_id, 'cohost') on conflict do nothing;
    update public.live_seat_requests set status = 'accepted', decided_at = now() where id = req.id;
  else
    update public.live_seat_requests set status = 'declined', decided_at = now() where id = req.id;
  end if;
end;
$$;
create or replace function public.decide_live_seat_request(target_request_id uuid, accept_request boolean)
returns void language sql security invoker set search_path = '' as $$ select private.decide_live_seat_request(target_request_id, accept_request); $$;
revoke all on function private.decide_live_seat_request(uuid, boolean) from public, anon;
grant execute on function private.decide_live_seat_request(uuid, boolean) to authenticated;
revoke all on function public.decide_live_seat_request(uuid, boolean) from public, anon;
grant execute on function public.decide_live_seat_request(uuid, boolean) to authenticated;

create or replace function private.send_live_gift(target_session_id uuid, target_gift_id text, idempotency_key text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare sender uuid := auth.uid(); recipient uuid; cost integer; current_balance bigint;
begin
  if sender is null then raise exception 'Sign in required'; end if;
  select s.host_id into recipient from public.live_sessions s where s.id = target_session_id and private.can_view_live_session(s.id, sender);
  if recipient is null then raise exception 'Live room has ended'; end if;
  select g.coin_value into cost from public.gifts g where g.id = target_gift_id and g.is_active;
  if cost is null then raise exception 'Gift is unavailable'; end if;
  insert into public.coin_wallets (user_id) values (sender) on conflict (user_id) do nothing;
  select w.balance into current_balance from public.coin_wallets w where w.user_id = sender for update;
  -- Serialize retries for the same wallet before checking the deduplication key.
  if exists (select 1 from public.live_gifts where sender_id = sender and live_gifts.idempotency_key = send_live_gift.idempotency_key) then
    return current_balance;
  end if;
  if current_balance is null or current_balance < cost then raise exception 'Not enough coins'; end if;
  update public.coin_wallets set balance = balance - cost, updated_at = now() where user_id = sender returning balance into current_balance;
  insert into public.coin_ledger (user_id, delta, reason, reference, idempotency_key) values (sender, -cost, 'gift_sent', target_session_id::text, 'gift:' || idempotency_key);
  insert into public.live_gifts (session_id, sender_id, recipient_id, gift_id, coin_value, idempotency_key) values (target_session_id, sender, recipient, target_gift_id, cost, idempotency_key);
  return current_balance;
end;
$$;
create or replace function public.send_live_gift(target_session_id uuid, target_gift_id text, idempotency_key text)
returns bigint language sql security invoker set search_path = '' as $$ select private.send_live_gift(target_session_id, target_gift_id, idempotency_key); $$;
revoke all on function private.send_live_gift(uuid, text, text) from public, anon;
grant execute on function private.send_live_gift(uuid, text, text) to authenticated;
revoke all on function public.send_live_gift(uuid, text, text) from public, anon;
grant execute on function public.send_live_gift(uuid, text, text) to authenticated;

create or replace function public.send_direct_message(recipient_user_id uuid, message_body text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare new_message_id uuid; sender uuid := auth.uid();
begin
  if sender is null then raise exception 'Sign in required'; end if;
  if not exists (select 1 from public.follows a join public.follows b on b.follower_id = a.followee_id and b.followee_id = a.follower_id where a.follower_id = sender and a.followee_id = recipient_user_id) then raise exception 'You can message each other after you follow one another'; end if;
  if exists (select 1 from public.blocks bl where (bl.blocker_id = sender and bl.blocked_id = recipient_user_id) or (bl.blocker_id = recipient_user_id and bl.blocked_id = sender)) then raise exception 'Messaging is unavailable'; end if;
  insert into public.direct_messages (sender_id, recipient_id, body) values (sender, recipient_user_id, message_body) returning id into new_message_id;
  return new_message_id;
end;
$$;
revoke all on function public.send_direct_message(uuid, text) from public, anon;
grant execute on function public.send_direct_message(uuid, text) to authenticated;

create or replace function public.list_mutual_conversations()
returns table (conversation_id text, peer jsonb, unread_count integer, last_message jsonb)
language sql
security invoker
set search_path = ''
as $$
  select least((select auth.uid()), p.id)::text || ':' || greatest((select auth.uid()), p.id)::text,
    to_jsonb(p), (select count(*)::integer from public.direct_messages unread where unread.sender_id = p.id and unread.recipient_id = (select auth.uid()) and unread.read_at is null),
    (select jsonb_build_object('id', d.id, 'sender_id', d.sender_id, 'body', d.body, 'created_at', d.created_at) from public.direct_messages d
      where (d.sender_id = (select auth.uid()) and d.recipient_id = p.id) or (d.sender_id = p.id and d.recipient_id = (select auth.uid())) order by d.created_at desc limit 1)
  from public.profiles p
  where p.id <> (select auth.uid())
    and exists (select 1 from public.follows a join public.follows b on b.follower_id = a.followee_id and b.followee_id = a.follower_id where a.follower_id = (select auth.uid()) and a.followee_id = p.id)
    and not private.are_blocked((select auth.uid()), p.id)
  order by p.display_name;
$$;
revoke all on function public.list_mutual_conversations() from public, anon;
grant execute on function public.list_mutual_conversations() to authenticated;

create or replace function public.mark_conversation_read(peer_user_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare updated_count integer;
begin
  if peer_user_id = (select auth.uid())
    or not exists (select 1 from public.follows a join public.follows b on b.follower_id = a.followee_id and b.followee_id = a.follower_id where a.follower_id = (select auth.uid()) and a.followee_id = peer_user_id)
    or private.are_blocked((select auth.uid()), peer_user_id) then
    raise exception 'You can only read messages from someone who follows you back';
  end if;
  update public.direct_messages set read_at = now()
    where sender_id = peer_user_id and recipient_id = (select auth.uid()) and read_at is null;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

create or replace function public.block_user(target_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare v_blocker_id uuid := (select auth.uid());
begin
  if v_blocker_id is null then raise exception 'Sign in to block people'; end if;
  if target_user_id is null or target_user_id = v_blocker_id then raise exception 'You cannot block this account'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (v_blocker_id, target_user_id)
    on conflict (blocker_id, blocked_id) do nothing;
  delete from public.follows
    where (follower_id = v_blocker_id and followee_id = target_user_id)
       or (follower_id = target_user_id and followee_id = v_blocker_id);
end;
$$;
revoke all on function public.block_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;

create or replace function public.credit_coin_purchase(p_user_id uuid, p_product_id text, p_transaction_id text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare amount integer; balance_after bigint;
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required';
  end if;
  select coin_amount into amount from public.coin_packs where id = p_product_id and is_active;
  if amount is null then raise exception 'Coin pack unavailable'; end if;
  insert into public.coin_wallets (user_id) values (p_user_id) on conflict (user_id) do nothing;
  perform 1 from public.coin_wallets where user_id = p_user_id for update;
  if exists (select 1 from public.coin_ledger where user_id = p_user_id and idempotency_key = 'purchase:' || p_transaction_id) then
    return (select balance from public.coin_wallets where user_id = p_user_id);
  end if;
  update public.coin_wallets set balance = balance + amount, updated_at = now() where user_id = p_user_id returning balance into balance_after;
  insert into public.coin_ledger (user_id, delta, reason, reference, idempotency_key) values (p_user_id, amount, 'purchase', p_product_id, 'purchase:' || p_transaction_id);
  return balance_after;
end;
$$;
revoke all on function public.credit_coin_purchase(uuid, text, text) from public, anon, authenticated;
grant execute on function public.credit_coin_purchase(uuid, text, text) to service_role;

insert into public.coin_packs (id, coin_amount) values
  ('com.circles.coins.120', 120), ('com.circles.coins.700', 700), ('com.circles.coins.1600', 1600)
on conflict (id) do nothing;

with gift_names as (
  select * from (values
    ('Petal','🌸'),('Cup of tea','🍵'),('Little star','⭐️'),('Peach','🍑'),('Warm bread','🍞'),('Daisy','🌼'),('Tiny heart','💛'),('Coffee date','☕️'),('Good luck charm','🍀'),('Sunshine','☀️'),
    ('Moonbeam','🌙'),('Fresh flowers','💐'),('Candlelight','🕯️'),('Bluebird','🐦'),('Sweet treat','🧁'),('Golden hour','🌅'),('Love note','💌'),('Vinyl spin','💿'),('Garden bouquet','💐'),('Shooting star','💫'),
    ('Picnic basket','🧺'),('Paper crane','🕊️'),('Little lantern','🏮'),('Lucky cat','🐈'),('Sea glass','🫧'),('Sunday cake','🍰'),('Big hug','🧸'),('Magic moment','✨'),('Golden ticket','🎟️'),('Whole sky','🌌')
  ) as t(name, emoji)
), gift_rows as (
  select n.name || ' ' || lpad((((series.idx - 1) / 30) + 1)::text, 2, '0') as name, n.emoji,
    case when series.idx <= 80 then 5 + ((series.idx - 1) % 8)
         when series.idx <= 160 then 25 + (((series.idx - 81) % 8) * 5)
         when series.idx <= 230 then 100 + (((series.idx - 161) % 7) * 20)
         when series.idx <= 280 then 500 + (((series.idx - 231) % 5) * 100)
         else 2000 + (((series.idx - 281) % 5) * 500) end as coin_value,
    case when series.idx <= 80 then 'tiny'::public.gift_tier when series.idx <= 160 then 'small'::public.gift_tier when series.idx <= 230 then 'medium'::public.gift_tier when series.idx <= 280 then 'large'::public.gift_tier else 'legendary'::public.gift_tier end as tier,
    series.idx
  from generate_series(1, 300) as series(idx)
  join gift_names n on ((series.idx - 1) % 30) + 1 = (select count(*) from gift_names n2 where n2.name <= n.name)
)
insert into public.gifts (id, name, emoji, coin_value, tier)
select 'gift-' || lpad(idx::text, 3, '0'), name, emoji, coin_value, tier from gift_rows
on conflict (id) do nothing;

insert into public.circles (id, name, description, interest, is_private, members_count, cover_url, cover_color)
values
  ('10000000-0000-4000-8000-000000000001','The Film Room','For people who love the feeling after the credits roll.','Film',false,0,'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=720&h=520&fit=crop','#E7D8CC'),
  ('10000000-0000-4000-8000-000000000002','Tiny Gardens','Small spaces, good soil, happy plants.','Gardening',false,0,'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=720&h=520&fit=crop','#DCE7D6'),
  ('10000000-0000-4000-8000-000000000003','Sunday Studio','A soft place to make things, share drafts, and start again.','Art',false,0,'https://images.unsplash.com/photo-1513364776144-60967b0f800f?w=720&h=520&fit=crop','#E5DFF1'),
  ('10000000-0000-4000-8000-000000000004','Kitchen Table Club','Recipes that feel like someone saved you a seat.','Cooking',false,0,'https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=720&h=520&fit=crop','#F4E6C7'),
  ('10000000-0000-4000-8000-000000000005','Quiet Mornings','A private circle for slower starts and kinder plans.','Slow living',true,0,'https://images.unsplash.com/photo-1445116572660-236099ec97a0?w=720&h=520&fit=crop','#E7E9E1'),
  ('10000000-0000-4000-8000-000000000006','Soft Sounds','New records, old favourites, and what to play next.','Music',false,0,'https://images.unsplash.com/photo-1516280440614-37939bbacd81?w=720&h=520&fit=crop','#DDE7E8')
on conflict (id) do nothing;

update public.circles c set members_count = (
  select count(*)::integer from public.circle_memberships m where m.circle_id = c.id and m.status = 'member'
);

grant usage on schema public to authenticated;
grant select on public.profiles, public.circles, public.circle_memberships, public.posts, public.post_media, public.post_likes, public.post_comments, public.follows, public.direct_messages, public.blocks, public.reports, public.live_sessions, public.live_seats, public.live_seat_requests, public.gifts, public.coin_wallets, public.coin_ledger, public.live_gifts, public.coin_packs to authenticated;
grant update on public.profiles, public.posts to authenticated;
-- A column grant does not override Supabase's existing table-level UPDATE grant.
revoke update on public.direct_messages from public, anon, authenticated;
revoke update (id, sender_id, recipient_id, body, created_at, read_at)
  on public.direct_messages from public, anon, authenticated;
grant update (read_at) on public.direct_messages to authenticated;
grant update (name, description, interest, is_private, cover_url, cover_color) on public.circles to authenticated;
grant update (status) on public.circle_memberships to authenticated;
grant delete on public.circle_memberships to authenticated;
grant insert (owner_id, name, description, interest, is_private) on public.circles to authenticated;
grant insert on public.posts, public.post_media, public.post_likes, public.post_comments, public.follows, public.direct_messages, public.blocks, public.reports to authenticated;
grant update on public.blocks to authenticated;
grant delete on public.post_likes, public.follows, public.blocks to authenticated;
grant execute on function public.send_direct_message(uuid, text), public.list_mutual_conversations(), public.mark_conversation_read(uuid) to authenticated;

alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.post_comments;
alter publication supabase_realtime add table public.circle_memberships;
alter publication supabase_realtime add table public.follows;
alter publication supabase_realtime add table public.direct_messages;
alter publication supabase_realtime add table public.live_sessions;
alter publication supabase_realtime add table public.live_seats;
alter publication supabase_realtime add table public.live_seat_requests;
alter publication supabase_realtime add table public.live_gifts;


-- Source: migrations/20261012145107_community_experience.sql
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


-- Source: migrations/20261012145255_community_foreign_key_indexes.sql
-- Cover account deletion and device lookup foreign keys found by the database advisor.
create index if not exists device_push_tokens_user on public.device_push_tokens(user_id);
create index if not exists moderation_actions_moderator on private.moderation_actions(moderator_id);
create index if not exists moderation_actions_report on private.moderation_actions(report_id);


-- Source: migrations/20261012155424_content_deletion_window.sql
-- A caller cannot supply a younger timestamp to extend the deletion window.
alter table public.direct_messages alter column created_at set default clock_timestamp();
alter table public.post_comments alter column created_at set default clock_timestamp();
revoke insert on public.direct_messages, public.post_comments from public, anon, authenticated;
revoke insert (created_at) on public.direct_messages, public.post_comments from public, anon, authenticated;
grant insert (sender_id, recipient_id, body) on public.direct_messages to authenticated;
grant insert (post_id, author_id, body) on public.post_comments to authenticated;

-- Existing SELECT policies still enforce mutual follows, blocks, and circle access.
grant delete on public.direct_messages, public.post_comments to authenticated;
drop policy if exists "Senders delete recent messages" on public.direct_messages;
create policy "Senders delete recent messages" on public.direct_messages
for delete to authenticated using (
  sender_id = (select auth.uid())
  and created_at <= clock_timestamp()
  and created_at > clock_timestamp() - interval '15 minutes'
);
drop policy if exists "Authors delete recent comments" on public.post_comments;
create policy "Authors delete recent comments" on public.post_comments
for delete to authenticated using (
  author_id = (select auth.uid())
  and created_at <= clock_timestamp()
  and created_at > clock_timestamp() - interval '15 minutes'
);

-- Recheck after acquiring the row lock, in case a blocked DELETE outlives its window.
-- Trusted moderation and account cleanup retain their existing unrestricted access.
create or replace function private.enforce_content_delete_window()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' and pg_trigger_depth() = 1 then
    if (select auth.uid()) is null
      or coalesce(to_jsonb(old)->>'sender_id', to_jsonb(old)->>'author_id') <> (select auth.uid())::text
      or old.created_at > clock_timestamp()
      or old.created_at <= clock_timestamp() - interval '15 minutes' then
      raise exception 'You can only delete your own content within 15 minutes of sending it.' using errcode = '42501';
    end if;
  end if;
  return old;
end;
$$;
revoke all on function private.enforce_content_delete_window() from public, anon, authenticated;
drop trigger if exists enforce_message_delete_window on public.direct_messages;
create trigger enforce_message_delete_window before delete on public.direct_messages
for each row execute function private.enforce_content_delete_window();
drop trigger if exists enforce_comment_delete_window on public.post_comments;
create trigger enforce_comment_delete_window before delete on public.post_comments
for each row execute function private.enforce_content_delete_window();

-- Remove activity and queued pushes for the deleted item, including the recipient's
-- notification. Only the trigger can call this cross-account cleanup function.
create or replace function private.remove_deleted_content_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications
  where dedupe_key = (case when tg_table_name = 'direct_messages' then 'message:' else 'reply:' end) || old.id::text;
  return old;
end;
$$;
revoke all on function private.remove_deleted_content_notification() from public, anon, authenticated;
drop trigger if exists remove_deleted_message_notification on public.direct_messages;
create trigger remove_deleted_message_notification after delete on public.direct_messages
for each row execute function private.remove_deleted_content_notification();
drop trigger if exists remove_deleted_comment_notification on public.post_comments;
create trigger remove_deleted_comment_notification after delete on public.post_comments
for each row execute function private.remove_deleted_content_notification();


-- Source: migrations/20261012163503_experience_enhancements.sql
-- Replies retain references, never copies of private/deleted message bodies.
alter table public.direct_messages add column reply_to_id uuid references public.direct_messages(id) on delete set null;
alter table public.post_comments add column reply_to_id uuid references public.post_comments(id) on delete set null;
create index direct_messages_reply on public.direct_messages(reply_to_id);
create index post_comments_reply on public.post_comments(reply_to_id);
grant insert(reply_to_id) on public.direct_messages, public.post_comments to authenticated;
create function private.validate_reply() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.reply_to_id is null then return new; end if;
 if tg_table_name='direct_messages' then
  if not exists(select 1 from public.direct_messages m where m.id=new.reply_to_id and
    ((m.sender_id=new.sender_id and m.recipient_id=new.recipient_id) or (m.sender_id=new.recipient_id and m.recipient_id=new.sender_id))) then
   raise exception 'Reply must reference an accessible message in this conversation' using errcode='42501';
  end if;
 else
  if not exists(select 1 from public.post_comments c where c.id=new.reply_to_id and c.post_id=new.post_id) then
   raise exception 'Reply must reference a comment on this post' using errcode='42501';
  end if;
 end if;
 return new;
end; $$;
revoke all on function private.validate_reply() from public,anon,authenticated;
create trigger validate_message_reply before insert on public.direct_messages for each row execute function private.validate_reply();
create trigger validate_comment_reply before insert on public.post_comments for each row execute function private.validate_reply();
create function public.send_message_reply(recipient_user_id uuid,message_body text,parent_id uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
 insert into public.direct_messages(sender_id,recipient_id,body,reply_to_id)
 values((select auth.uid()),recipient_user_id,trim(message_body),parent_id) returning id into result;
 return result;
end; $$;
revoke all on function public.send_message_reply(uuid,text,uuid) from public,anon;
grant execute on function public.send_message_reply(uuid,text,uuid) to authenticated;

create table public.message_reactions(
 message_id uuid references public.direct_messages(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete cascade,
 emoji text not null check(emoji in ('❤️','👍','😂','🎉','😮')),
 primary key(message_id,user_id,emoji)
);
create table public.comment_reactions(
 comment_id uuid references public.post_comments(id) on delete cascade,
 user_id uuid references public.profiles(id) on delete cascade,
 emoji text not null check(emoji in ('❤️','👍','😂','🎉','😮')),
 primary key(comment_id,user_id,emoji)
);
alter table public.message_reactions enable row level security;
alter table public.comment_reactions enable row level security;
revoke all on public.message_reactions,public.comment_reactions from public,anon,authenticated;
grant select,insert,delete on public.message_reactions,public.comment_reactions to authenticated;
create index message_reactions_user on public.message_reactions(user_id);
create index comment_reactions_user on public.comment_reactions(user_id);
create policy "Read accessible message reactions" on public.message_reactions for select to authenticated using(exists(select 1 from public.direct_messages m where m.id=message_id));
create policy "React to accessible messages" on public.message_reactions for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.direct_messages m where m.id=message_id));
create policy "Remove own message reaction" on public.message_reactions for delete to authenticated using(user_id=(select auth.uid()));
create policy "Read accessible comment reactions" on public.comment_reactions for select to authenticated using(exists(select 1 from public.post_comments c where c.id=comment_id));
create policy "React to accessible comments" on public.comment_reactions for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.post_comments c where c.id=comment_id));
create policy "Remove own comment reaction" on public.comment_reactions for delete to authenticated using(user_id=(select auth.uid()));

create table public.conversation_preferences(
 user_id uuid references public.profiles(id) on delete cascade,
 peer_id uuid references public.profiles(id) on delete cascade,
 muted boolean not null default false,
 primary key(user_id,peer_id),check(user_id<>peer_id)
);
alter table public.conversation_preferences enable row level security;
revoke all on public.conversation_preferences from public,anon,authenticated;
grant select,insert,update,delete on public.conversation_preferences to authenticated;
create index conversation_preferences_peer on public.conversation_preferences(peer_id);
create policy "Own conversation preferences" on public.conversation_preferences for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create function private.suppress_muted_message() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='messages' and exists(select 1 from public.conversation_preferences p where p.user_id=new.user_id and p.peer_id=new.actor_id and p.muted) then return null; end if;
 return new;
end; $$;
revoke all on function private.suppress_muted_message() from public,anon,authenticated;
create trigger suppress_muted_message before insert on public.notifications for each row execute function private.suppress_muted_message();
create function private.cancel_muted_deliveries() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.muted then delete from public.notification_deliveries d using public.notifications n
  where d.notification_id=n.id and n.user_id=new.user_id and n.actor_id=new.peer_id and n.kind='messages' and d.state in ('pending','processing'); end if;
 return new;
end; $$;
revoke all on function private.cancel_muted_deliveries() from public,anon,authenticated;
create trigger cancel_muted_deliveries after insert or update on public.conversation_preferences for each row execute function private.cancel_muted_deliveries();

alter table public.circles add column rules text not null default '' check(char_length(rules)<=3000);
grant update(rules) on public.circles to authenticated;
create policy "Members see circle roles" on public.circle_memberships for select to authenticated using(status='member' and private.is_circle_member(circle_id,(select auth.uid())));
create function private.set_circle_role(target_circle uuid,target_member uuid,new_role text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or not private.is_circle_owner(target_circle,(select auth.uid())) then raise exception 'Only the owner can assign roles' using errcode='42501'; end if;
 if new_role not in ('member','moderator') then raise exception 'Choose member or moderator'; end if;
 update public.circle_memberships set role=new_role where circle_id=target_circle and user_id=target_member and status='member' and role<>'owner';
 if not found then raise exception 'Member not found or owner role cannot be changed'; end if;
end; $$;
create function public.set_circle_role(target_circle uuid,target_member uuid,new_role text) returns void language sql security invoker set search_path='' as $$ select private.set_circle_role(target_circle,target_member,new_role); $$;
revoke all on function private.set_circle_role(uuid,uuid,text),public.set_circle_role(uuid,uuid,text) from public,anon;
grant execute on function private.set_circle_role(uuid,uuid,text),public.set_circle_role(uuid,uuid,text) to authenticated;
create policy "Circle moderators schedule events" on public.circle_events for insert to authenticated with check(creator_id=(select auth.uid()) and starts_at>now() and exists(select 1 from public.circle_memberships m where m.circle_id=circle_events.circle_id and m.user_id=(select auth.uid()) and m.role='moderator' and m.status='member'));
create policy "Circle moderators cancel events" on public.circle_events for delete to authenticated using(exists(select 1 from public.circle_memberships m where m.circle_id=circle_events.circle_id and m.user_id=(select auth.uid()) and m.role='moderator' and m.status='member'));

create function public.discover_circles(search_text text default '',interest_filter text default '',privacy_filter text default 'all',sort_order text default 'recommended',active_only boolean default false,page_offset integer default 0,page_size integer default 30)
returns setof public.circles language sql stable security invoker set search_path='' as $$
 select c.* from public.circles c where (c.owner_id is null or not private.are_blocked((select auth.uid()),c.owner_id))
 and (interest_filter in ('','All','For you') or lower(c.interest)=lower(interest_filter))
 and (privacy_filter='all' or privacy_filter='private' and c.is_private or privacy_filter='public' and not c.is_private)
 and (not active_only or c.last_activity_at>now()-interval '7 days')
 and (trim(search_text)='' or position(lower(trim(search_text)) in lower(c.name||' '||c.description||' '||c.interest))>0)
 order by case when sort_order='recommended' and exists(select 1 from public.profiles p,unnest(p.interests) i where p.id=(select auth.uid()) and lower(i)=lower(c.interest)) then 0 else 1 end,
 case when sort_order='popular' then c.members_count end desc,
 case when sort_order='newest' then c.created_at end desc,c.last_activity_at desc,c.id
 offset greatest(page_offset,0) limit least(greatest(page_size,1),50);
$$;
revoke all on function public.discover_circles(text,text,text,text,boolean,integer,integer) from public,anon;
grant execute on function public.discover_circles(text,text,text,text,boolean,integer,integer) to authenticated;

create table public.scheduled_live_rooms(
 id uuid primary key default gen_random_uuid(),host_id uuid not null references public.profiles(id) on delete cascade,
 circle_id uuid references public.circles(id) on delete cascade,title text not null check(char_length(trim(title)) between 2 and 120),
 starts_at timestamptz not null,created_at timestamptz not null default now(),
 status text not null default 'scheduled' check(status in ('scheduled','live','cancelled')),
 live_session_id uuid references public.live_sessions(id) on delete set null
);
create index scheduled_live_upcoming on public.scheduled_live_rooms(starts_at) where status='scheduled';
create index scheduled_live_host on public.scheduled_live_rooms(host_id);
create index scheduled_live_circle on public.scheduled_live_rooms(circle_id);
create index scheduled_live_session on public.scheduled_live_rooms(live_session_id);
alter table public.scheduled_live_rooms enable row level security;
revoke all on public.scheduled_live_rooms from public,anon,authenticated;
grant select on public.scheduled_live_rooms to authenticated;
grant insert(host_id,circle_id,title,starts_at),update(title,starts_at) on public.scheduled_live_rooms to authenticated;
create policy "Discover accessible scheduled rooms" on public.scheduled_live_rooms for select to authenticated using(not private.are_blocked((select auth.uid()),host_id) and (circle_id is null or private.is_circle_member(circle_id,(select auth.uid()))));
create policy "Schedule own live room" on public.scheduled_live_rooms for insert to authenticated with check(host_id=(select auth.uid()) and starts_at>now() and (circle_id is null or private.is_circle_member(circle_id,(select auth.uid()))));
create policy "Edit own upcoming room" on public.scheduled_live_rooms for update to authenticated using(host_id=(select auth.uid()) and status='scheduled') with check(host_id=(select auth.uid()) and status='scheduled' and starts_at>now());
create table public.live_reminders(room_id uuid references public.scheduled_live_rooms(id) on delete cascade,user_id uuid references public.profiles(id) on delete cascade,primary key(room_id,user_id));
create index live_reminders_user on public.live_reminders(user_id);
alter table public.live_reminders enable row level security;
revoke all on public.live_reminders from public,anon,authenticated;
grant select,insert,delete on public.live_reminders to authenticated;
create policy "Own live reminders" on public.live_reminders for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and exists(select 1 from public.scheduled_live_rooms r where r.id=room_id and r.status='scheduled' and r.starts_at>now()));
create function private.manage_scheduled_room(room_id uuid,action text) returns uuid language plpgsql security definer set search_path='' as $$
declare room public.scheduled_live_rooms; live_id uuid; recipient uuid;
begin
 select * into room from public.scheduled_live_rooms where id=room_id for update;
 if (select auth.uid()) is null or room.host_id is distinct from (select auth.uid()) then raise exception 'Only the host can manage this room' using errcode='42501'; end if;
 if action='start' and room.status='live' then return room.live_session_id; end if;
 if room.status<>'scheduled' then raise exception 'This room is no longer scheduled'; end if;
 if action='start' then
  live_id:=private.start_live_session(room.title,room.circle_id);
  update public.scheduled_live_rooms set status='live',live_session_id=live_id where id=room_id;
  for recipient in select user_id from public.live_reminders where live_reminders.room_id=room.id loop
   if room.circle_id is null or private.is_circle_member(room.circle_id,recipient) then
    perform private.notify_member(recipient,room.host_id,'live',room.circle_id,live_id,'Your scheduled room is live',room.title,'scheduled-start:'||room.id);
   end if;
  end loop;
 elsif action='cancel' then
  update public.scheduled_live_rooms set status='cancelled' where id=room_id;
  delete from public.notifications where dedupe_key='live-reminder:'||room.id;
 else raise exception 'Unknown action'; end if;
 return live_id;
end; $$;
create function public.manage_scheduled_room(room_id uuid,action text) returns uuid language sql security invoker set search_path='' as $$ select private.manage_scheduled_room(room_id,action); $$;
revoke all on function private.manage_scheduled_room(uuid,text),public.manage_scheduled_room(uuid,text) from public,anon;
grant execute on function private.manage_scheduled_room(uuid,text),public.manage_scheduled_room(uuid,text) to authenticated;
create function private.enqueue_live_reminders() returns void language plpgsql security definer set search_path='' as $$
declare room record;
begin
 for room in select s.*,r.user_id from public.scheduled_live_rooms s join public.live_reminders r on r.room_id=s.id where s.status='scheduled' and s.starts_at>now() and s.starts_at<=now()+interval '15 minutes' and (s.circle_id is null or private.is_circle_member(s.circle_id,r.user_id)) loop
  perform private.notify_member(room.user_id,case when room.user_id=room.host_id then null else room.host_id end,'live',room.circle_id,room.id,'Your room starts soon',room.title,'live-reminder:'||room.id);
 end loop;
end; $$;
revoke all on function private.enqueue_live_reminders() from public,anon,authenticated;
-- The existing trusted dispatcher runs once per minute.
-- runtime-schedule:start
create or replace function private.dispatch_notifications() returns void language plpgsql security definer set search_path='' as $$
declare endpoint text; secret text;
begin
 perform private.enqueue_event_reminders();perform private.enqueue_live_reminders();
 select value into endpoint from private.runtime_settings where key='dispatch_url';
 select value into secret from private.runtime_settings where key='dispatch_secret';
 if endpoint is not null then perform net.http_post(url:=endpoint,headers:=jsonb_build_object('Content-Type','application/json','x-dispatch-secret',secret),body:='{}'::jsonb,timeout_milliseconds:=10000); end if;
end; $$;
-- runtime-schedule:end

-- Remove obsolete reminders and queued deliveries when plans or subscriptions change.
create function private.clear_live_reminder() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='live_reminders' then
  delete from public.notifications where user_id=old.user_id and dedupe_key='live-reminder:'||old.room_id;
 elsif new.starts_at is distinct from old.starts_at or new.title is distinct from old.title or new.status is distinct from old.status then
  delete from public.notifications where dedupe_key='live-reminder:'||old.id;
 end if;
 return null;
end; $$;
revoke all on function private.clear_live_reminder() from public,anon,authenticated;
create trigger clear_unsubscribed_live_reminder after delete on public.live_reminders for each row execute function private.clear_live_reminder();
create trigger clear_changed_live_reminder after update on public.scheduled_live_rooms for each row execute function private.clear_live_reminder();
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.message_reactions,public.comment_reactions;
 end if;
end; $$;


-- Source: migrations/20261012164050_experience_policy_consolidation.sql
-- Preserve access while evaluating one permissive policy per action.
drop policy "Circle moderators cancel events" on public.circle_events;
drop policy "Owners cancel events" on public.circle_events;
drop policy "Circle moderators schedule events" on public.circle_events;
drop policy "Owners schedule events" on public.circle_events;
create policy "Organisers cancel events" on public.circle_events for delete to authenticated using(private.is_circle_owner(circle_id,(select auth.uid())) or exists(select 1 from public.circle_memberships m where m.circle_id=circle_events.circle_id and m.user_id=(select auth.uid()) and m.role='moderator' and m.status='member'));
create policy "Organisers schedule events" on public.circle_events for insert to authenticated with check(creator_id=(select auth.uid()) and starts_at>now() and (private.is_circle_owner(circle_id,(select auth.uid())) or exists(select 1 from public.circle_memberships m where m.circle_id=circle_events.circle_id and m.user_id=(select auth.uid()) and m.role='moderator' and m.status='member')));
drop policy "Members read their membership and owners read requests" on public.circle_memberships;
drop policy "Members see circle roles" on public.circle_memberships;
create policy "Read own membership, member roles or owned circle requests" on public.circle_memberships for select to authenticated using(user_id=(select auth.uid()) or private.is_circle_owner(circle_id,(select auth.uid())) or (status='member' and private.is_circle_member(circle_id,(select auth.uid()))));

-- Delivery eligibility includes upcoming rooms and current conversation mutes.
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
 or (n.kind='live' and not exists(select 1 from public.live_sessions l where l.id=n.target_id and l.status='live') and not exists(select 1 from public.scheduled_live_rooms s join public.live_reminders r on r.room_id=s.id and r.user_id=n.user_id where s.id=n.target_id and s.status='scheduled' and s.starts_at>now()))
 or (n.kind='events' and not exists(select 1 from public.circle_events e where e.id=n.target_id and e.starts_at>now()))
 or (n.circle_id is not null and not private.is_circle_member(n.circle_id,n.user_id))
 or exists(select 1 from public.circle_notification_preferences cp where cp.user_id=n.user_id and cp.circle_id=n.circle_id and not cp.enabled)
 or (n.kind='messages' and exists(select 1 from public.conversation_preferences cp where cp.user_id=n.user_id and cp.peer_id=n.actor_id and cp.muted))
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


-- Source: migrations/20261013063428_replies_audit_hardening.sql
-- Normalise and validate future comments without rewriting existing content.
create function private.normalise_comment_body() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.body := regexp_replace(new.body,'^[[:space:]]+|[[:space:]]+$','','g');
 if new.body is null or char_length(new.body) not between 1 and 2000 then
  raise exception 'Replies must contain 1–2000 characters' using errcode='23514';
 end if;
 return new;
end; $$;
revoke all on function private.normalise_comment_body() from public,anon,authenticated;
create trigger normalise_comment_body before insert or update of body on public.post_comments
for each row execute function private.normalise_comment_body();

-- The existing trigger notifies the post author. Also notify a different comment
-- author when someone replies directly to them, using the same deletion key.
create function private.notify_comment_recipient() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient uuid; post_author uuid; target_circle uuid;
begin
 if (select auth.uid()) is null or new.author_id is distinct from (select auth.uid()) or new.reply_to_id is null then return new; end if;
 select c.author_id,p.author_id,p.circle_id into recipient,post_author,target_circle
 from public.post_comments c join public.posts p on p.id=c.post_id
 where c.id=new.reply_to_id and c.post_id=new.post_id;
 if recipient is not null and recipient is distinct from post_author and private.is_circle_member(target_circle,recipient) then
  perform private.notify_member(recipient,new.author_id,'replies',target_circle,new.post_id,'New reply','Someone replied to your comment.','reply:'||new.id);
 end if;
 return new;
end; $$;
revoke all on function private.notify_comment_recipient() from public,anon,authenticated;
create trigger notify_comment_recipient after insert on public.post_comments
for each row execute function private.notify_comment_recipient();


-- Source: migrations/20261014130512_post_bookmarks.sql
create table public.post_bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  post_id uuid not null references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id,post_id)
);
alter table public.post_bookmarks enable row level security;
revoke all on public.post_bookmarks from anon;
grant select,insert,delete on public.post_bookmarks to authenticated;
create policy "Read own saved posts" on public.post_bookmarks for select to authenticated using (user_id=(select auth.uid()));
create policy "Save accessible published posts" on public.post_bookmarks for insert to authenticated with check (
 user_id=(select auth.uid()) and exists(select 1 from public.posts p where p.id=post_id and p.visibility='published')
);
create policy "Unsave own posts" on public.post_bookmarks for delete to authenticated using (user_id=(select auth.uid()));
create index post_bookmarks_post_idx on public.post_bookmarks(post_id);
create index post_bookmarks_recent_idx on public.post_bookmarks(user_id,created_at desc,post_id);


-- Source: migrations/20261014162132_circle_stories.sql
-- Stories expire by server time and use a private, membership-gated media bucket.
create table public.circle_stories (
 id uuid primary key default gen_random_uuid(),
 circle_id uuid not null references public.circles(id) on delete cascade,
 author_id uuid not null references public.profiles(id) on delete cascade,
 caption text not null default '' check (char_length(caption) <= 280),
 kind text not null check (kind in ('image','video')),
 storage_path text not null unique,
 duration_seconds numeric,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '24 hours'),
 check (expires_at = created_at + interval '24 hours'),
 check (storage_path like author_id::text || '/' || circle_id::text || '/' || id::text || '.%'),
 check ((kind='image' and duration_seconds is null) or (kind='video' and duration_seconds is not null and duration_seconds > 0 and duration_seconds <= 60))
);
create index circle_stories_circle_created on public.circle_stories(circle_id, created_at desc, id);
create index circle_stories_expiry on public.circle_stories(expires_at);
create index circle_stories_author on public.circle_stories(author_id);
alter table public.circle_stories enable row level security;
revoke all on public.circle_stories from anon, authenticated;
grant select, delete on public.circle_stories to authenticated;
grant insert(id,circle_id,author_id,caption,kind,storage_path,duration_seconds) on public.circle_stories to authenticated;
grant all on public.circle_stories to service_role;
create policy "Members see active unblocked stories" on public.circle_stories for select to authenticated using (
 expires_at > now() and private.is_circle_member(circle_id,(select auth.uid()))
 and not private.are_blocked((select auth.uid()),author_id)
);
create policy "Members post their own stories" on public.circle_stories for insert to authenticated with check (
 author_id=(select auth.uid()) and private.is_circle_member(circle_id,(select auth.uid()))
);
create policy "Authors remove stories" on public.circle_stories for delete to authenticated using(author_id=(select auth.uid()));
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('story-media','story-media',false,26214400,array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
on conflict(id) do nothing;
create policy "Members upload story media" on storage.objects for insert to authenticated with check (
 bucket_id='story-media' and (storage.foldername(name))[1]=(select auth.uid())::text
 and exists(select 1 from public.circle_memberships m where m.user_id=(select auth.uid()) and m.status='member' and m.circle_id::text=(storage.foldername(name))[2])
);
create policy "Read accessible story media" on storage.objects for select to authenticated using (
 bucket_id='story-media' and (
 (storage.foldername(name))[1]=(select auth.uid())::text or
 exists(select 1 from public.circle_stories s where s.storage_path=name)
 )
);
create policy "Owners remove story media" on storage.objects for delete to authenticated using (
 bucket_id='story-media' and (storage.foldername(name))[1]=(select auth.uid())::text
);

-- Durable storage deletion queue: database deletion must not directly delete storage.objects.
create table public.story_media_cleanup (
 storage_path text primary key,
 queued_at timestamptz not null default now()
);
alter table public.story_media_cleanup enable row level security;
revoke all on public.story_media_cleanup from public,anon,authenticated;
grant all on public.story_media_cleanup to service_role;
create function private.queue_story_media() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.story_media_cleanup(storage_path) values(old.storage_path) on conflict do nothing;
 return old;
end; $$;
revoke all on function private.queue_story_media() from public,anon,authenticated;
create trigger queue_story_media after delete on public.circle_stories for each row execute function private.queue_story_media();
create function public.queue_expired_story_media() returns void language plpgsql security definer set search_path='' as $$
begin
 delete from public.circle_stories where id in (select id from public.circle_stories where expires_at<=now() order by expires_at limit 100);
 insert into public.story_media_cleanup(storage_path)
 select o.name from storage.objects o where o.bucket_id='story-media' and o.created_at < now()-interval '25 hours'
 and not exists(select 1 from public.circle_stories s where s.storage_path=o.name)
 order by o.created_at limit 100 on conflict do nothing;
end; $$;
revoke all on function public.queue_expired_story_media() from public,anon,authenticated;
grant execute on function public.queue_expired_story_media() to service_role;


-- Source: migrations/20261015105642_independent_story_cleanup.sql
-- Keep retention running even when device notifications are disabled or unconfigured.
insert into private.runtime_settings(key, value)
values ('story_cleanup_secret', gen_random_uuid()::text || gen_random_uuid()::text)
on conflict (key) do nothing;

create or replace function private.authorize_story_cleanup(provided_secret text)
returns boolean language sql security definer set search_path = '' as $$
  select provided_secret = (select value from private.runtime_settings where key = 'story_cleanup_secret');
$$;
create or replace function public.authorize_story_cleanup(provided_secret text)
returns boolean language sql security invoker set search_path = '' as $$
  select private.authorize_story_cleanup(provided_secret);
$$;
revoke all on function private.authorize_story_cleanup(text) from public, anon, authenticated;
revoke all on function public.authorize_story_cleanup(text) from public, anon, authenticated;
grant execute on function private.authorize_story_cleanup(text) to service_role;
grant execute on function public.authorize_story_cleanup(text) to service_role;

-- runtime-schedule:start
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create or replace function private.cleanup_story_media()
returns void language plpgsql security definer set search_path = '' as $$
declare endpoint text; secret text;
begin
  select value into endpoint from private.runtime_settings where key = 'story_cleanup_url';
  select value into secret from private.runtime_settings where key = 'story_cleanup_secret';
  if endpoint is not null then
    perform net.http_post(
      url := endpoint,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cleanup-secret', secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  end if;
end;
$$;
revoke all on function private.cleanup_story_media() from public, anon, authenticated;
select cron.schedule('circles-cleanup-story-media', '* * * * *', 'select private.cleanup_story_media();');
-- runtime-schedule:end
