import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TRANSCRIPT_CHARS,
  CONTEXT_MIN_CHARS,
  CONTEXT_MAX_CHARS,
  CLOSENESS_STAGES,
  closenessStage,
  clampCloseness,
  clampContextChars,
  PACING_OPTIONS,
  TONE_OPTIONS,
  buildSystemPrompt,
  buildTranscript,
  contextUsage,
} from "../js/engine.js";

test("closeness clamps and maps to slow-burn stages", () => {
  assert.equal(clampCloseness(-50), 0);
  assert.equal(clampCloseness(500), 100);
  assert.equal(clampCloseness(42), 42);
  assert.equal(CLOSENESS_STAGES[0], "Strangers");
  assert.equal(CLOSENESS_STAGES.at(-1), "Intimate");
  for (let v = 0; v <= 100; v++) {
    assert.ok(CLOSENESS_STAGES.includes(closenessStage(v)));
  }
  assert.notEqual(closenessStage(0), closenessStage(100));
});

const persona = { name: "Mara", systemPrompt: "You are Mara, a guarded neighbor." };

test("buildSystemPrompt layers persona, threads, memory, closeness, pacing and tone", () => {
  const sp = buildSystemPrompt({
    persona,
    userName: "Ash",
    loreEntries: [{ title: "The rain", content: "You met in a downpour." }],
    memory: "She still has your umbrella.",
    closeness: 72,
    pacing: "glacial",
    tone: "charged",
  });
  assert.ok(sp.includes("Mara"));
  assert.ok(sp.includes("Ash"));
  assert.ok(sp.includes("downpour"));
  assert.ok(sp.includes("umbrella"));
  assert.ok(sp.includes(closenessStage(72)));
  assert.ok(/glacial|barely|inch/i.test(sp));
  assert.ok(/charged|tension/i.test(sp));
  assert.ok(sp.length <= 16000);
});

test("buildSystemPrompt defaults to slow burn and tolerates missing layers", () => {
  const sp = buildSystemPrompt({ persona });
  assert.ok(sp.includes("Mara"));
  assert.ok(/slow/i.test(sp));
  assert.ok(!sp.includes("undefined"));
  assert.ok(!sp.includes("null"));
  assert.ok(PACING_OPTIONS.includes("slow"));
  assert.ok(TONE_OPTIONS.length >= 3);
});

test("buildTranscript keeps newest messages within the budget", () => {
  const msgs = Array.from({ length: 300 }, (_, i) => ({
    role: i % 2 ? "bot" : "user",
    text: `message ${i} `.repeat(40),
  }));
  const t = buildTranscript(msgs);
  assert.ok(t.length <= MAX_TRANSCRIPT_CHARS);
  assert.ok(t.includes("message 299"));
  assert.ok(!t.includes("message 0 "));
});

test("contextUsage reports used, total and percent", () => {
  const u = contextUsage("abcde");
  assert.equal(u.total, MAX_TRANSCRIPT_CHARS);
  assert.equal(u.used, 5);
  assert.ok(u.percent >= 0 && u.percent <= 100);
});

test("clampContextChars defaults, clamps and rounds to a clean step", () => {
  assert.equal(clampContextChars(undefined), MAX_TRANSCRIPT_CHARS);
  assert.equal(clampContextChars("nonsense"), MAX_TRANSCRIPT_CHARS);
  assert.equal(clampContextChars(0), CONTEXT_MIN_CHARS);
  assert.equal(clampContextChars(999999), CONTEXT_MAX_CHARS);
  assert.equal(clampContextChars(12345), 12000);
  assert.equal(clampContextChars(1600), CONTEXT_MIN_CHARS);
});

test("buildTranscript honors a custom context budget", () => {
  const msgs = Array.from({ length: 200 }, (_, i) => ({
    role: i % 2 ? "bot" : "user",
    text: `line ${i} `.repeat(30),
  }));
  const t = buildTranscript(msgs, "Mara", { maxChars: 4000 });
  assert.ok(t.length <= 4000);
  assert.ok(t.includes("line 199"));
  assert.ok(!t.includes("line 0 "));
});

test("contextUsage reflects a custom budget in total and percent", () => {
  const u = contextUsage("x".repeat(2000), 4000);
  assert.equal(u.total, 4000);
  assert.equal(u.used, 2000);
  assert.equal(u.percent, 50);
  const single = contextUsage("abc", 8000);
  assert.equal(single.total, 8000);
  assert.equal(single.used, 3);
});