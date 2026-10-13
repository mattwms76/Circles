-- Normalise and validate future comments without rewriting existing content.
create function private.normalise_comment_body() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 new.body := regexp_replace(new.body,'^[[:space:]]+|[[:space:]]+$','','g');
 if new.body is null or char_length(new.body) not between 1 and 2000 then
  raise exception 'Replies must contain 1–2000 characters' using errcode='23514';
 end if;
 return new;
end; $$;
revoke all on function private.normalise_comment_body() from public,anon,authenticated;
create trigger normalise_comment_body before insert or update of body on public.post_comments
for each row execute function private.normalise_comment_body();

-- The existing trigger notifies the post author. Also notify a different comment
-- author when someone replies directly to them, using the same deletion key.
create function private.notify_comment_recipient() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient uuid; post_author uuid; target_circle uuid;
begin
 if (select auth.uid()) is null or new.author_id is distinct from (select auth.uid()) or new.reply_to_id is null then return new; end if;
 select c.author_id,p.author_id,p.circle_id into recipient,post_author,target_circle
 from public.post_comments c join public.posts p on p.id=c.post_id
 where c.id=new.reply_to_id and c.post_id=new.post_id;
 if recipient is not null and recipient is distinct from post_author and private.is_circle_member(target_circle,recipient) then
  perform private.notify_member(recipient,new.author_id,'replies',target_circle,new.post_id,'New reply','Someone replied to your comment.','reply:'||new.id);
 end if;
 return new;
end; $$;
revoke all on function private.notify_comment_recipient() from public,anon,authenticated;
create trigger notify_comment_recipient after insert on public.post_comments
for each row execute function private.notify_comment_recipient();
