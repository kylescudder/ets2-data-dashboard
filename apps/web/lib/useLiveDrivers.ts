"use client";

import { useEffect, useRef, useState } from "react";
import type { ActiveJob, TelemetrySample } from "@ets2/shared";
import { supabaseBrowser } from "./supabase/client";

export interface DriverRow {
  userId: string;
  name: string;
  displayName: string;
  avatarUrl: string | null;
  status: "online" | "offline";
  truck: { make: string; model: string } | null;
  fuelCapacityLitres: number | null;
  latest: TelemetrySample | null;
  job: ActiveJob | null;
}

const ONLINE_TTL_MS = 30_000;

interface TelemetryRow {
  time: string;
  session_id: string;
  user_id: string;
  job_id: string | null;
  speed_kph: number;
  rpm: number;
  gear: number;
  fuel_litres: number;
  odometer_km: number;
  truck_damage: number;
  cargo_damage: number;
  pos_x: number;
  pos_z: number;
  heading: number;
}

const TELEMETRY_COLS =
  "time, session_id, user_id, job_id, speed_kph, rpm, gear, fuel_litres, odometer_km, truck_damage, cargo_damage, pos_x, pos_z, heading";

interface SessionRow {
  id: string;
  fuel_capacity_litres: number | null;
  vehicles: { make: string; model: string } | null;
}

interface JobRow {
  id: string;
  cargo: string;
  source_city: string | null;
  destination_city: string | null;
  income: number | null;
}

interface SessionInfo {
  truck: { make: string; model: string } | null;
  fuelCapacityLitres: number | null;
}

function rowToSample(r: TelemetryRow): TelemetrySample {
  return {
    recordedAt: r.time,
    speedKph: r.speed_kph,
    rpm: r.rpm,
    gear: r.gear,
    fuelLitres: r.fuel_litres,
    odometerKm: r.odometer_km,
    truckDamage: r.truck_damage,
    cargoDamage: r.cargo_damage,
    position: { x: r.pos_x, z: r.pos_z, heading: r.heading },
  };
}

function jobRowToActive(j: JobRow): ActiveJob {
  return {
    cargo: j.cargo,
    sourceCity: j.source_city ?? "",
    destinationCity: j.destination_city ?? "",
    income: j.income ?? 0,
  };
}

function sessionRowToInfo(s: SessionRow): SessionInfo {
  return {
    truck:
      s.vehicles?.make && s.vehicles?.model
        ? { make: s.vehicles.make, model: s.vehicles.model }
        : null,
    fuelCapacityLitres: s.fuel_capacity_litres,
  };
}

