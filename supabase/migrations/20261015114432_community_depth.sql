-- Community depth: explicit preferences, participation, shared knowledge, chats,
-- invitations, recognition and opt-in catch-up. Every exposed table uses RLS.
create function private.circle_host(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and exists(select 1 from public.circle_memberships where circle_id=target and user_id=(select auth.uid()) and status='member' and role in ('owner','moderator'));
$$;
revoke all on function private.circle_host(uuid) from public,anon;
grant execute on function private.circle_host(uuid) to authenticated;

create table public.feed_preferences(
 user_id uuid not null references public.profiles(id) on delete cascade,
 circle_id uuid not null references public.circles(id) on delete cascade,
 favourite boolean not null default false, see_less boolean not null default false,
 snoozed_until timestamptz, primary key(user_id,circle_id)
);
create index feed_preferences_circle on public.feed_preferences(circle_id);
alter table public.feed_preferences enable row level security;
revoke all on public.feed_preferences from public,anon,authenticated;
grant select,insert,update,delete on public.feed_preferences to authenticated;
create policy "Own feed choices" on public.feed_preferences for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and private.is_circle_member(circle_id,(select auth.uid())));
create table public.hidden_posts(
 user_id uuid references public.profiles(id) on delete cascade,
 post_id uuid references public.posts(id) on delete cascade, primary key(user_id,post_id)
);
create index hidden_posts_post on public.hidden_posts(post_id);
alter table public.hidden_posts enable row level security;
revoke all on public.hidden_posts from public,anon,authenticated;
grant select,insert,delete on public.hidden_posts to authenticated;
create policy "Own hidden posts" on public.hidden_posts for select to authenticated using(user_id=(select auth.uid()));
create policy "Hide accessible posts" on public.hidden_posts for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.posts where id=post_id));
create policy "Restore hidden posts" on public.hidden_posts for delete to authenticated using(user_id=(select auth.uid()));

create table public.circle_topics(
 id uuid primary key default gen_random_uuid(), circle_id uuid not null references public.circles(id) on delete cascade,
 name text not null check(char_length(trim(name)) between 2 and 40), unique(circle_id,name)
);
create index circle_topics_circle on public.circle_topics(circle_id);
alter table public.circle_topics enable row level security;
revoke all on public.circle_topics from public,anon,authenticated;
grant select,insert,delete on public.circle_topics to authenticated;
create policy "Members read topics" on public.circle_topics for select to authenticated using(private.is_circle_member(circle_id,(select auth.uid())));
create policy "Hosts add topics" on public.circle_topics for insert to authenticated with check(private.circle_host(circle_id));
create policy "Hosts remove topics" on public.circle_topics for delete to authenticated using(private.circle_host(circle_id));
alter table public.posts add column post_type text not null default 'note' check(post_type in ('note','question','poll'));
alter table public.posts add column topic_id uuid references public.circle_topics(id) on delete set null;
create index posts_topic on public.posts(topic_id) where topic_id is not null;
grant update(topic_id) on public.posts to authenticated;
create function private.validate_post_topic() returns trigger language plpgsql set search_path='' as $$
begin
 if new.topic_id is not null and not exists(select 1 from public.circle_topics where id=new.topic_id and circle_id=new.circle_id) then raise exception 'Choose a topic in this circle'; end if;
 return new;
end; $$;
revoke all on function private.validate_post_topic() from public,anon,authenticated;
create trigger validate_post_topic before insert or update on public.posts for each row execute function private.validate_post_topic();

