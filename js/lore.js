import { uid } from "./personas.js";

export const MAX_LORE_ENTRIES = 60;
export const MAX_LORE_ENTRY_CHARS = 1500;
export const DEFAULT_LORE_INJECT_CHARS = 3000;
const MAX_KEYS = 8;
const MAX_KEY_CHARS = 40;

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function defaultLore() {
  return [
    {
      id: "lore_rain",
      title: "The rain that night",
      keys: ["rain", "downpour", "umbrella", "that night"],
      content:
        "You met properly during a sudden downpour — one umbrella, two people walking slower than necessary. Neither has mentioned that the walk took twenty minutes for a five-minute distance. The umbrella is still at her place.",
    },
    {
      id: "lore_coffee",
      title: "The coffee order",
      keys: ["coffee", "order", "café", "cafe"],
      content:
        "She takes it black, one sugar, and pretends to be embarrassed about the sugar. Remembering it without being told matters more than either of you admits. The corner café is neutral territory — neither apartment, neither life.",
    },
    {
      id: "lore_text",
      title: "The unsent text",
      keys: ["text", "message", "typed", "unsent"],
      content:
        "Three weeks ago she typed 'I can't stop thinking about Friday' at 1 am, deleted it, and sent 'did you get home ok' instead. The user doesn't know about the first draft. The Friday in question was the last time you were alone together.",
    },
    {
      id: "lore_song",
      title: "Your song",
      keys: ["song", "music", "playlist", "playing"],
      content:
        "A song came on the car radio the night of the drive back from the coast — something old, neither of you skipped it, and neither has called it 'our song' out loud. It has come on twice since. Both times, someone changed the subject.",
    },
    {
      id: "lore_key",
      title: "The spare key",
      keys: ["key", "spare", "apartment", "place"],
      content:
        "She has a spare key to your place 'for emergencies' — given after the lockout incident, never used, never returned. It sits in her drawer with the batteries and takeout menus, and both of you are aware it's still there.",
    },
    {
      id: "lore_rooftop",
      title: "The rooftop",
      keys: ["rooftop", "roof", "skyline", "up there"],
      content:
        "The building's rooftop is technically off-limits, which is why it became your spot. Two folding chairs, a view of the water, conversations that run past midnight. Nothing has happened up there. Everything has almost happened up there.",
    },
  ];
}

export function createLoreEntry(fields = {}) {
  const keys = Array.isArray(fields.keys)
    ? fields.keys.map((k) => cleanText(k, MAX_KEY_CHARS).toLowerCase()).filter(Boolean).slice(0, MAX_KEYS)
    : cleanText(fields.keys, 200)
        .split(",")
        .map((k) => cleanText(k, MAX_KEY_CHARS).toLowerCase())
        .filter(Boolean)
        .slice(0, MAX_KEYS);
  return {
    id: uid("lore"),
    title: cleanText(fields.title, 60) || "Untitled",
    keys,
    content: cleanText(fields.content, MAX_LORE_ENTRY_CHARS),
  };
}

export function sanitizeLore(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    if (!cleanText(raw.title, 60) || !cleanText(raw.content, MAX_LORE_ENTRY_CHARS)) continue;
    const entry = createLoreEntry(raw);
    if (!entry.keys.length || seen.has(entry.id)) continue;
    entry.id = cleanText(raw.id, 60) || entry.id;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
    if (out.length >= MAX_LORE_ENTRIES) break;
  }
  return out;
}

export function matchLore(entries, text, { maxChars = DEFAULT_LORE_INJECT_CHARS } = {}) {
  if (!Array.isArray(entries) || !entries.length || typeof text !== "string" || !text.trim()) return [];
  const hay = text.toLowerCase();
  const hits = [];
  let used = 0;
  for (const entry of entries) {
    if (!entry.keys.some((k) => k && hay.includes(k))) continue;
    const cost = entry.title.length + entry.content.length + 4;
    if (used + cost > maxChars) continue;
    hits.push(entry);
    used += cost;
  }
  return hits;
}