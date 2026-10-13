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
