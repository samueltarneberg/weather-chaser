"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LocationPicker, { type NamedLocation } from "@/components/LocationPicker";
import RangeSlider from "@/components/RangeSlider";
import Results, { type SortBy } from "@/components/Results";
import Timeline from "@/components/Timeline";
import type { LatLon } from "@/lib/geo";
import { useTravelTimes } from "@/lib/hooks";
import { gridMatches, isMatch, nearestCell, nextGridMatch, spreadGapKm, spreadOut } from "@/lib/match";
import { reverseGeocode } from "@/lib/placeSearch";
import { localDayDiff, parseUtcHour } from "@/lib/time";
import {
  MAX_RADIUS_KM,
  MAX_TEMP_C,
  MIN_RADIUS_KM,
  MIN_TEMP_C,
  type Place,
  type SearchMode,
  type SearchResponse,
  type TravelInfo,
  type WorldResponse,
} from "@/lib/types";
import { readUrlState, writeUrlState } from "@/lib/urlState";
import { textOn, WEATHER_TYPE_KEYS, WEATHER_TYPES, type WeatherType } from "@/lib/weather";

// Leaflet touches `window`, so the map is only rendered in the browser.
const WeatherMap = dynamic(() => import("@/components/WeatherMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full animate-pulse bg-black/30" />,
});

const FORECAST_DAYS = 7;

interface TempFilter {
  enabled: boolean;
  range: [number, number];
}

/** Each weather type remembers its own temperature filter. */
const initialTempFilters = Object.fromEntries(
  WEATHER_TYPE_KEYS.map((k) => [k, { enabled: false, range: [...WEATHER_TYPES[k].tempRange] }]),
) as Record<WeatherType, TempFilter>;

/** A finished search, together with the location and radius it was made for. */
interface Searched {
  result: SearchResponse;
  origin: NamedLocation;
  radiusKm: number;
}

