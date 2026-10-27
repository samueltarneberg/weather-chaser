import type { WeatherType } from "./weather";

// Snarky one-liners shown with results. {place} and {km} are filled in.
const FOUND: Record<WeatherType, string[]> = {
  sun: [
    "Sunglasses on. {place} is serving actual sunshine.",
    "Found the sun. It was hiding in {place}, obviously.",
    "{km} km to vitamin D. Start driving.",
  ],
  cloudy: [
    "{place} is perfectly, boringly grey. Exactly as ordered.",
    "Clouds located over {place}. Thrilling stuff.",
    "If you insist on gloom, {place} has plenty.",
  ],
  rain: [
    "Good news, if you enjoy being damp: {place}.",
    "{place} is getting soaked. Bring the good umbrella.",
    "Rain spotted {km} km away. Your puddle awaits.",
  ],
  snow: [
    "Snow in {place}. Go make questionable snow angels.",
    "{place} is a snow globe right now. Shake responsibly.",
    "{km} km to snow. Your sledge has been notified.",
  ],
  thunderstorm: [
    "{place} is getting zapped. Please chase responsibly.",
    "Thunder over {place}. Nature is doing a drum solo.",
    "Lightning {km} km away. Don't stand next to anything tall.",
  ],
  fog: [
    "{place} is thoroughly foggy. You won't see a thing. Enjoy.",
    "Fog in {place}. Great for mysteries, terrible for driving.",
    "Spooky mist located {km} km away. Bring a lantern.",
  ],
};

const HERE: Record<WeatherType, string> = {
  sun: "Look out the window. The sun is literally on you.",
  cloudy: "It's already grey where you are. Wish granted, I guess.",
  rain: "Step outside. You're standing in it.",
  snow: "It's snowing where you are. No travel required.",
  thunderstorm: "The storm is right on top of you. Maybe stay indoors?",
  fog: "You're already in the fog. Can't you tell?",
};

const NONE: Record<WeatherType, string[]> = {
  sun: ["No sun anywhere near you. Have you considered moving?", "The sun has left the chat."],
  cloudy: ["Not a single cloud. Some people would call that a good thing."],
  rain: ["Bone dry for miles. Try a garden hose?", "No rain nearby. The farmers are not amused."],
  snow: ["Zero snow. Your snowman dreams are on hold."],
  thunderstorm: ["No storms. The sky is being suspiciously polite."],
  fog: ["Visibility is great everywhere. How dull."],
};

/** Picks a line deterministically so it doesn't change on every re-render. */
function pick(lines: string[], seed: number) {
  return lines[Math.abs(seed) % lines.length];
}

export function foundQuip(weather: WeatherType, place: string, km: number): string {
  if (km === 0) return HERE[weather];
  return pick(FOUND[weather], place.length + km).replace("{place}", place).replace("{km}", String(km));
}

export function noneQuip(weather: WeatherType, seed: number): string {
  return pick(NONE[weather], seed);
}

const UPCOMING: Record<WeatherType, string> = {
  sun: "No sun right now. It breaks through over {place} {when}.",
  cloudy: "Annoyingly clear. Clouds roll into {place} {when}.",
  rain: "Dry for now. The rain reaches {place} {when}.",
  snow: "No snow yet. {place} gets some {when}.",
  thunderstorm: "All quiet. Thunder rolls into {place} {when}.",
  fog: "Clear for now. Fog creeps into {place} {when}.",
};

/** Shown when nothing matches now but something does later. */
export function upcomingQuip(weather: WeatherType, place: string, when: string, nightHere: boolean): string {
  const line = nightHere && weather === "sun" ? "The sun has clocked off for the night. It's back over {place} {when}." : UPCOMING[weather];
  return line.replace("{place}", place).replace("{when}", when);
}
