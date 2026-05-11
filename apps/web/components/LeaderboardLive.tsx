"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "../lib/supabase/client";

export interface LeaderboardRow {
  id: string;
  name: string;
  display_name: string;
  totalKm: number;
}

interface TotalRow {
  user_id: string;
  total_km: number;
}

const POLL_INTERVAL_MS = 3_000;

export function LeaderboardLive({ initial }: { initial: LeaderboardRow[] }) {
  const [byUser, setByUser] = useState<Record<string, number>>(() =>
    Object.fromEntries(initial.map((r) => [r.id, r.totalKm])),
  );

  const meta = useMemo(
    () => new Map(initial.map((r) => [r.id, { name: r.name, display_name: r.display_name }])),
    [initial],
  );

  // Tried WS-delta accumulation first — too fragile (backgrounded tabs,
  // reconnects, brief Realtime hiccups silently dropped events, the running
  // total drifted away from reality). For a friends-scale leaderboard the
  // RPC is dirt cheap; poll it on a short interval and totals are always
  // ground truth.
  useEffect(() => {
    const supabase = supabaseBrowser();
    let cancelled = false;

    async function refresh() {
      const { data } = await supabase.rpc("driver_totals_14d");
      if (cancelled || !data) return;
      setByUser((prev) => {
        const next: Record<string, number> = { ...prev };
        for (const r of data as TotalRow[]) {
          next[r.user_id] = Number(r.total_km ?? 0);
        }
        return next;
      });
    }

    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const rows = useMemo(
    () =>
      Array.from(meta.entries())
        .map(([id, m]) => ({
          id,
          name: m.name,
          display_name: m.display_name,
          totalKm: byUser[id] ?? 0,
        }))
        .sort((a, b) => b.totalKm - a.totalKm),
    [meta, byUser],
  );

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
                {r.totalKm.toLocaleString(undefined, {
                  minimumFractionDigits: 1,
                  maximumFractionDigits: 1,
                })} km
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
