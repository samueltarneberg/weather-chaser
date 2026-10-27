// Matching logic shared by the server (normal mode) and the browser (pro-mode timeline).
import { compassDirection, distanceKm, type LatLon } from "./geo";
import type { Criteria, GridCell, Place, Upcoming } from "./types";
import { categoryOf, describeCode } from "./weather";

export const MAX_MATCHES = 10;

export function isMatch(code: number, temp: number, isDay: boolean, { weather, tempRange }: Criteria): boolean {
  if (categoryOf(code) !== weather) return false;
  if (weather === "sun" && !isDay) return false; // "sun" means sunshine, not a clear night
  return !tempRange || (temp >= tempRange.min && temp <= tempRange.max);
}

export function toPlace(
  origin: LatLon,
  p: LatLon & { name: string; country?: string; here?: boolean },
  code: number,
  temp: number,
  isDay: boolean,
): Place {
  const d = distanceKm(origin, p);
  return {
    id: `${p.lat},${p.lon}`,
    name: p.name,
    country: p.country || undefined,
    lat: p.lat,
    lon: p.lon,
    distanceKm: Math.round(d),
    direction: p.here || d < 0.5 ? "" : compassDirection(origin, p),
    here: p.here || undefined,
    weatherCode: code,
    description: describeCode(code),
    temperature: Math.round(temp),
    isDay,
  };
}

/**
 * Keeps places at least `minGapKm` apart (closest first), so the list isn't
 * ten neighbourhoods of the same city.
 */
export function spreadOut(sortedPlaces: Place[], minGapKm: number, max = MAX_MATCHES): Place[] {
  const kept: Place[] = [];
  for (const p of sortedPlaces) {
    if (kept.length >= max) break;
    if (!kept.some((k) => distanceKm(k, p) < minGapKm)) kept.push(p);
  }
  return kept;
}

export const spreadGapKm = (radiusKm: number) => Math.max(2, radiusKm * 0.03);

/** Pro mode: matching grid cells at one hour, closest first. */
export function gridMatches(
  grid: GridCell[],
  hour: number,
  origin: LatLon,
  criteria: Criteria,
  spacingKm: number,
): Place[] {
  return grid
    .filter((c) => isMatch(c.codes[hour], c.temps[hour], c.day[hour] === 1, criteria))
    .map((c) => {
      const here = distanceKm(origin, c) <= spacingKm * 0.75;
      const name = here ? "Your area" : (c.near ?? `${c.lat.toFixed(3)}, ${c.lon.toFixed(3)}`);
      return toPlace(origin, { ...c, name, here }, c.codes[hour], c.temps[hour], c.day[hour] === 1);
    })
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Pro mode: the first hour after `fromHour` with any match, and the closest match then. */
export function nextGridMatch(
  grid: GridCell[],
  times: string[],
  fromHour: number,
  origin: LatLon,
  criteria: Criteria,
  spacingKm: number,
): Upcoming | undefined {
  for (let h = fromHour + 1; h < times.length; h++) {
    const [match] = gridMatches(grid, h, origin, criteria, spacingKm);
    if (match) return { time: times[h], hoursAhead: h - fromHour, match };
  }
}

/** The grid cell nearest the user (their "local" weather in pro mode). */
export function nearestCell(grid: GridCell[], origin: LatLon): GridCell | undefined {
  let best: GridCell | undefined;
  let bestD = Infinity;
  for (const c of grid) {
    const d = distanceKm(origin, c);
    if (d < bestD) [best, bestD] = [c, d];
  }
  return best;
}
