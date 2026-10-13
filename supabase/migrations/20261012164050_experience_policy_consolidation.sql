-- Preserve access while evaluating one permissive policy per action.
drop policy "Circle moderators cancel events" on public.circle_events;
drop policy "Owners cancel events" on public.circle_events;
drop policy "Circle moderators schedule events" on public.circle_events;
drop policy "Owners schedule events" on public.circle_events;
create policy "Organisers cancel events" on public.circle_events for delete to authenticated using(private.is_circle_owner(circle_id,(select auth.uid())) or exists(select 1 from public.circle_memberships m where m.circle_id=circle_events.circle_id and m.user_id=(select auth.uid()) and m.role='moderator' and m.status='member'));
create policy "Organisers schedule events" on public.circle_events for insert to authenticated with check(creator_id=(select auth.uid()) and starts_at>now() and (private.is_circle_owner(circle_id,(select auth.uid())) or exists(select 1 from public.circle_memberships m where m.circle_id=circle_events.circle_id and m.user_id=(select auth.uid()) and m.role='moderator' and m.status='member')));
drop policy "Members read their membership and owners read requests" on public.circle_memberships;
drop policy "Members see circle roles" on public.circle_memberships;
create policy "Read own membership, member roles or owned circle requests" on public.circle_memberships for select to authenticated using(user_id=(select auth.uid()) or private.is_circle_owner(circle_id,(select auth.uid())) or (status='member' and private.is_circle_member(circle_id,(select auth.uid()))));

-- Delivery eligibility includes upcoming rooms and current conversation mutes.
create or replace function private.claim_notification_deliveries() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role','')<>'service_role' then raise exception 'Service role required'; end if;
 -- Suppress obsolete or newly muted notifications, including blocks and unfollows.
 update public.notification_deliveries set state='failed',last_error='Retry limit reached'
 where state in ('pending','processing') and attempts>=5 and available_at<=now();
 update public.notification_deliveries d set state='failed',last_error='No longer eligible'
 from public.notifications n left join public.notification_preferences p on p.user_id=n.user_id
 where d.notification_id=n.id and d.state in ('pending','processing') and
 (n.created_at<now()-interval '24 hours' or n.read_at is not null or not coalesce(p.push_enabled,false)
 or not coalesce((to_jsonb(p)->>n.kind)::boolean,true) or private.are_blocked(n.user_id,n.actor_id)
 or not exists(select 1 from public.device_push_tokens t where t.token=d.token and t.user_id=n.user_id)
 or (n.kind='live' and not exists(select 1 from public.live_sessions l where l.id=n.target_id and l.status='live') and not exists(select 1 from public.scheduled_live_rooms s join public.live_reminders r on r.room_id=s.id and r.user_id=n.user_id where s.id=n.target_id and s.status='scheduled' and s.starts_at>now()))
 or (n.kind='events' and not exists(select 1 from public.circle_events e where e.id=n.target_id and e.starts_at>now()))
 or (n.circle_id is not null and not private.is_circle_member(n.circle_id,n.user_id))
 or exists(select 1 from public.circle_notification_preferences cp where cp.user_id=n.user_id and cp.circle_id=n.circle_id and not cp.enabled)
 or (n.kind='messages' and exists(select 1 from public.conversation_preferences cp where cp.user_id=n.user_id and cp.peer_id=n.actor_id and cp.muted))
 or (n.kind='messages' and (not exists(select 1 from public.follows f where f.follower_id=n.user_id and f.followee_id=n.actor_id) or not exists(select 1 from public.follows f where f.follower_id=n.actor_id and f.followee_id=n.user_id))));
 with eligible as (
  select d.id from public.notification_deliveries d join public.notifications n on n.id=d.notification_id join public.notification_preferences p on p.user_id=n.user_id
  where d.state in ('pending','processing') and d.available_at<=now() and d.attempts<5
  and (not p.quiet_enabled or p.quiet_start=p.quiet_end or not(case when p.quiet_start<p.quiet_end
   then (now() at time zone p.timezone)::time>=p.quiet_start and (now() at time zone p.timezone)::time<p.quiet_end
   else (now() at time zone p.timezone)::time>=p.quiet_start or (now() at time zone p.timezone)::time<p.quiet_end end))
  order by d.available_at,d.id limit 50 for update of d skip locked
 ), claimed as (
  update public.notification_deliveries d set state='processing',attempts=attempts+1,available_at=now()+interval '5 minutes' from eligible e where d.id=e.id returning d.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'token',d.token,'attempts',d.attempts,'notificationId',n.id,'title',n.title,'body',n.body)), '[]'::jsonb) into result from claimed d join public.notifications n on n.id=d.notification_id;
 return result;
end; $$;
