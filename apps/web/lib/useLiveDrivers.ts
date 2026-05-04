"use client";

import { useEffect, useState } from "react";
import type { TelemetrySample, WsServerMessage } from "@ets2/shared";
import { API_URL, WS_URL } from "./env";

export interface DriverRow {
  userId: string;
  name: string;
  displayName: string;
  avatarUrl: string | null;
  status: "online" | "offline";
  truck: { make: string; model: string } | null;
  latest: TelemetrySample | null;
}

export function useLiveDrivers() {
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_URL}/api/drivers`)
      .then((r) => r.json())
      .then((data: DriverRow[]) => {
        if (!cancelled) setDrivers(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      const msg: WsServerMessage = JSON.parse(ev.data);
      setDrivers((prev) => {
        if (msg.type === "snapshot") {
          const live = new Map(msg.drivers.map((d) => [d.userId, d]));
          return prev.map((d) => {
            const l = live.get(d.userId);
            return l ? { ...d, status: "online" as const, latest: l.latest, truck: l.truck } : d;
          });
        }
        if (msg.type === "update") {
          return prev.map((d) =>
            d.userId === msg.userId
              ? { ...d, status: "online" as const, latest: msg.sample, truck: msg.truck }
              : d,
          );
        }
        if (msg.type === "offline") {
          return prev.map((d) =>
            d.userId === msg.userId ? { ...d, status: "offline" as const } : d,
          );
        }
        return prev;
      });
    };
    return () => ws.close();
  }, []);

  return { drivers, connected };
}
