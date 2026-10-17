-- Circles → Supabase Postgres schema (Stage 1)
-- IDs are app-generated uuid4 strings -> text; timestamps are ISO strings (text)
-- to preserve the existing lexicographic comparison logic in server.py.

create table if not exists users (
  id text primary key,
  email text not null unique,
  name text not null default '',
  password_hash text not null,
  bio text not null default '',
  avatar_url text,
  interests jsonb not null default '[]',
  onboarded boolean not null default false,
  coins integer not null default 0,
  is_moderator boolean not null default false,
  date_of_birth text,
  is_minor boolean not null default false,
  private_profile boolean not null default false,
  tos_version text,
  privacy_version text,
  consent_at text,
  created_at text not null
);

create table if not exists circles (
  id text primary key,
  name text not null,
  description text not null default '',
  category text not null default 'General',
  cover_url text,
  owner_id text not null references users(id) on delete cascade,
  is_private boolean not null default false,
  welcome_message text,
  created_at text not null
);
create index if not exists circles_category_idx on circles(category);
create index if not exists circles_owner_idx on circles(owner_id);

create table if not exists memberships (
  circle_id text not null references circles(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null default 'member',
  muted_until text,
  created_at text not null,
  primary key (circle_id, user_id)
);
create index if not exists memberships_user_idx on memberships(user_id);

create table if not exists circle_bans (
  circle_id text not null references circles(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  until text,
  created_at text,
  primary key (circle_id, user_id)
);

create table if not exists posts (
  id text primary key,
  circle_id text not null references circles(id) on delete cascade,
  author_id text not null references users(id) on delete cascade,
  content text not null default '',
  image_url text,
  gift_count integer not null default 0,
  deleted boolean not null default false,
  created_at text not null
);
create index if not exists posts_circle_created_idx on posts(circle_id, created_at desc);
create index if not exists posts_author_idx on posts(author_id);

create table if not exists comments (
  id text primary key,
  post_id text not null references posts(id) on delete cascade,
  author_id text not null references users(id) on delete cascade,
  text text not null,
  created_at text not null
);
create index if not exists comments_post_idx on comments(post_id, created_at);

create table if not exists likes (
  post_id text not null references posts(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  created_at text not null,
  primary key (post_id, user_id)
);

create table if not exists conversations (
  id text primary key,
  type text not null default 'direct',
  members jsonb not null default '[]',
  circle_id text,
  created_at text not null,
  last_message_at text
);

create table if not exists messages (
  id text primary key,
  conversation_id text not null references conversations(id) on delete cascade,
  author_id text not null references users(id) on delete cascade,
  text text not null default '',
  image_url text,
  created_at text not null
);
create index if not exists messages_conv_idx on messages(conversation_id, created_at);

create table if not exists conversation_reads (
  conversation_id text not null,
  user_id text not null,
  last_read_at text,
  primary key (conversation_id, user_id)
);

create table if not exists typing (
  conversation_id text not null,
  user_id text not null,
  until text,
  primary key (conversation_id, user_id)
);

create table if not exists events (
  id text primary key,
  circle_id text not null references circles(id) on delete cascade,
  title text not null,
  description text not null default '',
  starts_at text not null,
  host_id text references users(id) on delete set null,
  created_at text not null
);
create index if not exists events_circle_idx on events(circle_id, starts_at);
create index if not exists events_starts_idx on events(starts_at);

create table if not exists event_rsvps (
  event_id text not null references events(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  created_at text not null,
  primary key (event_id, user_id)
);

create table if not exists rooms (
  id text primary key,
  title text not null,
  circle_id text,
  host_id text not null references users(id) on delete cascade,
  status text not null default 'live',
  scheduled_at text,
  created_at text not null
);
create index if not exists rooms_status_idx on rooms(status, created_at desc);
create index if not exists rooms_circle_idx on rooms(circle_id);

create table if not exists room_messages (
  id text primary key,
  room_id text not null references rooms(id) on delete cascade,
  author_id text not null references users(id) on delete cascade,
  text text not null default '',
  created_at text not null
);
create index if not exists room_messages_room_idx on room_messages(room_id, created_at);

create table if not exists room_participants (
  room_id text not null references rooms(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role text not null default 'listener',
  hand_raised boolean not null default false,
  created_at text not null,
  primary key (room_id, user_id)
);

create table if not exists gifts (
  id text primary key,
  sender_id text not null references users(id) on delete cascade,
  recipient_id text references users(id) on delete set null,
  amount integer not null default 0,
  gift_type text,
  circle_id text,
  post_id text,
  room_id text,
  created_at text not null
);
create index if not exists gifts_circle_idx on gifts(circle_id);
create index if not exists gifts_recipient_idx on gifts(recipient_id);

create table if not exists transactions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  amount integer not null,
  type text,
  description text,
  created_at text not null
);
create index if not exists transactions_user_idx on transactions(user_id, created_at desc);

create table if not exists reports (
  id text primary key,
  reporter_id text not null references users(id) on delete cascade,
  target_type text not null,
  target_id text not null,
  circle_id text,
  category text not null default 'other',
  reason text not null default '',
  priority boolean not null default false,
  status text not null default 'open',
  resolution jsonb,
  created_at text not null
);
create index if not exists reports_status_idx on reports(status, created_at desc);
create index if not exists reports_circle_idx on reports(circle_id);
create index if not exists reports_reporter_idx on reports(reporter_id);

create table if not exists moderation_actions (
  id text primary key,
  action text not null,
  target_type text,
  target_id text,
  actor_id text,
  affected_user_id text,
  reason text,
  status text not null default 'active',
  created_at text not null
);
create index if not exists modactions_affected_idx on moderation_actions(affected_user_id, created_at desc);

create table if not exists appeals (
  id text primary key,
  action_id text not null,
  user_id text not null,
  reason text not null,
  status text not null default 'open',
  created_at text not null
);

create table if not exists blocks (
  id text primary key,
  blocker_id text not null references users(id) on delete cascade,
  blocked_id text not null references users(id) on delete cascade,
  created_at text not null,
  unique (blocker_id, blocked_id)
);
create index if not exists blocks_blocker_idx on blocks(blocker_id);
create index if not exists blocks_blocked_idx on blocks(blocked_id);

create table if not exists consents (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  tos_version text,
  privacy_version text,
  accepted_at text
);

create table if not exists password_resets (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  code_hash text not null,
  expires_at text not null,
  attempts integer not null default 0,
  used boolean not null default false,
  created_at text not null
);
create index if not exists password_resets_user_idx on password_resets(user_id, expires_at);

create table if not exists uploads (
  id text primary key,
  owner_id text,
  path text,
  created_at text
);
