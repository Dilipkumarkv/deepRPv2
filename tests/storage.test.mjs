import test from "node:test";
import assert from "node:assert/strict";
import {
  STORAGE_KEYS,
  MAX_CHATS,
  MAX_MESSAGES_PER_CHAT,
  createChat,
  sanitizeChat,
  sanitizeChats,
  sanitizeSettings,
  exportBundle,
  importBundle,
} from "../js/storage.js";

test("storage keys are namespaced and include a token slot", () => {
  assert.ok(STORAGE_KEYS.token.startsWith("ah_"));
  assert.ok(STORAGE_KEYS.chats.startsWith("ah_"));
  assert.ok(STORAGE_KEYS.personas.startsWith("ah_"));
});

test("createChat seeds a slow-burn story at strangers", () => {
  const c = createChat({ personaId: "mara", title: "Test story" });
  assert.ok(c.id);
  assert.equal(c.personaId, "mara");
  assert.equal(c.title, "Test story");
  assert.deepEqual(c.messages, []);
  assert.equal(c.closeness, 8);
  assert.equal(c.memory, "");
  assert.equal(c.pacing, "slow");
  assert.equal(c.tone, "tender");
});

test("sanitizeChat filters bad roles and clamps fields", () => {
  const c = sanitizeChat({
    id: "x",
    personaId: "mara",
    title: "t".repeat(300),
    closeness: 999,
    pacing: "warp-speed",
    tone: "spicy",
    memory: "m".repeat(9000),
    messages: [
      { role: "user", text: "hi" },
      { role: "assistant", text: "dropped" },
      { role: "bot", text: "hello" },
      { role: "system", text: "note" },
      { role: "user", text: 42 },
    ],
  });
  assert.ok(c);
  assert.equal(c.closeness, 100);
  assert.equal(c.pacing, "slow");
  assert.equal(c.tone, "tender");
  assert.ok(c.title.length <= 80);
  assert.ok(c.memory.length <= 4000);
  assert.deepEqual(c.messages.map((m) => m.role), ["user", "bot", "system"]);
  assert.equal(sanitizeChat(null), null);
  assert.equal(sanitizeChat({ personaId: "x" }), null);
});

test("sanitizeChat keeps valid pacing and tone", () => {
  const c = sanitizeChat({ id: "x", personaId: "mara", pacing: "glacial", tone: "raw" });
  assert.equal(c.pacing, "glacial");
  assert.equal(c.tone, "raw");
});

test("sanitizeChats caps count and message count, keeps newest", () => {
  const chats = Array.from({ length: MAX_CHATS + 10 }, (_, i) =>
    createChat({ personaId: "p", title: `c${i}` })
  );
  chats[0].messages = Array.from({ length: MAX_MESSAGES_PER_CHAT + 50 }, (_, i) => ({
    role: "user",
    text: `m${i}`,
  }));
  const out = sanitizeChats(chats);
  assert.equal(out.length, MAX_CHATS);
  assert.equal(out[0].messages.length, MAX_MESSAGES_PER_CHAT);
  assert.equal(out[0].messages.at(-1).text, `m${MAX_MESSAGES_PER_CHAT + 49}`);
});

test("exportBundle never contains the token; importBundle restores data", () => {
  const chats = [createChat({ personaId: "mara", title: "Story" })];
  const bundle = exportBundle({ chats, personas: [], lore: [], settings: { space: "user/space", userName: "Ash" } });
  const json = JSON.stringify(bundle);
  assert.ok(!json.includes("hf_secret_value"));
  assert.ok(!json.includes(STORAGE_KEYS.token));
  assert.equal(bundle.app, "deeprp-afterhours");
  assert.equal(bundle.version, 1);

  const restored = importBundle(json);
  assert.equal(restored.chats.length, 1);
  assert.equal(restored.chats[0].title, "Story");
  assert.equal(restored.settings.space, "user/space");
  assert.ok(!("token" in restored.settings));
});

test("importBundle rejects foreign or malformed payloads", () => {
  assert.throws(() => importBundle("not json"));
  assert.throws(() => importBundle(JSON.stringify({ app: "other", version: 1 })));
  assert.throws(() => importBundle(JSON.stringify({ app: "deeprp-afterhours", version: 99 })));
});

test("sanitizeSettings clamps the context budget and defaults it", () => {
  const s = sanitizeSettings({ space: "u/s", userName: "Ash", contextChars: 999999 });
  assert.equal(s.contextChars, 32000);
  assert.equal(sanitizeSettings({ space: "u/s" }).contextChars, 12000);
  assert.equal(sanitizeSettings({ contextChars: "junk" }).contextChars, 12000);
  assert.equal(sanitizeSettings({ contextChars: 500 }).contextChars, 2000);
});