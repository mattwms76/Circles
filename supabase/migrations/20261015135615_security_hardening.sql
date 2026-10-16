-- Security audit S01, S07-S10. Apply after the canonical bootstrap manifest.
-- No existing content is deleted by this migration.
create table private.write_budgets (
 user_id uuid references public.profiles(id) on delete cascade,
 action text not null, window_start timestamptz not null, used integer not null,
 primary key(user_id,action,window_start)
);
alter table private.write_budgets enable row level security;
revoke all on private.write_budgets from public,anon,authenticated;
grant all on private.write_budgets to service_role;

create function private.consume_budget(action_name text, minute_limit integer, day_limit integer)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid:=(select auth.uid()); stamp timestamptz:=clock_timestamp(); amount integer;
begin
 if caller is null then return; end if;
 perform pg_advisory_xact_lock(hashtextextended(caller::text||':budget:'||action_name,0));
 insert into private.write_budgets values(caller,action_name||':minute',date_trunc('minute',stamp),1)
 on conflict(user_id,action,window_start) do update set used=private.write_budgets.used+1 returning used into amount;
 if amount>minute_limit then raise exception 'Please wait a minute before trying again' using errcode='P0001'; end if;
 insert into private.write_budgets values(caller,action_name||':day',date_trunc('day',stamp),1)
 on conflict(user_id,action,window_start) do update set used=private.write_budgets.used+1 returning used into amount;
 if amount>day_limit then raise exception 'Daily activity limit reached. Please try again tomorrow' using errcode='P0001'; end if;
end; $$;
revoke all on function private.consume_budget(text,integer,integer) from public,anon,authenticated;

create function private.limit_content_writes() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null then return new; end if;
 case tg_table_name
 when 'posts' then perform private.consume_budget('posts',10,200);
 when 'direct_messages' then
  perform private.consume_budget('messages',30,1000);
  perform private.consume_budget('message-to:'||new.recipient_id::text,20,500);
 when 'post_comments' then perform private.consume_budget('comments',30,500);
 when 'circle_chat_messages' then perform private.consume_budget('chat',60,2000);
 when 'circle_stories' then perform private.consume_budget('stories',10,100);
 when 'reports' then perform private.consume_budget('reports',5,30);
 when 'circles' then perform private.consume_budget('circles',3,20);
 when 'profiles' then perform private.consume_budget('profile-updates',10,200);
 else raise exception 'Unsupported write budget';
 end case;
 return new;
end; $$;
create trigger limit_profile_updates before update on public.profiles for each row execute function private.limit_content_writes();

alter table public.profiles add constraint bounded_profile_fields check(
 char_length(display_name) between 1 and 80 and char_length(handle) between 3 and 32
 and char_length(bio)<=1000 and char_length(coalesce(avatar_url,''))<=2048
 and cardinality(interests)<=20 and char_length(array_to_string(interests,','))<=1000
);
alter table public.circles add constraint bounded_circle_fields check(char_length(description)<=2000 and char_length(interest) between 1 and 64 and char_length(coalesce(cover_url,''))<=2048);
create or replace function private.bootstrap_profile() returns trigger language plpgsql security definer set search_path='' as $$
declare chosen_handle text;
begin
 chosen_handle:=lower(regexp_replace(coalesce(new.raw_user_meta_data->>'handle',split_part(coalesce(new.email,'member'),'@',1)),'[^a-zA-Z0-9_]','','g'));
 if chosen_handle='' then chosen_handle:='member'; end if;
 insert into public.profiles(id,handle,display_name) values(new.id,left(chosen_handle,24)||'_'||left(replace(new.id::text,'-',''),6),left(coalesce(nullif(new.raw_user_meta_data->>'display_name',''),'New member'),80)) on conflict(id) do nothing;
 insert into public.coin_wallets(user_id) values(new.id) on conflict(user_id) do nothing;
 return new;
