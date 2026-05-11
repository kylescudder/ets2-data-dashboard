"use client";

import { useEffect, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useLiveDrivers, type DriverRow } from "../lib/useLiveDrivers";
import { simToLatLon } from "../lib/projection";
import { formatSpeed, useUnits } from "../lib/units";

const TRAIL_MAX = 80;

function avatarIcon(d: DriverRow) {
  const url = d.avatarUrl ?? "";
  const initial = (d.displayName[0] ?? "?").toUpperCase();
  const ring = d.status === "online" ? "#34d399" : "#475569";
  const bg = url ? `url(${url}) center/cover no-repeat` : "#1f2937";
  const html = `<div style="
    width:40px;height:40px;border-radius:9999px;
    box-shadow:0 0 0 3px ${ring},0 2px 8px rgba(0,0,0,0.6);
    background:${bg};color:#fff;font-weight:700;font-size:14px;
    display:flex;align-items:center;justify-content:center;
  ">${url ? "" : initial}</div>`;
  return L.divIcon({
    html,
    className: "ets2-avatar-marker",
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

export function LiveMap() {
  const { drivers, connected } = useLiveDrivers();
  const { units } = useUnits();
  const trailsRef = useRef<Map<string, [number, number][]>>(new Map());
  const [, bump] = useState(0);

  useEffect(() => {
    let changed = false;
    for (const d of drivers) {
      if (d.status !== "online" || !d.latest) continue;
      const trail = trailsRef.current.get(d.userId) ?? [];
      const point = simToLatLon(d.latest.position.x, d.latest.position.z);
      const last = trail[trail.length - 1];
      if (!last || last[0] !== point[0] || last[1] !== point[1]) {
        trailsRef.current.set(d.userId, [...trail, point].slice(-TRAIL_MAX));
        changed = true;
      }
    }
    if (changed) bump((n) => n + 1);
  }, [drivers]);

  const online = drivers.filter((d) => d.status === "online" && d.latest);

  return (
    <div className="relative -mx-6 -my-8" style={{ height: "calc(100vh - 73px)" }}>
      <MapContainer
        center={[50.5, 10]}
        zoom={5}
        scrollWheelZoom
        className="w-full h-full"
        style={{ background: "#0b0f17" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {online.map((d) => {
          const trail = trailsRef.current.get(d.userId) ?? [];
          if (trail.length < 2) return null;
          return (
            <Polyline
              key={`${d.userId}-trail`}
              positions={trail}
              pathOptions={{ color: "#34d399", weight: 3, opacity: 0.55 }}
            />
          );
        })}
        {online.map((d) => {
          const sample = d.latest!;
          const pos = simToLatLon(sample.position.x, sample.position.z);
          return (
            <Marker key={d.userId} position={pos} icon={avatarIcon(d)}>
              <Popup>
                <div style={{ minWidth: 160 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{d.displayName}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    {d.truck ? `${d.truck.make} ${d.truck.model}` : ""}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 13 }}>
                    {formatSpeed(sample.speedKph, units)} · gear {sample.gear}
                  </div>
                  {d.job ? (
                    <div style={{ marginTop: 4, fontSize: 12 }}>
                      <div>{d.job.cargo}</div>
                      <div style={{ color: "#475569" }}>
                        {d.job.sourceCity} → {d.job.destinationCity}
                      </div>
                    </div>
                  ) : null}
                  <a
                    href={`/u/${d.name}`}
                    style={{ display: "inline-block", marginTop: 6, fontSize: 12, color: "#22d3ee" }}
                  >
                    history →
                  </a>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      <div className="absolute top-3 right-3 z-[1000] bg-panel/90 border border-edge rounded px-3 py-1.5 text-xs flex gap-3">
        <span className={connected ? "text-green-400" : "text-slate-500"}>
          {connected ? "● live" : "○ disconnected"}
        </span>
        <span className="text-slate-400">{online.length} on the road</span>
      </div>
    </div>
  );
}
