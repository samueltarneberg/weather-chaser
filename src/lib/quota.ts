import "server-only";
import type { NextRequest } from "next/server";

// Best-effort, in-memory limits. They protect the free Open-Meteo quota (~10,000 location
// lookups/day) on a single server. When hosting on several instances (e.g. Vercel serverless),
// move these counters to a shared store such as Upstash Redis.

const env = (name: string, fallback: number) => Number(process.env[name]) || fallback;

export const LIMITS = {
  /** Weather lookups per visitor per hour (a Pro search is ~200, a Normal search 100–500). */
  visitorWeather: { max: env("VISITOR_LOOKUPS_PER_HOUR", 2500), windowMs: 3_600_000 },
  /** Weather lookups for the whole site, kept under Open-Meteo's free tier (600/min, 5,000/h, 10,000/day). */
  siteWeatherMinute: { max: 550, windowMs: 60_000 },
  siteWeatherHour: { max: 4500, windowMs: 3_600_000 },
  globalWeather: { max: env("SITE_LOOKUPS_PER_DAY", 9000), windowMs: 86_400_000 },
  /** Drive-time requests per visitor per hour. */
  visitorTravel: { max: 300, windowMs: 3_600_000 },
};

export class QuotaError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryAfterS: number,
  ) {
    super(message);
  }
}

const buckets = new Map<string, { used: number; resetAt: number }>();

/** Spends `amount` from a bucket, or throws a QuotaError if that would exceed the limit. */
export function spend(
  bucket: string,
  limit: { max: number; windowMs: number },
  amount: number,
  message: string,
  dryRun = false,
) {
  const now = Date.now();
  let b = buckets.get(bucket);
  if (!b || b.resetAt <= now) {
    b = { used: 0, resetAt: now + limit.windowMs };
    buckets.set(bucket, b);
  }
  if (b.used + amount > limit.max) {
    throw new QuotaError(message, 429, Math.ceil((b.resetAt - now) / 1000));
  }
  if (!dryRun) b.used += amount;
  if (buckets.size > 10_000) {
    for (const [key, value] of buckets) if (value.resetAt <= now) buckets.delete(key);
  }
}

const SITE_BUCKETS = [
  { bucket: "w:site:min", limit: LIMITS.siteWeatherMinute, message: "Lots of weather chasers right now. Try again in a minute." },
  { bucket: "w:site:hour", limit: LIMITS.siteWeatherHour, message: "Weather Chaser is very busy. Try again a bit later." },
  { bucket: "w:global", limit: LIMITS.globalWeather, message: "Weather Chaser has used up its weather lookups for today. Please come back tomorrow." },
];

/** Spends from the site-wide weather budgets (per minute, hour and day), checking all of them first. */
export function spendSiteWeather(lookups: number) {
  for (const b of SITE_BUCKETS) spend(b.bucket, b.limit, lookups, b.message, true);
  for (const b of SITE_BUCKETS) spend(b.bucket, b.limit, lookups, b.message);
}

/** Checks the per-visitor and site-wide weather budgets, then spends from all of them. */
export function spendWeather(visitor: string, lookups: number) {
  if (lookups === 0) return;
  const slowDown = "Whoa, slow down, storm chaser. You've used up your searches for now. Try again in a bit.";
  // Check everything first so a refusal from one doesn't leave the others charged.
  spend(`w:${visitor}`, LIMITS.visitorWeather, lookups, slowDown, true);
  spendSiteWeather(lookups);
  spend(`w:${visitor}`, LIMITS.visitorWeather, lookups, slowDown);
}

export function visitorId(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "local";
}

export function quotaResponseInit(err: QuotaError): ResponseInit {
  return { status: err.status, headers: { "Retry-After": String(err.retryAfterS) } };
}
