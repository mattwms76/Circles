-- Repair the six authorization failures found in the end-to-end audit.

-- A column grant does not override Supabase's existing table-level UPDATE grant.
revoke update on public.direct_messages from public, anon, authenticated;
revoke update (id, sender_id, recipient_id, body, created_at, read_at)
  on public.direct_messages from public, anon, authenticated;
grant update (read_at) on public.direct_messages to authenticated;

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

-- INSERT ... RETURNING, uploads, and publishing all need the author to see the draft.
drop policy if exists "Joined members read published circle posts" on public.posts;
create policy "Joined members read published circle posts" on public.posts for select to authenticated using (
  private.is_circle_member(circle_id, (select auth.uid())) and (
    (visibility = 'published' and not private.are_blocked((select auth.uid()), author_id))
    or (visibility = 'removed' and author_id = (select auth.uid()))
  )
);
-- Storage SELECT is also required when cleaning up a failed draft upload.
drop policy if exists "Members read media for posts they can read" on storage.objects;
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

-- Keep the wrapper invoker-only; the private function checks the host itself.
create or replace function private.heartbeat_live_session(target_session_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare heartbeat_at timestamptz;
begin
  update public.live_sessions set host_heartbeat_at = now()
  where id = target_session_id and host_id = (select auth.uid()) and status = 'live'
  returning host_heartbeat_at into heartbeat_at;
  if heartbeat_at is null then raise exception 'Live room not found or you are not the host'; end if;
  return heartbeat_at;
end;
$$;
create or replace function public.heartbeat_live_session(target_session_id uuid)
returns timestamptz language sql security invoker set search_path = '' as $$
  select private.heartbeat_live_session(target_session_id);
$$;
revoke all on function private.heartbeat_live_session(uuid), public.heartbeat_live_session(uuid) from public, anon;
grant execute on function private.heartbeat_live_session(uuid), public.heartbeat_live_session(uuid) to authenticated;

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