end; $$;
revoke all on function private.limit_content_writes() from public,anon,authenticated;
do $$ declare target text; begin
 foreach target in array array['posts','direct_messages','post_comments','circle_chat_messages','circle_stories','reports','circles'] loop
 execute format('create trigger limit_content_writes before insert on public.%I for each row execute function private.limit_content_writes()',target);
 end loop;
end; $$;

drop policy "Join public circles or request private access" on public.circle_memberships;
create policy "Join public circles or request private access" on public.circle_memberships for insert to authenticated
with check(user_id=(select auth.uid()) and role='member' and
 ((private.is_public_circle(circle_id) and status='member') or status='pending'));

-- A policy helper runs outside message RLS but only answers about the caller's own path.
-- The same path lock is taken while attaching media, closing attach/delete races.
create function private.community_upload_unattached(path text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or split_part(path,'/',1)<>(select auth.uid())::text then return false; end if;
 perform pg_advisory_xact_lock(hashtextextended('community-media:'||path,0));
 return not exists(select 1 from public.circle_chat_messages where media_path=path)
 and not exists(select 1 from public.message_attachments where storage_path=path);
end; $$;
revoke all on function private.community_upload_unattached(text) from public,anon;
grant execute on function private.community_upload_unattached(text) to authenticated;
drop policy "Owners discard unattached community media" on storage.objects;
create policy "Owners discard unattached community media" on storage.objects for delete to authenticated
using(bucket_id='community-media' and private.community_upload_unattached(name));

create function private.lock_message_media() returns trigger language plpgsql security definer set search_path='' as $$
declare path text; sent timestamptz;
begin
 if tg_table_name='message_attachments' then
  path:=new.storage_path;
  select created_at into sent from public.direct_messages where id=new.message_id and sender_id=(select auth.uid());
  if (select auth.uid()) is not null and (sent is null or sent<=clock_timestamp()-interval '15 minutes') then
   raise exception 'This message can no longer be changed' using errcode='42501';
  end if;
 else path:=new.media_path; end if;
 if path is not null then
  perform pg_advisory_xact_lock(hashtextextended('community-media:'||path,0));
  if not exists(select 1 from storage.objects where bucket_id='community-media' and name=path) then
   raise exception 'Upload this attachment first' using errcode='42501';
  end if;
 end if;
 return new;
end; $$;
revoke all on function private.lock_message_media() from public,anon,authenticated;
create trigger lock_message_media before insert on public.message_attachments for each row execute function private.lock_message_media();
create trigger lock_message_media before insert on public.circle_chat_messages for each row execute function private.lock_message_media();

alter table public.posts add column upload_pending boolean not null default false;
alter table public.posts add column upload_expired boolean not null default false;
create function private.stamp_post() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' and current_user='authenticated' then new.created_at:=clock_timestamp(); end if;
 if tg_op='UPDATE' and old.upload_expired and new.visibility='published' then raise exception 'This upload expired. Discard the draft and choose media again'; end if;
 if new.visibility='published' then new.upload_pending:=false; end if;
 return new;
end; $$;
revoke all on function private.stamp_post() from public,anon,authenticated;
create trigger stamp_post before insert or update on public.posts for each row execute function private.stamp_post();

-- Deferred checks allow the atomic poll RPC to insert its options after the post.
create function private.validate_published_post() returns trigger language plpgsql security definer set search_path='' as $$
declare item public.posts; target uuid;
begin
 if tg_table_name='posts' then target:=new.id; else target:=new.post_id; end if;
 select * into item from public.posts where id=target;
 if not found or item.visibility<>'published' then return null; end if;
 if item.post_type='poll' and not exists(select 1 from public.post_polls where post_id=item.id) then
  raise exception 'Add poll options before publishing';
 end if;
 if char_length(trim(item.body))=0 and not exists(select 1 from public.post_media where post_id=item.id) then
  raise exception 'Add text or media before publishing';
 end if;
 return null;
end; $$;
revoke all on function private.validate_published_post() from public,anon,authenticated;
create constraint trigger validate_published_post after insert or update on public.posts deferrable initially deferred for each row execute function private.validate_published_post();
create constraint trigger validate_published_media after insert or update on public.post_media deferrable initially deferred for each row execute function private.validate_published_post();

-- Keep the valid operations expressed by RLS, but replace inherited ALL grants with
-- explicit operation/column grants. New columns do not inherit these client rights.
do $$ declare item record; operation text; columns text; allowed text[]; original_ops text[]; begin
 for item in select c.oid,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' loop
  select array_agg(op) into original_ops from unnest(array['SELECT','INSERT','UPDATE','DELETE']) op
  where case when op in ('INSERT','UPDATE') then has_any_column_privilege('authenticated',item.oid,op) else has_table_privilege('authenticated',item.oid,op) end;
  execute format('revoke all on public.%I from public,anon,authenticated',item.relname);
  -- Revoke independent column grants as well as table grants.
  select string_agg(quote_ident(attname),',') into columns from pg_attribute where attrelid=item.oid and attnum>0 and not attisdropped;
  execute format('revoke select(%s),insert(%s),update(%s),references(%s) on public.%I from public,anon,authenticated',columns,columns,columns,columns,item.relname);
  foreach operation in array array['SELECT','INSERT','UPDATE','DELETE'] loop
   if original_ops is null or operation<>all(original_ops) then continue; end if;
   if not exists(select 1 from pg_policies where schemaname='public' and tablename=item.relname and (cmd=operation or cmd='ALL') and 'authenticated'=any(roles::text[])) then continue; end if;
   if operation in ('SELECT','DELETE') then
    execute format('grant %s on public.%I to authenticated',operation,item.relname);
   else
    allowed:=null;
    if operation='INSERT' then
     case item.relname
      when 'posts' then allowed:=array['id','circle_id','author_id','body','visibility','client_request_id','post_type','topic_id','upload_pending'];
      when 'direct_messages' then allowed:=array['id','sender_id','recipient_id','body','reply_to_id'];
      when 'post_comments' then allowed:=array['post_id','author_id','body','reply_to_id'];
      when 'reports' then allowed:=array['reporter_id','target_type','target_id','reason'];
      when 'circles' then allowed:=array['owner_id','name','description','interest','is_private'];
      else null;
     end case;
    end if;
    if operation='UPDATE' then
     case item.relname
      when 'circle_memberships' then allowed:=array['status'];
      when 'profiles' then allowed:=array['handle','display_name','avatar_url','bio','interests'];
      when 'circles' then allowed:=array['name','description','interest','is_private','cover_url','cover_color'];
      when 'posts' then allowed:=array['body','visibility','topic_id'];
      when 'direct_messages' then allowed:=array['read_at'];
      when 'notifications' then allowed:=array['read_at'];
      when 'poll_votes' then allowed:=array['option_index','post_id','user_id'];
      else null;
     end case;
    end if;
    select string_agg(quote_ident(attname),',') into columns from pg_attribute where attrelid=item.oid and attnum>0 and not attisdropped and
     ((allowed is not null and attname=any(allowed)) or (allowed is null and attname<>all(array['created_at','joined_at','updated_at','reviewed_by','resolution_note','reviewed_at','balance','coin_value','members_count','moderation_locked']) and (item.relname<>'circle_memberships' or attname<>'role')));
    if columns is not null then execute format('grant %s(%s) on public.%I to authenticated',operation,columns,item.relname); end if;
   end if;
  end loop;
 end loop;
end; $$;
alter default privileges in schema public revoke all on tables from public,anon,authenticated;
-- PUBLIC EXECUTE is a global Postgres default; a per-schema REVOKE alone cannot remove it.
alter default privileges revoke execute on functions from public,anon,authenticated;
alter default privileges in schema public revoke all on sequences from public,anon,authenticated;
-- The chat BEFORE trigger always overwrites supplied timestamps, including forged values.
grant insert(created_at) on public.circle_chat_messages to authenticated;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated;
alter default privileges in schema private revoke all on tables from public,anon,authenticated;
alter default privileges in schema private revoke execute on functions from public,anon,authenticated;

create function private.reserve_upload(bucket text,path text) returns boolean language plpgsql security definer set search_path='' as $$
declare caller uuid:=(select auth.uid()); objects bigint; bytes numeric; incoming bigint;
begin
 if caller is null or split_part(path,'/',1)<>caller::text or bucket<>all(array['post-media','story-media','community-media','avatars']) then return false; end if;
 if bucket='post-media' and exists(select 1 from public.posts where id::text=split_part(path,'/',2) and upload_expired) then raise exception 'This upload expired. Start a new draft'; end if;
 perform pg_advisory_xact_lock(hashtextextended(caller::text||':storage',0));
 select file_size_limit into incoming from storage.buckets where id=bucket;
 select count(*),coalesce(sum(case when (o.metadata->>'size')~'^[0-9]+$' then (o.metadata->>'size')::numeric else b.file_size_limit end),0)
 into objects,bytes from storage.objects o join storage.buckets b on b.id=o.bucket_id
 where split_part(o.name,'/',1)=caller::text and o.bucket_id=any(array['post-media','story-media','community-media','avatars']);
 if objects>=500 or bytes+incoming>2147483648 then raise exception 'Media storage limit reached. Remove unused uploads before adding more'; end if;
 perform private.consume_budget('uploads',20,200);
 return true;
end; $$;
revoke all on function private.reserve_upload(text,text) from public,anon;
grant execute on function private.reserve_upload(text,text) to authenticated;
create policy "Account upload budget" on storage.objects as restrictive for insert to authenticated with check(private.reserve_upload(bucket_id,name));

-- Unfinished upload retention is distinct from intentionally removed posts.
create table public.post_media_cleanup(storage_path text primary key,queued_at timestamptz not null default now());
alter table public.post_media_cleanup enable row level security;
revoke all on public.post_media_cleanup from public,anon,authenticated;
grant all on public.post_media_cleanup to service_role;
create function private.lock_post_media() returns trigger language plpgsql security definer set search_path='' as $$
declare parent public.posts; path text;
begin
 select * into parent from public.posts where id=new.post_id for update;
 if not found or parent.author_id<>new.owner_id or parent.upload_expired then raise exception 'This upload is unavailable'; end if;
 foreach path in array array[new.storage_path,new.cover_path] loop
  if path is null then continue; end if;
  if path not like new.owner_id::text||'/'||new.post_id::text||'/%' then raise exception 'Upload media to this post first' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('post-media:'||path,0));
  if exists(select 1 from public.post_media_cleanup where storage_path=path) or not exists(select 1 from storage.objects where bucket_id='post-media' and name=path) then
   raise exception 'This upload expired or is missing. Choose media again';
  end if;
 end loop;
 return new;
