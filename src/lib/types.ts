import type { WeatherType } from "./weather";

export const MIN_RADIUS_KM = 5;
export const MAX_RADIUS_KM = 500;
export const MIN_TEMP_C = -30;
export const MAX_TEMP_C = 45;
/** How many hours of weather each search covers (timeline and "next match" scan). */
export const WINDOW_HOURS = 72;

export type SearchMode = "normal" | "pro";

export interface Criteria {
  weather: WeatherType;
  tempRange?: { min: number; max: number };
}

export interface Place {
  /** Stable id, "lat,lon". */
  id: string;
  name: string;
  country?: string;
  lat: number;
  lon: number;
  distanceKm: number;
  direction: string;
  /** True when this is the user's own spot. */
  here?: boolean;
  weatherCode: number;
  description: string;
  temperature: number;
  isDay: boolean;
}

/** A pro-mode grid point with its hourly weather over the search window. */
export interface GridCell {
  lat: number;
  lon: number;
  /** e.g. "12 km SE of Norrtälje, SE" */
  near: string | null;
  codes: number[];
  temps: number[];
  day: number[];
}

/** The earliest upcoming match when nothing matches at the requested time. */
export interface Upcoming {
  time: string; // UTC hour, "YYYY-MM-DDTHH:00"
  hoursAhead: number;
  match: Place;
}

interface BaseResponse {
  weather: WeatherType;
  tempRange?: Criteria["tempRange"];
  checked: number;
}

export interface NormalResponse extends BaseResponse {
  mode: "normal";
  time: string;
  /** Matches at `time`, closest first and spread out. */
  matches: Place[];
  next?: Upcoming;
  /** True when chasing sun and it's dark at the user's location. */
  nightHere: boolean;
  /** Set when the search stopped early, e.g. too many towns in the radius. */
  note?: string;
}

/** Pro mode returns the raw grid; the browser works out matches for whichever hour is shown. */
export interface ProResponse extends BaseResponse {
  mode: "pro";
  times: string[];
  grid: GridCell[];
  gridSpacingKm: number;
}

export type SearchResponse = NormalResponse | ProResponse;

/** Driving time to a place; `null` when there's no road route. */
export type TravelInfo = { durationMin: number; distanceKm: number } | null;

/** The world overview: a coarse global grid with 72 hours of weather. */
export interface WorldResponse {
  times: string[];
  grid: GridCell[];
  spacingKm: number;
}
