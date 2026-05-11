-- Friends, sessions, telemetry. Telemetry is plain Postgres (no Timescale on
-- Supabase); the read path uses date_trunc for daily rollups.
--
-- A friend has two identities:
--   * auth_user_id  — Supabase Auth uid; used for "this is me" RLS checks.
--   * api_key       — opaque token the telemetry client sends with each batch.
-- The two are decoupled so the telemetry agent doesn't need a Supabase session.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

create table if not exists public.users (
  id            uuid primary key default uuid_generate_v4(),
  auth_user_id  uuid unique references auth.users(id) on delete set null,
  name          text not null unique,
  display_name  text not null,
  api_key       text not null unique,
  avatar_url    text,
  created_at    timestamptz not null default now()
);

create table if not exists public.sessions (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.users(id) on delete cascade,
  truck_make  text,
  truck_model text,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);
create index if not exists sessions_user_started_idx
  on public.sessions (user_id, started_at desc);

create table if not exists public.telemetry (
  time              timestamptz not null,
  session_id        uuid not null references public.sessions(id) on delete cascade,
  user_id           uuid not null references public.users(id) on delete cascade,
  speed_kph         double precision not null,
  rpm               double precision not null,
  gear              integer not null,
  fuel_litres       double precision not null,
  fuel_capacity_l   double precision not null,
  odometer_km       double precision not null,
  truck_damage      double precision not null,
  cargo_damage      double precision not null,
  pos_x             double precision not null,
  pos_y             double precision not null,
  pos_z             double precision not null,
  heading           double precision not null,
  job_cargo         text,
  job_source        text,
  job_destination   text,
  job_remaining_km  double precision,
  job_income        double precision
);
create index if not exists telemetry_time_idx
  on public.telemetry (time desc);
create index if not exists telemetry_user_time_idx
  on public.telemetry (user_id, time desc);
create index if not exists telemetry_session_time_idx
  on public.telemetry (session_id, time desc);

-- When a friend signs up via Supabase Auth, auto-create their public.users
-- row with a fresh api_key and a placeholder slug derived from their uid.
-- They can rename themselves later through a profile UI.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  base_slug text := 'user_' || substring(replace(new.id::text, '-', ''), 1, 8);
begin
  insert into public.users (auth_user_id, name, display_name, api_key)
  values (
    new.id,
    base_slug,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    encode(gen_random_bytes(24), 'hex')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();
