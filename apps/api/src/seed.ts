import { randomUUID } from "node:crypto";
import { pool, query } from "./db.js";
import { CARGOS, CITIES, FIXTURE_USERS } from "./fixtures.js";

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

async function seedUsers() {
  for (const u of FIXTURE_USERS) {
    await query(
      `INSERT INTO users (name, display_name, api_key, avatar_url)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (name) DO UPDATE SET display_name = EXCLUDED.display_name,
                                        api_key = EXCLUDED.api_key,
                                        avatar_url = EXCLUDED.avatar_url`,
      [u.name, u.displayName, u.apiKey, u.avatarUrl],
    );
  }
}

async function seedHistoryFor(userName: string) {
  const u = await query<{ id: string }>(`SELECT id FROM users WHERE name = $1`, [userName]);
  const userId = u.rows[0].id;
  const fixture = FIXTURE_USERS.find((x) => x.name === userName)!;

  let odometer = rand(50_000, 250_000);

  for (let day = 7; day >= 1; day--) {
    const sessionId = randomUUID();
    const startedAt = new Date(Date.now() - day * 86_400_000 - rand(0, 4) * 3_600_000);
    const durationMs = rand(40, 180) * 60_000;
    const endedAt = new Date(startedAt.getTime() + durationMs);

    await query(
      `INSERT INTO sessions (id, user_id, truck_make, truck_model, started_at, ended_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sessionId, userId, fixture.truck.make, fixture.truck.model, startedAt, endedAt],
    );

    const source = pick(CITIES);
    let dest = pick(CITIES);
    while (dest.name === source.name) dest = pick(CITIES);
    const cargo = pick(CARGOS);
    const totalKm = Math.hypot(dest.x - source.x, dest.z - source.z) / 5;

    const stepMs = 30_000;
    const steps = Math.floor(durationMs / stepMs);
    let posX = source.x;
    let posZ = source.z;
    let fuel = rand(400, 700);
    const fuelCap = 800;
    let truckDamage = rand(0, 0.05);
    let cargoDamage = rand(0, 0.02);

    const tuples: string[] = [];
    const values: unknown[] = [];
    for (let i = 0; i < steps; i++) {
      const t = new Date(startedAt.getTime() + i * stepMs);
      const progress = i / steps;
      posX = source.x + (dest.x - source.x) * progress + rand(-3, 3);
      posZ = source.z + (dest.z - source.z) * progress + rand(-3, 3);
      const heading = Math.atan2(dest.z - source.z, dest.x - source.x);
      const speed = Math.max(0, 80 + rand(-15, 15) - (i === 0 || i === steps - 1 ? 60 : 0));
      const rpm = 800 + speed * 18 + rand(-100, 100);
      const gear = Math.min(12, Math.max(1, Math.round(speed / 8)));
      odometer += (speed / 3600) * (stepMs / 1000);
      fuel = Math.max(20, fuel - rand(0.05, 0.18));
      truckDamage = Math.min(1, truckDamage + rand(0, 0.0008));
      cargoDamage = Math.min(1, cargoDamage + rand(0, 0.0004));
      const remainingKm = Math.max(0, totalKm * (1 - progress));

      const base = values.length;
      values.push(
        t, sessionId, userId, speed, rpm, gear,
        fuel, fuelCap, odometer, truckDamage, cargoDamage,
        posX, 0, posZ, heading,
        cargo, source.name, dest.name, remainingKm, 1500 + rand(-200, 400),
      );
      tuples.push(
        `(${Array.from({ length: 20 }, (_, k) => `$${base + k + 1}`).join(",")})`,
      );
    }

    if (tuples.length) {
      await query(
        `INSERT INTO telemetry (
           time, session_id, user_id, speed_kph, rpm, gear,
           fuel_litres, fuel_capacity_l, odometer_km, truck_damage, cargo_damage,
           pos_x, pos_y, pos_z, heading,
           job_cargo, job_source, job_destination, job_remaining_km, job_income
         ) VALUES ${tuples.join(",")}`,
        values,
      );
    }
    console.log(`  ${userName}: day -${day} session ${source.name} -> ${dest.name} (${steps} samples)`);
  }
}

async function main() {
  console.log("clearing prior fixture data...");
  await query(`DELETE FROM telemetry`);
  await query(`DELETE FROM sessions`);
  await query(`DELETE FROM users WHERE api_key LIKE 'demo-key-%'`);

  console.log("seeding users...");
  await seedUsers();

  console.log("seeding 7 days of history per driver...");
  for (const u of FIXTURE_USERS) {
    await seedHistoryFor(u.name);
  }

  console.log("done.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
