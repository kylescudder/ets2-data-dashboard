-- Latest odometer reading per user inside the 14-day window. The leaderboard
-- uses this as a per-user baseline so it can apply odometer deltas from
-- live telemetry inserts without re-running the (heavier) totals aggregation.
create or replace function public.driver_latest_odo()
returns table (user_id uuid, odometer_km double precision)
language sql
stable
as $$
  select distinct on (user_id) user_id, odometer_km
    from public.telemetry
   where time > now() - interval '14 days'
   order by user_id, time desc;
$$;

grant execute on function public.driver_latest_odo() to authenticated;
