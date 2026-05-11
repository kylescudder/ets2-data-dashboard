// Telemetry ingest endpoint. Called by clients (real ETS2 agent or local
// simulator) with `Authorization: Bearer <users.api_key>`. Validates the
// payload, normalises truck → vehicles, job → jobs, and bulk-inserts
// telemetry rows linked to both. Realtime broadcasts the inserts to
// subscribed dashboards.
//
// `verify_jwt = false` is set in supabase/config.toml because the
// Authorization header carries our own opaque api_key, not a Supabase JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { z } from "https://esm.sh/zod@3.23.8";

const TelemetrySample = z.object({
  recordedAt: z.string(),
  speedKph: z.number(),
  rpm: z.number(),
  gear: z.number().int(),
  fuelLitres: z.number(),
  odometerKm: z.number(),
  truckDamage: z.number().min(0).max(1),
  cargoDamage: z.number().min(0).max(1),
  position: z.object({
    x: z.number(),
    z: z.number(),
    heading: z.number(),
  }),
});

const ActiveJob = z.object({
  cargo: z.string(),
  sourceCity: z.string(),
  destinationCity: z.string(),
  income: z.number(),
});

const Truck = z.object({
  make: z.string(),
  model: z.string(),
  fuelCapacityLitres: z.number().optional(),
});

const IngestPayload = z.object({
  sessionId: z.string().uuid(),
  truck: Truck,
  job: ActiveJob.nullable().optional(),
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

async function ensureVehicle(
  userId: string,
  make: string,
  model: string,
): Promise<string | null> {
  // Upsert by (user_id, make, model) — schema has a UNIQUE constraint there.
  const { data, error } = await supabase
    .from("vehicles")
    .upsert(
      { user_id: userId, make, model },
      { onConflict: "user_id,make,model" },
    )
    .select("id")
    .single();
  if (error) {
    console.error("vehicle upsert error:", error);
    return null;
  }
  return data.id;
}

async function ensureJob(
  sessionId: string,
  job: z.infer<typeof ActiveJob>,
): Promise<string | null> {
  // A job is identified within a session by (cargo, source_city,
  // destination_city, income). Idempotent — same tuple, same job row.
  const { data: existing, error: findErr } = await supabase
    .from("jobs")
    .select("id")
    .eq("session_id", sessionId)
    .eq("cargo", job.cargo)
    .eq("source_city", job.sourceCity)
    .eq("destination_city", job.destinationCity)
    .eq("income", job.income)
    .maybeSingle();
  if (findErr) {
    console.error("job find error:", findErr);
    return null;
  }
  if (existing) return existing.id;

  const { data: created, error: createErr } = await supabase
    .from("jobs")
    .insert({
      session_id: sessionId,
      cargo: job.cargo,
      source_city: job.sourceCity,
      destination_city: job.destinationCity,
      income: job.income,
    })
    .select("id")
    .single();
  if (createErr) {
    console.error("job insert error:", createErr);
    return null;
  }
  return created.id;
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
  const { sessionId, truck, job, samples } = parsed.data;

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

  const vehicleId = await ensureVehicle(user.id, truck.make, truck.model);
  if (!vehicleId) return json({ error: "vehicle ensure failed" }, 500);

  // Upsert session. ignoreDuplicates means later batches don't clobber the
  // initially-recorded fuel_capacity_litres (it's stable per session anyway).
  const { error: sessionErr } = await supabase.from("sessions").upsert(
    {
      id: sessionId,
      user_id: user.id,
      vehicle_id: vehicleId,
      fuel_capacity_litres: truck.fuelCapacityLitres ?? null,
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (sessionErr) {
    console.error("session upsert error:", sessionErr);
    return json({ error: "session insert failed" }, 500);
  }

  let jobId: string | null = null;
  if (job) {
    jobId = await ensureJob(sessionId, job);
    if (!jobId) return json({ error: "job ensure failed" }, 500);
  }

  const rows = samples.map((s) => ({
    time: s.recordedAt,
    session_id: sessionId,
    user_id: user.id,
    job_id: jobId,
    speed_kph: s.speedKph,
    rpm: s.rpm,
    gear: s.gear,
    fuel_litres: s.fuelLitres,
    odometer_km: s.odometerKm,
    truck_damage: s.truckDamage,
    cargo_damage: s.cargoDamage,
    pos_x: s.position.x,
    pos_z: s.position.z,
    heading: s.position.heading,
  }));

  const { error: telemetryErr } = await supabase.from("telemetry").insert(rows);
  if (telemetryErr) {
    console.error("telemetry insert error:", telemetryErr);
    return json({ error: "telemetry insert failed" }, 500);
  }

  return json({ ok: true, accepted: samples.length });
});
