import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { IngestPayload, type LiveDriver, type WsServerMessage } from "@ets2/shared";
import { query } from "./db.js";
import { bus } from "./bus.js";

const PORT = Number(process.env.API_PORT ?? 4000);

const app = Fastify({ logger: { level: "info" } });
await app.register(cors, { origin: true });
await app.register(websocket);

app.get("/health", async () => ({ ok: true }));

app.get("/api/drivers", async () => {
  const { rows } = await query<{
    id: string;
    name: string;
    display_name: string;
    avatar_url: string | null;
  }>(`SELECT id, name, display_name, avatar_url FROM users ORDER BY display_name`);
  const live = new Map(bus.snapshot().map((d) => [d.userId, d]));
  return rows.map((u) => {
    const l = live.get(u.id);
    return {
      userId: u.id,
      name: u.name,
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      status: l ? "online" : "offline",
      latest: l?.latest ?? null,
      truck: l?.truck ?? null,
    };
  });
});

app.get("/api/drivers/:name/history", async (req) => {
  const { name } = req.params as { name: string };
  const { rows } = await query<{
    bucket: string;
    avg_speed: number;
    distance_km: number;
  }>(
    `SELECT time_bucket('1 day', t.time) AS bucket,
            avg(t.speed_kph) AS avg_speed,
            (max(t.odometer_km) - min(t.odometer_km)) AS distance_km
       FROM telemetry t
       JOIN users u ON u.id = t.user_id
      WHERE u.name = $1 AND t.time > now() - interval '14 days'
      GROUP BY bucket
      ORDER BY bucket`,
    [name],
  );
  return rows;
});

app.get("/api/drivers/:name/recent", async (req) => {
  const { name } = req.params as { name: string };
  const { rows } = await query(
    `SELECT t.time, t.speed_kph, t.fuel_litres, t.odometer_km,
            t.pos_x, t.pos_z, t.heading, t.job_cargo, t.job_source, t.job_destination
       FROM telemetry t
       JOIN users u ON u.id = t.user_id
      WHERE u.name = $1
      ORDER BY t.time DESC
      LIMIT 200`,
    [name],
  );
  return rows;
});

app.post("/api/ingest", async (req, reply) => {
  const parsed = IngestPayload.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const { apiKey, sessionId, truck, samples } = parsed.data;

  const userRes = await query<{ id: string; name: string; display_name: string }>(
    `SELECT id, name, display_name FROM users WHERE api_key = $1`,
    [apiKey],
  );
  const user = userRes.rows[0];
  if (!user) return reply.code(401).send({ error: "unknown api key" });

  await query(
    `INSERT INTO sessions (id, user_id, truck_make, truck_model)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [sessionId, user.id, truck.make, truck.model],
  );

  const values: unknown[] = [];
  const tuples: string[] = [];
  for (const s of samples) {
    const base = values.length;
    values.push(
      s.recordedAt, sessionId, user.id, s.speedKph, s.rpm, s.gear,
      s.fuelLitres, s.fuelCapacityLitres, s.odometerKm, s.truckDamage, s.cargoDamage,
      s.position.x, s.position.y, s.position.z, s.position.heading,
      s.job?.cargo ?? null, s.job?.sourceCity ?? null, s.job?.destinationCity ?? null,
      s.job?.remainingKm ?? null, s.job?.income ?? null,
    );
    const ph = Array.from({ length: 20 }, (_, i) => `$${base + i + 1}`).join(",");
    tuples.push(`(${ph})`);
  }

  await query(
    `INSERT INTO telemetry (
       time, session_id, user_id, speed_kph, rpm, gear,
       fuel_litres, fuel_capacity_l, odometer_km, truck_damage, cargo_damage,
       pos_x, pos_y, pos_z, heading,
       job_cargo, job_source, job_destination, job_remaining_km, job_income
     ) VALUES ${tuples.join(",")}`,
    values,
  );

  const last = samples[samples.length - 1];
  const driver: LiveDriver = {
    userId: user.id,
    name: user.name,
    status: "online",
    truck,
    latest: last,
  };
  const msg: WsServerMessage = {
    type: "update",
    userId: user.id,
    name: user.name,
    sample: last,
    truck,
  };
  bus.publish(driver, msg);

  return { ok: true, accepted: samples.length };
});

app.register(async (f) => {
  f.get("/ws", { websocket: true }, (socket) => {
    const snapshot: WsServerMessage = { type: "snapshot", drivers: bus.snapshot() };
    socket.send(JSON.stringify(snapshot));
    const onMessage = (msg: WsServerMessage) => socket.send(JSON.stringify(msg));
    bus.on("message", onMessage);
    socket.on("close", () => bus.off("message", onMessage));
  });
});

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
  app.log.info(`api listening on :${PORT}`);
});
