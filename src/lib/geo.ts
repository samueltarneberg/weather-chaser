export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_KM = 6371;
const KM_PER_DEG_LAT = 111.32;
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle (haversine) distance in kilometres. */
export function distanceKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** Compass direction (N, NE, E, ...) from a to b. */
export function compassDirection(a: LatLon, b: LatLon): string {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  const bearing = (toDeg(Math.atan2(y, x)) + 360) % 360;
  return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(bearing / 45) % 8];
}

// Grid spacings are rounded up to one of these, and grid points sit on a fixed global lattice,
// so nearby searches reuse the same points (and the same cached weather).
const GRID_SPACINGS_KM = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 75];

/** Evenly spaced points covering a circle, at most about `targetCount` of them. */
export function gridPoints(
  center: LatLon,
  radiusKm: number,
  targetCount = 200,
): { points: LatLon[]; spacingKm: number } {
  const ideal = radiusKm * Math.sqrt(Math.PI / targetCount);
  const spacing = GRID_SPACINGS_KM.find((s) => s >= ideal) ?? GRID_SPACINGS_KM[GRID_SPACINGS_KM.length - 1];
  const steps = Math.ceil(radiusKm / spacing) + 1;
  const latStep = spacing / KM_PER_DEG_LAT;
  const row0 = Math.round(center.lat / latStep);
  const points: LatLon[] = [];

  for (let i = -steps; i <= steps; i++) {
    const lat = (row0 + i) * latStep;
    if (lat < -90 || lat > 90) continue;
    const lonStep = spacing / (KM_PER_DEG_LAT * Math.max(0.05, Math.cos(toRad(lat))));
    const col0 = Math.round(center.lon / lonStep);
    for (let j = -steps; j <= steps; j++) {
      const lon = ((((col0 + j) * lonStep + 540) % 360) + 360) % 360 - 180;
      const p = { lat: +lat.toFixed(4), lon: +lon.toFixed(4) };
      if (distanceKm(center, p) <= radiusKm) points.push(p);
    }
  }
  return { points, spacingKm: spacing };
}

/** Roughly evenly spaced points over the whole globe (poles excluded), for the world overview. */
export function worldGrid(spacingKm = 1000, maxLat = 75): LatLon[] {
  const latStep = spacingKm / KM_PER_DEG_LAT;
  const points: LatLon[] = [];
  for (let lat = -Math.floor(maxLat / latStep) * latStep; lat <= maxLat; lat += latStep) {
    const cols = Math.max(1, Math.round((360 * KM_PER_DEG_LAT * Math.cos(toRad(lat))) / spacingKm));
    for (let j = 0; j < cols; j++) {
      points.push({ lat: +lat.toFixed(4), lon: +(-180 + (j + 0.5) * (360 / cols)).toFixed(4) });
    }
  }
  return points;
}