end; $$;
revoke all on function private.lock_post_media() from public,anon,authenticated;
create trigger lock_post_media before insert on public.post_media for each row execute function private.lock_post_media();
create function private.queue_abandoned_post_media() returns void language plpgsql security definer set search_path='' as $$
declare candidate record; parent public.posts;
begin
 for candidate in select o.name from storage.objects o where o.bucket_id='post-media' and o.created_at<now()-interval '7 days'
 and not exists(select 1 from public.post_media_cleanup where storage_path=o.name)
 and (not exists(select 1 from public.posts p where p.id::text=split_part(o.name,'/',2)) or exists(select 1 from public.posts p where p.id::text=split_part(o.name,'/',2) and p.upload_pending and p.visibility='removed' and p.created_at<now()-interval '7 days')) limit 100 loop
  -- Same lock order as registration: parent row, then object path.
  select * into parent from public.posts where id::text=split_part(candidate.name,'/',2) for update;
  if found then
   if not(parent.upload_pending and parent.visibility='removed' and parent.created_at<now()-interval '7 days') then continue; end if;
   update public.posts set upload_expired=true where id=parent.id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('post-media:'||candidate.name,0));
  if not exists(select 1 from public.posts where id::text=split_part(candidate.name,'/',2) and (visibility='published' or not upload_pending)) then
   insert into public.post_media_cleanup(storage_path) values(candidate.name) on conflict do nothing;
  end if;
 end loop;
 delete from private.write_budgets where window_start<now()-interval '2 days';
