import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { ActiveJob, IngestPayload, TelemetrySample, Truck } from "@ets2/shared";
import { loadConfig } from "./config.js";
import { BatchBuffer, type PendingBatch } from "./buffer.js";
import { openTelemetryMap, type TelemetryMap } from "./win-shm.js";
import { decodeJob, decodeSample, decodeStatic } from "./scs-layout.js";

// Sample at 1 Hz. 10 Hz was overkill — the map is plenty smooth at 1 Hz,
// the leaderboard polls every 3 s anyway, and dropping to 1 Hz cuts the
// telemetry table size 10× (a 30-min trip drops from ~12 MB to ~1.2 MB).
const SAMPLE_INTERVAL_MS = 1000;
const FLUSH_INTERVAL_MS = 1000;

if (process.platform !== "win32") {
  console.error("ets2-client is Windows-only (Linux/Wine support dropped).");
  process.exit(1);
}

const config = loadConfig();
const buffer = new BatchBuffer(config.configDir);
const sessionId = randomUUID();

let map: TelemetryMap | null = null;
let samples: TelemetrySample[] = [];
// Captured per-batch at flush time. Truck stays roughly constant for a
// session; job changes when the driver picks one up / completes one.
let lastTruck: Truck | null = null;
let lastJob: ActiveJob | null = null;
let warnedNotRunning = false;

// Steam launch-option wrapper mode: when invoked as
//   ets2-tracker.exe <game-exe> [game-args...]
// (which is what `"...\ets2-tracker.exe" %command% -developer -console` expands
// to), spawn the game as a child process, keep sampling in parallel, and exit
// when the game exits. With no args we run as a standalone agent — same as
// double-clicking the .exe.
//
// slice(2) because compiled bun binaries follow Node's argv layout:
// argv[0] = exe path, argv[1] = embedded script path (e.g. B:/~BUN/root/…),
// argv[2+] = user-provided args.
const launchArgs = process.argv.slice(2);
if (launchArgs.length >= 1 && /\.exe$/i.test(launchArgs[0])) {
  const [gameCmd, ...gameArgs] = launchArgs;
  console.log(`launcher mode: ${gameCmd} ${gameArgs.join(" ")}`);
  const child = spawn(gameCmd, gameArgs, {
    stdio: "inherit",
    windowsHide: false,
  });
  child.on("error", (err) => {
    console.error("failed to launch game:", err.message);
  });
  child.on("exit", (code) => {
    console.log(`game exited (code ${code ?? "null"}); shutting down agent`);
    map?.close();
    process.exit(code ?? 0);
  });
}

function tryOpenMap(): boolean {
  try {
    map = openTelemetryMap();
    console.log("connected to SCS telemetry shared memory");
    warnedNotRunning = false;
    return true;
  } catch (err) {
    if (!warnedNotRunning) {
      console.log((err as Error).message);
      console.log("waiting for the game to start…");
      warnedNotRunning = true;
    }
    return false;
  }
}

function sample() {
  if (!map) {
    tryOpenMap();
    return;
  }
  let buf: Buffer;
  try {
    buf = map.read();
  } catch (err) {
    console.error("lost shared memory view:", (err as Error).message);
    map.close();
    map = null;
    return;
  }

  const stat = decodeStatic(buf);
  if (!stat.sdkActive || stat.paused) return;
  lastTruck = stat.truck;
  lastJob = decodeJob(buf);
  samples.push(decodeSample(buf, new Date().toISOString()));
}

async function postBatch(pending: PendingBatch): Promise<boolean> {
  try {
    const res = await fetch(config.ingestUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${pending.apiKey}`,
      },
      body: JSON.stringify(pending.payload),
    });
    if (!res.ok) {
      console.error(`ingest failed: ${res.status} ${res.statusText}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("ingest error:", (err as Error).message);
    return false;
  }
}

async function flushPending() {
  for (const { id, batch } of buffer.pending()) {
    if (await postBatch(batch)) buffer.clear(id);
    else return;
  }
}

async function flush() {
  if (samples.length === 0 || !lastTruck) return;
  const batch = samples;
  samples = [];
  const payload: IngestPayload = {
    sessionId,
    truck: lastTruck,
    job: lastJob,
    samples: batch,
  };
  const pending: PendingBatch = { apiKey: config.apiKey, payload };
  if (!(await postBatch(pending))) {
    buffer.persist(pending);
    return;
  }
  await flushPending();
}

process.on("SIGINT", () => {
  if (samples.length && lastTruck) {
    buffer.persist({
      apiKey: config.apiKey,
      payload: { sessionId, truck: lastTruck, job: lastJob, samples },
    });
  }
  map?.close();
  process.exit(0);
});

console.log(`ets2-client → ${config.ingestUrl} (session ${sessionId})`);
tryOpenMap();
flushPending().catch(() => {});
setInterval(sample, SAMPLE_INTERVAL_MS);
setInterval(() => {
  flush().catch((err) => console.error("flush error:", err));
}, FLUSH_INTERVAL_MS);