create table public.post_polls(
 post_id uuid primary key references public.posts(id) on delete cascade,
 options jsonb not null check(jsonb_typeof(options)='array' and jsonb_array_length(options) between 2 and 6),
 closes_at timestamptz not null default now()+interval '7 days'
);
create table public.poll_votes(
 post_id uuid references public.post_polls(post_id) on delete cascade,
 user_id uuid references public.profiles(id) on delete cascade, option_index integer not null check(option_index between 0 and 5),
 primary key(post_id,user_id)
);
create index poll_votes_user on public.poll_votes(user_id);
alter table public.post_polls enable row level security;
alter table public.poll_votes enable row level security;
revoke all on public.post_polls,public.poll_votes from public,anon,authenticated;
grant select,insert on public.post_polls to authenticated;
grant select,insert,update,delete on public.poll_votes to authenticated;
create policy "Members read polls" on public.post_polls for select to authenticated using(exists(select 1 from public.posts where id=post_id and visibility='published'));
create policy "Authors create polls" on public.post_polls for insert to authenticated with check(exists(select 1 from public.posts where id=post_id and author_id=(select auth.uid()) and post_type='poll'));
create policy "Members read votes" on public.poll_votes for select to authenticated using(exists(select 1 from public.post_polls where post_id=poll_votes.post_id));
create policy "Members cast vote" on public.poll_votes for insert to authenticated with check(user_id=(select auth.uid()) and exists(select 1 from public.post_polls where post_id=poll_votes.post_id and closes_at>now() and option_index<jsonb_array_length(options)));
create policy "Members change own vote" on public.poll_votes for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and exists(select 1 from public.post_polls where post_id=poll_votes.post_id and closes_at>now() and option_index<jsonb_array_length(options)));
create policy "Members remove own vote" on public.poll_votes for delete to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.post_polls where post_id=poll_votes.post_id and closes_at>now()));
create function public.create_participation_post(target_circle uuid,post_body text,kind text,poll_options jsonb default null,selected_topic uuid default null,request_id text default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid; item jsonb;
begin
 if kind is null or post_body is null or kind not in ('question','poll') or char_length(trim(post_body)) not between 2 and 5000 then raise exception 'Write a question of 2–5000 characters'; end if;
 if kind='poll' then
  if poll_options is null or jsonb_typeof(poll_options)<>'array' or jsonb_array_length(poll_options) not between 2 and 6 then raise exception 'Add 2–6 poll options'; end if;
  for item in select * from jsonb_array_elements(poll_options) loop
   if jsonb_typeof(item)<>'string' or char_length(trim(item#>>'{}')) not between 1 and 120 then raise exception 'Poll options must contain 1–120 characters'; end if;
  end loop;
  if (select count(distinct lower(trim(value))) from jsonb_array_elements_text(poll_options))<>jsonb_array_length(poll_options) then raise exception 'Use different poll options'; end if;
 end if;
 if request_id is not null then
  select id into result from public.posts where author_id=(select auth.uid()) and client_request_id=request_id;
  if result is not null then return result; end if;
 end if;
 insert into public.posts(circle_id,author_id,body,post_type,topic_id,client_request_id) values(target_circle,(select auth.uid()),trim(post_body),kind,selected_topic,request_id) returning id into result;
 if kind='poll' then insert into public.post_polls(post_id,options) values(result,poll_options); end if;
 return result;
end; $$;
revoke all on function public.create_participation_post(uuid,text,text,jsonb,uuid,text) from public,anon;
grant execute on function public.create_participation_post(uuid,text,text,jsonb,uuid,text) to authenticated;

create table public.circle_prompts(
 circle_id uuid primary key references public.circles(id) on delete cascade,
 question text not null check(char_length(trim(question)) between 2 and 500),
 weekday integer not null default 1 check(weekday between 0 and 6), enabled boolean not null default false
);
alter table public.circle_prompts enable row level security;
revoke all on public.circle_prompts from public,anon,authenticated;
grant select,insert,update,delete on public.circle_prompts to authenticated;
create policy "Members read prompts" on public.circle_prompts for select to authenticated using(private.is_circle_member(circle_id,(select auth.uid())));
create policy "Hosts configure prompts" on public.circle_prompts for all to authenticated using(private.circle_host(circle_id)) with check(private.circle_host(circle_id));
create table private.prompt_runs(circle_id uuid references public.circles(id) on delete cascade,week date,primary key(circle_id,week));
alter table private.prompt_runs enable row level security;
revoke all on private.prompt_runs from public,anon,authenticated;
create function private.publish_weekly_prompts() returns void language plpgsql security definer set search_path='' as $$
declare prompt record; inserted integer;
begin
 for prompt in select p.*,c.owner_id from public.circle_prompts p join public.circles c on c.id=p.circle_id where p.enabled and p.weekday=extract(dow from now() at time zone 'UTC')::integer loop
  insert into private.prompt_runs values(prompt.circle_id,date_trunc('week',now() at time zone 'UTC')::date) on conflict do nothing;
  get diagnostics inserted=row_count;
  if inserted=1 then insert into public.posts(circle_id,author_id,body,post_type) values(prompt.circle_id,prompt.owner_id,prompt.question,'question'); end if;
 end loop;
end; $$;
revoke all on function private.publish_weekly_prompts() from public,anon,authenticated;

create table public.circle_collections(
 id uuid primary key default gen_random_uuid(), circle_id uuid not null references public.circles(id) on delete cascade,
 creator_id uuid not null references public.profiles(id) on delete cascade,
 name text not null check(char_length(trim(name)) between 2 and 80), created_at timestamptz not null default now()
);
create index circle_collections_circle on public.circle_collections(circle_id,created_at);
create index circle_collections_creator on public.circle_collections(creator_id);
create table public.collection_posts(
 collection_id uuid references public.circle_collections(id) on delete cascade,
 post_id uuid references public.posts(id) on delete cascade,
 added_by uuid not null references public.profiles(id) on delete cascade, primary key(collection_id,post_id)
);
create index collection_posts_post on public.collection_posts(post_id);
create index collection_posts_author on public.collection_posts(added_by);
alter table public.circle_collections enable row level security;
alter table public.collection_posts enable row level security;
revoke all on public.circle_collections,public.collection_posts from public,anon,authenticated;
grant select,insert,delete on public.circle_collections,public.collection_posts to authenticated;
create policy "Members read collections" on public.circle_collections for select to authenticated using(private.is_circle_member(circle_id,(select auth.uid())));
create policy "Members create collections" on public.circle_collections for insert to authenticated with check(creator_id=(select auth.uid()) and private.is_circle_member(circle_id,(select auth.uid())));
create policy "Creators and hosts remove collections" on public.circle_collections for delete to authenticated using(private.is_circle_member(circle_id,(select auth.uid())) and (creator_id=(select auth.uid()) or private.circle_host(circle_id)));
create policy "Read accessible collection entries" on public.collection_posts for select to authenticated using(exists(select 1 from public.circle_collections c join public.posts p on p.circle_id=c.circle_id where c.id=collection_id and p.id=post_id and p.visibility='published'));
create policy "Members collect same-circle posts" on public.collection_posts for insert to authenticated with check(added_by=(select auth.uid()) and exists(select 1 from public.circle_collections c join public.posts p on p.circle_id=c.circle_id where c.id=collection_id and p.id=post_id and p.visibility='published'));
create policy "Contributors and hosts remove entries" on public.collection_posts for delete to authenticated using(exists(select 1 from public.circle_collections c where c.id=collection_id and (added_by=(select auth.uid()) or c.creator_id=(select auth.uid()) or private.circle_host(c.circle_id))));

create table public.circle_chat_settings(
 circle_id uuid primary key references public.circles(id) on delete cascade,
 enabled boolean not null default false, slow_seconds integer not null default 0 check(slow_seconds between 0 and 300)
);
create table public.circle_chat_messages(
 id uuid primary key default gen_random_uuid(), circle_id uuid not null references public.circles(id) on delete cascade,
 author_id uuid not null references public.profiles(id) on delete cascade,
 body text not null default '' check(char_length(body)<=2000),
 media_kind text check(media_kind in ('photo','voice')), media_path text unique, duration_ms integer,
 created_at timestamptz not null default now(),
 check(char_length(trim(body))>0 or media_path is not null),
 check((media_kind is null and media_path is null) or (media_kind is not null and media_path is not null)),
 check(media_kind<>'voice' or (duration_ms is not null and duration_ms between 1 and 60000))
);
create index circle_chat_timeline on public.circle_chat_messages(circle_id,created_at desc,id desc);
create index circle_chat_author on public.circle_chat_messages(author_id);
create table public.circle_chat_preferences(
 user_id uuid references public.profiles(id) on delete cascade, circle_id uuid references public.circles(id) on delete cascade,
 muted boolean not null default false, read_at timestamptz not null default now(), primary key(user_id,circle_id)
);
create index circle_chat_preferences_circle on public.circle_chat_preferences(circle_id);
alter table public.circle_chat_settings enable row level security;
alter table public.circle_chat_messages enable row level security;
alter table public.circle_chat_preferences enable row level security;
revoke all on public.circle_chat_settings,public.circle_chat_messages,public.circle_chat_preferences from public,anon,authenticated;
grant select,insert,update on public.circle_chat_settings to authenticated;
grant select,insert,delete on public.circle_chat_messages to authenticated;
grant select,insert,update,delete on public.circle_chat_preferences to authenticated;
create policy "Members read chat configuration" on public.circle_chat_settings for select to authenticated using(private.is_circle_member(circle_id,(select auth.uid())));
create policy "Hosts enable circle chat" on public.circle_chat_settings for insert to authenticated with check(private.circle_host(circle_id));
create policy "Hosts configure circle chat" on public.circle_chat_settings for update to authenticated using(private.circle_host(circle_id)) with check(private.circle_host(circle_id));
create policy "Members read unblocked chat" on public.circle_chat_messages for select to authenticated using(private.is_circle_member(circle_id,(select auth.uid())) and not private.are_blocked((select auth.uid()),author_id));
create policy "Members send circle chat" on public.circle_chat_messages for insert to authenticated with check(author_id=(select auth.uid()) and private.is_circle_member(circle_id,(select auth.uid())) and exists(select 1 from public.circle_chat_settings where circle_id=circle_chat_messages.circle_id and enabled));
create policy "Authors and hosts remove circle chat" on public.circle_chat_messages for delete to authenticated using(private.is_circle_member(circle_id,(select auth.uid())) and (private.circle_host(circle_id) or author_id=(select auth.uid()) and created_at<=now() and created_at>now()-interval '15 minutes'));
create policy "Own circle chat preferences" on public.circle_chat_preferences for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and private.is_circle_member(circle_id,(select auth.uid())));
create function private.validate_circle_chat() returns trigger language plpgsql security definer set search_path='' as $$
declare slow integer;
begin
 new.created_at:=now();
 if new.author_id is distinct from (select auth.uid()) or not private.is_circle_member(new.circle_id,(select auth.uid())) then raise exception 'Circle membership required' using errcode='42501'; end if;
 select slow_seconds into slow from public.circle_chat_settings where circle_id=new.circle_id and enabled;
 if slow is null then raise exception 'Chat is paused'; end if;
 perform pg_advisory_xact_lock(hashtextextended(new.author_id::text||new.circle_id::text,0));
 if exists(select 1 from public.circle_chat_messages where circle_id=new.circle_id and author_id=new.author_id and created_at>now()-make_interval(secs=>greatest(slow,1))) then raise exception 'Please wait before sending another message'; end if;
 if new.media_path is not null and (new.media_path not like new.author_id::text||'/circle/'||new.circle_id::text||'/%' or not exists(select 1 from storage.objects where bucket_id='community-media' and name=new.media_path)) then raise exception 'Upload media to this circle first'; end if;
 return new;
end; $$;
revoke all on function private.validate_circle_chat() from public,anon,authenticated;
create trigger validate_circle_chat before insert on public.circle_chat_messages for each row execute function private.validate_circle_chat();

create table public.message_attachments(
 message_id uuid primary key references public.direct_messages(id) on delete cascade,
 owner_id uuid not null references public.profiles(id) on delete cascade,
 media_kind text not null check(media_kind in ('photo','voice')), storage_path text not null unique,
 duration_ms integer, check(media_kind<>'voice' or (duration_ms is not null and duration_ms between 1 and 60000))
);
create index message_attachments_owner on public.message_attachments(owner_id);
alter table public.message_attachments enable row level security;
revoke all on public.message_attachments from public,anon,authenticated;
grant select,insert on public.message_attachments to authenticated;
create policy "Read accessible message attachments" on public.message_attachments for select to authenticated using(exists(select 1 from public.direct_messages where id=message_id));
create function private.own_community_upload(path text) returns boolean language sql stable security definer set search_path='' as $$
 select (select auth.uid()) is not null and split_part(path,'/',1)=(select auth.uid())::text and exists(select 1 from storage.objects where bucket_id='community-media' and name=path);
$$;
revoke all on function private.own_community_upload(text) from public,anon;
grant execute on function private.own_community_upload(text) to authenticated;
create policy "Sender attaches own upload" on public.message_attachments for insert to authenticated with check(owner_id=(select auth.uid()) and exists(select 1 from public.direct_messages m where m.id=message_id and m.sender_id=(select auth.uid()) and storage_path like m.sender_id::text||'/direct/'||m.recipient_id::text||'/%') and private.own_community_upload(storage_path));
create function public.send_media_message(recipient_user uuid,media_kind text,media_path text,voice_duration integer,request_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.direct_messages where id=request_id and sender_id=(select auth.uid()) and recipient_id=recipient_user) then return request_id; end if;
 insert into public.direct_messages(id,sender_id,recipient_id,body) values(request_id,(select auth.uid()),recipient_user,case when media_kind='voice' then 'Voice note' else 'Photo' end);
 insert into public.message_attachments(message_id,owner_id,media_kind,storage_path,duration_ms) values(request_id,(select auth.uid()),media_kind,media_path,voice_duration);
 return request_id;
end; $$;
revoke all on function public.send_media_message(uuid,text,text,integer,uuid) from public,anon;
grant execute on function public.send_media_message(uuid,text,text,integer,uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('community-media','community-media',false,10485760,array['image/jpeg','image/png','image/webp','audio/mp4','audio/m4a','audio/x-m4a','audio/webm']) on conflict(id) do nothing;
create policy "Members upload community media" on storage.objects for insert to authenticated with check(bucket_id='community-media' and (storage.foldername(name))[1]=(select auth.uid())::text and (
 (storage.foldername(name))[2]='circle' and exists(select 1 from public.circle_chat_settings s where s.circle_id::text=(storage.foldername(name))[3] and s.enabled and private.is_circle_member(s.circle_id,(select auth.uid())))
 or (storage.foldername(name))[2]='direct' and exists(select 1 from public.follows f join public.follows r on r.follower_id=f.followee_id and r.followee_id=f.follower_id where f.follower_id=(select auth.uid()) and f.followee_id::text=(storage.foldername(name))[3] and not private.are_blocked(f.follower_id,f.followee_id))));
create policy "Owners preview their community uploads" on storage.objects for select to authenticated using(bucket_id='community-media' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "Read community media through accessible messages" on storage.objects for select to authenticated using(bucket_id='community-media' and (
 exists(select 1 from public.circle_chat_messages m where m.media_path=name)
 or exists(select 1 from public.message_attachments a where a.storage_path=name)));
-- Draft uploads can be removed by their owner; published objects are deleted only through message deletion.
create policy "Owners discard unattached community media" on storage.objects for delete to authenticated using(bucket_id='community-media' and (storage.foldername(name))[1]=(select auth.uid())::text and not exists(select 1 from public.circle_chat_messages where media_path=name) and not exists(select 1 from public.message_attachments where storage_path=name));
create table public.community_media_cleanup(storage_path text primary key,queued_at timestamptz not null default now());
alter table public.community_media_cleanup enable row level security;
revoke all on public.community_media_cleanup from public,anon,authenticated;
grant all on public.community_media_cleanup to service_role;
create function private.queue_community_media() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='message_attachments' then insert into public.community_media_cleanup(storage_path) values(old.storage_path) on conflict do nothing;
 elsif old.media_path is not null then insert into public.community_media_cleanup(storage_path) values(old.media_path) on conflict do nothing; end if;
 return old;
end; $$;
revoke all on function private.queue_community_media() from public,anon,authenticated;
create trigger queue_circle_chat_media after delete on public.circle_chat_messages for each row execute function private.queue_community_media();
create trigger queue_message_media after delete on public.message_attachments for each row execute function private.queue_community_media();
create function private.queue_abandoned_community_media() returns void language sql security definer set search_path='' as $$
 insert into public.community_media_cleanup(storage_path)
 select o.name from storage.objects o where o.bucket_id='community-media' and o.created_at<now()-interval '25 hours'
 and not exists(select 1 from public.circle_chat_messages where media_path=o.name) and not exists(select 1 from public.message_attachments where storage_path=o.name) limit 100 on conflict do nothing;
$$;
create function public.queue_abandoned_community_media() returns void language sql security invoker set search_path='' as $$ select private.queue_abandoned_community_media(); $$;
revoke all on function private.queue_abandoned_community_media(),public.queue_abandoned_community_media() from public,anon,authenticated;
grant execute on function private.queue_abandoned_community_media(),public.queue_abandoned_community_media() to service_role;

create table public.circle_recognition(
 circle_id uuid references public.circles(id) on delete cascade, user_id uuid references public.profiles(id) on delete cascade,
 label text not null check(char_length(trim(label)) between 2 and 40),
 granted_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(), primary key(circle_id,user_id)
);
create index circle_recognition_user on public.circle_recognition(user_id);
create index circle_recognition_granter on public.circle_recognition(granted_by);
alter table public.circle_recognition enable row level security;
revoke all on public.circle_recognition from public,anon,authenticated;
grant select,insert,update,delete on public.circle_recognition to authenticated;
create policy "Members read recognition" on public.circle_recognition for select to authenticated using(private.is_circle_member(circle_id,(select auth.uid())) and private.is_circle_member(circle_id,user_id) and not private.are_blocked((select auth.uid()),user_id));
create policy "Hosts recognise members" on public.circle_recognition for insert to authenticated with check(private.circle_host(circle_id) and private.is_circle_member(circle_id,user_id) and granted_by=(select auth.uid()));
create policy "Hosts update recognition" on public.circle_recognition for update to authenticated using(private.circle_host(circle_id)) with check(private.circle_host(circle_id) and private.is_circle_member(circle_id,user_id) and granted_by=(select auth.uid()));
create policy "Hosts or recipients revoke recognition" on public.circle_recognition for delete to authenticated using(private.circle_host(circle_id) or user_id=(select auth.uid()));
create table public.helpful_answers(
 post_id uuid primary key references public.posts(id) on delete cascade,
 comment_id uuid not null unique references public.post_comments(id) on delete cascade,
 marked_by uuid references public.profiles(id) on delete set null
);
create index helpful_answers_marker on public.helpful_answers(marked_by);
alter table public.helpful_answers enable row level security;
revoke all on public.helpful_answers from public,anon,authenticated;
grant select,insert,update,delete on public.helpful_answers to authenticated;
create policy "Members read helpful answers" on public.helpful_answers for select to authenticated using(exists(select 1 from public.post_comments c where c.id=comment_id and c.post_id=helpful_answers.post_id));
create policy "Authors or hosts mark helpful answers" on public.helpful_answers for insert to authenticated with check(marked_by=(select auth.uid()) and exists(select 1 from public.posts p join public.post_comments c on c.post_id=p.id where p.id=helpful_answers.post_id and c.id=comment_id and (p.author_id=(select auth.uid()) or private.circle_host(p.circle_id))));
create policy "Authors or hosts update helpful answers" on public.helpful_answers for update to authenticated using(exists(select 1 from public.posts p where p.id=post_id and (p.author_id=(select auth.uid()) or private.circle_host(p.circle_id)))) with check(marked_by=(select auth.uid()) and exists(select 1 from public.posts p join public.post_comments c on c.post_id=p.id where p.id=helpful_answers.post_id and c.id=comment_id and (p.author_id=(select auth.uid()) or private.circle_host(p.circle_id))));
create policy "Authors or hosts unmark helpful answers" on public.helpful_answers for delete to authenticated using(exists(select 1 from public.posts p where p.id=post_id and (p.author_id=(select auth.uid()) or private.circle_host(p.circle_id))));

create table public.circle_invites(
 token text primary key default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),
 circle_id uuid not null references public.circles(id) on delete cascade,
 created_by uuid not null references public.profiles(id) on delete cascade,
 preview_name boolean not null default false, expires_at timestamptz not null default now()+interval '7 days',
 created_at timestamptz not null default now(), check(expires_at>created_at and expires_at<=created_at+interval '30 days')
);
create index circle_invites_circle on public.circle_invites(circle_id);
create index circle_invites_creator on public.circle_invites(created_by);
alter table public.circle_invites enable row level security;
revoke all on public.circle_invites from public,anon,authenticated;
grant select,insert,delete on public.circle_invites to authenticated;
create policy "Hosts read invites" on public.circle_invites for select to authenticated using(private.circle_host(circle_id));
create policy "Hosts create invites" on public.circle_invites for insert to authenticated with check(private.circle_host(circle_id) and created_by=(select auth.uid()));
create policy "Hosts revoke invites" on public.circle_invites for delete to authenticated using(private.circle_host(circle_id));
-- Deliberately public preview returns only approved metadata, never member names or private content.
create function private.invite_preview(invite_token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('name',case when not c.is_private or i.preview_name then c.name else 'A private circle' end,
 'description',case when not c.is_private then c.description else 'Membership requires host approval.' end,
 'private',c.is_private,'expiresAt',i.expires_at)
 from public.circle_invites i join public.circles c on c.id=i.circle_id where i.token=invite_token and i.expires_at>now();
$$;
create function public.invite_preview(invite_token text) returns jsonb language sql stable security invoker set search_path='' as $$ select private.invite_preview(invite_token); $$;
revoke all on function private.invite_preview(text),public.invite_preview(text) from public;
grant execute on function private.invite_preview(text),public.invite_preview(text) to anon,authenticated,service_role;
create function private.redeem_circle_invite(invite_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid; status text;
begin
 if (select auth.uid()) is null then raise exception 'Sign in to join'; end if;
 select circle_id into target from public.circle_invites where token=invite_token and expires_at>now();
 if target is null then raise exception 'This invitation has expired or was revoked'; end if;
 status:=public.request_circle_membership(target);
 return jsonb_build_object('circleId',target,'status',status);
end; $$;
create function public.redeem_circle_invite(invite_token text) returns jsonb language sql security invoker set search_path='' as $$ select private.redeem_circle_invite(invite_token); $$;
revoke all on function private.redeem_circle_invite(text),public.redeem_circle_invite(text) from public,anon;
grant execute on function private.redeem_circle_invite(text),public.redeem_circle_invite(text) to authenticated;

alter table public.post_media add column position integer not null default 0 check(position between 0 and 9);
alter table public.post_media add column cover_path text;
alter table public.post_media add column subtitles jsonb not null default '[]'::jsonb check(jsonb_typeof(subtitles)='array' and jsonb_array_length(subtitles)<=100);
create function private.validate_media_details() returns trigger language plpgsql set search_path='' as $$
declare cue jsonb; existing_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.post_id::text,0));
 select count(*) into existing_count from public.post_media where post_id=new.post_id;
 if existing_count>=10 or (existing_count>0 and (new.kind<>'image' or exists(select 1 from public.post_media where post_id=new.post_id and kind<>'image'))) then raise exception 'Choose up to 10 photos, or one video or GIF'; end if;
 if new.cover_path is not null and new.cover_path not like new.owner_id::text||'/'||new.post_id::text||'/%' then raise exception 'Cover must belong to this post'; end if;
 for cue in select * from jsonb_array_elements(new.subtitles) loop
  if jsonb_typeof(cue) is distinct from 'object' or jsonb_typeof(cue->'text') is distinct from 'string' or jsonb_typeof(cue->'start') is distinct from 'number' or jsonb_typeof(cue->'end') is distinct from 'number' or char_length(trim(cue->>'text')) not between 1 and 300 or (cue->>'start')::numeric<0 or (cue->>'end')::numeric<=(cue->>'start')::numeric or (cue->>'end')::numeric>120 then raise exception 'Invalid subtitle timing'; end if;
 end loop;
 return new;
end; $$;
revoke all on function private.validate_media_details() from public,anon,authenticated;
create trigger validate_media_details before insert on public.post_media for each row execute function private.validate_media_details();

create table public.catchup_checkpoints(
 user_id uuid primary key references public.profiles(id) on delete cascade,
 caught_up_at timestamptz not null default now(), digest_after timestamptz not null default now()+interval '7 days'
);
alter table public.catchup_checkpoints enable row level security;
revoke all on public.catchup_checkpoints from public,anon,authenticated;
grant select on public.catchup_checkpoints to authenticated;
create policy "Own catch-up checkpoint" on public.catchup_checkpoints for select to authenticated using(user_id=(select auth.uid()));
create function private.mark_caught_up() returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
 insert into public.catchup_checkpoints(user_id) values((select auth.uid())) on conflict(user_id) do update set caught_up_at=now();
end; $$;
create function public.mark_caught_up() returns void language sql security invoker set search_path='' as $$ select private.mark_caught_up(); $$;
revoke all on function private.mark_caught_up(),public.mark_caught_up() from public,anon;
grant execute on function private.mark_caught_up(),public.mark_caught_up() to authenticated;
create function public.get_catchup() returns jsonb language sql stable security invoker set search_path='' as $$
 with checkpoint as (select coalesce((select caught_up_at from public.catchup_checkpoints where user_id=(select auth.uid())),now()-interval '7 days') since),
 posts as (select p.id,p.circle_id,p.body,p.created_at,p.post_type from public.posts p,checkpoint where p.visibility='published' and p.created_at>checkpoint.since and p.author_id<>(select auth.uid()) order by p.created_at desc limit 30),
 unanswered as (select p.id,p.circle_id,p.body from public.posts p where p.visibility='published' and p.post_type='question' and not exists(select 1 from public.post_comments c where c.post_id=p.id) order by p.created_at desc limit 10),
 events as (select e.id,e.circle_id,e.title,e.starts_at from public.circle_events e where private.is_circle_member(e.circle_id,(select auth.uid())) and e.starts_at>now() and e.starts_at<now()+interval '7 days' order by e.starts_at limit 10),
 replies as (select n.id,n.target_id,n.title,n.created_at from public.notifications n,checkpoint where n.kind='replies' and n.created_at>checkpoint.since order by n.created_at desc limit 20)
 select jsonb_build_object('since',(select since from checkpoint),'posts',coalesce((select jsonb_agg(posts) from posts),'[]'::jsonb),'unanswered',coalesce((select jsonb_agg(unanswered) from unanswered),'[]'::jsonb),'events',coalesce((select jsonb_agg(events) from events),'[]'::jsonb),'replies',coalesce((select jsonb_agg(replies) from replies),'[]'::jsonb));
$$;
revoke all on function public.get_catchup() from public,anon;
grant execute on function public.get_catchup() to authenticated;
alter table public.notification_preferences add column digests boolean not null default false;
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in ('messages','replies','memberships','live','events','digests'));
create function private.enqueue_weekly_digests() returns void language plpgsql security definer set search_path='' as $$
declare item record;
begin
 insert into public.catchup_checkpoints(user_id) select user_id from public.notification_preferences where digests on conflict do nothing;
 for item in select c.user_id from public.catchup_checkpoints c join public.notification_preferences p on p.user_id=c.user_id where p.digests and c.digest_after<=now() for update of c skip locked loop
  perform private.notify_member(item.user_id,null,'digests',null,item.user_id,'Your weekly catch-up','Open Circles for new conversations and upcoming events.','digest:'||date_trunc('week',now() at time zone 'UTC')::date);
  update public.catchup_checkpoints set digest_after=now()+interval '7 days' where user_id=item.user_id;
 end loop;
end; $$;
revoke all on function private.enqueue_weekly_digests() from public,anon,authenticated;

-- Validate direct API calls as well as the composer RPC.
create function private.validate_poll() returns trigger language plpgsql set search_path='' as $$
declare item jsonb;
begin
 for item in select * from jsonb_array_elements(new.options) loop
  if jsonb_typeof(item) is distinct from 'string' or char_length(trim(item#>>'{}')) not between 1 and 120 then raise exception 'Poll options must contain 1–120 characters'; end if;
 end loop;
 if (select count(distinct lower(trim(value))) from jsonb_array_elements_text(new.options))<>jsonb_array_length(new.options) then raise exception 'Use different poll options'; end if;
 if new.closes_at<=now() or new.closes_at>now()+interval '30 days' then raise exception 'Poll must close within 30 days'; end if;
 return new;
end; $$;
revoke all on function private.validate_poll() from public,anon,authenticated;
create trigger validate_poll before insert on public.post_polls for each row execute function private.validate_poll();
grant usage on schema private to anon;

create function public.personal_feed(sort_mode text default 'recommended',page_offset integer default 0,page_size integer default 20)
returns table(id uuid,reason text) language sql stable security invoker set search_path='' as $$
 select p.id,case when sort_mode='latest' then 'Newest in your circles' when f.favourite then 'From a favourite circle' when c.interest=any(coalesce(me.interests,'{}')) then 'Matches your interests: '||c.interest else 'A conversation in a circle you joined' end
 from public.posts p join public.circles c on c.id=p.circle_id
 left join public.profiles me on me.id=(select auth.uid())
 left join public.feed_preferences f on f.circle_id=p.circle_id and f.user_id=(select auth.uid())
 where p.visibility='published' and private.is_circle_member(p.circle_id,(select auth.uid()))
 and (f.snoozed_until is null or f.snoozed_until<=now())
 and not exists(select 1 from public.hidden_posts h where h.post_id=p.id and h.user_id=(select auth.uid()))
 order by case when sort_mode='latest' then 0 else (case when f.favourite then 40 else 0 end)+(case when c.interest=any(coalesce(me.interests,'{}')) then 15 else 0 end)-(case when f.see_less then 60 else 0 end)+greatest(0,30-extract(epoch from (now()-p.created_at))/86400) end desc,p.created_at desc,p.id desc
 limit least(greatest(page_size,1),50) offset greatest(page_offset,0);
$$;
revoke all on function public.personal_feed(text,integer,integer) from public,anon;
grant execute on function public.personal_feed(text,integer,integer) to authenticated;

create function public.circle_chat_inbox() returns table(circle_id uuid,unread bigint,muted boolean) language sql stable security invoker set search_path='' as $$
 select s.circle_id,count(m.id),coalesce(pref.muted,false) from public.circle_chat_settings s
 left join public.circle_chat_preferences pref on pref.circle_id=s.circle_id and pref.user_id=(select auth.uid())
 left join public.circle_chat_messages m on m.circle_id=s.circle_id and m.author_id<>(select auth.uid()) and m.created_at>coalesce(pref.read_at,'epoch'::timestamptz)
 where s.enabled and private.is_circle_member(s.circle_id,(select auth.uid())) group by s.circle_id,pref.muted;
$$;
revoke all on function public.circle_chat_inbox() from public,anon;
grant execute on function public.circle_chat_inbox() to authenticated;

-- Explicit service access for retention and account deletion.
grant all on public.feed_preferences,public.hidden_posts,public.circle_topics,public.post_polls,public.poll_votes,public.circle_prompts,public.circle_collections,public.collection_posts,public.circle_chat_settings,public.circle_chat_messages,public.circle_chat_preferences,public.message_attachments,public.circle_recognition,public.helpful_answers,public.circle_invites,public.catchup_checkpoints to service_role;

-- runtime-schedule:start
select cron.schedule('circles-community-prompts','0 * * * *','select private.publish_weekly_prompts();');
select cron.schedule('circles-weekly-digests','0 * * * *','select private.enqueue_weekly_digests();');
alter publication supabase_realtime add table public.poll_votes,public.circle_chat_messages,public.circle_chat_settings,public.circle_recognition,public.helpful_answers;
-- runtime-schedule:end
