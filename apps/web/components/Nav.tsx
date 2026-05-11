"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "../lib/supabase/client";

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (pathname === "/login" || pathname.startsWith("/auth/")) return null;

  async function logout() {
    setBusy(true);
    try {
      await supabaseBrowser().auth.signOut();
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  return (
    <header className="border-b border-edge bg-panel">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-6">
        <Link href="/" className="font-bold text-accent text-lg">ETS2 Tracker</Link>
        <nav className="flex gap-4 text-sm text-slate-300 flex-1">
          <Link href="/">Map</Link>
          <Link href="/drivers">Drivers</Link>
          <Link href="/leaderboard">Leaderboard</Link>
          <Link href="/profile">Profile</Link>
        </nav>
        <button
          onClick={logout}
          disabled={busy}
          className="text-xs text-slate-400 hover:text-accent disabled:opacity-50"
        >
          {busy ? "…" : "Sign out"}
        </button>
      </div>
    </header>
  );
}
