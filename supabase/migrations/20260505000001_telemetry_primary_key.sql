-- Realtime requires a primary key on broadcast tables when subscribers use
-- column filters; without one it ships INSERT events with `new: {}` and an
-- "Error 400: Bad Request, no primary key" entry in payload.errors.
--
-- A surrogate bigint identity is sufficient. Time-ordered indexes already
-- exist for the query patterns we care about, so the new PK doesn't change
-- read performance.
alter table public.telemetry add column id bigint generated always as identity primary key;
