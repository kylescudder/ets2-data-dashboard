# ETS2 Friends Tracker

A small cross-platform stack that ingests Euro Truck Simulator 2 telemetry from
players, stores it in TimescaleDB, and shows live + historical dashboards so you
can see what your friends are hauling.

## Architecture

```
apps/client     telemetry agent (Windows/Linux), reads scs-sdk-plugin shared memory
apps/api        Fastify + Postgres/Timescale + WebSocket fan-out
apps/web        Next.js dashboard (live cards, per-driver history, leaderboard)
packages/shared Zod schemas / TS types shared by all three
```

The `apps/client` is a stub for now. Live data is produced by a built-in
**simulator** that POSTs to the same `/api/ingest` endpoint the real client
will use, so you can build out the DB and frontend without hooking ETS2 up.

## Quick start

```bash
# 1. install
pnpm install

# 2. start postgres+timescale
pnpm db:up

# 3. run migrations + seed (5 drivers, 7 days of fake history)
pnpm db:migrate
pnpm db:seed

# 4. start the API (terminal A)
pnpm dev:api

# 5. start the web dashboard (terminal B)
pnpm dev:web
# -> http://localhost:3000

# 6. start the live simulator (terminal C)
pnpm simulate
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

## Real client (later)

`apps/client` will read the `Local\SCSTelemetry` shared memory block exposed by
[scs-sdk-plugin](https://github.com/RenCloud/scs-sdk-plugin). Same memory
layout on Windows and Linux; only the OS shared-memory call differs. On Linux
ETS2 runs under Proton/Wine - the plugin lives in the Wine prefix, so the
client either runs in the same prefix or talks to a tiny Wine-side bridge.
```
