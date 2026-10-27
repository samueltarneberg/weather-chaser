"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useMemo, useState } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Pane,
  Rectangle,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { LatLon } from "@/lib/geo";
import type { GridCell, Place } from "@/lib/types";
import {
  categoryOf,
  codeColor,
  describeCode,
  TEMP_STOPS,
  tempColor,
  tempScaleFor,
  WEATHER_TYPE_KEYS,
  WEATHER_TYPES,
  type TempScale,
  type WeatherType,
} from "@/lib/weather";

type ColorBy = "weather" | "temperature";

interface Props {
  origin: LatLon | null;
  radiusKm: number;
  weather: WeatherType | null;
  /** The headline result, labelled on the map. */
  best: Place | null;
  others: Place[];
  /** Pro mode: the grid and which hour of it to show. */
  grid?: { cells: GridCell[]; spacingKm: number; hour: number };
  /** World view: the global grid and which hour of it to show. Replaces the search overlays. */
  world?: { cells: GridCell[]; spacingKm: number; hour: number };
  /** Pixels covered on the left (by the floating results card), kept clear when fitting the view. */
  padLeftPx?: number;
  /** When set, clicking the map calls this with the clicked point. */
  onPick?: (point: LatLon) => void;
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const ATTRIBUTION = "Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors";
// With noWrap, Leaflet still requests tiles past the antimeridian unless the layer has bounds.
const WORLD_BOUNDS: [[number, number], [number, number]] = [
  [-85, -180],
  [85, 180],
];

export default function WeatherMap(props: Props) {
  const { origin, radiusKm, weather, best, others, world, padLeftPx = 0, onPick } = props;
  const [colorBy, setColorBy] = useState<ColorBy>("weather");
  const grid = world ?? props.grid;
  const wanted = weather && !world ? WEATHER_TYPES[weather] : null;
  const cells = grid?.cells;
  // One scale for the whole window, so colours stay comparable while scrubbing the timeline.
  const tempScale = useMemo(() => (cells?.length ? tempScaleFor(cells.flatMap((c) => c.temps)) : null), [cells]);

  return (
    <div className={`relative h-full w-full ${onPick ? "picking" : ""}`}>
      {/* One copy of the world only: vector layers (the heat mesh) aren't repeated like tiles are. */}
      <MapContainer
        center={[30, 10]}
        zoom={2}
        minZoom={2}
        maxBounds={[
          [-85, -200],
          [85, 200],
        ]}
        className="h-full w-full"
        scrollWheelZoom
        zoomControl={false}
      >
        {/* Base without labels, heat mesh on top, then labels above the mesh so place names stay readable. */}
        <TileLayer
          attribution={ATTRIBUTION}
          url={`${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`}
          maxNativeZoom={16}
          noWrap
          bounds={WORLD_BOUNDS}
        />
        <Pane name="labels" style={{ zIndex: 360, pointerEvents: "none" }}>
          {/* The label layer has no data below zoom 3 (it serves grey "no data" tiles). */}
          <TileLayer
            url={`${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`}
            minZoom={3}
            maxNativeZoom={16}
            noWrap
            bounds={WORLD_BOUNDS}
          />
        </Pane>

        {world ? (
          <FitWorld />
        ) : (
          origin && <FitToCircle key="fit-circle" origin={origin} radiusKm={radiusKm} padLeftPx={padLeftPx} />
        )}
        {onPick && <ClickToPick onPick={onPick} />}
        {grid && tempScale && (
          <HeatMesh
            key={world ? "world-heat" : "chase-heat"}
            name={world ? "world-heat" : "heat"}
            opacity={world ? 0.6 : 0.8} // lighter over the whole world so continents show through
            {...grid}
            colorBy={colorBy}
            tempScale={tempScale}
          />
        )}

        {origin && !world && (
          <>
            <Circle
              center={[origin.lat, origin.lon]}
              radius={radiusKm * 1000}
              interactive={false}
              pathOptions={{ color: "#fff", weight: 1.5, opacity: 0.6, fill: !grid, fillOpacity: 0.04, dashArray: "4 6" }}
            />
            <CircleMarker
              center={[origin.lat, origin.lon]}
              radius={7}
              pathOptions={{ color: "#0f172a", weight: 3, fillColor: "#fff", fillOpacity: 1 }}
            >
              <Tooltip>You are here</Tooltip>
            </CircleMarker>
          </>
        )}

        {wanted &&
          others.map((m) => (
            <CircleMarker
              key={m.id}
              center={[m.lat, m.lon]}
              radius={5}
              pathOptions={{ color: "#0f172a", weight: 2, fillColor: wanted.color, fillOpacity: 1 }}
            >
              <Tooltip>
                {m.name}: {m.description}, {m.temperature}°C
              </Tooltip>
            </CircleMarker>
          ))}

        {wanted && best && (
          <CircleMarker
            key={best.id}
            center={[best.lat, best.lon]}
            radius={10}
            pathOptions={{ color: "#fff", weight: 3, fillColor: wanted.color, fillOpacity: 1 }}
          >
            <Tooltip permanent direction="top" offset={[0, -10]} className="match-tooltip">
              {wanted.emoji} {best.here ? "Right here" : best.name} · {best.temperature}°
            </Tooltip>
          </CircleMarker>
        )}
      </MapContainer>

      {grid && tempScale && (
        <div className="absolute top-3 right-3 z-[1000] flex flex-col items-end gap-2">
          <div className="flex rounded-full bg-black/60 p-1 text-xs font-semibold backdrop-blur">
            {(["weather", "temperature"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setColorBy(v)}
                className={`rounded-full px-3 py-1 capitalize ${colorBy === v ? "bg-white text-slate-900" : "text-white/70"}`}
              >
                {v}
              </button>
            ))}
          </div>
          <Legend colorBy={colorBy} tempScale={tempScale} />
        </div>
      )}
      {world && <WorldStats cells={world.cells} hour={world.hour} />}
    </div>
  );
}

