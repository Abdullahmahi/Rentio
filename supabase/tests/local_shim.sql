-- Minimal local stand-in for the Supabase-managed bits the migrations rely on.
-- Test harness only — never shipped.

create extension if not exists "pgcrypto";

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Supabase reads the JWT out of a GUC; we set the same GUC in tests.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets (id),
  name text not null,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;

-- Real Supabase returns every path segment except the filename.
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1];
$$;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant all on all tables in schema storage to authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
alter default privileges in schema public grant all on functions to authenticated, service_role;

-- Columns the real auth.users carries, so seed_auth.sql can be exercised locally.
alter table auth.users
  add column if not exists instance_id uuid,
  add column if not exists aud text,
  add column if not exists role text,
  add column if not exists email_confirmed_at timestamptz,
  add column if not exists updated_at timestamptz,
  add column if not exists raw_app_meta_data jsonb,
  add column if not exists confirmation_token text,
  add column if not exists recovery_token text,
  add column if not exists email_change_token_new text,
  add column if not exists email_change text;

create table if not exists auth.identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider_id text not null,
  provider text not null,
  identity_data jsonb not null default '{}'::jsonb,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (provider_id, provider)
);
