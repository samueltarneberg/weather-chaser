"use client";

interface Props {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  disabled?: boolean;
}

/** Two-handle slider built from two overlapping native range inputs (styled in globals.css). */
export default function RangeSlider({ min, max, step = 1, value: [lo, hi], onChange, disabled }: Props) {
  const pct = (v: number) => ((v - min) / (max - min)) * 100;

  return (
    <div className={`relative h-6 ${disabled ? "opacity-40" : ""}`}>
      <div className="absolute top-1/2 h-1.5 w-full -translate-y-1/2 rounded-full bg-white/15" />
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white"
        style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }}
      />
      <input
        type="range"
        aria-label="Minimum"
        className="slider-dual"
        min={min}
        max={max}
        step={step}
        value={lo}
        disabled={disabled}
        onChange={(e) => onChange([Math.min(Number(e.target.value), hi - step), hi])}
      />
      <input
        type="range"
        aria-label="Maximum"
        className="slider-dual"
        min={min}
        max={max}
        step={step}
        value={hi}
        disabled={disabled}
        onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo + step)])}
      />
    </div>
  );
}
