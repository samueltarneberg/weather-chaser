import { NextRequest, NextResponse } from "next/server";
import { describeNear } from "@/lib/cities";

/** GET ?lat&lon → { label: "12 km SE of Norrtälje, SE" | null }. Names dropped map pins. */
export async function GET(req: NextRequest) {
  const lat = Number(req.nextUrl.searchParams.get("lat"));
  const lon = Number(req.nextUrl.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return NextResponse.json({ error: "Invalid location" }, { status: 400 });
  return NextResponse.json({ label: describeNear({ lat, lon }) });
}
