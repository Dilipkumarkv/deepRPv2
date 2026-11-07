export const MAX_TRANSCRIPT_CHARS = 12000;
export const CONTEXT_MIN_CHARS = 2000;
export const CONTEXT_MAX_CHARS = 32000;
export const MAX_MEMORY_CHARS = 4000;
export const MAX_SYSTEM_PROMPT_CHARS = 16000;

export const CLOSENESS_STAGES = [
  "Strangers",
  "Acquainted",
  "Curious",
  "Guarded",
  "Warming",
  "Opening up",
  "Vulnerable",
  "Intimate",
];

export const PACING_OPTIONS = ["glacial", "slow", "steady"];
export const TONE_OPTIONS = ["tender", "charged", "raw"];

export function clampContextChars(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return MAX_TRANSCRIPT_CHARS;
  return Math.max(CONTEXT_MIN_CHARS, Math.min(CONTEXT_MAX_CHARS, Math.round(n / 1000) * 1000));
}

export function clampCloseness(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 8;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function closenessStage(value) {
  const v = clampCloseness(value);
  if (v < 12) return CLOSENESS_STAGES[0];
  if (v < 25) return CLOSENESS_STAGES[1];
  if (v < 38) return CLOSENESS_STAGES[2];
  if (v < 50) return CLOSENESS_STAGES[3];
  if (v < 63) return CLOSENESS_STAGES[4];
  if (v < 76) return CLOSENESS_STAGES[5];
  if (v < 90) return CLOSENESS_STAGES[6];
  return CLOSENESS_STAGES[7];
}

const PACING_GUIDANCE = {
  glacial: "Pacing: glacial. Let almost nothing happen outwardly while everything shifts underneath. A single scene can span many exchanges; resist every urge to advance the relationship.",
  slow: "Pacing: slow burn. Progress happens in small, earned increments — a shared silence, a confession walked back, a touch that lingers. Never skip the steps between.",
  steady: "Pacing: steady. The relationship may move forward when the moment genuinely earns it, but never faster than the emotional logic allows.",
};

const TONE_GUIDANCE = {
  tender: "Tone: tender. Warmth, care, and quiet attention carry the charge. Softness is the point.",
  charged: "Tone: charged. Every ordinary exchange has a current under it — loaded pauses, double meanings, eyes meeting a second too long.",
  raw: "Tone: raw. Honest to the point of discomfort. People say the thing they shouldn't, then sit in the silence after.",
};

function clip(text, max) {
  return typeof text === "string" ? text.slice(0, max) : "";
}

export function buildSystemPrompt({
  persona,
  userName,
  loreEntries = [],
  memory = "",
  closeness = null,
  pacing = "slow",
  tone = "tender",
} = {}) {
  if (!persona) throw new Error("A persona is required.");
  const parts = [persona.systemPrompt];
  parts.push(
    `\nRoleplay rules: Stay in character as ${persona.name}. Never speak or act for the user. Write in third-person-limited narration plus dialogue where natural.`
  );
  parts.push(`\n${PACING_GUIDANCE[pacing] || PACING_GUIDANCE.slow}`);
  parts.push(`\n${TONE_GUIDANCE[tone] || TONE_GUIDANCE.tender}`);
  if (userName && userName.trim()) {
    parts.push(`\nThe user's character is named ${userName.trim()}. Address them by that name when appropriate.`);
  }
  if (Array.isArray(loreEntries) && loreEntries.length) {
    const lore = loreEntries.map((e) => `- ${e.title}: ${e.content}`).join("\n");
    parts.push(`\nShared history (established details — weave in naturally, never quote verbatim):\n${clip(lore, 3500)}`);
  }
  if (memory && memory.trim()) {
    parts.push(`\nStory memory (established facts — stay consistent):\n${clip(memory.trim(), MAX_MEMORY_CHARS)}`);
  }
  if (closeness !== null && Number.isFinite(Number(closeness))) {
    const v = clampCloseness(closeness);
    parts.push(
      `\nCloseness: ${persona.name} and the user are at "${closenessStage(v)}" (${v}/100). Let trust, openness and physical ease match this stage exactly — no jumping ahead, and let old defenses resurface under stress.`
    );
  }
  return clip(parts.join("\n"), MAX_SYSTEM_PROMPT_CHARS);
}

function labelFor(role, personaName) {
  if (role === "user") return "You";
  if (role === "bot") return personaName || "Character";
  return null;
}

export function buildTranscript(messages, personaName = "Character", { maxChars = MAX_TRANSCRIPT_CHARS } = {}) {
  if (!Array.isArray(messages)) return "";
  const lines = [];
  for (const msg of messages) {
    if (!msg || typeof msg.text !== "string" || !msg.text.trim()) continue;
    const label = labelFor(msg.role, personaName);
    lines.push(label ? `${label}: ${msg.text.trim()}` : msg.text.trim());
  }
  let out = lines.join("\n\n");
  if (out.length <= maxChars) return out;
  const kept = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = lines[i].length + 2;
    if (used + cost > maxChars) break;
    kept.unshift(lines[i]);
    used += cost;
  }
  out = kept.join("\n\n");
  return out.length > maxChars ? out.slice(out.length - maxChars) : out;
}

export function buildUserTurn(transcript, newText) {
  const t = (transcript || "").trim();
  const n = (newText || "").trim();
  if (!t) return `You: ${n}\n\nRespond in character.`;
  return `${t}\n\nYou: ${n}\n\nRespond in character.`;
}

export function contextUsage(parts, maxChars = MAX_TRANSCRIPT_CHARS) {
  const arr = Array.isArray(parts) ? parts : [parts];
  const used = arr.reduce((sum, p) => sum + (typeof p === "string" ? p.length : 0), 0);
  const total = clampContextChars(maxChars);
  return {
    used,
    total,
    percent: Math.max(0, Math.min(100, Math.round((used / total) * 100))),
  };
}