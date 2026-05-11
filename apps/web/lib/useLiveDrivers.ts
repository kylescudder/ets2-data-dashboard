"use client";

import { useEffect, useRef, useState } from "react";
import type { TelemetrySample } from "@ets2/shared";
import { supabaseBrowser } from "./supabase/client";

export interface DriverRow {
  userId: string;
  name: string;
  displayName: string;
  avatarUrl: string | null;
  status: "online" | "offline";
  truck: { make: string; model: string } | null;
  latest: TelemetrySample | null;
}

const ONLINE_TTL_MS = 30_000;

interface TelemetryRow {
  time: string;
  session_id: string;
  user_id: string;
  speed_kph: number;
  rpm: number;
  gear: number;
  fuel_litres: number;
  fuel_capacity_l: number;
  odometer_km: number;
  truck_damage: number;
  cargo_damage: number;
  pos_x: number;
  pos_y: number;
  pos_z: number;
  heading: number;
  job_cargo: string | null;
  job_source: string | null;
  job_destination: string | null;
  job_remaining_km: number | null;
  job_income: number | null;
}

const TELEMETRY_COLS =
  "time, session_id, user_id, speed_kph, rpm, gear, fuel_litres, fuel_capacity_l, odometer_km, truck_damage, cargo_damage, pos_x, pos_y, pos_z, heading, job_cargo, job_source, job_destination, job_remaining_km, job_income";

function rowToSample(r: TelemetryRow): TelemetrySample {
  return {
    recordedAt: r.time,
    speedKph: r.speed_kph,
    rpm: r.rpm,
    gear: r.gear,
    fuelLitres: r.fuel_litres,
    fuelCapacityLitres: r.fuel_capacity_l,
    odometerKm: r.odometer_km,
    truckDamage: r.truck_damage,
    cargoDamage: r.cargo_damage,
    position: { x: r.pos_x, y: r.pos_y, z: r.pos_z, heading: r.heading },
    job: r.job_cargo
      ? {
          cargo: r.job_cargo,
          sourceCity: r.job_source ?? "",
          destinationCity: r.job_destination ?? "",
          remainingKm: r.job_remaining_km ?? 0,
          deliveryDeadline: null,
          income: r.job_income ?? 0,
        }
      : null,
  };
}

export function useLiveDrivers() {
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [connected, setConnected] = useState(false);
  const offlineTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const truckBySession = useRef<
    Map<string, { make: string; model: string }>
  >(new Map());

  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;

    function scheduleOffline(userId: string, time: string) {
      const existing = offlineTimers.current.get(userId);
      if (existing) clearTimeout(existing);
      const elapsed = Date.now() - new Date(time).getTime();
      const ttl = Math.max(0, ONLINE_TTL_MS - elapsed);
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
      for (const r of (recent ?? []) as TelemetryRow[]) {
        if (!latestByUser.has(r.user_id)) {
          latestByUser.set(r.user_id, r);
          sessionIds.add(r.session_id);
        }
      }

      if (sessionIds.size > 0) {
        const { data: sessions } = await supabase
          .from("sessions")
          .select("id, truck_make, truck_model")
          .in("id", [...sessionIds]);
        for (const s of sessions ?? []) {
          if (s.truck_make && s.truck_model) {
            truckBySession.current.set(s.id, {
              make: s.truck_make,
              model: s.truck_model,
            });
          }
        }
      }

      if (cancelled) return;
      setDrivers(
        users.map((u) => {
          const latest = latestByUser.get(u.id);
          return {
            userId: u.id,
            name: u.name,
            displayName: u.display_name,
            avatarUrl: u.avatar_url,
            status: latest ? "online" : "offline",
            truck: latest
              ? truckBySession.current.get(latest.session_id) ?? null
              : null,
            latest: latest ? rowToSample(latest) : null,
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
        (payload) => {
          const row = payload.new as TelemetryRow;
          setDrivers((prev) =>
            prev.map((d) =>
              d.userId === row.user_id
                ? {
                    ...d,
                    status: "online" as const,
                    latest: rowToSample(row),
                    truck: truckBySession.current.get(row.session_id) ?? d.truck,
                  }
                : d,
            ),
          );
          scheduleOffline(row.user_id, row.time);

          if (!truckBySession.current.has(row.session_id)) {
            supabase
              .from("sessions")
              .select("truck_make, truck_model")
              .eq("id", row.session_id)
              .single()
              .then(({ data }) => {
                if (data?.truck_make && data?.truck_model) {
                  const truck = { make: data.truck_make, model: data.truck_model };
                  truckBySession.current.set(row.session_id, truck);
                  setDrivers((prev) =>
                    prev.map((d) =>
                      d.userId === row.user_id ? { ...d, truck } : d,
                    ),
                  );
                }
              });
          }
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
