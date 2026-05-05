// Telemetry ingest endpoint. Called by clients (real ETS2 agent or local
// simulator) with `Authorization: Bearer <users.api_key>`. Validates the
// payload, looks up the user by api_key (service role bypasses RLS), upserts
// the session, and bulk-inserts telemetry rows. Realtime broadcasts the
// inserts to subscribed dashboards.
//
// `verify_jwt = false` is set in supabase/config.toml because the Authorization
// header carries our own opaque api_key, not a Supabase JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { z } from "https://esm.sh/zod@3.23.8";

const TelemetrySample = z.object({
  recordedAt: z.string(),
  speedKph: z.number(),
  rpm: z.number(),
  gear: z.number().int(),
  fuelLitres: z.number(),
  fuelCapacityLitres: z.number(),
  odometerKm: z.number(),
  truckDamage: z.number().min(0).max(1),
  cargoDamage: z.number().min(0).max(1),
  position: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
    heading: z.number(),
  }),
  job: z
    .object({
      cargo: z.string(),
      sourceCity: z.string(),
      destinationCity: z.string(),
      remainingKm: z.number(),
      deliveryDeadline: z.string().nullable(),
      income: z.number(),
    })
    .nullable(),
});

const IngestPayload = z.object({
  sessionId: z.string().uuid(),
  truck: z.object({ make: z.string(), model: z.string() }),
  samples: z.array(TelemetrySample).min(1).max(200),
});

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "missing bearer token" }, 401);
  }
  const apiKey = auth.slice(7).trim();
  if (!apiKey) return json({ error: "empty bearer token" }, 401);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const parsed = IngestPayload.safeParse(raw);
  if (!parsed.success) {
    return json({ error: parsed.error.flatten() }, 400);
  }
  const { sessionId, truck, samples } = parsed.data;

  const { data: user, error: userErr } = await supabase
    .from("users")
    .select("id, name")
    .eq("api_key", apiKey)
    .maybeSingle();
  if (userErr) {
    console.error("user lookup error:", userErr);
    return json({ error: "user lookup failed" }, 500);
  }
  if (!user) return json({ error: "unknown api key" }, 401);

  const { error: sessionErr } = await supabase.from("sessions").upsert(
    {
      id: sessionId,
      user_id: user.id,
      truck_make: truck.make,
      truck_model: truck.model,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (sessionErr) {
    console.error("session upsert error:", sessionErr);
    return json({ error: "session insert failed" }, 500);
  }

  const rows = samples.map((s) => ({
    time: s.recordedAt,
    session_id: sessionId,
    user_id: user.id,
    speed_kph: s.speedKph,
    rpm: s.rpm,
    gear: s.gear,
    fuel_litres: s.fuelLitres,
    fuel_capacity_l: s.fuelCapacityLitres,
    odometer_km: s.odometerKm,
    truck_damage: s.truckDamage,
    cargo_damage: s.cargoDamage,
    pos_x: s.position.x,
    pos_y: s.position.y,
    pos_z: s.position.z,
    heading: s.position.heading,
    job_cargo: s.job?.cargo ?? null,
    job_source: s.job?.sourceCity ?? null,
    job_destination: s.job?.destinationCity ?? null,
    job_remaining_km: s.job?.remainingKm ?? null,
    job_income: s.job?.income ?? null,
  }));

  const { error: telemetryErr } = await supabase.from("telemetry").insert(rows);
  if (telemetryErr) {
    console.error("telemetry insert error:", telemetryErr);
    return json({ error: "telemetry insert failed" }, 500);
  }

  return json({ ok: true, accepted: samples.length });
});