/** Pro-mode grid drawn as overlapping squares in a blurred pane, so neighbouring cells melt into a heat map. */
function HeatMesh({
  name,
  opacity,
  cells,
  spacingKm,
  hour,
  colorBy,
  tempScale,
}: {
  name: string;
  opacity: number;
  cells: GridCell[];
  spacingKm: number;
  hour: number;
  colorBy: ColorBy;
  tempScale: TempScale;
}) {
  const map = useMap();
  const [pane, setPane] = useState<HTMLElement | null>(null);

  // Blur in proportion to how big a cell is on screen at the current zoom.
  useEffect(() => {
    const update = () => {
      const lat = map.getCenter().lat;
      const metersPerPx = (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** map.getZoom();
      const blurPx = Math.min(40, Math.max(2, ((spacingKm * 1000) / metersPerPx) * 0.45));
      if (pane) pane.style.filter = `blur(${blurPx}px) saturate(1.5)`;
    };
    update();
    map.on("zoomend", update);
    return () => {
      map.off("zoomend", update);
    };
  }, [map, pane, spacingKm]);

  const halfLat = ((spacingKm / 111.32) * 1.3) / 2; // 30% overlap avoids seams between cells

  return (
    <Pane name={name} ref={setPane} style={{ zIndex: 350 }}>
      {cells.map((c) => {
        const halfLon = halfLat / Math.max(0.05, Math.cos((c.lat * Math.PI) / 180));
        const code = c.codes[hour];
        const temp = c.temps[hour];
        return (
          <Rectangle
            key={`${c.lat},${c.lon}`}
            bounds={[
              [c.lat - halfLat, c.lon - halfLon],
              [c.lat + halfLat, c.lon + halfLon],
            ]}
            pathOptions={{
              stroke: false,
              fillColor: colorBy === "weather" ? codeColor(code) : tempColor(temp, tempScale),
              fillOpacity: opacity,
            }}
          >
            <Tooltip sticky>
              {describeCode(code)} · {Math.round(temp)}°C
            </Tooltip>
          </Rectangle>
        );
      })}
    </Pane>
  );
}

function Legend({ colorBy, tempScale }: { colorBy: ColorBy; tempScale: TempScale }) {
  if (colorBy === "temperature") {
    const gradient = TEMP_STOPS.map(([, c], i) => `${c} ${(i / (TEMP_STOPS.length - 1)) * 100}%`).join(", ");
    const mid = Math.round((tempScale.min + tempScale.max) / 2);
    return (
      <div className="w-44 rounded-2xl bg-black/60 px-3 py-2 text-[11px] font-semibold backdrop-blur">
        <div className="h-2.5 rounded-full" style={{ background: `linear-gradient(90deg, ${gradient})` }} />
        <div className="mt-1 flex justify-between text-white/70 tabular-nums">
          <span>{tempScale.min}°</span>
          <span>{mid}°</span>
          <span>{tempScale.max}°</span>
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-x-3 gap-y-1 rounded-2xl bg-black/60 px-3 py-2 text-[10px] font-semibold backdrop-blur sm:grid-cols-2 sm:text-[11px]">
      {WEATHER_TYPE_KEYS.map((key) => (
        <div key={key} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: WEATHER_TYPES[key].color }} />
          {WEATHER_TYPES[key].label}
        </div>
      ))}
    </div>
  );
}

function ClickToPick({ onPick }: { onPick: (point: LatLon) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lon: L.Util.wrapNum(e.latlng.lng, [-180, 180]) }) });
  return null;
}

function FitToCircle({ origin, radiusKm, padLeftPx }: { origin: LatLon; radiusKm: number; padLeftPx: number }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(L.latLng(origin.lat, origin.lon).toBounds(radiusKm * 2000), {
      paddingTopLeft: [20 + padLeftPx, 20],
      paddingBottomRight: [20, 20],
    });
  }, [map, origin.lat, origin.lon, radiusKm, padLeftPx]);
  return null;
}

function FitWorld() {
  const map = useMap();
  useEffect(() => {
    map.setView([25, 10], 2);
  }, [map]);
  return null;
}

/** Share of the world (grid cells are roughly equal-area) in each kind of weather at this hour. */
function WorldStats({ cells, hour }: { cells: GridCell[]; hour: number }) {
  const counts = new Map<WeatherType, number>();
  for (const c of cells) {
    const cat = categoryOf(c.codes[hour]);
    if (cat) counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  const shares = [...counts].sort((a, b) => b[1] - a[1]);
  return (
    <div className="absolute top-3 left-3 z-[1000] flex max-w-[calc(100%-1.5rem)] flex-wrap gap-1.5 sm:max-w-[60%]">
      {shares.map(([cat, n]) => (
        <span
          key={cat}
          title={WEATHER_TYPES[cat].label}
          className="rounded-full bg-black/60 px-3 py-1 text-sm font-black tabular-nums backdrop-blur"
        >
          {WEATHER_TYPES[cat].emoji} {Math.round((n / cells.length) * 100)}%
        </span>
      ))}
    </div>
  );
}
