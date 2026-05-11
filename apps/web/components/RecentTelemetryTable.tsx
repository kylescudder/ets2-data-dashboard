"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "../lib/supabase/client";

export interface RecentRow {
  time: string;
  speed_kph: number;
  fuel_litres: number;
  odometer_km: number;
  job_cargo: string | null;
  job_source: string | null;
  job_destination: string | null;
}

const MAX_ROWS = 200;

export function RecentTelemetryTable({
  userId,
  initial,
}: {
  userId: string;
  initial: RecentRow[];
}) {
  const [rows, setRows] = useState<RecentRow[]>(initial);

  useEffect(() => {
    const supabase = supabaseBrowser();
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
        (payload) => {
          const r = payload.new as RecentRow;
          setRows((prev) => [r, ...prev].slice(0, MAX_ROWS));
        },
      )
      .subscribe();
    return () => {
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
            <td className="px-4 py-2 text-right font-mono">{Math.round(r.speed_kph)} km/h</td>
            <td className="px-4 py-2 text-right font-mono">{Math.round(r.fuel_litres)} L</td>
            <td className="px-4 py-2 text-right font-mono">
              {Math.round(r.odometer_km).toLocaleString()} km
            </td>
            <td className="px-4 py-2 text-slate-400">
              {r.job_source && r.job_destination
                ? `${r.job_source} → ${r.job_destination}`
                : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
