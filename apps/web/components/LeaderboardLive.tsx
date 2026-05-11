"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabaseBrowser } from "../lib/supabase/client";

export interface LeaderboardRow {
  id: string;
  name: string;
  display_name: string;
  totalKm: number;
}

interface TelemetryInsert {
  user_id: string;
  odometer_km: number;
}

export function LeaderboardLive({
  initial,
  initialOdometer,
}: {
  initial: LeaderboardRow[];
  initialOdometer: Record<string, number>;
}) {
  const [byUser, setByUser] = useState<Record<string, number>>(() =>
    Object.fromEntries(initial.map((r) => [r.id, r.totalKm])),
  );
  const lastOdoRef = useRef<Map<string, number>>(
    new Map(Object.entries(initialOdometer)),
  );

  const meta = useMemo(
    () => new Map(initial.map((r) => [r.id, { name: r.name, display_name: r.display_name }])),
    [initial],
  );

  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel("leaderboard-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "telemetry" },
        (payload) => {
          const row = payload.new as TelemetryInsert;
          if (!row?.user_id || typeof row.odometer_km !== "number") return;
          const last = lastOdoRef.current.get(row.user_id);
          lastOdoRef.current.set(row.user_id, row.odometer_km);
          if (last == null) return; // first sample after load — establish baseline only
          const delta = row.odometer_km - last;
          if (delta <= 0) return; // odometer reset / out-of-order; skip
          setByUser((prev) => ({
            ...prev,
            [row.user_id]: (prev[row.user_id] ?? 0) + delta,
          }));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const rows = useMemo(() => {
    return Array.from(meta.entries())
      .map(([id, m]) => ({
        id,
        name: m.name,
        display_name: m.display_name,
        totalKm: byUser[id] ?? 0,
      }))
      .sort((a, b) => b.totalKm - a.totalKm);
  }, [meta, byUser]);

  return (
    <div className="rounded-lg border border-edge bg-panel overflow-hidden">
      <table className="w-full">
        <thead className="bg-edge/40 text-slate-400 text-xs uppercase">
          <tr>
            <th className="text-left px-4 py-2 w-10">#</th>
            <th className="text-left px-4 py-2">Driver</th>
            <th className="text-right px-4 py-2">Distance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className="border-t border-edge">
              <td className="px-4 py-3 font-mono text-slate-500">{i + 1}</td>
              <td className="px-4 py-3">
                <Link href={`/u/${r.name}`} className="hover:text-accent">
                  {r.display_name}
                </Link>
              </td>
              <td className="px-4 py-3 text-right font-mono">
                {r.totalKm.toLocaleString(undefined, { maximumFractionDigits: 0 })} km
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
