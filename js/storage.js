import { sanitizePersonas, uid } from "./personas.js";
import { sanitizeLore } from "./lore.js";
import { clampCloseness, clampContextChars, MAX_MEMORY_CHARS, PACING_OPTIONS, TONE_OPTIONS } from "./engine.js";

export const STORAGE_KEYS = {
  token: "ah_hf_token",
  settings: "ah_settings",
  chats: "ah_chats_v1",
  personas: "ah_personas_v1",
  lore: "ah_lore_v1",
  theme: "ah_theme",
  feedback: "ah_feedback_",
};

export const MAX_CHATS = 50;
export const MAX_MESSAGES_PER_CHAT = 300;
export const MAX_TITLE_CHARS = 80;
const VALID_ROLES = new Set(["user", "bot", "system"]);

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

export function createChat({ personaId, title = "New story" } = {}) {
  return {
    id: uid("chat"),
    personaId: cleanText(personaId, 60),
    title: cleanText(title, MAX_TITLE_CHARS) || "New story",
    messages: [],
    closeness: 8,
    memory: "",
    pacing: "slow",
    tone: "tender",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function sanitizeChat(raw) {
  if (!raw || typeof raw !== "object") return null;
  const personaId = cleanText(raw.personaId, 60);
  const id = cleanText(raw.id, 60);
  if (!personaId || !id) return null;
  const messages = [];
  if (Array.isArray(raw.messages)) {
    for (const m of raw.messages) {
      if (!m || typeof m !== "object" || !VALID_ROLES.has(m.role)) continue;
      if (typeof m.text !== "string" || !m.text.trim()) continue;
      messages.push({ role: m.role, text: m.text, ts: Number(m.ts) || 0 });
    }
  }
  return {
    id,
    personaId,
    title: cleanText(raw.title, MAX_TITLE_CHARS) || "New story",
    messages: messages.slice(-MAX_MESSAGES_PER_CHAT),
    closeness: clampCloseness(raw.closeness),
    memory: cleanText(raw.memory, MAX_MEMORY_CHARS),
    pacing: PACING_OPTIONS.includes(raw.pacing) ? raw.pacing : "slow",
    tone: TONE_OPTIONS.includes(raw.tone) ? raw.tone : "tender",
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Date.now(),
  };
}

export function sanitizeChats(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const chat = sanitizeChat(raw);
    if (!chat || seen.has(chat.id)) continue;
    seen.add(chat.id);
    out.push(chat);
    if (out.length >= MAX_CHATS) break;
  }
  return out;
}

export function sanitizeSettings(raw) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    space: cleanText(s.space, 120),
    endpoint: cleanText(s.endpoint, 60) || "/chat_response",
    userName: cleanText(s.userName, 40),
    contextChars: clampContextChars(s.contextChars),
  };
}

export function readJSON(storage, key, fallback) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJSON(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

export function exportBundle({ chats, personas, lore, settings }) {
  return {
    app: "deeprp-afterhours",
    version: 1,
    exportedAt: new Date().toISOString(),
    chats: sanitizeChats(chats),
    personas: sanitizePersonas(personas),
    lore: sanitizeLore(lore),
    settings: sanitizeSettings(settings),
  };
}

export function importBundle(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("That file is not valid JSON.");
  }
  if (!data || data.app !== "deeprp-afterhours") throw new Error("That file is not an After Hours backup.");
  if (data.version !== 1) throw new Error("Unsupported backup version.");
  return {
    chats: sanitizeChats(data.chats),
    personas: sanitizePersonas(data.personas),
    lore: sanitizeLore(data.lore),
    settings: sanitizeSettings(data.settings),
  };
}