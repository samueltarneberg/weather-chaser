import { NextRequest, NextResponse } from "next/server";
import { citiesWithin, describeNear } from "@/lib/cities";
import { gridPoints, type LatLon } from "@/lib/geo";
import { isMatch, MAX_MATCHES, spreadGapKm, spreadOut, toPlace } from "@/lib/match";
import { countUncached, currentUtcHour, fetchSeries, windowTimes, type Series } from "@/lib/openMeteo";
import { QuotaError, quotaResponseInit, spendWeather, visitorId } from "@/lib/quota";
import {
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
  type Criteria,
  type NormalResponse,
  type Place,
  type ProResponse,
  type SearchMode,
} from "@/lib/types";
import { isWeatherType } from "@/lib/weather";

const NORMAL_BATCH = 100; // towns checked per round, nearest first
const NORMAL_MAX_CHECKED = 500; // stop after this many towns to respect API limits
const HERE_KM = 2; // towns closer than this are the user's own spot, already covered by "Your location"

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const lat = Number(q.get("lat"));
  const lon = Number(q.get("lon"));
  const radiusKm = Number(q.get("radius"));
  const weather = q.get("weather") ?? "";
  const mode = (q.get("mode") ?? "normal") as SearchMode;
  const time = q.get("time"); // absent = now, else UTC hour "YYYY-MM-DDTHH:00"
  const minTemp = q.get("minTemp");
  const maxTemp = q.get("maxTemp");

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return bad("Invalid location");
  if (!(radiusKm >= MIN_RADIUS_KM && radiusKm <= MAX_RADIUS_KM))
    return bad(`Radius must be between ${MIN_RADIUS_KM} and ${MAX_RADIUS_KM} km`);
  if (!isWeatherType(weather)) return bad("Unknown weather type");
  if (mode !== "normal" && mode !== "pro") return bad("Unknown mode");
  if (time && !/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(time)) return bad("Invalid time");

  let tempRange: Criteria["tempRange"];
  if (minTemp !== null || maxTemp !== null) {
    const min = Number(minTemp ?? -Infinity);
    const max = Number(maxTemp ?? Infinity);
    if (Number.isNaN(min) || Number.isNaN(max) || min > max) return bad("Invalid temperature range");
    tempRange = { min, max };
  }

  const origin = { lat, lon };
  const criteria: Criteria = { weather, tempRange };
  const start = time && time > currentUtcHour() ? time : currentUtcHour();
  const visitor = visitorId(req);
  try {
    const body =
      mode === "pro"
        ? await searchGrid(origin, radiusKm, criteria, start, visitor)
        : await searchTowns(origin, radiusKm, criteria, start, visitor);
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof QuotaError) return NextResponse.json({ error: err.message }, quotaResponseInit(err));
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}

/** Fetches weather, charging the visitor only for points that aren't already cached. */
async function fetchWithQuota(points: LatLon[], start: string, visitor: string): Promise<Series[]> {
  spendWeather(visitor, countUncached(points, start));
  return fetchSeries(points, start);
}

/**
 * Normal mode: check named towns, nearest first, and stop at the first round with a match.
 * If nothing matches at the requested hour, find the earliest later hour that does.
 */
async function searchTowns(
  origin: LatLon,
  radiusKm: number,
  criteria: Criteria,
  start: string,
  visitor: string,
): Promise<NormalResponse> {
  const candidates = [
    { name: "Your location", country: "", ...origin, here: true },
    ...citiesWithin(origin, radiusKm).filter((c) => c.distanceKm >= HERE_KM),
  ];
  const times = windowTimes(start);
  const checked: { place: (typeof candidates)[number]; series: Series }[] = [];
  let found: Place[] = [];

  while (checked.length < candidates.length && checked.length < NORMAL_MAX_CHECKED && found.length === 0) {
    const batch = candidates.slice(checked.length, checked.length + NORMAL_BATCH);
    const series = await fetchWithQuota(batch, start, visitor);
    batch.forEach((place, i) => checked.push({ place, series: series[i] }));
    found = matchesAt(checked, 0, origin, criteria);
  }

  // Nothing now: scan forward through the window for the first hour that has a match.
  let next: NormalResponse["next"];
  if (found.length === 0) {
    for (let h = 1; h < times.length && !next; h++) {
      const [match] = matchesAt(checked, h, origin, criteria);
      if (match) next = { time: times[h], hoursAhead: h, match };
    }
  }

  const note =
    found.length === 0 && !next && checked.length < candidates.length
      ? `Checked the ${checked.length} nearest towns of ${candidates.length} in range. Try a smaller radius or Pro mode.`
      : undefined;

  return {
    mode: "normal",
    weather: criteria.weather,
    tempRange: criteria.tempRange,
    time: start,
    matches: spreadOut(found, spreadGapKm(radiusKm), MAX_MATCHES),
    next,
    nightHere: criteria.weather === "sun" && checked[0].series.day[0] === 0,
    checked: checked.length,
    note,
  };
}

function matchesAt(
  checked: { place: LatLon & { name: string; country?: string; here?: boolean }; series: Series }[],
  hour: number,
  origin: LatLon,
  criteria: Criteria,
): Place[] {
  return checked
    .filter(({ series: s }) => isMatch(s.codes[hour], s.temps[hour], s.day[hour] === 1, criteria))
    .map(({ place, series: s }) => toPlace(origin, place, s.codes[hour], s.temps[hour], s.day[hour] === 1))
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Pro mode: an even grid over the whole circle, with 72 hours of weather per point. */
async function searchGrid(
  origin: LatLon,
  radiusKm: number,
  criteria: Criteria,
  start: string,
  visitor: string,
): Promise<ProResponse> {
  const { points, spacingKm } = gridPoints(origin, radiusKm);
  const series = await fetchWithQuota(points, start, visitor);
  const towns = citiesWithin(origin, radiusKm + 100); // grid points near the edge may be closest to a town outside
  return {
    mode: "pro",
    weather: criteria.weather,
    tempRange: criteria.tempRange,
    times: windowTimes(start),
    grid: points.map((p, i) => ({ ...p, near: describeNear(p, towns), ...series[i] })),
    gridSpacingKm: spacingKm,
    checked: points.length,
  };
}

function bad(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
