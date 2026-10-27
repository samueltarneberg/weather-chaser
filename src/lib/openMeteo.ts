import "server-only";
import type { LatLon } from "./geo";
import { QuotaError } from "./quota";
import { WINDOW_HOURS } from "./types";

/** Hourly weather for one point over the search window. */
export interface Series {
  codes: number[];
  temps: number[];
  /** 1 = daylight, 0 = night */
  day: number[];
}

const API = "https://api.open-meteo.com/v1/forecast";
const BATCH_SIZE = 100; // Open-Meteo accepts many coordinates per request
const CACHE_MS = 15 * 60_000; // weather doesn't change much in 15 minutes
const MAX_CACHE_ENTRIES = 50_000;

// Shared by every visitor: a point that anyone fetched recently is free for everyone else.
const cache = new Map<string, { series: Series; expires: number }>();

/** The current hour in UTC, e.g. "2026-10-27T15:00". */
export function currentUtcHour(): string {
  return new Date().toISOString().slice(0, 13) + ":00";
}

/** The UTC hours covered by a window starting at `start`. */
export function windowTimes(start: string): string[] {
  const t0 = Date.parse(`${start}:00Z`);
  return Array.from({ length: WINDOW_HOURS }, (_, h) => new Date(t0 + h * 3_600_000).toISOString().slice(0, 13) + ":00");
}

const keyOf = (p: LatLon, start: string) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}|${start}`;

/** How many of these points would need a fresh API lookup (used for quota checks). */
export function countUncached(points: LatLon[], start: string): number {
  const now = Date.now();
  return points.filter((p) => (cache.get(keyOf(p, start))?.expires ?? 0) <= now).length;
}

/** Fetches the hourly series for each point, starting at the UTC hour `start`. */
export async function fetchSeries(points: LatLon[], start: string): Promise<Series[]> {
  const now = Date.now();
  const missing = points.filter((p) => (cache.get(keyOf(p, start))?.expires ?? 0) <= now);

  const batches: LatLon[][] = [];
  for (let i = 0; i < missing.length; i += BATCH_SIZE) batches.push(missing.slice(i, i + BATCH_SIZE));
  const fetched = (await Promise.all(batches.map((b) => fetchBatch(b, start)))).flat();

  pruneCache();
  missing.forEach((p, i) => cache.set(keyOf(p, start), { series: fetched[i], expires: now + CACHE_MS }));
  return points.map((p) => cache.get(keyOf(p, start))!.series);
}

async function fetchBatch(points: LatLon[], start: string): Promise<Series[]> {
  const times = windowTimes(start);
  const params = new URLSearchParams({
    latitude: points.map((p) => p.lat).join(","),
    longitude: points.map((p) => p.lon).join(","),
    hourly: "weather_code,temperature_2m,is_day",
    start_hour: times[0],
    end_hour: times[times.length - 1],
    timezone: "GMT",
  });

  const res = await fetch(`${API}?${params}`, { cache: "no-store" });
  if (res.status === 429) {
    throw new QuotaError("The weather service has had enough of us for today. Try again later.", 503, 3600);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`Weather service error: ${body?.reason ?? res.statusText}`);
  }

  const json = await res.json();
  const locations = Array.isArray(json) ? json : [json]; // a single location returns an object
  return locations.map((loc) => ({
    codes: loc.hourly.weather_code,
    temps: loc.hourly.temperature_2m.map((t: number) => Math.round(t * 10) / 10),
    day: loc.hourly.is_day,
  }));
}

function pruneCache() {
  if (cache.size < MAX_CACHE_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of cache) if (entry.expires <= now) cache.delete(key);
  // Still too big: drop the oldest entries (Maps iterate in insertion order).
  for (const key of cache.keys()) {
    if (cache.size < MAX_CACHE_ENTRIES * 0.8) break;
    cache.delete(key);
  }
}