export default function Home() {
  const [weather, setWeather] = useState<WeatherType>("sun");
  const [tempFilters, setTempFilters] = useState(initialTempFilters);
  const [radiusKm, setRadiusKm] = useState(100);
  const [mode, setMode] = useState<SearchMode>("normal");
  const [when, setWhen] = useState<"now" | "later">("now");
  const [dayOffset, setDayOffset] = useState(1);
  const [hour, setHour] = useState(12);
  const [origin, setOrigin] = useState<NamedLocation | null>(null);
  const [picking, setPicking] = useState(false);
  /** null until the URL has been read; a shared link may preset everything. */
  const [urlLoaded, setUrlLoaded] = useState<{ hasOrigin: boolean } | null>(null);
  const [autoSearch, setAutoSearch] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState<Searched | null>(null);
  const [proHour, setProHour] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>("drive");
  const [resultsCollapsed, setResultsCollapsed] = useState(false);
  const resultsRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const isDesktop = useIsDesktop();

  const [screen, setScreen] = useState<"chase" | "world">("chase");
  const [world, setWorld] = useState<WorldResponse | null>(null);
  const [worldStatus, setWorldStatus] = useState<"idle" | "loading" | "error">("idle");
  const [worldHour, setWorldHour] = useState(0);
  const [worldNow, setWorldNow] = useState(0);

  const temp = tempFilters[weather];
  const setTemp = (patch: Partial<TempFilter>) =>
    setTempFilters((f) => ({ ...f, [weather]: { ...f[weather], ...patch } }));

  // Restore a shared search from the URL, then run it.
  useEffect(() => {
    const s = readUrlState(window.location.search);
    if (s.weather) setWeather(s.weather);
    if (s.radiusKm) setRadiusKm(s.radiusKm);
    if (s.mode) setMode(s.mode);
    if (s.tempRange) {
      const w = s.weather ?? "sun";
      setTempFilters((f) => ({ ...f, [w]: { enabled: true, range: s.tempRange! } }));
    }
    if (s.time) {
      const t = parseUtcHour(s.time);
      const days = localDayDiff(new Date(), t);
      if (t.getTime() > Date.now() - 3_600_000 && days < FORECAST_DAYS) {
        setWhen("later");
        setDayOffset(days);
        setHour(t.getHours());
      }
    }
    if (s.origin) {
      setOrigin(s.origin);
      setAutoSearch(true);
    }
    setUrlLoaded({ hasOrigin: !!s.origin });
  }, []);

  useEffect(() => {
    if (autoSearch && origin) {
      setAutoSearch(false);
      search();
    }
  }, [autoSearch, origin]); // eslint-disable-line react-hooks/exhaustive-deps

  // On phones the results are below the form; bring them into view.
  useEffect(() => {
    if (searched && window.innerWidth < 1024) resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [searched]);
  useEffect(() => {
    if (error && window.innerWidth < 1024) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error]);

  function changeOrigin(location: NamedLocation) {
    setOrigin(location);
    setSearched(null); // the old result belongs to the old location
  }

  async function pickOnMap(point: LatLon) {
    setPicking(false);
    changeOrigin({ ...point, label: "Dropped pin" });
    const label = await reverseGeocode(point);
    if (label) setOrigin((o) => (o && o.lat === point.lat && o.lon === point.lon ? { ...o, label } : o));
  }

  /** The selected forecast hour as a UTC string like "2026-10-28T11:00", or undefined for now. */
  function selectedTimeUtc(): string | undefined {
    if (when === "now") return undefined;
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString().slice(0, 13) + ":00";
  }

  async function search() {
    if (!origin) return;
    const time = selectedTimeUtc();
    if (time && parseUtcHour(time).getTime() + 3_600_000 < Date.now()) {
      return setError("That's in the past. Even I can't forecast backwards.");
    }

    setLoading(true);
    setError(null);
    const tempRange = temp.enabled ? temp.range : undefined;
    const params = new URLSearchParams({
      lat: origin.lat.toFixed(4),
      lon: origin.lon.toFixed(4),
      radius: String(radiusKm),
      weather,
      mode,
    });
    if (time) params.set("time", time);
    if (tempRange) {
      params.set("minTemp", String(tempRange[0]));
      params.set("maxTemp", String(tempRange[1]));
    }

    try {
      const res = await fetch(`/api/search?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Search failed");
      setSearched({ result: json, origin, radiusKm });
      setProHour(0);
      setResultsCollapsed(false);
      window.history.replaceState(null, "", writeUrlState({ weather, radiusKm, mode, origin, time, tempRange }));
    } catch (err) {
      setError((err as Error).message);
      setSearched(null);
    } finally {
      setLoading(false);
    }
  }

  async function switchScreen(next: "chase" | "world") {
    setScreen(next);
    if (next !== "world" || world || worldStatus === "loading") return;
    setWorldStatus("loading");
    try {
      const res = await fetch("/api/world");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      // The shared snapshot can be a few hours old; start the timeline at the current hour.
      const now = Math.max(0, json.times.indexOf(new Date().toISOString().slice(0, 13) + ":00"));
      setWorld(json);
      setWorldNow(now);
      setWorldHour(now);
      setWorldStatus("idle");
    } catch {
      setWorldStatus("error");
    }
  }

  // What to show for the current result (and, in pro mode, the hour on the timeline).
  const view = useMemo(() => {
    if (!searched) return null;
    const { result, origin: o, radiusKm: r } = searched;
    if (result.mode === "normal") {
      return { matches: result.matches, next: result.next, nightHere: result.nightHere, note: result.note };
    }
    const criteria = { weather: result.weather, tempRange: result.tempRange };
    const spacing = result.gridSpacingKm;
    const matches = spreadOut(
      gridMatches(result.grid, proHour, o, criteria, spacing),
      Math.max(spreadGapKm(r), spacing * 1.5),
    );
    const next = matches.length ? undefined : nextGridMatch(result.grid, result.times, proHour, o, criteria, spacing);
    const nightHere = result.weather === "sun" && nearestCell(result.grid, o)?.day[proHour] === 0;
    return { matches, next, nightHere, note: undefined };
  }, [searched, proHour]);

  const matchHours = useMemo(() => {
    if (searched?.result.mode !== "pro") return [];
    const { grid, times, weather: w, tempRange } = searched.result;
    return times.map((_, h) => grid.some((c) => isMatch(c.codes[h], c.temps[h], c.day[h] === 1, { weather: w, tempRange })));
  }, [searched]);

  const targets = view ? [...view.matches, ...(view.next ? [view.next.match] : [])] : [];
  const travel = useTravelTimes(searched?.origin ?? null, targets);
  const travelLoading = targets.some((p) => !p.here && !travel.has(p.id));
  const ranked = view ? (sortBy === "drive" && !travelLoading ? rankByDrive(view.matches, travel) : view.matches) : [];
  const jumpToNext = useCallback(() => {
    if (searched?.result.mode === "pro" && view?.next) setProHour((h) => h + view.next!.hoursAhead);
  }, [searched, view]);

  const type = WEATHER_TYPES[weather];
  const pro = searched?.result.mode === "pro" ? searched.result : null;
  const chasing = screen === "chase";
  // On wide screens the results float over the map's left side; elsewhere they sit below the map.
  const floatingCard = isDesktop && chasing && !!searched && !resultsCollapsed;

  const findButton = (className: string) => (
    <button
      type="button"
      onClick={search}
      disabled={!origin || loading}
      className={`h-14 truncate rounded-2xl px-4 text-lg font-black tracking-wide whitespace-nowrap uppercase transition hover:scale-[1.02] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      style={{ background: type.color, color: textOn(type.color), boxShadow: `0 0 32px ${type.color}99` }}
    >
      {loading ? "Chasing… 🌀" : `Find ${type.label} ${type.emoji}`}
    </button>
  );

  const results = searched && view && (
    <Results
      ref={resultsRef}
      mode={searched.result.mode}
      weather={searched.result.weather}
      tempRange={searched.result.tempRange}
      origin={searched.origin}
      radiusKm={searched.radiusKm}
      matches={ranked}
      next={view.next}
      nightHere={view.nightHere}
      checked={searched.result.checked}
      note={view.note}
      travel={travel}
      travelLoading={travelLoading}
      sortBy={sortBy}
      onSortBy={setSortBy}
      onJumpToNext={pro ? jumpToNext : undefined}
      className={isDesktop ? "absolute top-3 left-3 z-[1000] w-[380px] max-h-[calc(100%-1.5rem)] overflow-y-auto" : ""}
      collapsed={isDesktop && resultsCollapsed}
      onToggleCollapsed={isDesktop ? () => setResultsCollapsed((c) => !c) : undefined}
    />
  );

  return (
    <>
      {/* One background layer per weather, cross-faded when the choice changes. */}
      <div className="fixed inset-0 -z-10 bg-slate-950">
        {WEATHER_TYPE_KEYS.map((k) => (
          <div
            key={k}
            className="absolute inset-0 transition-opacity duration-700"
            style={{ background: WEATHER_TYPES[k].sky, opacity: k === weather ? 1 : 0 }}
          />
        ))}
      </div>

      <div className={`flex min-h-screen flex-col lg:h-screen lg:pb-0 ${chasing ? "pb-24" : ""}`}>
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 pt-5 pb-4 sm:px-5">
          <h1 className="text-2xl leading-none font-black tracking-tight uppercase sm:text-3xl">
            Weather<span className="text-white/60">Chaser</span>
          </h1>
          <div className="w-60">
            <Segmented
              value={screen}
              onChange={switchScreen}
              options={[
                { value: "chase", label: "🎯 Chase" },
                { value: "world", label: "🌍 World" },
              ]}
            />
          </div>
          <p className="hidden text-sm font-medium text-white/70 xl:block">
            Because the good weather is never where you are.
          </p>
        </header>

        <main className="flex flex-1 flex-col gap-4 px-4 pb-5 sm:px-5 lg:min-h-0">
          {chasing && (
            // Every control keeps a fixed size whatever its state, so pressing buttons never moves the layout.
            <section className="glass space-y-4 p-4">
              {/* Row 1: what you're chasing */}
              <div className="flex flex-wrap items-end gap-x-8 gap-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem]">
                <Field label="I'm chasing" className="min-w-0 flex-1">
                  <div className="flex flex-wrap gap-2">
                    {WEATHER_TYPE_KEYS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setWeather(key)}
                        className={`flex items-center gap-2 rounded-full py-1.5 pr-4 pl-3 text-sm font-bold transition ${
                          weather === key
                            ? "bg-white text-slate-900 shadow-lg"
                            : "bg-white/10 text-white hover:bg-white/20"
                        }`}
                      >
                        <span className="text-xl leading-none">{WEATHER_TYPES[key].emoji}</span>
                        {WEATHER_TYPES[key].label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 truncate text-xs text-white/60">{type.hint}</p>
                </Field>

                <Field
                  label="Temperature"
                  className="w-full sm:w-96 lg:w-auto"
                  aside={
                    <Toggle
                      checked={temp.enabled}
                      onChange={(enabled) => setTemp({ enabled })}
                      label={`Filter ${type.label.toLowerCase()} by temperature`}
                    />
                  }
                >
                  <div className="flex items-center gap-4">
                    <span
                      className={`w-32 shrink-0 text-lg font-black whitespace-nowrap tabular-nums ${temp.enabled ? "" : "text-white/40"}`}
                    >
                      {temp.enabled ? `${temp.range[0]}° to ${temp.range[1]}°` : "Any temp"}
                    </span>
                    <div className="flex-1">
                      <RangeSlider
                        min={MIN_TEMP_C}
                        max={MAX_TEMP_C}
                        value={temp.range}
                        disabled={!temp.enabled}
                        onChange={(range) => setTemp({ range })}
                      />
                    </div>
                  </div>
                </Field>
              </div>

              {/* Row 2: where, when, how, go */}
              <div className="flex flex-wrap items-end gap-x-6 gap-y-4 xl:grid xl:grid-cols-[minmax(14rem,1fr)_10rem_auto_9rem_13rem] xl:gap-x-5">
                <Field label="From" className="min-w-[260px] flex-[2] xl:min-w-0">
                  {urlLoaded ? (
                    <LocationPicker value={origin} onChange={changeOrigin} autoLocate={!urlLoaded.hasOrigin} />
                  ) : (
                    <div className="h-[76px]" />
                  )}
                  <button
                    type="button"
                    onClick={() => setPicking((p) => !p)}
                    className={`mt-1.5 block max-w-full truncate text-xs font-semibold ${picking ? "text-yellow-300" : "text-white/60 hover:text-white"}`}
                  >
                    {picking ? "📌 Click the map… (cancel)" : "📌 Drop a pin on the map"}
                  </button>
                </Field>

                <Field
                  label="Within"
                  aside={<span className="w-16 text-right font-black tabular-nums">{radiusKm} km</span>}
                  className="w-full sm:w-44 xl:w-auto"
                >
                  <div className="flex h-11 items-center">
                    <input
                      type="range"
                      aria-label="Search radius"
                      className="slider-single"
                      min={MIN_RADIUS_KM}
                      max={MAX_RADIUS_KM}
                      step={5}
                      value={radiusKm}
                      onChange={(e) => setRadiusKm(Number(e.target.value))}
                    />
                  </div>
                </Field>

                <Field label="When" className="w-full sm:w-auto">
                  {/* The day/hour pickers are always shown (dimmed for "Now"), so the field never changes width. */}
                  <div className="flex gap-2">
                    <div className="w-36 shrink-0">
                      <Segmented
                        value={when}
                        onChange={setWhen}
                        options={[
                          { value: "now", label: "Now" },
                          { value: "later", label: "Later" },
                        ]}
                      />
                    </div>
                    <select
                      aria-label="Forecast day"
                      value={dayOffset}
                      onChange={(e) => {
                        setDayOffset(Number(e.target.value));
                        setWhen("later");
                      }}
                      className={`select w-28 min-w-0 transition-opacity ${when === "now" ? "opacity-40" : ""}`}
                    >
                      {/* Day names depend on today's date and the viewer's locale, so render them in the browser only. */}
                      {Array.from({ length: FORECAST_DAYS }, (_, i) => (
                        <option key={i} value={i}>
                          {urlLoaded ? dayLabel(i) : ""}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Forecast time"
                      value={hour}
                      onChange={(e) => {
                        setHour(Number(e.target.value));
                        setWhen("later");
                      }}
                      className={`select w-20 shrink-0 transition-opacity ${when === "now" ? "opacity-40" : ""}`}
                    >
                      {Array.from({ length: 24 }, (_, h) => (
                        <option key={h} value={h}>
                          {String(h).padStart(2, "0")}:00
                        </option>
                      ))}
                    </select>
                  </div>
                </Field>

                <Field label="Mode" className="w-full sm:w-36 xl:w-auto">
                  <div
                    title={
                      mode === "normal"
                        ? "Normal: searches real towns and cities near you."
                        : "Pro: scans the whole area, wilderness included, and paints a 72-hour weather heat map."
                    }
                  >
                    <Segmented
                      value={mode}
                      onChange={setMode}
                      options={[
                        { value: "normal", label: "Normal" },
                        { value: "pro", label: "Pro" },
                      ]}
                    />
                  </div>
                </Field>

                {findButton("hidden lg:block lg:min-w-52 lg:flex-1 xl:w-full")}
              </div>
            </section>
          )}

          <div className="glass relative h-[70vh] min-h-96 overflow-hidden lg:h-auto lg:min-h-[460px] lg:flex-1">
            <WeatherMap
              origin={origin}
              radiusKm={radiusKm}
              weather={searched?.result.weather ?? null}
              best={ranked[0] ?? view?.next?.match ?? null}
              others={ranked.slice(1)}
              grid={pro ? { cells: pro.grid, spacingKm: pro.gridSpacingKm, hour: proHour } : undefined}
              world={!chasing && world ? { cells: world.grid, spacingKm: world.spacingKm, hour: worldHour } : undefined}
              padLeftPx={floatingCard ? 392 : 0}
              onPick={chasing && (picking || !origin) ? pickOnMap : undefined}
            />

            {chasing && isDesktop && results}
            {chasing && isDesktop && error && (
              <p className="glass absolute top-3 left-1/2 z-[1100] -translate-x-1/2 px-4 py-2 text-sm font-semibold text-red-200">
                {error}
              </p>
            )}
            {chasing && pro && (
              <Timeline
                times={pro.times}
                hour={proHour}
                onChange={setProHour}
                matchHours={matchHours}
                color={WEATHER_TYPES[pro.weather].color}
                className={floatingCard ? "lg:left-[404px]" : ""}
              />
            )}

            {!chasing && world && (
              <Timeline times={world.times} hour={worldHour} onChange={setWorldHour} nowIndex={worldNow} />
            )}
            {!chasing && worldStatus !== "idle" && (
              <p className="glass absolute top-1/2 left-1/2 z-[1100] -translate-x-1/2 -translate-y-1/2 px-5 py-3 text-center font-bold">
                {worldStatus === "loading" ? "🌍 Fetching the whole planet's weather…" : "The world view is unavailable right now."}
              </p>
            )}
          </div>

          {chasing && !isDesktop && error && (
            <p ref={errorRef} className="glass p-4 text-sm font-medium text-red-200">
              {error}
            </p>
          )}
          {chasing && !isDesktop && results}
        </main>
      </div>

      {/* On phones the Find button floats at the bottom so it's always in reach. */}
      {chasing && findButton("fixed inset-x-4 bottom-4 z-[1500] lg:hidden")}
    </>
  );
}

/** True on screens at least 1024 px wide (Tailwind's `lg`). */
function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

/** Your own spot first, then by driving time; places without a road route go last. */
function rankByDrive(places: Place[], travel: Map<string, TravelInfo>): Place[] {
  const score = (p: Place) => (p.here ? -1 : (travel.get(p.id)?.durationMin ?? Infinity));
  return [...places].sort((a, b) => score(a) - score(b) || a.distanceKm - b.distanceKm);
}

function Field({
  label,
  aside,
  className = "",
  children,
}: {
  label: string;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="mb-1.5 flex h-6 items-center justify-between">
        <p className="text-[11px] font-bold tracking-widest text-white/60 uppercase">{label}</p>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition ${checked ? "bg-white" : "bg-white/20"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full shadow transition ${
          checked ? "translate-x-5 bg-slate-900" : "bg-white"
        }`}
      />
    </button>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex rounded-2xl bg-black/25 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-xl py-2 text-sm font-bold transition ${
            value === o.value ? "bg-white text-slate-900 shadow" : "text-white/70 hover:text-white"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function dayLabel(offset: number) {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}