end; $$;
create function public.queue_abandoned_post_media() returns void language sql set search_path='' as $$select private.queue_abandoned_post_media();$$;
revoke all on function private.queue_abandoned_post_media(),public.queue_abandoned_post_media() from public,anon,authenticated;
grant execute on function private.queue_abandoned_post_media(),public.queue_abandoned_post_media() to service_role;

-- Record independently verified transaction provenance before wallet credit.
create table private.store_transactions(
 store text not null check(store in ('apple','google')), transaction_id text not null,
 environment text not null check(environment='production'), user_id uuid not null references public.profiles(id) on delete cascade,
 product_id text not null, verified_at timestamptz not null default now(), primary key(store,transaction_id)
);
alter table private.store_transactions enable row level security;
revoke all on private.store_transactions from public,anon,authenticated;
grant all on private.store_transactions to service_role;
create function public.credit_verified_purchase(p_user_id uuid,p_product_id text,p_store text,p_transaction_id text,p_environment text)
returns bigint language plpgsql set search_path='' as $$
begin
 return private.credit_verified_purchase(p_user_id,p_product_id,p_store,p_transaction_id,p_environment);
end; $$;
create function private.credit_verified_purchase(p_user_id uuid,p_product_id text,p_store text,p_transaction_id text,p_environment text)
returns bigint language plpgsql security definer set search_path='' as $$
declare saved private.store_transactions;
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' or p_environment is distinct from 'production' then raise exception 'Verified production purchase required' using errcode='42501'; end if;
 insert into private.store_transactions(store,transaction_id,environment,user_id,product_id) values(p_store,p_transaction_id,p_environment,p_user_id,p_product_id) on conflict do nothing;
 select * into saved from private.store_transactions where store=p_store and transaction_id=p_transaction_id for update;
 if saved.user_id is distinct from p_user_id or saved.product_id is distinct from p_product_id then raise exception 'Purchase already belongs to a different account or product'; end if;
 return public.credit_coin_purchase(p_user_id,p_product_id,p_store||':'||p_transaction_id);
