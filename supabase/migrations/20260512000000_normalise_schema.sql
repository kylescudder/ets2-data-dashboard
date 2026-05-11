-- ============================================================================
-- Normalise jobs + vehicles out of denormalised columns, slim telemetry,
-- switch select columns to single-precision, add per-minute rollup of old
-- raw rows.
--
-- One transactional migration. Brief ingest downtime is expected between
-- this running and the new Edge Function being redeployed — the agent's
-- on-disk retry queue covers it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. vehicles
-- ---------------------------------------------------------------------------
-- One row per (user, make+model). A user re-using the same truck across
-- multiple sessions points all those sessions at the same vehicles row.
create table if not exists public.vehicles (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.users(id) on delete cascade,
  make         text not null,
  model        text not null,
  created_at   timestamptz not null default now(),
  unique (user_id, make, model)
);
create index if not exists vehicles_user_idx on public.vehicles(user_id);

-- ---------------------------------------------------------------------------
-- 2. jobs
-- ---------------------------------------------------------------------------
-- One row per delivery. Identified within a session by the
-- (cargo, source_city, destination_city, income) tuple — same tuple in the
-- same session is the same job. If a user takes another identical-looking
-- delivery in the same session, that's a minor edge case we'll worry about
-- only if it ever happens in practice.
create table if not exists public.jobs (
  id               uuid primary key default uuid_generate_v4(),
  session_id       uuid not null references public.sessions(id) on delete cascade,
  cargo            text not null,
  source_city      text,
  destination_city text,
  income           double precision,
  started_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create index if not exists jobs_session_idx on public.jobs(session_id);

-- ---------------------------------------------------------------------------
-- 3. sessions: gain vehicle_id + fuel_capacity_litres (constant per session)
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column if not exists vehicle_id            uuid references public.vehicles(id),
  add column if not exists fuel_capacity_litres  real;

-- ---------------------------------------------------------------------------
-- 4. backfill vehicles from sessions, point sessions at them
-- ---------------------------------------------------------------------------
insert into public.vehicles (user_id, make, model)
select distinct user_id, truck_make, truck_model
  from public.sessions
 where truck_make  is not null
   and truck_model is not null
on conflict (user_id, make, model) do nothing;

update public.sessions s
   set vehicle_id = v.id
  from public.vehicles v
 where v.user_id = s.user_id
   and v.make    = s.truck_make
   and v.model   = s.truck_model
   and s.vehicle_id is null;

-- ---------------------------------------------------------------------------
-- 5. backfill fuel_capacity_litres on sessions from the most-recent
-- telemetry row that recorded it (capacity is constant per truck).
-- ---------------------------------------------------------------------------
update public.sessions s
   set fuel_capacity_litres = sub.cap
  from (
    select distinct on (session_id) session_id, fuel_capacity_l as cap
      from public.telemetry
     where fuel_capacity_l is not null
     order by session_id, time desc
  ) sub
 where sub.session_id = s.id
   and s.fuel_capacity_litres is null;

-- ---------------------------------------------------------------------------
-- 6. backfill jobs from distinct (session, cargo, src, dst, income) tuples
-- ---------------------------------------------------------------------------
insert into public.jobs (session_id, cargo, source_city, destination_city, income)
select distinct session_id,
       job_cargo,
       job_source,
       job_destination,
       job_income
  from public.telemetry
 where job_cargo is not null;

-- ---------------------------------------------------------------------------
-- 7. add job_id to telemetry, backfill from the job tuple
-- ---------------------------------------------------------------------------
alter table public.telemetry
  add column if not exists job_id uuid references public.jobs(id);

update public.telemetry t
   set job_id = j.id
  from public.jobs j
 where t.session_id = j.session_id
   and t.job_cargo       is not distinct from j.cargo
   and t.job_source      is not distinct from j.source_city
   and t.job_destination is not distinct from j.destination_city
   and t.job_income      is not distinct from j.income
   and t.job_id is null;

-- ---------------------------------------------------------------------------
-- 8. drop denormalised columns from telemetry
-- ---------------------------------------------------------------------------
alter table public.telemetry
  drop column if exists pos_y,
  drop column if exists fuel_capacity_l,
  drop column if exists job_cargo,
  drop column if exists job_source,
  drop column if exists job_destination,
  drop column if exists job_remaining_km,
  drop column if exists job_income;

-- ---------------------------------------------------------------------------
-- 9. drop denormalised columns from sessions
-- ---------------------------------------------------------------------------
alter table public.sessions
  drop column if exists truck_make,
  drop column if exists truck_model;

-- ---------------------------------------------------------------------------
-- 10. shrink select columns to single precision (real = 4 bytes vs 8)
--     pos_x / pos_z / odometer_km stay double — large values, precision matters.
-- ---------------------------------------------------------------------------
alter table public.telemetry
  alter column speed_kph    type real using speed_kph::real,
  alter column rpm          type real using rpm::real,
  alter column fuel_litres  type real using fuel_litres::real,
  alter column truck_damage type real using truck_damage::real,
  alter column cargo_damage type real using cargo_damage::real,
  alter column heading      type real using heading::real;

-- ---------------------------------------------------------------------------
-- 11. RLS + Realtime publication for the new tables
-- ---------------------------------------------------------------------------
alter table public.vehicles enable row level security;
alter table public.jobs     enable row level security;

create policy "vehicles readable to authenticated"
  on public.vehicles for select to authenticated using (true);
create policy "jobs readable to authenticated"
  on public.jobs     for select to authenticated using (true);

alter table public.vehicles replica identity full;
alter table public.jobs     replica identity full;

alter publication supabase_realtime add table public.vehicles;
alter publication supabase_realtime add table public.jobs;

-- ---------------------------------------------------------------------------
-- 12. telemetry_rollup_minute: long-term retention as per-minute aggregates
-- ---------------------------------------------------------------------------
create table if not exists public.telemetry_rollup_minute (
  user_id        uuid not null references public.users(id) on delete cascade,
  bucket         timestamptz not null,
  avg_speed_kph  real,
  max_speed_kph  real,
  distance_km    double precision,
  samples        integer,
  primary key (user_id, bucket)
);
create index if not exists telemetry_rollup_user_bucket_idx
  on public.telemetry_rollup_minute(user_id, bucket desc);

alter table public.telemetry_rollup_minute enable row level security;
create policy "rollup readable to authenticated"
  on public.telemetry_rollup_minute for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 13. rollup function: aggregate raw rows older than 14 days into the
--     per-minute table, then delete them. 14 days matches the existing
--     dashboard window (driver_totals_14d / driver_history).
-- ---------------------------------------------------------------------------
create or replace function public.rollup_old_telemetry()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - interval '14 days';
begin
  insert into public.telemetry_rollup_minute
    (user_id, bucket, avg_speed_kph, max_speed_kph, distance_km, samples)
  select user_id,
         date_trunc('minute', time) as bucket,
         avg(speed_kph)::real,
         max(speed_kph)::real,
         max(odometer_km) - min(odometer_km),
         count(*)
    from public.telemetry
   where time < cutoff
   group by user_id, date_trunc('minute', time)
  on conflict (user_id, bucket) do nothing;

  delete from public.telemetry where time < cutoff;
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. schedule the rollup at 03:00 UTC daily via pg_cron
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;

-- pg_cron lives in the cron schema. Re-creating the schedule with the same
-- name is idempotent — drop the existing one first so re-running the
-- migration doesn't error.
select cron.unschedule(j.jobid)
  from cron.job j
 where j.jobname = 'rollup-old-telemetry';

select cron.schedule(
  'rollup-old-telemetry',
  '0 3 * * *',
  $$ select public.rollup_old_telemetry(); $$
);
