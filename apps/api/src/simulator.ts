import { randomUUID } from "node:crypto";
import type { IngestPayload, TelemetrySample } from "@ets2/shared";
import { CARGOS, CITIES, FIXTURE_USERS, type FixtureUser } from "./fixtures.js";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const TICK_MS = 1000;

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

function round(n: number, p: number) {
  const f = 10 ** p;
  return Math.round(n * f) / f;
}

async function send(s: DriverState, sample: TelemetrySample) {
  const payload: IngestPayload = {
    apiKey: s.user.apiKey,
    sessionId: s.sessionId,
    truck: s.user.truck,
    samples: [sample],
  };
  try {
    const res = await fetch(`${API_URL}/api/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`ingest failed for ${s.user.name}: ${res.status}`);
    }
  } catch (err) {
    console.error(`ingest error for ${s.user.name}:`, (err as Error).message);
  }
}

async function main() {
  const onlineCount = Math.max(1, Math.min(FIXTURE_USERS.length, Number(process.env.SIM_DRIVERS ?? 4)));
  const drivers: DriverState[] = FIXTURE_USERS.slice(0, onlineCount).map((u) =>
    newJob(u, rand(50_000, 250_000)),
  );

  console.log(`simulating ${drivers.length} drivers -> ${API_URL}`);
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
