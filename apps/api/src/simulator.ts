import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { TelemetrySample } from "@ets2/shared";
import { CARGOS, CITIES, FIXTURE_USERS, type FixtureUser } from "./fixtures.js";

// `bun run --filter` loads .env from the invoking shell's cwd, not the
// workspace's, so we eagerly read apps/api/.env (and fall back to the web
// app's .env.local) ourselves.
function loadEnv(path: string) {
  try {
    const content = readFileSync(path, "utf8");
    for (const raw of content.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    // file missing — silently skip; if both fallbacks miss we error below.
  }
}
const here = dirname(fileURLToPath(import.meta.url));
loadEnv(resolve(here, "../.env"));
loadEnv(resolve(here, "../../web/.env.local"));

const SUPABASE_URL =
  process.env.SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const TICK_MS = 1000;

if (!ANON_KEY) {
  console.error(
    "Missing SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).",
    "Get the publishable key from `supabase status -o env` and put it in",
    "apps/api/.env or export it before running.",
  );
  process.exit(1);
}

const INGEST_URL = `${SUPABASE_URL}/functions/v1/ingest`;

interface DriverState {
  user: FixtureUser;
  sessionId: string;
  source: (typeof CITIES)[number];
  dest: (typeof CITIES)[number];
  cargo: string;
  posX: number;
  posZ: number;
  speed: number;
  rpm: number;
  gear: number;
  fuel: number;
  fuelCap: number;
  odometer: number;
  truckDamage: number;
  cargoDamage: number;
  totalKm: number;
  remainingKm: number;
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function newJob(user: FixtureUser, odometer: number): DriverState {
  const source = pick(CITIES);
  let dest = pick(CITIES);
  while (dest.name === source.name) dest = pick(CITIES);
  const totalKm = Math.hypot(dest.x - source.x, dest.z - source.z) / 5;
  return {
    user,
    sessionId: randomUUID(),
    source,
    dest,
    cargo: pick(CARGOS),
    posX: source.x,
    posZ: source.z,
    speed: 0,
    rpm: 800,
    gear: 1,
    fuel: rand(500, 780),
    fuelCap: 800,
    odometer,
    truckDamage: rand(0, 0.05),
    cargoDamage: 0,
    totalKm,
    remainingKm: totalKm,
  };
}

function tick(s: DriverState) {
  const dx = s.dest.x - s.posX;
  const dz = s.dest.z - s.posZ;
  const distToDest = Math.hypot(dx, dz);

  s.speed = Math.max(0, Math.min(95, s.speed + rand(-3, 3) + (distToDest < 50 ? -8 : 1)));
  s.rpm = 800 + s.speed * 18 + rand(-80, 80);
  s.gear = Math.min(12, Math.max(1, Math.round(s.speed / 8)));

  if (distToDest > 1) {
    const stepDist = (s.speed / 3600) * (TICK_MS / 1000) * 5;
    s.posX += (dx / distToDest) * stepDist;
    s.posZ += (dz / distToDest) * stepDist;
  }
  const kmThisTick = (s.speed / 3600) * (TICK_MS / 1000);
  s.odometer += kmThisTick;
  s.remainingKm = Math.max(0, s.remainingKm - kmThisTick);
  s.fuel = Math.max(15, s.fuel - rand(0.001, 0.005));
  s.truckDamage = Math.min(1, s.truckDamage + (Math.random() < 0.001 ? rand(0, 0.005) : 0));
}

function round(n: number, p: number) {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}

function buildSample(s: DriverState): TelemetrySample {
  const heading = Math.atan2(s.dest.z - s.posZ, s.dest.x - s.posX);
  return {
    recordedAt: new Date().toISOString(),
    speedKph: round(s.speed, 2),
    rpm: round(s.rpm, 0),
    gear: s.gear,
    fuelLitres: round(s.fuel, 2),
    fuelCapacityLitres: s.fuelCap,
    odometerKm: round(s.odometer, 3),
    truckDamage: round(s.truckDamage, 4),
    cargoDamage: round(s.cargoDamage, 4),
    position: { x: round(s.posX, 2), y: 0, z: round(s.posZ, 2), heading: round(heading, 4) },
    job: {
      cargo: s.cargo,
      sourceCity: s.source.name,
      destinationCity: s.dest.name,
      remainingKm: round(s.remainingKm, 2),
      deliveryDeadline: null,
      income: 1500,
    },
  };
}

async function send(s: DriverState, sample: TelemetrySample) {
  try {
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: ANON_KEY!,
        authorization: `Bearer ${s.user.apiKey}`,
      },
      body: JSON.stringify({
        sessionId: s.sessionId,
        truck: s.user.truck,
        samples: [sample],
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`ingest failed for ${s.user.name}: ${res.status} ${text}`);
    }
  } catch (err) {
    console.error(`ingest error for ${s.user.name}:`, (err as Error).message);
  }
}

async function main() {
  const onlineCount = Math.max(
    1,
    Math.min(FIXTURE_USERS.length, Number(process.env.SIM_DRIVERS ?? 4)),
  );
  const drivers: DriverState[] = FIXTURE_USERS.slice(0, onlineCount).map((u) =>
    newJob(u, rand(50_000, 250_000)),
  );

  console.log(`simulating ${drivers.length} drivers -> ${INGEST_URL}`);
  for (const d of drivers) {
    console.log(`  ${d.user.displayName}: ${d.source.name} -> ${d.dest.name} (${d.cargo})`);
  }

  setInterval(async () => {
    for (let i = 0; i < drivers.length; i++) {
      const s = drivers[i];
      tick(s);
      await send(s, buildSample(s));
      if (s.remainingKm < 0.5) {
        console.log(`  ${s.user.displayName} delivered to ${s.dest.name}, picking new job`);
        drivers[i] = newJob(s.user, s.odometer);
      }
    }
  }, TICK_MS);
}

main();
