// Converts a GeoNames cities file (e.g. cities5000.txt from
// https://download.geonames.org/export/dump/) into src/data/cities.json.
// Usage: node scripts/build-cities.mjs path/to/cities5000.txt
import { readFileSync, writeFileSync } from "node:fs";

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/build-cities.mjs <cities5000.txt>");
  process.exit(1);
}

// Each row: [name, lat, lon, countryCode, population]
const rows = readFileSync(input, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const f = line.split("\t");
    return [f[1], +(+f[4]).toFixed(4), +(+f[5]).toFixed(4), f[8], +f[14]];
  });

writeFileSync(new URL("../src/data/cities.json", import.meta.url), JSON.stringify(rows));
console.log(`Wrote ${rows.length} cities`);