end; $$;
revoke all on function public.credit_verified_purchase(uuid,text,text,text,text),private.credit_verified_purchase(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.credit_verified_purchase(uuid,text,text,text,text),private.credit_verified_purchase(uuid,text,text,text,text) to service_role;

-- Device-held capability permits retrying deregistration after an account switch,
-- without granting the new account arbitrary access to the old account's devices.
alter table public.device_push_tokens add column device_key uuid;
revoke all on function public.register_push_token(text),private.register_push_token(text) from public,anon,authenticated;
create function private.register_push_token(push_token text,device_key uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null or device_key is null then raise exception 'Device authentication required' using errcode='42501'; end if;
 insert into public.device_push_tokens(user_id,token,device_key) values((select auth.uid()),push_token,device_key)
 on conflict(token) do update set user_id=excluded.user_id,device_key=excluded.device_key,updated_at=now();
end; $$;
create function public.register_push_token(push_token text,device_key uuid) returns void language sql set search_path='' as $$ select private.register_push_token(push_token,device_key); $$;
create function private.unregister_push_device(push_token text,device_key uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if (select auth.uid()) is null then raise exception 'Sign in required' using errcode='42501'; end if;
 delete from public.device_push_tokens t where t.token=push_token and t.device_key=unregister_push_device.device_key;
end; $$;
create function public.unregister_push_device(push_token text,device_key uuid) returns void language sql set search_path='' as $$ select private.unregister_push_device(push_token,device_key); $$;
revoke all on function public.register_push_token(text,uuid),private.register_push_token(text,uuid),public.unregister_push_device(text,uuid),private.unregister_push_device(text,uuid) from public,anon;
grant execute on function public.register_push_token(text,uuid),private.register_push_token(text,uuid),public.unregister_push_device(text,uuid),private.unregister_push_device(text,uuid) to authenticated;
