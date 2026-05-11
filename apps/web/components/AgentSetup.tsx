"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "../lib/supabase/client";

interface AgentSetupProps {
  userId: string;
  apiKey: string;
}

function generateKey(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function AgentSetup({ userId, apiKey }: AgentSetupProps) {
  const router = useRouter();
  const [key, setKey] = useState(apiKey);
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState<"key" | "config" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ingestUrl =
    process.env.NEXT_PUBLIC_INGEST_URL ??
    `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321"}/functions/v1/ingest`;

  const configSnippet = useMemo(
    () => JSON.stringify({ ingestUrl, apiKey: key }, null, 2),
    [ingestUrl, key],
  );

  async function copy(value: string, label: "key" | "config") {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
  }

  async function regenerate() {
    if (
      !confirm(
        "Regenerate your agent key? The old key stops working immediately and you'll need to update config.json on every machine running the agent.",
      )
    ) {
      return;
    }
    setBusy(true);
    setErr(null);
    const next = generateKey();
    const { error } = await supabaseBrowser()
      .from("users")
      .update({ api_key: next })
      .eq("id", userId);
    setBusy(false);
    if (error) {
      setErr(error.message);
      return;
    }
    setKey(next);
    setReveal(true);
    router.refresh();
  }

  const masked = key.slice(0, 4) + "…".repeat(8) + key.slice(-4);

  return (
    <section className="max-w-lg rounded-lg border border-edge bg-panel p-6 space-y-4">
      <div>
        <h2 className="text-lg font-bold">Agent setup</h2>
        <p className="text-xs text-slate-500 mt-1">
          The Windows telemetry agent identifies you with this key. Paste the
          snippet below into <code>%USERPROFILE%\.ets2-tracker\config.json</code>
          and start the agent with <code>bun dev:client</code>.
        </p>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
          API key
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={reveal ? key : masked}
            className="flex-1 rounded border border-edge bg-ink px-3 py-2 outline-none font-mono text-sm"
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            className="rounded border border-edge bg-ink px-3 py-2 text-sm hover:border-accent"
          >
            {reveal ? "Hide" : "Show"}
          </button>
          <button
            type="button"
            onClick={() => copy(key, "key")}
            className="rounded border border-edge bg-ink px-3 py-2 text-sm hover:border-accent"
          >
            {copied === "key" ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <div>
        <label className="block text-xs uppercase tracking-wide text-slate-500 mb-1">
          config.json
        </label>
        <pre className="rounded border border-edge bg-ink px-3 py-2 text-xs font-mono overflow-x-auto">
{configSnippet}
        </pre>
        <button
          type="button"
          onClick={() => copy(configSnippet, "config")}
          className="mt-2 rounded border border-edge bg-ink px-3 py-1.5 text-sm hover:border-accent"
        >
          {copied === "config" ? "Copied" : "Copy snippet"}
        </button>
      </div>

      {err && <div className="text-sm text-red-400">{err}</div>}

      <div className="flex items-center justify-between pt-2 border-t border-edge">
        <p className="text-xs text-slate-500">
          Rotate this key if you suspect it leaked.
        </p>
        <button
          type="button"
          onClick={regenerate}
          disabled={busy}
          className="rounded border border-red-500/40 text-red-300 px-3 py-1.5 text-sm hover:bg-red-500/10 disabled:opacity-50"
        >
          {busy ? "Regenerating…" : "Regenerate"}
        </button>
      </div>
    </section>
  );
}
