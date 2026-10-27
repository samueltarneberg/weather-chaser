"use client";

import { useEffect, useRef, useState } from "react";
import type { LatLon } from "@/lib/geo";
import { searchPlaces, type PlaceSuggestion } from "@/lib/placeSearch";

export interface NamedLocation extends LatLon {
  label: string;
}

interface Props {
  value: NamedLocation | null;
  onChange: (location: NamedLocation) => void;
  /** Ask for the browser's location on mount (skipped when a shared link already has one). */
  autoLocate?: boolean;
}

/** Uses the browser's location, with type-ahead place search. */
export default function LocationPicker({ value, onChange, autoLocate = true }: Props) {
  const [status, setStatus] = useState<"idle" | "locating" | "denied">("idle");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  const bias = useRef<LatLon | null>(null);
  bias.current = value;

  function locate() {
    if (!navigator.geolocation) return setStatus("denied");
    setStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setStatus("idle");
        onChange({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: "Your current location" });
      },
      () => setStatus("denied"),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }

  // Try to locate the user straight away.
  useEffect(() => {
    if (autoLocate) locate();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Search as the user types, debounced, cancelling stale requests.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return setSuggestions([]);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setSuggestions(await searchPlaces(q, bias.current, controller.signal));
        setHighlight(0);
        setOpen(true);
      } catch {
        // aborted or offline; keep the previous list
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  function choose(s: PlaceSuggestion) {
    onChange({ lat: s.lat, lon: s.lon, label: s.label });
    setQuery("");
    setSuggestions([]);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") setHighlight((h) => (h + 1) % suggestions.length);
    else if (e.key === "ArrowUp") setHighlight((h) => (h - 1 + suggestions.length) % suggestions.length);
    else if (e.key === "Enter") choose(suggestions[highlight]);
    else if (e.key === "Escape") setOpen(false);
    else return;
    e.preventDefault();
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-sm font-medium">
          📍{" "}
          {status === "locating"
            ? "Finding you…"
            : value
              ? value.label
              : status === "denied"
                ? "Location unavailable"
                : "No location yet"}
        </p>
        <button
          type="button"
          onClick={locate}
          className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold hover:bg-white/20"
        >
          Locate me
        </button>
      </div>

      <div className="relative">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search a place, or click the map"
          role="combobox"
          aria-controls="location-suggestions"
          aria-expanded={open}
          aria-autocomplete="list"
          className="w-full rounded-xl border border-white/10 bg-black/25 px-3.5 py-2.5 text-sm placeholder-white/40 outline-none focus:border-white/40"
        />
        {open && suggestions.length > 0 && (
          <ul
            id="location-suggestions"
            role="listbox"
            className="absolute z-[2000] mt-1.5 w-full overflow-hidden rounded-xl border border-white/10 bg-slate-900/95 text-sm shadow-2xl backdrop-blur"
          >
            {suggestions.map((s, i) => (
              <li key={s.key} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => choose(s)}
                  className={`w-full px-3.5 py-2 text-left ${i === highlight ? "bg-white/15" : ""}`}
                >
                  <span className="font-semibold">{s.name}</span>
                  <span className="text-white/50"> {s.detail}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
