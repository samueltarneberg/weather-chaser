// Type-ahead place search combining two free geocoders:
// - Open-Meteo (GeoNames): good prefix matching, ranked by population, so towns come up early.
// - Photon (OpenStreetMap): finds villages, mountains, ski resorts and other named spots.
import { distanceKm, type LatLon } from "./geo";

export interface PlaceSuggestion extends LatLon {
  key: string;
  name: string;
  /** Secondary text, e.g. "peak · Norrbotten · Sweden". */
  detail: string;
  /** Short label for the chosen location, e.g. "Åre, Sweden". */
  label: string;
}

const PHOTON = "https://photon.komoot.io";
const OPEN_METEO = "https://geocoding-api.open-meteo.com/v1/search";

// Photon also returns shops, bus stops, streets... keep only things you'd chase weather to.
const PHOTON_KEYS = new Set(["place", "natural", "boundary", "tourism", "leisure", "landuse", "mountain_pass"]);
const PHOTON_SKIP_VALUES = new Set(["house", "isolated_dwelling", "farm", "plot", "allotments", "residential"]);

const GEONAMES_TYPES: Record<string, string> = {
  PK: "peak",
  MT: "mountain",
  MTS: "mountains",
  AIRP: "airport",
  ISL: "island",
  LK: "lake",
  BCH: "beach",
  PRK: "park",
};

export async function searchPlaces(query: string, near: LatLon | null, signal: AbortSignal): Promise<PlaceSuggestion[]> {
  const [fromOpenMeteo, fromPhoton] = await Promise.all([
    openMeteo(query, signal).catch(() => []),
    photon(query, near, signal).catch(() => []),
  ]);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");

  // Interleave the two sources, then move names that start with the query to the top.
  const merged: PlaceSuggestion[] = [];
  for (let i = 0; i < Math.max(fromOpenMeteo.length, fromPhoton.length); i++) {
    if (fromOpenMeteo[i]) merged.push(fromOpenMeteo[i]);
    if (fromPhoton[i]) merged.push(fromPhoton[i]);
  }
  const q = fold(query);
  const rank = (s: PlaceSuggestion) => (s.name.toLowerCase().startsWith(query.toLowerCase()) ? 0 : fold(s.name).startsWith(q) ? 1 : 2);
  const sorted = merged.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i);

  // The same place often comes back from both sources; keep the first.
  const unique: PlaceSuggestion[] = [];
  for (const { s } of sorted) {
    if (!unique.some((u) => fold(u.name) === fold(s.name) && distanceKm(u, s) < 5)) unique.push(s);
  }
  return unique.slice(0, 7);
}

interface OpenMeteoResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  feature_code?: string;
  country?: string;
  admin1?: string;
}

async function openMeteo(query: string, signal: AbortSignal): Promise<PlaceSuggestion[]> {
  const res = await fetch(`${OPEN_METEO}?name=${encodeURIComponent(query)}&count=6&language=en`, { signal });
  const results: OpenMeteoResult[] = (await res.json()).results ?? [];
  return results.map((r) => ({
    key: `om-${r.id}`,
    name: r.name,
    detail: [GEONAMES_TYPES[r.feature_code ?? ""], r.admin1, r.country].filter(Boolean).join(" · "),
    label: [r.name, r.country].filter(Boolean).join(", "),
    lat: r.latitude,
    lon: r.longitude,
  }));
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    osm_id: number;
    osm_key?: string;
    osm_value?: string;
    name?: string;
    city?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

async function photon(query: string, near: LatLon | null, signal: AbortSignal): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ q: query, limit: "10", lang: "en" });
  if (near) {
    // A gentle nudge towards the user; a strong bias floods the list with local shops and streets.
    params.set("lat", near.lat.toFixed(3));
    params.set("lon", near.lon.toFixed(3));
    params.set("zoom", "7");
    params.set("location_bias_scale", "0.1");
  }
  const res = await fetch(`${PHOTON}/api/?${params}`, { signal });
  const features: PhotonFeature[] = (await res.json()).features ?? [];
  return features
    .filter(
      ({ properties: p }) =>
        p.name && PHOTON_KEYS.has(p.osm_key ?? "") && !PHOTON_SKIP_VALUES.has(p.osm_value ?? ""),
    )
    .map(({ properties: p, geometry }) => {
      const [lon, lat] = geometry.coordinates;
      const kind = ["city", "town", "village", "hamlet", "yes"].includes(p.osm_value ?? "")
        ? undefined
        : p.osm_value?.replace(/_/g, " ");
      return {
        key: `ph-${p.osm_id}-${lat}`,
        name: p.name!,
        detail: [kind, p.city !== p.name ? p.city : undefined, p.county ?? p.state, p.country]
          .filter(Boolean)
          .join(" · "),
        label: [p.name, p.country].filter(Boolean).join(", "),
        lat,
        lon,
      };
    });
}

/** Names a clicked map point from the bundled town list, e.g. "12 km SE of Norrtälje, SE". */
export async function reverseGeocode({ lat, lon }: LatLon): Promise<string | null> {
  try {
    const res = await fetch(`/api/near?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
    return (await res.json()).label ?? null;
  } catch {
    return null;
  }
}

/** Lowercase and strip accents, so "sälen" matches "Salen". */
function fold(s: string) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}
