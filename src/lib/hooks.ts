"use client";

import { useEffect, useState } from "react";
import type { LatLon } from "./geo";
import type { Place, TravelInfo } from "./types";

const DEBOUNCE_MS = 400; // scrubbing the timeline shouldn't fire a request per hour step

// Module-level cache survives between searches and timeline steps.
const travelCache = new Map<string, TravelInfo>();

const travelKey = (o: LatLon, p: LatLon) => `${o.lat.toFixed(4)},${o.lon.toFixed(4)}>${p.lat},${p.lon}`;

/**
 * Driving time from `origin` to each place, keyed by place id.
 * A place is missing from the map while loading, and `null` when there's no road route.
 */
export function useTravelTimes(origin: LatLon | null, places: Place[]): Map<string, TravelInfo> {
  const [, rerender] = useState(0);
  const ids = places.map((p) => p.id).join("|");

  useEffect(() => {
    if (!origin) return;
    const todo = places.filter((p) => !p.here && !travelCache.has(travelKey(origin, p))).slice(0, 10);
    if (todo.length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/travel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ origin, destinations: todo.map(({ lat, lon }) => ({ lat, lon })) }),
          signal: controller.signal,
        });
        if (!res.ok) return; // drive times are a nice-to-have; fall back to straight-line distance
        const { travel } = (await res.json()) as { travel: TravelInfo[] };
        todo.forEach((p, i) => travelCache.set(travelKey(origin, p), travel[i]));
        rerender((n) => n + 1);
      } catch {
        // aborted or offline
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [origin?.lat, origin?.lon, ids]); // eslint-disable-line react-hooks/exhaustive-deps

  const result = new Map<string, TravelInfo>();
  if (origin) {
    for (const p of places) {
      const key = travelKey(origin, p);
      if (travelCache.has(key)) result.set(p.id, travelCache.get(key)!);
    }
  }
  return result;
}
