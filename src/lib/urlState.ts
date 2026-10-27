// The search lives in the URL so it can be shared, e.g.
// /?w=snow&r=200&m=pro&lat=59.33&lon=18.07&place=Stockholm&tmin=-10&tmax=0&t=2026-10-28T12:00
import type { NamedLocation } from "@/components/LocationPicker";
import { MAX_RADIUS_KM, MIN_RADIUS_KM, type SearchMode } from "./types";
import { isWeatherType, type WeatherType } from "./weather";

export interface UrlState {
  weather?: WeatherType;
  radiusKm?: number;
  mode?: SearchMode;
  /** Forecast hour in UTC; absent means "right now". */
  time?: string;
  origin?: NamedLocation;
  tempRange?: [number, number];
}

export function readUrlState(search: string): UrlState {
  const q = new URLSearchParams(search);
  const state: UrlState = {};
  const w = q.get("w");
  if (w && isWeatherType(w)) state.weather = w;
  const r = Number(q.get("r"));
  if (r >= MIN_RADIUS_KM && r <= MAX_RADIUS_KM) state.radiusKm = Math.round(r / 5) * 5;
  const m = q.get("m");
  if (m === "normal" || m === "pro") state.mode = m;
  const t = q.get("t");
  if (t && /^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(t)) state.time = t;
  const lat = Number(q.get("lat"));
  const lon = Number(q.get("lon"));
  if (q.has("lat") && q.has("lon") && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    state.origin = { lat, lon, label: q.get("place") || "Shared location" };
  }
  const tmin = Number(q.get("tmin"));
  const tmax = Number(q.get("tmax"));
  if (q.has("tmin") && q.has("tmax") && tmin < tmax) state.tempRange = [tmin, tmax];
  return state;
}

export function writeUrlState(s: Required<Pick<UrlState, "weather" | "radiusKm" | "mode" | "origin">> & UrlState): string {
  const q = new URLSearchParams({
    w: s.weather,
    r: String(s.radiusKm),
    m: s.mode,
    lat: s.origin.lat.toFixed(4),
    lon: s.origin.lon.toFixed(4),
  });
  // "Your current location" means nothing to the person you share with.
  if (s.origin.label !== "Your current location") q.set("place", s.origin.label);
  if (s.time) q.set("t", s.time);
  if (s.tempRange) {
    q.set("tmin", String(s.tempRange[0]));
    q.set("tmax", String(s.tempRange[1]));
  }
  return `?${q}`;
}
