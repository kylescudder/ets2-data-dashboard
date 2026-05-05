-- Realtime needs the full row image to evaluate `filter: user_id=eq.…`
-- subscriptions and to deliver every column to subscribers. The telemetry
-- table has no primary key, so REPLICA IDENTITY DEFAULT can't carry the
-- user_id through the WAL — without this, filtered subscribers get rows
-- with all columns undefined.
alter table public.telemetry replica identity full;
