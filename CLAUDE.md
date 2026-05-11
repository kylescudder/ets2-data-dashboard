# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common commands

This is a Bun workspace (`apps/*`, `packages/*`). Run from the repo root:

```bash
bun install               # install all workspaces
bun run db:up             # start Postgres/Timescale via docker compose
bun run db:down           # stop the db container
bun run db:migrate        # apply apps/api/src/migrations.sql
bun run db:seed           # wipe demo data, reinsert 5 users + 7 days of history
bun run dev:api           # Fastify API on :4000 (tsx watch)
bun run dev:web           # Next.js dashboard on :3000
bun run simulate          # run the in-API simulator that POSTs to /api/ingest
```

There is no test suite, lint config, or CI in this repo yet. Type checking is whatever the editor / `tsc` reports per package — there is no top-level `typecheck` script.

Workspace-scoped commands use filters, e.g. `bun run --filter @ets2/api <script>`. Package names are `@ets2/api`, `@ets2/web`, `@ets2/client`, `@ets2/shared`. Use bun (never pnpm or npm) for installs and script invocations in this repo.

Env vars (see `.env.example`): `DATABASE_URL`, `API_PORT`, `API_INGEST_KEY`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_WS_URL`. The simulator additionally reads `API_URL` and `SIM_DRIVERS`.

## Architecture

Four workspaces forming one data-flow pipeline:

```
client (stub) ──┐
                ├─► POST /api/ingest ──► api ──► Postgres/Timescale
simulator ──────┘                         │
                                          └─► in-process bus ──► WS /ws ──► web
```

**`packages/shared`** is the schema source of truth. `IngestPayload` and `TelemetrySample` Zod schemas live in `packages/shared/src/index.ts` and are imported by both the API (for runtime validation in `/api/ingest`) and the web app (for typing WS messages). Any change to the on-the-wire shape must go here, not be redefined in each app.

**`apps/api`** is Fastify + `pg`. Notable pieces:
- `src/server.ts` exposes `/api/drivers`, `/api/drivers/:name/history`, `/api/drivers/:name/recent`, `POST /api/ingest`, and a WS endpoint at `/ws`.
- `src/bus.ts` is a process-local `EventEmitter` keeping a `Map<userId, LiveDriver>`. Every ingest publishes a `WsServerMessage` and resets a 30s offline timer. WS clients receive a `snapshot` on connect and `update`/`offline` afterwards. Because the bus is in-process, **the API is single-instance**; horizontal scaling would require replacing the bus with Redis pub/sub or similar.
- Auth model:
  - **Ingest** (`POST /api/ingest`): `Authorization: Bearer <users.api_key>`. The key lives in the header, not the body — the `IngestPayload` Zod schema in `packages/shared` does not include it.
  - **Read endpoints + WS** (`/api/drivers*`, `/ws`): protected by `requireAuth` preHandler in `apps/api/src/auth.ts`. Accepts EITHER an HttpOnly `ets2_session` cookie (HMAC-signed, set by `POST /api/login` after a `DASHBOARD_PASSWORD` check) OR `Authorization: Bearer ${INTERNAL_API_TOKEN}` for server-to-server calls from the web app's server components.
  - **Web app** has its own `ets2_dashboard` cookie set on the `:3000` origin by the Next.js route handler at `app/api/auth/login/route.ts`. `apps/web/middleware.ts` redirects to `/login` if the cookie is missing/invalid. The login form posts the password to both origins (API first, then web) so both cookies get set.
  - Server components on `:3000` cannot read the API's `:4000` cookie (cross-origin), so `apps/web/lib/serverFetch.ts` calls the API with the `INTERNAL_API_TOKEN` Bearer token instead.
  - Required env: `DASHBOARD_PASSWORD`, `SESSION_SECRET`, `INTERNAL_API_TOKEN`, `WEB_ORIGIN`. Dev defaults exist; production startup throws if any are at default.
- Telemetry rows are inserted in a single multi-row `INSERT` per request — preserve that pattern when changing the ingest path; per-row inserts will not keep up at higher sample rates.

**Timescale is optional.** `migrations.sql` and `server.ts` both probe `pg_extension` and degrade to plain Postgres: the hypertable creation is skipped, and the history endpoint swaps `time_bucket('1 day', t.time)` for `date_trunc('day', t.time)`. When adding queries that use Timescale-only features, replicate this `hasTimescale` branch — do **not** assume Timescale is present.

**`apps/web`** is Next.js 15 App Router (React 19 RC) with Tailwind. `lib/useLiveDrivers.ts` is the live-state hook: it seeds from `GET /api/drivers`, then reconciles `snapshot`/`update`/`offline` messages from `/ws` into a single `DriverRow[]`. Pages under `app/u/[name]` and `app/leaderboard` are server components that fetch the API directly.

**`apps/client`** is a stub. The intended implementation is documented inline at the top of `src/index.ts` — read scs-sdk-plugin shared memory (`Local\SCSTelemetry`), decode to `TelemetrySample`, batch + POST to `/api/ingest`. Until that exists, `bun run simulate` (in `apps/api/src/simulator.ts`) drives the same endpoint with synthetic drivers using the demo API keys from `apps/api/src/fixtures.ts` (`demo-key-mike`, `demo-key-sarah`, `demo-key-tom`, `demo-key-lena`, `demo-key-jonas`).

## Data model

Three tables (`apps/api/src/migrations.sql`):
- `users` — one row per friend; `api_key` is the ingest credential.
- `sessions` — one row per driving session, FK to `users`.
- `telemetry` — TimescaleDB hypertable (or plain table when Timescale absent), ~1 Hz samples. Keep `time` as the first column / partitioning key. Indexes exist on `(time DESC)`, `(user_id, time DESC)`, `(session_id, time DESC)`; reuse those for new query patterns instead of adding parallel indexes.
