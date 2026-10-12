drop policy if exists "Members manage their own follows" on public.follows;
create policy "Members manage their own follows" on public.follows for all to authenticated using (
  follower_id = (select auth.uid())
) with check (
  follower_id = (select auth.uid()) and not private.are_blocked((select auth.uid()), followee_id)
);
create policy "Members remove follows for blocked users" on public.follows for delete to authenticated using (
  followee_id = (select auth.uid()) and private.are_blocked((select auth.uid()), follower_id)
);

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
