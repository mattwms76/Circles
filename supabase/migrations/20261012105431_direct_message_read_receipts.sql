alter table public.direct_messages add column if not exists read_at timestamptz;

create index if not exists direct_messages_unread
  on public.direct_messages (recipient_id, sender_id, read_at)
  where read_at is null;

drop policy if exists "Recipients mark mutual messages as read" on public.direct_messages;
create policy "Recipients mark mutual messages as read"
  on public.direct_messages for update to authenticated
  using (
    recipient_id = (select auth.uid())
    and exists (
      select 1 from public.follows a
      join public.follows b on b.follower_id = a.followee_id and b.followee_id = a.follower_id
      where a.follower_id = sender_id and a.followee_id = recipient_id
    )
    and not private.are_blocked(sender_id, recipient_id)
  )
  with check (
    recipient_id = (select auth.uid())
    and exists (
      select 1 from public.follows a
      join public.follows b on b.follower_id = a.followee_id and b.followee_id = a.follower_id
      where a.follower_id = sender_id and a.followee_id = recipient_id
    )
    and not private.are_blocked(sender_id, recipient_id)
  );
grant update (read_at) on public.direct_messages to authenticated;

create or replace function public.list_mutual_conversations()
returns table (conversation_id text, peer jsonb, unread_count integer, last_message jsonb)
language sql
security invoker
set search_path = ''
as $$
  select least((select auth.uid()), p.id)::text || ':' || greatest((select auth.uid()), p.id)::text,
    to_jsonb(p),
    (select count(*)::integer from public.direct_messages unread
      where unread.sender_id = p.id and unread.recipient_id = (select auth.uid()) and unread.read_at is null),
    (select jsonb_build_object('id', d.id, 'sender_id', d.sender_id, 'body', d.body, 'created_at', d.created_at)
      from public.direct_messages d
      where (d.sender_id = (select auth.uid()) and d.recipient_id = p.id)
        or (d.sender_id = p.id and d.recipient_id = (select auth.uid()))
      order by d.created_at desc limit 1)
  from public.profiles p
  where p.id <> (select auth.uid())
    and exists (
      select 1 from public.follows a
      join public.follows b on b.follower_id = a.followee_id and b.followee_id = a.follower_id
      where a.follower_id = (select auth.uid()) and a.followee_id = p.id
    )
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
    or not exists (
      select 1 from public.follows a
      join public.follows b on b.follower_id = a.followee_id and b.followee_id = a.follower_id
      where a.follower_id = (select auth.uid()) and a.followee_id = peer_user_id
    )
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
