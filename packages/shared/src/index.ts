import { z } from "zod";

export const TelemetrySample = z.object({
  recordedAt: z.string().datetime(),
  speedKph: z.number(),
  rpm: z.number(),
  gear: z.number().int(),
  fuelLitres: z.number(),
  fuelCapacityLitres: z.number(),
  odometerKm: z.number(),
  truckDamage: z.number().min(0).max(1),
  cargoDamage: z.number().min(0).max(1),
  position: z.object({
    x: z.number(),
    y: z.number(),
    z: z.number(),
    heading: z.number(),
  }),
  job: z
    .object({
      cargo: z.string(),
      sourceCity: z.string(),
      destinationCity: z.string(),
      remainingKm: z.number(),
      deliveryDeadline: z.string().datetime().nullable(),
      income: z.number(),
    })
    .nullable(),
});
export type TelemetrySample = z.infer<typeof TelemetrySample>;

export const IngestPayload = z.object({
  sessionId: z.string().uuid(),
  truck: z.object({
    make: z.string(),
    model: z.string(),
  }),
  samples: z.array(TelemetrySample).min(1).max(200),
});
export type IngestPayload = z.infer<typeof IngestPayload>;

export type DriverStatus = "online" | "idle" | "offline";

export interface LiveDriver {
  userId: string;
  name: string;
  status: DriverStatus;
  truck: { make: string; model: string } | null;
  latest: TelemetrySample | null;
}

export type WsServerMessage =
  | { type: "snapshot"; drivers: LiveDriver[] }
  | { type: "update"; userId: string; name: string; sample: TelemetrySample; truck: { make: string; model: string } }
  | { type: "offline"; userId: string };
