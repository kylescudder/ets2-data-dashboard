"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "../lib/supabase/client";
import { formatDistance, formatSpeed, useUnits } from "../lib/units";

interface JobInfo {
  cargo: string;
  source_city: string | null;
  destination_city: string | null;
}

export interface RecentRow {
  time: string;
  speed_kph: number;
  fuel_litres: number;
  odometer_km: number;
  job_id: string | null;
  jobs: JobInfo | null;
}

interface TelemetryInsert {
  time: string;
  speed_kph: number;
  fuel_litres: number;
  odometer_km: number;
  job_id: string | null;
}

const MAX_ROWS = 200;
const REFRESH_MS = 10_000;

export function RecentTelemetryTable({
  userId,
  initial,
}: {
  userId: string;
  initial: RecentRow[];
}) {
  const { units } = useUnits();
  const [rows, setRows] = useState<RecentRow[]>(initial);
  const jobCache = useRef<Map<string, JobInfo>>(
    new Map(
      initial
        .filter((r): r is RecentRow & { job_id: string; jobs: JobInfo } =>
          Boolean(r.job_id && r.jobs),
        )
        .map((r) => [r.job_id, r.jobs]),
    ),
  );

  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;

    async function lookupJob(jobId: string): Promise<JobInfo | null> {
      const cached = jobCache.current.get(jobId);
      if (cached) return cached;
      const { data } = await supabase
        .from("jobs")
        .select("cargo, source_city, destination_city")
        .eq("id", jobId)
        .maybeSingle<JobInfo>();
      if (!data) return null;
      jobCache.current.set(jobId, data);
      return data;
    }

    async function refreshRows() {
      const { data } = await supabase
        .from("telemetry")
        .select("time, speed_kph, fuel_litres, odometer_km, job_id, jobs ( cargo, source_city, destination_city )")
        .eq("user_id", userId)
        .order("time", { ascending: false })
        .limit(MAX_ROWS);
      if (cancelled || !data) return;
      const recent = data as unknown as RecentRow[];
      for (const r of recent) {
        if (r.job_id && r.jobs) jobCache.current.set(r.job_id, r.jobs);
      }
      setRows(recent);
    }

    const channel = supabase
      .channel(`recent-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "telemetry",
          filter: `user_id=eq.${userId}`,
        },
        async (payload) => {
          const raw = payload.new as TelemetryInsert;
          const jobs = raw.job_id ? await lookupJob(raw.job_id) : null;
          const r: RecentRow = {
            time: raw.time,
            speed_kph: raw.speed_kph,
            fuel_litres: raw.fuel_litres,
            odometer_km: raw.odometer_km,
            job_id: raw.job_id,
            jobs,
          };
          setRows((prev) => [r, ...prev].slice(0, MAX_ROWS));
        },
      )
      .subscribe();
    const refreshInterval = setInterval(() => {
      void refreshRows();
    }, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(refreshInterval);
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return (
    <table className="w-full text-sm">
      <thead className="bg-edge/40 text-slate-400 text-xs uppercase">
        <tr>
          <th className="text-left px-4 py-2">Time</th>
          <th className="text-right px-4 py-2">Speed</th>
          <th className="text-right px-4 py-2">Fuel</th>
          <th className="text-right px-4 py-2">Odo</th>
          <th className="text-left px-4 py-2">Job</th>
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 30).map((r, i) => (
          <tr key={`${r.time}-${i}`} className="border-t border-edge">
            <td className="px-4 py-2 font-mono text-xs">
              {new Date(r.time).toLocaleString()}
            </td>
            <td className="px-4 py-2 text-right font-mono">{formatSpeed(r.speed_kph, units)}</td>
            <td className="px-4 py-2 text-right font-mono">{Math.round(r.fuel_litres)} L</td>
            <td className="px-4 py-2 text-right font-mono">
              {formatDistance(r.odometer_km, units)}
            </td>
            <td className="px-4 py-2 text-slate-400">
              {r.jobs?.source_city && r.jobs?.destination_city
                ? `${r.jobs.source_city} → ${r.jobs.destination_city}`
                : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
