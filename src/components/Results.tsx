"use client";

import { forwardRef, useState } from "react";
import { foundQuip, noneQuip, upcomingQuip } from "@/lib/quips";
import { durationLabel, whenLabel } from "@/lib/time";
import type { Place, SearchMode, TravelInfo, Upcoming } from "@/lib/types";
import { WEATHER_TYPES, type WeatherType } from "@/lib/weather";
import type { NamedLocation } from "./LocationPicker";

export type SortBy = "drive" | "distance";

interface Props {
  mode: SearchMode;
  weather: WeatherType;
  tempRange?: { min: number; max: number };
  origin: NamedLocation;
  radiusKm: number;
  /** Matches at the hour being shown, already ranked. */
  matches: Place[];
  next?: Upcoming;
  nightHere: boolean;
  checked: number;
  note?: string;
  travel: Map<string, TravelInfo>;
  /** True while drive times are still loading for the listed matches. */
  travelLoading: boolean;
  sortBy: SortBy;
  onSortBy: (s: SortBy) => void;
  /** Pro mode: jump the timeline to the upcoming match. */
  onJumpToNext?: () => void;
  /** Extra classes, e.g. to float the card over the map. */
  className?: string;
  /** When given, the card can be collapsed to a one-line pill. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const Results = forwardRef<HTMLElement, Props>(function Results(props, ref) {
  const { weather, matches, next, origin, travel } = props;
  const type = WEATHER_TYPES[weather];
  const best = matches[0];
  const nameOf = placeName;
  const units = props.mode === "pro" ? "grid points" : "places";

  if (props.collapsed && props.onToggleCollapsed) {
    const shown = best ?? next?.match;
    return (
      <button
        type="button"
        onClick={props.onToggleCollapsed}
        className={`glass !rounded-full px-4 py-2 text-sm font-black ${props.className ?? ""}`}
      >
        {shown
          ? `${type.emoji} ${shown.temperature}° · ${shown.here ? "Right here" : nameOf(shown)}${best ? "" : ` · in ${next!.hoursAhead} h`}`
          : `${type.emoji} No match`}{" "}
        <span className="ml-1 text-white/60">＋</span>
      </button>
    );
  }

  const shell = (padding: string, children: React.ReactNode) => (
    <section ref={ref} className={`glass ${padding} ${props.className || "relative"}`}>
      {props.onToggleCollapsed && (
        <button
          type="button"
          onClick={props.onToggleCollapsed}
          aria-label="Minimise results"
          className="absolute top-3 right-3 grid h-7 w-7 place-items-center rounded-full bg-white/10 text-white/70 hover:bg-white/20"
        >
          –
        </button>
      )}
      {children}
    </section>
  );

  if (!best && !next) {
    return shell(
      "p-5",
      <>
        <p className="pr-8 text-xl font-black">{noneQuip(weather, props.checked)}</p>
        <p className="mt-2 text-sm text-white/70">
          {props.note ??
            `No ${type.label.toLowerCase()}${props.tempRange ? ` between ${props.tempRange.min}° and ${props.tempRange.max}°` : ""} within ${props.radiusKm} km in the next 3 days (checked ${props.checked} ${units}). Try a bigger radius${props.tempRange ? " or a wider temperature range" : ""}.`}
        </p>
        <ShareButton text="No luck chasing weather this time." />
      </>,
    );
  }

  // Nothing now, but something later.
  if (!best && next) {
    return shell(
      "space-y-4 p-5",
      <>
        <div className="flex items-center gap-4">
          <span className="text-6xl drop-shadow-lg">{props.nightHere && weather === "sun" ? "🌙" : "⏳"}</span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold tracking-widest text-white/60 uppercase">Coming up</p>
            <p className="text-3xl leading-tight font-black">in {next.hoursAhead} h</p>
          </div>
        </div>
        <p className="rounded-2xl bg-black/25 px-4 py-3 text-sm font-semibold italic">
          “{upcomingQuip(weather, nameOf(next.match), whenLabel(next.time), props.nightHere)}”
        </p>
        <PlaceSummary place={next.match} name={nameOf(next.match)} travel={travel.get(next.match.id)} />
        <div className="flex gap-2">
          {props.onJumpToNext && (
            <button type="button" onClick={props.onJumpToNext} className="btn-secondary flex-1">
              Show on timeline
            </button>
          )}
          <DirectionsLink origin={origin} place={next.match} />
        </div>
        <ShareButton text={`${type.emoji} ${nameOf(next.match)} ${whenLabel(next.time)}`} />
      </>,
    );
  }

  const quickest = props.sortBy === "drive" && !props.travelLoading;
  return shell(
    "space-y-4 p-5",
    <>
      <div className="flex items-center gap-4">
        <span className="text-6xl drop-shadow-lg">{type.emoji}</span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold tracking-widest text-white/60 uppercase">
            {quickest && !best.here ? "Quickest to reach" : "Closest match"}
          </p>
          <p className="text-6xl leading-none font-black tabular-nums">{best.temperature}°</p>
        </div>
      </div>

      <div>
        <p className="truncate text-2xl font-black">{best.here ? "Right here" : nameOf(best)}</p>
        <PlaceSummary place={best} travel={travel.get(best.id)} />
      </div>

      <p className="rounded-2xl bg-black/25 px-4 py-3 text-sm font-semibold italic">
        “{foundQuip(weather, nameOf(best), best.here ? 0 : best.distanceKm)}”
      </p>

      {!best.here && <DirectionsLink origin={origin} place={best} primary />}

      {matches.length > 1 && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-[11px] font-bold tracking-widest text-white/60 uppercase">Also nearby</p>
            <div className="flex rounded-full bg-black/25 p-0.5 text-[11px] font-bold">
              {(["drive", "distance"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => props.onSortBy(s)}
                  className={`rounded-full px-2.5 py-0.5 ${props.sortBy === s ? "bg-white text-slate-900" : "text-white/60"}`}
                >
                  {s === "drive" ? "Drive time" : "Distance"}
                </button>
              ))}
            </div>
          </div>
          <ul className="divide-y divide-white/10 text-sm">
            {matches.slice(1).map((m) => (
              <li key={m.id} className="flex justify-between gap-2 py-2">
                <span className="truncate font-semibold">{m.here ? "Right here" : nameOf(m)}</span>
                <span className="shrink-0 text-white/60 tabular-nums">
                  {travelText(travel, m) ?? `${m.distanceKm} km ${m.direction}`} ·{" "}
                  <span className="font-bold text-white">{m.temperature}°</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ShareButton text={`${type.emoji} ${best.here ? "Right here" : nameOf(best)}: ${best.description}, ${best.temperature}°`} />
      <p className="text-xs text-white/40">
        Checked {props.checked} {units}. Weather by Open-Meteo, drive times by OSRM.
      </p>
    </>,
  );
});

export default Results;

function PlaceSummary({ place, name, travel }: { place: Place; name?: string; travel: TravelInfo | undefined }) {
  return (
    <div className="text-sm font-medium text-white/70">
      {name && <p className="truncate text-lg font-black text-white">{name}</p>}
      <p>
        {!place.here && `${place.distanceKm} km ${place.direction} · `}
        {place.description} · {place.temperature}°{!place.isDay && " · night"}
      </p>
      {!place.here && (
        <p className="mt-0.5 font-semibold text-white">
          {travel === undefined
            ? "🚗 Checking drive time…"
            : travel === null
              ? "🚫 No road route (water or wilderness)"
              : `🚗 ${durationLabel(travel.durationMin)} drive · ${travel.distanceKm} km by road`}
        </p>
      )}
    </div>
  );
}

function travelText(travel: Map<string, TravelInfo>, p: Place): string | undefined {
  if (p.here || !travel.has(p.id)) return undefined;
  const t = travel.get(p.id);
  return t ? `🚗 ${durationLabel(t.durationMin)}` : "🚫 no road";
}

function DirectionsLink({ origin, place, primary }: { origin: NamedLocation; place: Place; primary?: boolean }) {
  return (
    <a
      href={`https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lon}&destination=${place.lat},${place.lon}`}
      target="_blank"
      rel="noopener noreferrer"
      className={primary ? "btn-primary block text-center" : "btn-secondary flex-1 text-center"}
    >
      Take me there →
    </a>
  );
}

function ShareButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    if (navigator.share) {
      await navigator.share({ title: "Weather Chaser", text, url }).catch(() => {});
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button type="button" onClick={share} className="w-full text-center text-xs font-bold text-white/60 hover:text-white">
      {copied ? "✓ Link copied" : "🔗 Share this search"}
    </button>
  );
}

function placeName(p: Place) {
  return p.country ? `${p.name}, ${p.country}` : p.name;
}
