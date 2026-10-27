import { NextRequest, NextResponse } from "next/server";
import type { LatLon } from "@/lib/geo";
import { LIMITS, QuotaError, quotaResponseInit, spend, visitorId } from "@/lib/quota";
import type { TravelInfo } from "@/lib/types";

// Free public OSRM demo server: fine for a hobby site; self-host or use a paid router for heavy traffic.
const OSRM = "https://router.project-osrm.org/table/v1/driving";
const MAX_DESTINATIONS = 10;
const MAX_SNAP_M = 5000; // further than this from any road = no road route (sea, wilderness)

/** POST { origin: {lat, lon}, destinations: [{lat, lon}] } → { travel: TravelInfo[] } */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const origin = body?.origin as LatLon | undefined;
  const destinations = body?.destinations as LatLon[] | undefined;
  if (!isLatLon(origin) || !Array.isArray(destinations) || !destinations.every(isLatLon))
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  if (destinations.length === 0) return NextResponse.json({ travel: [] });
  if (destinations.length > MAX_DESTINATIONS)
    return NextResponse.json({ error: `At most ${MAX_DESTINATIONS} destinations` }, { status: 400 });

  try {
    spend(`t:${visitorId(req)}`, LIMITS.visitorTravel, 1, "Too many drive-time lookups. Try again in a bit.");
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, quotaResponseInit(err as QuotaError));
  }

  const coords = [origin, ...destinations].map((p) => `${p.lon.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  try {
    const res = await fetch(`${OSRM}/${coords}?sources=0&annotations=duration,distance`, {
      next: { revalidate: 86_400 }, // roads don't change much in a day
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json();
    if (json.code !== "Ok") throw new Error(json.message ?? "Routing failed");

    const originOffRoad = json.sources[0].distance > MAX_SNAP_M;
    const travel: TravelInfo[] = destinations.map((_, i) => {
      const duration = json.durations[0][i + 1];
      const offRoad = originOffRoad || json.destinations[i + 1].distance > MAX_SNAP_M;
      if (duration == null || offRoad) return null;
      return { durationMin: Math.round(duration / 60), distanceKm: Math.round(json.distances[0][i + 1] / 1000) };
    });
    return NextResponse.json({ travel });
  } catch {
    return NextResponse.json({ error: "Drive times unavailable right now" }, { status: 502 });
  }
}

function isLatLon(p: unknown): p is LatLon {
  const { lat, lon } = (p ?? {}) as LatLon;
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}
