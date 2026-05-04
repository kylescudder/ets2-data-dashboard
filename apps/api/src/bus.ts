import { EventEmitter } from "node:events";
import type { LiveDriver, WsServerMessage } from "@ets2/shared";

class TelemetryBus extends EventEmitter {
  private live = new Map<string, LiveDriver>();
  private offlineTimers = new Map<string, NodeJS.Timeout>();

  snapshot(): LiveDriver[] {
    return [...this.live.values()];
  }

  publish(driver: LiveDriver, message: WsServerMessage) {
    this.live.set(driver.userId, driver);
    this.resetOfflineTimer(driver.userId);
    this.emit("message", message);
  }

  private resetOfflineTimer(userId: string) {
    const existing = this.offlineTimers.get(userId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      this.live.delete(userId);
      this.offlineTimers.delete(userId);
      this.emit("message", { type: "offline", userId } satisfies WsServerMessage);
    }, 30_000);
    this.offlineTimers.set(userId, t);
  }
}

export const bus = new TelemetryBus();
