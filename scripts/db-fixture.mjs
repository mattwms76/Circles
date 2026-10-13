import { PGlite } from '@electric-sql/pglite';
export async function createDatabase(source) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
    create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant all on storage.objects to authenticated, service_role;
    create function storage.foldername(text) returns text[] language sql as $$
      select (string_to_array($1, '/'))[1:array_length(string_to_array($1, '/'), 1)-1]
    $$;
  `);
  await db.exec(
    source
      .replace(/-- runtime-schedule:start[\s\S]*?-- runtime-schedule:end/g, '')
      .replace(/^create extension .*;\r?\n/gm, '')
      .replace(/do \$\$\s*declare existing_job (?:record|bigint);[\s\S]*?end;\s*\$\$;/, '')
      .replace(/^alter publication .*;\r?$/gm, ''),
  );
  return db;
}
