-- Keep retention running even when device notifications are disabled or unconfigured.
insert into private.runtime_settings(key, value)
values ('story_cleanup_secret', gen_random_uuid()::text || gen_random_uuid()::text)
on conflict (key) do nothing;

create or replace function private.authorize_story_cleanup(provided_secret text)
returns boolean language sql security definer set search_path = '' as $$
  select provided_secret = (select value from private.runtime_settings where key = 'story_cleanup_secret');
$$;
create or replace function public.authorize_story_cleanup(provided_secret text)
returns boolean language sql security invoker set search_path = '' as $$
  select private.authorize_story_cleanup(provided_secret);
$$;
revoke all on function private.authorize_story_cleanup(text) from public, anon, authenticated;
revoke all on function public.authorize_story_cleanup(text) from public, anon, authenticated;
grant execute on function private.authorize_story_cleanup(text) to service_role;
grant execute on function public.authorize_story_cleanup(text) to service_role;

-- runtime-schedule:start
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create or replace function private.cleanup_story_media()
returns void language plpgsql security definer set search_path = '' as $$
declare endpoint text; secret text;
begin
  select value into endpoint from private.runtime_settings where key = 'story_cleanup_url';
  select value into secret from private.runtime_settings where key = 'story_cleanup_secret';
  if endpoint is not null then
    perform net.http_post(
      url := endpoint,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cleanup-secret', secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  end if;
end;
$$;
revoke all on function private.cleanup_story_media() from public, anon, authenticated;
select cron.schedule('circles-cleanup-story-media', '* * * * *', 'select private.cleanup_story_media();');
-- runtime-schedule:end
