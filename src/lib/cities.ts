import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { compassDirection, distanceKm, type LatLon } from "./geo";

/** [name, lat, lon, countryCode, population] — built by scripts/build-cities.mjs from GeoNames. */
type CityRow = [string, number, number, string, number];

export interface City extends LatLon {
  name: string;
  country: string;
  distanceKm: number;
}

let cache: CityRow[] | null = null;

function loadCities(): CityRow[] {
  cache ??= JSON.parse(readFileSync(path.join(process.cwd(), "src/data/cities.json"), "utf8"));
  return cache!;
}

/** All towns (population ≥ 5000) within the radius, closest first. */
export function citiesWithin(center: LatLon, radiusKm: number): City[] {
  const maxDLat = radiusKm / 111;
  const result: City[] = [];
  for (const [name, lat, lon, country] of loadCities()) {
    if (Math.abs(lat - center.lat) > maxDLat) continue; // cheap pre-filter
    const d = distanceKm(center, { lat, lon });
    if (d <= radiusKm) result.push({ name, lat, lon, country, distanceKm: d });
  }
  return result.sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Describes a point relative to the nearest town, e.g. "12 km SE of Norrtälje, SE" or just
 * "Norrtälje, SE" when it's in town. Pass `towns` to search a pre-filtered list.
 */
export function describeNear(p: LatLon, towns: City[] = citiesWithin(p, 100)): string | null {
  let best: City | null = null;
  let bestD = Infinity;
  for (const t of towns) {
    const d = distanceKm(p, t);
    if (d < bestD) [best, bestD] = [t, d];
  }
  if (!best) return null;
  const town = `${best.name}, ${best.country}`;
  return bestD < 2 ? town : `${Math.round(bestD)} km ${compassDirection(best, p)} of ${town}`;
}
