/**
 * ETS2 telemetry client (stub).
 *
 * Real implementation will:
 *   1. Read the `Local\SCSTelemetry` shared-memory block exposed by scs-sdk-plugin.
 *      - Windows: CreateFileMappingA / MapViewOfFile via ffi-napi or a small N-API addon.
 *      - Linux:   the plugin runs inside the Wine prefix; either run this client inside
 *                 the same prefix, or use a tiny Wine-side bridge that pushes samples
 *                 to a Unix socket the native process reads.
 *   2. Decode the binary layout from scs-sdk-plugin's headers into TelemetrySample.
 *   3. Sample at ~10 Hz, batch every 1 s, and POST to /api/ingest with the configured
 *      apiKey from a local config file (~/.ets2-tracker/config.json).
 *   4. Buffer to disk if the API is unreachable; replay on reconnect.
 *
 * For now, the simulator in `apps/api` (`bun run simulate`) drives the same /api/ingest
 * endpoint with synthetic data so the DB and dashboard can be developed in isolation.
 */
console.log("ets2-client stub: see apps/client/src/index.ts for implementation plan");
console.log("for now, run: bun run simulate");
