export function OnboardingBanner() {
  return (
    <section className="rounded-lg border border-accent/30 bg-accent/5 p-6 space-y-4">
      <div>
        <h2 className="text-lg font-bold text-accent">Welcome — let&apos;s get you on the road</h2>
        <p className="text-sm text-slate-300 mt-1">
          Live telemetry comes from a small Windows agent on your gaming PC. It reads
          <code className="mx-1 text-xs">Local\SCSTelemetry</code>
          (the shared-memory block exposed by scs-sdk-plugin) and POSTs samples to this
          site. Three one-time steps:
        </p>
      </div>

      <ol className="text-sm text-slate-300 space-y-3 list-decimal list-inside">
        <li>
          Install{" "}
          <a
            className="underline hover:text-accent"
            href="https://github.com/RenCloud/scs-sdk-plugin/releases"
            target="_blank"
            rel="noreferrer"
          >
            scs-sdk-plugin
          </a>{" "}
          into <code className="text-xs">&lt;Steam&gt;\steamapps\common\Euro Truck Simulator 2\bin\win_x64\plugins\</code>{" "}
          (create the <code className="text-xs">plugins</code> folder if it&apos;s missing).
        </li>
        <li>
          Copy the <span className="font-semibold">config.json</span> snippet below into{" "}
          <code className="text-xs">%USERPROFILE%\.ets2-tracker\config.json</code> on the
          same PC.
        </li>
        <li>
          Clone{" "}
          <a
            className="underline hover:text-accent"
            href="https://github.com/kylescudder/ets2-data-dashboard"
            target="_blank"
            rel="noreferrer"
          >
            the repo
          </a>{" "}
          and run <code className="text-xs">bun install &amp;&amp; bun dev:client</code>{" "}
          (after installing{" "}
          <a className="underline hover:text-accent" href="https://bun.sh" target="_blank" rel="noreferrer">
            bun
          </a>
          ). Start ETS2 first; the agent connects to the plugin once you&apos;re in-game.
        </li>
      </ol>

      <p className="text-xs text-slate-500 pt-2 border-t border-edge">
        This panel disappears once your first driving session arrives.
      </p>
    </section>
  );
}
