# Weather Chaser 🌦️

Pick a type of weather (sun, cloudy, rain, snow, thunderstorm, fog), optionally a temperature range,
a radius and a time (now or up to 7 days ahead), and Weather Chaser finds the closest place that has it.
Set your location with the browser, by searching for a place, or by dropping a pin on the map.

- **Normal mode** checks real towns and cities (population ≥ 5,000), nearest first, and stops at the first match.
- **Pro mode** scans an even grid of ~200 points across the whole circle, including remote areas,
  and paints a blended heat map coloured by weather (shaded by intensity) or by temperature,
  with a 72-hour timeline you can scrub or play.

**World view** (the 🌍 switch in the header) shows the weather across the whole planet as a heat map,
coloured by weather or temperature, with a 72-hour timeline and a live "% of the world" summary.

Every search covers the next 72 hours, so when nothing matches right now it tells you when and where
it will ("No sun right now. It breaks through over Hedemora tomorrow at 09:00"). "Sun" means daytime
sunshine; clear nights don't count. Matches are ranked by driving time, and places without a road
route (islands without a ferry, open sea) are flagged. The search is kept in the URL, so it can be shared.

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
```

## How it works

| Part | File |
| --- | --- |
| Search API (`GET /api/search?lat&lon&radius&weather&mode&time&minTemp&maxTemp`) | `src/app/api/search/route.ts` |
| Drive times (`POST /api/travel`, OSRM) | `src/app/api/travel/route.ts` |
| World overview (`GET /api/world`, shared 6-hour snapshot, gzipped) | `src/app/api/world/route.ts` |
| Nearest-town names (`GET /api/near?lat&lon`) | `src/app/api/near/route.ts`, `src/lib/cities.ts` |
| Matching rules, shared by server and browser | `src/lib/match.ts` |
| Rate limits / quota protection | `src/lib/quota.ts` |
| Shareable URL state | `src/lib/urlState.ts` |
| Weather categories ↔ WMO weather codes | `src/lib/weather.ts` |
| Open-Meteo client (72 h per point, batched, shared 15-min cache) | `src/lib/openMeteo.ts` |
| Distance, direction, grid generation | `src/lib/geo.ts` |
| Town list (GeoNames `cities5000`) | `src/data/cities.json`, built by `scripts/build-cities.mjs` |
| Place search (Open-Meteo + Photon, merged) | `src/lib/placeSearch.ts` |
| Snarky result lines | `src/lib/quips.ts` |
| UI and map | `src/app/page.tsx`, `src/components/` |

To refresh the town list, download `cities5000.zip` from https://download.geonames.org/export/dump/,
unzip it and run `node scripts/build-cities.mjs path/to/cities5000.txt`.

## Data & limits

Quota protection (in `src/lib/quota.ts`): each visitor gets 2,500 weather lookups per hour, and the whole
site is capped at 550 per minute, 4,500 per hour and 9,000 per day, safely under Open-Meteo's free tier
(600/minute, 5,000/hour, 10,000/day). The world view is one shared snapshot of ~340 points refreshed
every 6 hours (~1,400 lookups/day). Cached points are free, and Pro grids sit on
a fixed global lattice so nearby searches share them. Override with the `VISITOR_LOOKUPS_PER_HOUR` and
`SITE_LOOKUPS_PER_DAY` environment variables. The counters and cache live in server memory: fine on a
single server, but on multi-instance hosting (e.g. Vercel) each instance counts separately, so move
them to a shared store such as Upstash Redis before expecting real traffic.

- Weather: [Open-Meteo](https://open-meteo.com), which is free for **non-commercial** use (about 10,000 location lookups/day).
  A Pro search uses about 200 lookups and a Normal search 100–500. Commercial use needs an Open-Meteo API plan.
- Places: [GeoNames](https://www.geonames.org) (CC BY 4.0). Place search: Open-Meteo geocoding and
  [Photon](https://photon.komoot.io) (OpenStreetMap), both free for reasonable use. Photon's public server
  rate-limits bursts; the search box falls back to Open-Meteo's results when it does.
- Drive times: the public [OSRM](https://project-osrm.org) demo server (includes ferries). Fine for a hobby
  site; self-host OSRM or use a commercial router for heavy traffic.
- Map: Esri World Dark Gray Canvas tiles. Free with attribution for low traffic; a busy public site should use an
  [ArcGIS developer account](https://developers.arcgis.com) or another tile provider.
