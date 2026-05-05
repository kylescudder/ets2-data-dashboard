import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseServer } from "../../../lib/supabase/server";
import { RecentTelemetryTable, type RecentRow } from "../../../components/RecentTelemetryTable";

interface HistoryRow {
  bucket: string;
  avg_speed: number;
  distance_km: number;
}

export default async function DriverPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const supabase = await supabaseServer();

  const { data: user } = await supabase
    .from("users")
    .select("id")
    .eq("name", name)
    .maybeSingle();
  if (!user) notFound();

  const [{ data: history }, { data: recent }] = await Promise.all([
    supabase.rpc("driver_history", { p_name: name }),
    supabase
      .from("telemetry")
      .select(
        "time, speed_kph, fuel_litres, odometer_km, job_cargo, job_source, job_destination",
      )
      .eq("user_id", user.id)
      .order("time", { ascending: false })
      .limit(200),
  ]);

  const historyRows = (history ?? []) as HistoryRow[];
  const recentRows = (recent ?? []) as RecentRow[];
  const totalKm = historyRows.reduce(
    (acc, r) => acc + Number(r.distance_km ?? 0),
    0,
  );

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
            {historyRows.slice(-14).map((r) => {
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
          <RecentTelemetryTable userId={user.id} initial={recentRows} />
        </div>
      </section>
    </div>
  );
}
