import { API_URL } from "../../lib/env";
import Link from "next/link";

interface DriverDto {
  userId: string;
  name: string;
  displayName: string;
}

interface HistoryRow {
  bucket: string;
  avg_speed: number;
  distance_km: number;
}

export default async function Leaderboard() {
  const drivers: DriverDto[] = await fetch(`${API_URL}/api/drivers`, { cache: "no-store" }).then(
    (r) => r.json(),
  );

  const rows = await Promise.all(
    drivers.map(async (d) => {
      const h: HistoryRow[] = await fetch(
        `${API_URL}/api/drivers/${d.name}/history`,
        { cache: "no-store" },
      ).then((r) => r.json());
      const totalKm = h.reduce((acc, r) => acc + Number(r.distance_km ?? 0), 0);
      return { ...d, totalKm };
    }),
  );
  rows.sort((a, b) => b.totalKm - a.totalKm);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Leaderboard · last 14 days</h1>
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
              <tr key={r.userId} className="border-t border-edge">
                <td className="px-4 py-3 font-mono text-slate-500">{i + 1}</td>
                <td className="px-4 py-3">
                  <Link href={`/u/${r.name}`} className="hover:text-accent">
                    {r.displayName}
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
    </div>
  );
}
