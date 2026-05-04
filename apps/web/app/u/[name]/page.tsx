import { API_URL } from "../../../lib/env";
import Link from "next/link";

interface HistoryRow {
  bucket: string;
  avg_speed: number;
  distance_km: number;
}

interface RecentRow {
  time: string;
  speed_kph: number;
  fuel_litres: number;
  odometer_km: number;
  job_cargo: string | null;
  job_source: string | null;
  job_destination: string | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.json();
}

export default async function DriverPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const [history, recent] = await Promise.all([
    fetchJson<HistoryRow[]>(`${API_URL}/api/drivers/${name}/history`),
    fetchJson<RecentRow[]>(`${API_URL}/api/drivers/${name}/recent`),
  ]);

  const totalKm = history.reduce((acc, r) => acc + Number(r.distance_km ?? 0), 0);

  return (
    <div>
      <Link href="/" className="text-sm text-slate-400 hover:text-accent">← back</Link>
      <h1 className="text-2xl font-bold capitalize mt-2 mb-6">{name}</h1>

      <section className="mb-8">
        <h2 className="text-sm uppercase tracking-wide text-slate-500 mb-3">Last 14 days</h2>
        <div className="rounded-lg border border-edge bg-panel p-5">
          <div className="text-3xl font-mono">
            {totalKm.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            <span className="text-base text-slate-400 ml-2">km</span>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1">
            {history.slice(-14).map((r) => {
              const h = Math.min(60, Math.max(2, Number(r.distance_km ?? 0) / 4));
              return (
                <div key={r.bucket} className="flex flex-col items-center">
                  <div className="w-full bg-accent/30 rounded" style={{ height: `${h}px` }} />
                  <div className="text-[10px] text-slate-500 mt-1">
                    {new Date(r.bucket).toLocaleDateString(undefined, { weekday: "short" })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm uppercase tracking-wide text-slate-500 mb-3">Recent telemetry</h2>
        <div className="rounded-lg border border-edge bg-panel overflow-hidden">
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
              {recent.slice(0, 30).map((r, i) => (
                <tr key={i} className="border-t border-edge">
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
        </div>
      </section>
    </div>
  );
}
