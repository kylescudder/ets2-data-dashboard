import { supabaseServer } from "../../lib/supabase/server";
import { LeaderboardLive, type LeaderboardRow } from "../../components/LeaderboardLive";

interface UserRow {
  id: string;
  name: string;
  display_name: string;
}

interface TotalRow {
  user_id: string;
  total_km: number;
}

export default async function Leaderboard() {
  const supabase = await supabaseServer();

  const [{ data: users }, { data: totals }] = await Promise.all([
    supabase.from("users").select("id, name, display_name"),
    supabase.rpc("driver_totals_14d"),
  ]);

  const totalsByUser = new Map<string, number>(
    ((totals ?? []) as TotalRow[]).map((r) => [r.user_id, Number(r.total_km ?? 0)]),
  );

  const initial: LeaderboardRow[] = ((users ?? []) as UserRow[])
    .map((u) => ({ ...u, totalKm: totalsByUser.get(u.id) ?? 0 }))
    .sort((a, b) => b.totalKm - a.totalKm);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Leaderboard · last 14 days</h1>
      <LeaderboardLive initial={initial} />
    </div>
  );
}
