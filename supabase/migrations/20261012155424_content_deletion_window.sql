-- A caller cannot supply a younger timestamp to extend the deletion window.
alter table public.direct_messages alter column created_at set default clock_timestamp();
alter table public.post_comments alter column created_at set default clock_timestamp();
revoke insert on public.direct_messages, public.post_comments from public, anon, authenticated;
revoke insert (created_at) on public.direct_messages, public.post_comments from public, anon, authenticated;
grant insert (sender_id, recipient_id, body) on public.direct_messages to authenticated;
grant insert (post_id, author_id, body) on public.post_comments to authenticated;

-- Existing SELECT policies still enforce mutual follows, blocks, and circle access.
grant delete on public.direct_messages, public.post_comments to authenticated;
drop policy if exists "Senders delete recent messages" on public.direct_messages;
create policy "Senders delete recent messages" on public.direct_messages
for delete to authenticated using (
  sender_id = (select auth.uid())
  and created_at <= clock_timestamp()
  and created_at > clock_timestamp() - interval '15 minutes'
);
drop policy if exists "Authors delete recent comments" on public.post_comments;
create policy "Authors delete recent comments" on public.post_comments
for delete to authenticated using (
  author_id = (select auth.uid())
  and created_at <= clock_timestamp()
  and created_at > clock_timestamp() - interval '15 minutes'
);

-- Recheck after acquiring the row lock, in case a blocked DELETE outlives its window.
-- Trusted moderation and account cleanup retain their existing unrestricted access.
create or replace function private.enforce_content_delete_window()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' and pg_trigger_depth() = 1 then
    if (select auth.uid()) is null
      or coalesce(to_jsonb(old)->>'sender_id', to_jsonb(old)->>'author_id') <> (select auth.uid())::text
      or old.created_at > clock_timestamp()
      or old.created_at <= clock_timestamp() - interval '15 minutes' then
      raise exception 'You can only delete your own content within 15 minutes of sending it.' using errcode = '42501';
    end if;
  end if;
  return old;
end;
$$;
revoke all on function private.enforce_content_delete_window() from public, anon, authenticated;
drop trigger if exists enforce_message_delete_window on public.direct_messages;
create trigger enforce_message_delete_window before delete on public.direct_messages
for each row execute function private.enforce_content_delete_window();
drop trigger if exists enforce_comment_delete_window on public.post_comments;
create trigger enforce_comment_delete_window before delete on public.post_comments
for each row execute function private.enforce_content_delete_window();

-- Remove activity and queued pushes for the deleted item, including the recipient's
-- notification. Only the trigger can call this cross-account cleanup function.
create or replace function private.remove_deleted_content_notification()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications
  where dedupe_key = (case when tg_table_name = 'direct_messages' then 'message:' else 'reply:' end) || old.id::text;
  return old;
end;
$$;
revoke all on function private.remove_deleted_content_notification() from public, anon, authenticated;
drop trigger if exists remove_deleted_message_notification on public.direct_messages;
create trigger remove_deleted_message_notification after delete on public.direct_messages
for each row execute function private.remove_deleted_content_notification();
drop trigger if exists remove_deleted_comment_notification on public.post_comments;
create trigger remove_deleted_comment_notification after delete on public.post_comments
for each row execute function private.remove_deleted_content_notification();
