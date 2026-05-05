-- Friends-only data: any signed-in user reads everything. Writes happen
-- only through the service role (Edge Function ingest), which bypasses RLS.

alter table public.users    enable row level security;
alter table public.sessions enable row level security;
alter table public.telemetry enable row level security;

-- users: everyone reads, but only your own row is editable.
create policy "users readable to authenticated"
  on public.users for select
  to authenticated
  using (true);

create policy "users update own row"
  on public.users for update
  to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- sessions and telemetry: read-only for the dashboard.
create policy "sessions readable to authenticated"
  on public.sessions for select
  to authenticated
  using (true);

create policy "telemetry readable to authenticated"
  on public.telemetry for select
  to authenticated
  using (true);

-- Realtime: broadcast new telemetry rows to subscribed clients. We only
-- care about INSERT, so default REPLICA IDENTITY is sufficient.
alter publication supabase_realtime add table public.telemetry;
