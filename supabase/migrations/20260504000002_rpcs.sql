-- Aggregations exposed via PostgREST rpc(). Both run as the calling user
-- (security invoker), so RLS on telemetry still applies.

create or replace function public.driver_totals_14d()
returns table (user_id uuid, total_km double precision)
language sql
stable
as $$
  select user_id,
         coalesce(max(odometer_km) - min(odometer_km), 0) as total_km
    from public.telemetry
   where time > now() - interval '14 days'
   group by user_id;
$$;

create or replace function public.driver_history(p_name text)
returns table (bucket timestamptz, avg_speed double precision, distance_km double precision)
language sql
stable
as $$
  select date_trunc('day', t.time) as bucket,
         avg(t.speed_kph)            as avg_speed,
         max(t.odometer_km) - min(t.odometer_km) as distance_km
    from public.telemetry t
    join public.users u on u.id = t.user_id
   where u.name = p_name
     and t.time > now() - interval '14 days'
   group by bucket
   order by bucket;
$$;

grant execute on function public.driver_totals_14d()        to authenticated;
grant execute on function public.driver_history(text)        to authenticated;
