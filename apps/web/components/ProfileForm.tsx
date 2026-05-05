"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "../lib/supabase/client";

interface Profile {
  id: string;
  name: string;
  display_name: string;
  avatar_url: string | null;
}

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

export function ProfileForm({ initial }: { initial: Profile }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initial.display_name);
  const [slug, setSlug] = useState(initial.name);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setOk(false);

    const trimmedDisplay = displayName.trim();
    const trimmedSlug = slug.trim().toLowerCase();

    if (!trimmedDisplay) {
      setErr("Display name can't be blank");
      setBusy(false);
      return;
    }
    if (!SLUG_RE.test(trimmedSlug)) {
      setErr(
        "Username must be 2-32 characters: lowercase letters, digits, hyphens (no leading/trailing hyphen)",
      );
      setBusy(false);
      return;
    }

    const supabase = supabaseBrowser();
    const { error } = await supabase
      .from("users")
      .update({ display_name: trimmedDisplay, name: trimmedSlug })
      .eq("id", initial.id);

    setBusy(false);
    if (error) {
      // Postgres unique-violation when slug collides
      setErr(error.code === "23505" ? "That username is taken" : error.message);
      return;
    }
    setOk(true);
    router.refresh();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="max-w-lg rounded-lg border border-edge bg-panel p-6 space-y-4"
    >
      <div>
        <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
          Display name
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          required
          className="w-full rounded border border-edge bg-ink px-3 py-2 outline-none focus:border-accent"
        />
        <p className="text-xs text-slate-500 mt-1">
          Shown on driver cards, the leaderboard, and the live map.
        </p>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
          Username
        </label>
        <input
          type="text"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          required
          className="w-full rounded border border-edge bg-ink px-3 py-2 outline-none focus:border-accent font-mono"
        />
        <p className="text-xs text-slate-500 mt-1">
          URL slug. Your driver page is at <code>/u/{slug || "…"}</code>.
        </p>
      </div>

      {err && <div className="text-sm text-red-400">{err}</div>}
      {ok && !err && <div className="text-sm text-green-300">Saved.</div>}

      <button
        type="submit"
        disabled={busy || !displayName.trim() || !slug.trim()}
        className="rounded bg-accent text-ink font-semibold px-4 py-2 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
