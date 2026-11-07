import { Client } from "https://cdn.jsdelivr.net/npm/@gradio/client/dist/index.min.js";

const REQUEST_TIMEOUT_MS = 120000;
const MAX_ATTEMPTS = 3;

let client = null;
let connectedKey = null;

export function resetClient() {
  client = null;
  connectedKey = null;
}

export async function ensureClient(space, token) {
  if (!token) return null;
  const key = `${space}::${token.length}`;
  if (client && connectedKey === key) return client;
  try {
    client = await Client.connect(space, { token, hf_token: token });
    connectedKey = key;
    return client;
  } catch (err) {
    resetClient();
    throw err;
  }
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function describeError(err, space) {
  const raw = String(err?.message || err || "Unknown error");
  const msg = raw.toLowerCase();
  if (/401|403|unauthorized|invalid credentials|permission|not allowed|could not resolve/.test(msg)) {
    return "Authentication failed — the Space rejected the token. Check that your HF token has Read access to this Space in Settings.";
  }
  if (/404|not found|does not exist/.test(msg)) {
    return `Could not find the Space “${space}”. Check the Space ID in Settings.`;
  }
  if (/timed out|timeout/i.test(msg)) {
    return "The request timed out. The Space may be waking up or busy — tap Send to retry.";
  }
  if (/gpu|quota|rate|queue/i.test(msg)) {
    return `Space error: ${raw}`;
  }
  if (/fetch|network|socket|websocket|connection|offline|abort|econn/i.test(msg)) {
    return "Network error — check your connection and try again.";
  }
  return `Error: ${raw}`;
}

export async function predictReply({ space, token, endpoint, message, systemPrompt }) {
  const c = await ensureClient(space, token);
  if (!c) throw new Error("No Hugging Face token set.");
  let lastErr;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const result = await withTimeout(
        c.predict(endpoint || "/chat_response", [message, systemPrompt]),
        REQUEST_TIMEOUT_MS,
        "Request timed out"
      );
      const reply = Array.isArray(result?.data) ? result.data[0] : null;
      if (typeof reply !== "string" || !reply.trim()) {
        throw new Error("The model returned an empty reply — try again.");
      }
      return reply.trim();
    } catch (err) {
      lastErr = err;
      if (/401|403|unauthorized|invalid credentials|permission/i.test(String(err?.message || err))) throw err;
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        if (/network|fetch|connection|abort/i.test(String(err?.message || err))) resetClient();
      }
    }
  }
  throw lastErr;
}