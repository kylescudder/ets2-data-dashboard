"use client";

import dynamic from "next/dynamic";

const LiveMap = dynamic(
  () => import("../components/LiveMap").then((m) => m.LiveMap),
  { ssr: false, loading: () => <div className="text-slate-500">Loading map…</div> },
);

export default function Page() {
  return <LiveMap />;
}
