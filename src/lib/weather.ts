// Weather categories and WMO weather-code helpers. Shared by client and server.
// Code reference: https://open-meteo.com/en/docs (WMO Weather interpretation codes)

// `sky` is the page background shown while chasing that weather;
// `tempRange` is the default for the optional temperature filter (°C).
export const WEATHER_TYPES = {
  sun: {
    label: "Sun",
    hint: "Daytime sunshine only, clear nights don't count",
    emoji: "☀️",
    color: "#fbbf24",
    codes: [0, 1],
    sky: "linear-gradient(165deg, #ffb347 0%, #ff6a5c 38%, #8e2d6b 70%, #1b0f3b 100%)",
    tempRange: [20, 40],
  },
  cloudy: {
    label: "Cloudy",
    hint: "Partly cloudy or overcast",
    emoji: "☁️",
    color: "#94a3b8",
    codes: [2, 3],
    sky: "linear-gradient(165deg, #8a9bb3 0%, #4b5b74 40%, #1f2937 75%, #0b1120 100%)",
    tempRange: [5, 25],
  },
  rain: {
    label: "Rain",
    hint: "Drizzle, rain or showers",
    emoji: "🌧️",
    color: "#3b82f6",
    codes: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82],
    sky: "linear-gradient(165deg, #3a7bd5 0%, #2948a8 38%, #172554 72%, #070b1f 100%)",
    tempRange: [5, 30],
  },
  snow: {
    label: "Snow",
    hint: "Snowfall or snow showers",
    emoji: "❄️",
    color: "#e0f2fe",
    codes: [71, 73, 75, 77, 85, 86],
    sky: "linear-gradient(165deg, #9be7ff 0%, #6b8cff 40%, #3730a3 72%, #120f3a 100%)",
    tempRange: [-20, 0],
  },
  thunderstorm: {
    label: "Thunder",
    hint: "Thunderstorms, with or without hail",
    emoji: "⛈️",
    color: "#d946ef",
    codes: [95, 96, 99],
    sky: "linear-gradient(165deg, #e040fb 0%, #7b1fa2 35%, #311b92 68%, #0a0618 100%)",
    tempRange: [15, 40],
  },
  fog: {
    label: "Fog",
    hint: "Fog or freezing fog",
    emoji: "🌫️",
    color: "#d6d3d1",
    codes: [45, 48],
    sky: "linear-gradient(165deg, #c9c2b8 0%, #8a8178 38%, #44403c 72%, #141210 100%)",
    tempRange: [-5, 15],
  },
} as const;

export type WeatherType = keyof typeof WEATHER_TYPES;

export const WEATHER_TYPE_KEYS = Object.keys(WEATHER_TYPES) as WeatherType[];

export function isWeatherType(value: string): value is WeatherType {
  return value in WEATHER_TYPES;
}

export function categoryOf(code: number): WeatherType | null {
  for (const key of WEATHER_TYPE_KEYS) {
    if ((WEATHER_TYPES[key].codes as readonly number[]).includes(code)) return key;
  }
  return null;
}

const DESCRIPTIONS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light rain showers",
  81: "Rain showers",
  82: "Violent rain showers",
  85: "Light snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with heavy hail",
};

export function describeCode(code: number): string {
  return DESCRIPTIONS[code] ?? "Unknown";
}

/** Heat-map colour for a specific weather code, shaded by intensity within its category. */
const CODE_COLORS: Record<number, string> = {
  0: "#ffc300", 1: "#ffd966",
  2: "#a9c1e8", 3: "#6c7a96",
  45: "#d8cfc4", 48: "#bfb3a5",
  51: "#9be2ff", 53: "#5ccfff", 55: "#1fb6ff", 56: "#8ff0ff", 57: "#3ddcff",
  61: "#4d9bff", 63: "#2f6bff", 65: "#2440d8", 66: "#7ab8ff", 67: "#2a36b8",
  80: "#4fb0ff", 81: "#2f6bff", 82: "#1f2fa8",
  71: "#e8f6ff", 73: "#f5fbff", 75: "#ffffff", 77: "#dbe9ff", 85: "#e8f6ff", 86: "#ffffff",
  95: "#e040fb", 96: "#c026d3", 99: "#a000c8",
};

export function codeColor(code: number): string {
  return CODE_COLORS[code] ?? "#64748b";
}

/** Colour stops for the temperature palette, from coldest to warmest (°C on the absolute scale). */
export const TEMP_STOPS: [number, string][] = [
  [-25, "#7c3aed"],
  [-10, "#2563eb"],
  [0, "#06b6d4"],
  [10, "#22c55e"],
  [20, "#facc15"],
  [30, "#f97316"],
  [40, "#dc2626"],
];

/**
 * Colour for a temperature. With `scale`, the palette is stretched over that range instead,
 * so small local differences (e.g. 9° vs 13°) still show as distinct colours.
 */
export function tempColor(t: number, scale?: TempScale): string {
  if (scale) {
    const [lo, hi] = [TEMP_STOPS[0][0], TEMP_STOPS[TEMP_STOPS.length - 1][0]];
    t = lo + ((t - scale.min) / (scale.max - scale.min)) * (hi - lo);
  }
  if (t <= TEMP_STOPS[0][0]) return TEMP_STOPS[0][1];
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const [t1, c1] = TEMP_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = TEMP_STOPS[i - 1];
      return mix(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return TEMP_STOPS[TEMP_STOPS.length - 1][1];
}

export interface TempScale {
  min: number;
  max: number;
}

/** A display range covering the given temperatures, at least `minSpan` degrees wide. */
export function tempScaleFor(temps: number[], minSpan = 10): TempScale {
  let min = Math.floor(Math.min(...temps));
  let max = Math.ceil(Math.max(...temps));
  const pad = Math.max(0, minSpan - (max - min)) / 2;
  min = Math.floor(min - pad);
  max = Math.ceil(max + pad);
  return { min, max };
}

function mix(a: string, b: string, f: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const channel = (shift: number) =>
    Math.round(((pa >> shift) & 255) * (1 - f) + ((pb >> shift) & 255) * f);
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/** Readable text colour (dark or white) on top of a "#rrggbb" background. */
export function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const luminance = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance > 0.6 ? "#0f172a" : "#ffffff";
}
