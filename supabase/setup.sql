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
  visibility = 'published' and not private.are_blocked((select auth.uid()), author_id) and exists (
    select 1 from public.circle_memberships m where m.circle_id = posts.circle_id and m.user_id = (select auth.uid()) and m.status = 'member'
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
    select 1 from public.posts p join public.circle_memberships m on m.circle_id = p.circle_id
    where p.id::text = (storage.foldername(name))[2] and p.visibility = 'published'
      and m.user_id = (select auth.uid()) and m.status = 'member'
      and not private.are_blocked((select auth.uid()), p.author_id)
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
  membership_role text;
begin
  if leaving_user is null then raise exception 'Sign in required'; end if;
  select m.status, m.role into membership_status, membership_role
    from public.circle_memberships m
    where m.circle_id = target_circle_id and m.user_id = leaving_user
    for update;
  if not found then return 'not_member'; end if;
  if membership_role = 'owner' then raise exception 'Circle owners cannot leave while they own the circle'; end if;
  delete from public.circle_memberships where circle_id = target_circle_id and user_id = leaving_user;
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
declare blocker_id uuid := (select auth.uid());
begin
  if blocker_id is null then raise exception 'Sign in to block people'; end if;
  if target_user_id is null or target_user_id = blocker_id then raise exception 'You cannot block this account'; end if;
  insert into public.blocks (blocker_id, blocked_id) values (blocker_id, target_user_id)
    on conflict (blocker_id, blocked_id) do nothing;
  delete from public.follows
    where (follower_id = blocker_id and followee_id = target_user_id)
       or (follower_id = target_user_id and followee_id = blocker_id);
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
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role' then raise exception 'Service role required'; end if;
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
