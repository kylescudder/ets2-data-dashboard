"use client";

import { Suspense, useState } from "react";
import { supabaseBrowser } from "../../lib/supabase/client";

function LoginForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setSent(true);
  }

  return (
    <form
      onSubmit={onSubmit}
      className="max-w-sm mx-auto mt-24 rounded-lg border border-edge bg-panel p-6"
    >
      <h1 className="text-xl font-bold mb-1">ETS2 Tracker</h1>
      <p className="text-xs text-slate-500 mb-4">Sign in with a magic link.</p>

      {sent ? (
        <div className="text-sm text-green-300">
          Check your inbox — sent a link to <span className="font-mono">{email}</span>.
          <div className="mt-2 text-xs text-slate-500">
            On local dev, the link lands in Mailpit at{" "}
            <a className="underline" href="http://127.0.0.1:54324" target="_blank" rel="noreferrer">
              127.0.0.1:54324
            </a>.
          </div>
        </div>
      ) : (
        <>
          <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
            Email
          </label>
          <input
            type="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-edge bg-ink px-3 py-2 mb-3 outline-none focus:border-accent"
          />
          {err && <div className="text-sm text-red-400 mb-3">{err}</div>}
          <button
            type="submit"
            disabled={busy || !email}
            className="w-full rounded bg-accent text-ink font-semibold py-2 disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send magic link"}
          </button>
        </>
      )}
    </form>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
