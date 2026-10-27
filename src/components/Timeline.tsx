"use client";

import { useEffect, useState } from "react";
import { parseUtcHour, shortLabel } from "@/lib/time";

interface Props {
  times: string[];
  hour: number;
  onChange: (hour: number) => void;
  /** Which hours have at least one match, drawn as a strip above the slider. */
  matchHours?: boolean[];
  color?: string;
  /** Index of the current hour (a cached forecast may start a few hours ago). */
  nowIndex?: number;
  className?: string;
}

const STEP_MS = 450;

/** Pro-mode scrubber over the forecast window, with play/pause. */
export default function Timeline({ times, hour, onChange, matchHours, color, nowIndex = 0, className = "" }: Props) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => onChange(hour + 1 < times.length ? hour + 1 : 0), STEP_MS);
    return () => clearInterval(id);
  }, [playing, hour, times.length, onChange]);

  // The first hour of each local day gets a tick, so you can see where days start.
  const dayStarts = times.map((t, i) => i > 0 && parseUtcHour(t).getDate() !== parseUtcHour(times[i - 1]).getDate());

  return (
    <div
      className={`absolute right-3 bottom-8 left-3 z-[1000] rounded-2xl bg-black/65 px-3 py-2.5 backdrop-blur sm:right-6 sm:left-6 ${className}`}
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause" : "Play"}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-slate-900"
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="font-black tabular-nums">{shortLabel(times[hour])}</span>
            <span className="text-xs font-semibold text-white/60">
              {hour === nowIndex ? "now" : `${hour > nowIndex ? "+" : "−"}${Math.abs(hour - nowIndex)} h`}
            </span>
          </div>
          <div className="relative">
            <div className="flex h-1.5 gap-px overflow-hidden rounded-full" aria-hidden>
              {times.map((_, i) => (
                <span
                  key={i}
                  className="flex-1"
                  style={{
                    background: matchHours?.[i] ? color : "rgb(255 255 255 / 0.12)",
                    boxShadow: dayStarts[i] ? "inset 2px 0 0 rgb(255 255 255 / 0.7)" : undefined,
                  }}
                />
              ))}
            </div>
            <input
              type="range"
              aria-label="Forecast hour"
              className="slider-single mt-1.5 !bg-white/15"
              min={0}
              max={times.length - 1}
              value={hour}
              onChange={(e) => {
                setPlaying(false);
                onChange(Number(e.target.value));
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
