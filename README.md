# ETS2 Friends Tracker

A small cross-platform stack that ingests Euro Truck Simulator 2 telemetry from
players, stores it in TimescaleDB, and shows live + historical dashboards so you
can see what your friends are hauling.

## Architecture

```
apps/client     Windows telemetry agent, reads scs-sdk-plugin shared memory
apps/api        Fastify + Postgres/Timescale + WebSocket fan-out
apps/web        Next.js dashboard (live cards, per-driver history, leaderboard)
packages/shared Zod schemas / TS types shared by all three
```

The simulator under `apps/api` (`bun run simulate`) POSTs to the same
`/api/ingest` endpoint the real client uses, so the DB and dashboard can be
developed without the game running.

## Quick start

```bash
# 1. install
bun install

# 2. start postgres+timescale
bun run db:up

# 3. run migrations + seed (5 drivers, 7 days of fake history)
bun run db:migrate
bun run db:seed

# 4. start the API (terminal A)
bun run dev:api

# 5. start the web dashboard (terminal B)
bun run dev:web
# -> http://localhost:3000

# 6. start the live simulator (terminal C)
bun run simulate
```

You should see 4 drivers driving across Europe in real time, with cards updating
once a second on the home page.

## Identity

Each driver has an `api_key` in the `users` table. The telemetry client (or
simulator) sends that key with every batch, so the API knows whose data it is.
Demo keys: `demo-key-mike`, `demo-key-sarah`, `demo-key-tom`, `demo-key-lena`,
`demo-key-jonas`.

## Data model

* `users` - one row per friend (name, display_name, api_key, avatar)
* `sessions` - one driving session (truck make/model, start/end)
* `telemetry` - **TimescaleDB hypertable**, one row per sample (~1 Hz)

`telemetry` keeps the raw stream for live + recent views; long-term dashboards
use `time_bucket` rollups (see `/api/drivers/:name/history`).

## Real client (Windows)

`apps/client` reads the `Local\SCSTelemetry` shared memory block exposed by
[scs-sdk-plugin](https://github.com/RenCloud/scs-sdk-plugin). Windows-only;
Linux/Proton is not supported.

1. Install scs-sdk-plugin into the ETS2/ATS `bin/win_x64/plugins/` folder.
2. Sign in to the dashboard, open `/profile`, and copy the **config.json
   snippet** from the *Agent setup* panel into `%USERPROFILE%\.ets2-tracker\config.json`.
   It looks like:
   ```json
   {
     "ingestUrl": "http://127.0.0.1:54321/functions/v1/ingest",
     "apiKey": "<48 hex chars from your profile>"
   }
   ```
   (For the Fastify backend instead of Supabase, use
   `http://localhost:4000/api/ingest`.)
3. Start the game, then `bun dev:client`. The agent samples at 10 Hz, batches
   every second, and POSTs to `ingestUrl` with `Authorization: Bearer <apiKey>`.
   Failed batches are persisted under `%USERPROFILE%\.ets2-tracker\pending\`
   and replayed on reconnect.
```
