// Affine fit from simulator (x, z) coords to WGS84 (lat, lon), least-squares fit
// against the 10 fixture cities in apps/api/src/fixtures.ts. Accurate to ~1-2°.
// Recompute the coefficients if the fixture city set changes substantially.
export function simToLatLon(x: number, z: number): [number, number] {
  const lat = 0.000644 * x - 0.004378 * z + 50.079;
  const lon = 0.005782 * x - 0.000786 * z + 5.651;
  return [lat, lon];
}
