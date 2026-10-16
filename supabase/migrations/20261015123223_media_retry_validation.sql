create or replace function private.validate_media_details() returns trigger language plpgsql set search_path='' as $$
declare cue jsonb; existing_count integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.post_id::text,0));
 -- Repeated metadata inserts must reach the unique constraint so clients can confirm an earlier upload.
 if exists(select 1 from public.post_media where post_id=new.post_id and storage_path=new.storage_path) then return new; end if;
 select count(*) into existing_count from public.post_media where post_id=new.post_id;
 if existing_count>=10 or (existing_count>0 and (new.kind<>'image' or exists(select 1 from public.post_media where post_id=new.post_id and kind<>'image'))) then raise exception 'Choose up to 10 photos, or one video or GIF'; end if;
 if new.cover_path is not null and new.cover_path not like new.owner_id::text||'/'||new.post_id::text||'/%' then raise exception 'Cover must belong to this post'; end if;
 for cue in select * from jsonb_array_elements(new.subtitles) loop
  if jsonb_typeof(cue) is distinct from 'object' or jsonb_typeof(cue->'text') is distinct from 'string' or jsonb_typeof(cue->'start') is distinct from 'number' or jsonb_typeof(cue->'end') is distinct from 'number' or char_length(trim(cue->>'text')) not between 1 and 300 or (cue->>'start')::numeric<0 or (cue->>'end')::numeric<=(cue->>'start')::numeric or (cue->>'end')::numeric>120 then raise exception 'Invalid subtitle timing'; end if;
 end loop;
 return new;
end; $$;
