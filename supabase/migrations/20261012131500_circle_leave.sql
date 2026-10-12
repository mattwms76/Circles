create policy "Members leave their own circles" on public.circle_memberships for delete to authenticated using (
  user_id = (select auth.uid()) and role <> 'owner'
);
grant delete on public.circle_memberships to authenticated;

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
