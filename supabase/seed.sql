-- Local dev fixtures. Five demo friends with stable api_keys so the simulator
-- can ingest without a real signup flow. Cloud installations don't run this;
-- real friends sign up via magic link and get auto-provisioned by the
-- on_auth_user_created trigger.

insert into public.users (name, display_name, api_key, avatar_url) values
  ('mike',  'Mike',  'demo-key-mike',  'https://api.dicebear.com/9.x/adventurer/svg?seed=mike'),
  ('sarah', 'Sarah', 'demo-key-sarah', 'https://api.dicebear.com/9.x/adventurer/svg?seed=sarah'),
  ('tom',   'Tom',   'demo-key-tom',   'https://api.dicebear.com/9.x/adventurer/svg?seed=tom'),
  ('lena',  'Lena',  'demo-key-lena',  'https://api.dicebear.com/9.x/adventurer/svg?seed=lena'),
  ('jonas', 'Jonas', 'demo-key-jonas', 'https://api.dicebear.com/9.x/adventurer/svg?seed=jonas')
on conflict (name) do nothing;

-- Mock one finished session per demo user so the leaderboard / history pages
-- have something to render before real ingest is wired up. Each user ends up
-- with 200–800 km logged 5 days ago.
do $$
declare
  u record;
  s_id uuid;
  base_odo double precision;
  drove_km double precision;
begin
  for u in select id from public.users where api_key like 'demo-key-%' loop
    s_id := uuid_generate_v4();
    base_odo := 100000 + random() * 50000;
    drove_km := 200 + random() * 600;

    -- Anchor inside one calendar day so date_trunc('day', t.time) buckets
    -- both rows together and (max - min)(odometer_km) reflects the trip.
    insert into public.sessions (id, user_id, truck_make, truck_model, started_at, ended_at)
    values (s_id, u.id, 'Volvo', 'FH16',
            date_trunc('day', now()) - interval '5 days' + interval '10 hours',
            date_trunc('day', now()) - interval '5 days' + interval '14 hours');

    insert into public.telemetry (
      time, session_id, user_id, speed_kph, rpm, gear,
      fuel_litres, fuel_capacity_l, odometer_km, truck_damage, cargo_damage,
      pos_x, pos_y, pos_z, heading,
      job_cargo, job_source, job_destination, job_remaining_km, job_income
    ) values
      (date_trunc('day', now()) - interval '5 days' + interval '10 hours',
       s_id, u.id, 0, 800, 1, 700, 800,
       base_odo,            0, 0, 0,    0, 0,    0,
       'Pallets', 'Berlin', 'Munich', drove_km, 1500),
      (date_trunc('day', now()) - interval '5 days' + interval '14 hours',
       s_id, u.id, 0, 800, 1, 400, 800,
       base_odo + drove_km, 0, 0, 1000, 0, 1000, 0,
       'Pallets', 'Berlin', 'Munich', 0,        1500);
  end loop;
end $$;