export function useLiveDrivers() {
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [connected, setConnected] = useState(false);
  const offlineTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const sessionInfo = useRef<Map<string, SessionInfo>>(new Map());
  const jobById = useRef<Map<string, ActiveJob>>(new Map());

  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;

    // `time` is the sample's recordedAt — used for initial load where we
    // want to expire stale recent telemetry quickly. For live WS arrivals
    // pass `null` instead: the row was *just inserted*, so reset the full
    // TTL regardless of how old the recordedAt is (matters for buffered
    // retries replaying old timestamps).
    function scheduleOffline(userId: string, time: string | null) {
      const existing = offlineTimers.current.get(userId);
      if (existing) clearTimeout(existing);
      let ttl = ONLINE_TTL_MS;
      if (time) {
        const elapsed = Date.now() - new Date(time).getTime();
        ttl = Math.max(0, ONLINE_TTL_MS - elapsed);
      }
      const t = setTimeout(() => {
        setDrivers((prev) =>
          prev.map((d) =>
            d.userId === userId ? { ...d, status: "offline" as const } : d,
          ),
        );
        offlineTimers.current.delete(userId);
      }, ttl);
      offlineTimers.current.set(userId, t);
    }

    async function fetchJob(id: string): Promise<ActiveJob | null> {
      const cached = jobById.current.get(id);
      if (cached) return cached;
      const { data } = await supabase
        .from("jobs")
        .select("cargo, source_city, destination_city, income")
        .eq("id", id)
        .maybeSingle<JobRow>();
      if (!data) return null;
      const j = jobRowToActive({ ...data, id });
      jobById.current.set(id, j);
      return j;
    }

    async function fetchSession(id: string): Promise<SessionInfo | null> {
      const cached = sessionInfo.current.get(id);
      if (cached) return cached;
      const { data } = await supabase
        .from("sessions")
        .select("id, fuel_capacity_litres, vehicles ( make, model )")
        .eq("id", id)
        .maybeSingle<SessionRow>();
      if (!data) return null;
      const info = sessionRowToInfo(data);
      sessionInfo.current.set(id, info);
      return info;
    }

    async function loadInitial() {
      const since = new Date(Date.now() - ONLINE_TTL_MS).toISOString();

      const { data: users, error: usersErr } = await supabase
        .from("users")
        .select("id, name, display_name, avatar_url")
        .order("display_name");
      if (usersErr || !users || cancelled) return;

      const { data: recent } = await supabase
        .from("telemetry")
        .select(TELEMETRY_COLS)
        .gte("time", since)
        .order("time", { ascending: false });

      const latestByUser = new Map<string, TelemetryRow>();
      const sessionIds = new Set<string>();
      const jobIds = new Set<string>();
      for (const r of (recent ?? []) as TelemetryRow[]) {
        if (!latestByUser.has(r.user_id)) {
          latestByUser.set(r.user_id, r);
          sessionIds.add(r.session_id);
          if (r.job_id) jobIds.add(r.job_id);
        }
      }

      if (sessionIds.size > 0) {
        const { data: sessions } = await supabase
          .from("sessions")
          .select("id, fuel_capacity_litres, vehicles ( make, model )")
          .in("id", [...sessionIds]);
        for (const s of (sessions ?? []) as unknown as SessionRow[]) {
          sessionInfo.current.set(s.id, sessionRowToInfo(s));
        }
      }

      if (jobIds.size > 0) {
        const { data: jobs } = await supabase
          .from("jobs")
          .select("id, cargo, source_city, destination_city, income")
          .in("id", [...jobIds]);
        for (const j of (jobs ?? []) as JobRow[]) {
          jobById.current.set(j.id, jobRowToActive(j));
        }
      }

      if (cancelled) return;
      setDrivers(
        users.map((u) => {
          const latest = latestByUser.get(u.id);
          const info = latest ? sessionInfo.current.get(latest.session_id) : null;
          return {
            userId: u.id,
            name: u.name,
            displayName: u.display_name,
            avatarUrl: u.avatar_url,
            status: latest ? "online" : "offline",
            truck: info?.truck ?? null,
            fuelCapacityLitres: info?.fuelCapacityLitres ?? null,
            latest: latest ? rowToSample(latest) : null,
            job: latest?.job_id ? jobById.current.get(latest.job_id) ?? null : null,
          };
        }),
      );
      for (const [userId, row] of latestByUser) scheduleOffline(userId, row.time);
    }

    loadInitial();

    const channel = supabase
      .channel("telemetry-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "telemetry" },
        async (payload) => {
          const row = payload.new as TelemetryRow;
          const job = row.job_id ? await fetchJob(row.job_id) : null;
          const info =
            sessionInfo.current.get(row.session_id) ??
            (await fetchSession(row.session_id));

          setDrivers((prev) =>
            prev.map((d) =>
              d.userId === row.user_id
                ? {
                    ...d,
                    status: "online" as const,
                    latest: rowToSample(row),
                    truck: info?.truck ?? d.truck,
                    fuelCapacityLitres:
                      info?.fuelCapacityLitres ?? d.fuelCapacityLitres,
                    job,
                  }
                : d,
            ),
          );
          scheduleOffline(row.user_id, null);
        },
      )
      .subscribe((status) => setConnected(status === "SUBSCRIBED"));

    return () => {
      cancelled = true;
      for (const t of offlineTimers.current.values()) clearTimeout(t);
      offlineTimers.current.clear();
      supabase.removeChannel(channel);
    };
  }, []);

  return { drivers, connected };
}
