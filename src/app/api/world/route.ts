import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { worldGrid } from "@/lib/geo";
import { currentUtcHour, fetchSeries, windowTimes } from "@/lib/openMeteo";
import { QuotaError, quotaResponseInit, spendSiteWeather } from "@/lib/quota";
import type { WorldResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const SPACING_KM = 1200;
const REFRESH_MS = 6 * 3_600_000; // ~340 lookups per refresh, so about 1,400 a day

// One world snapshot shared by every visitor; `pending` stops simultaneous refreshes.
// Stored gzipped (~5x smaller): Next.js doesn't compress route handler responses itself.
let snapshot: { gzipped: Buffer; expires: number } | null = null;
let pending: Promise<Buffer> | null = null;

async function refresh(): Promise<Buffer> {
  const points = worldGrid(SPACING_KM);
  spendSiteWeather(points.length);
  const start = currentUtcHour();
  const series = await fetchSeries(points, start);
  const data: WorldResponse = {
    times: windowTimes(start),
    // Whole degrees are plenty at this scale and keep the payload small.
    grid: points.map((p, i) => ({ ...p, near: null, ...series[i], temps: series[i].temps.map(Math.round) })),
    spacingKm: SPACING_KM,
  };
  const gzipped = gzipSync(JSON.stringify(data));
  snapshot = { gzipped, expires: Date.now() + REFRESH_MS };
  return gzipped;
}

function send(gzipped: Buffer) {
  return new Response(new Uint8Array(gzipped), {
    headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
  });
}

/** GET → the world overview: a coarse global grid with 72 hours of weather. */
export async function GET() {
  if (snapshot && snapshot.expires > Date.now()) return send(snapshot.gzipped);
  try {
    pending ??= refresh().finally(() => (pending = null));
    return send(await pending);
  } catch (err) {
    // An old snapshot beats an error.
    if (snapshot) return send(snapshot.gzipped);
    if (err instanceof QuotaError) return NextResponse.json({ error: err.message }, quotaResponseInit(err));
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }
}
