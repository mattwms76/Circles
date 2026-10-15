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
