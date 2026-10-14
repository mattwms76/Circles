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
