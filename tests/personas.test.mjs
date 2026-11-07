import test from "node:test";
import assert from "node:assert/strict";
import {
  PERSONA_COLORS,
  MAX_PERSONAS,
  MAX_PERSONA_PROMPT_CHARS,
  defaultPersonas,
  createPersona,
  restoreDefaultPersonas,
  sanitizePersona,
  sanitizePersonas,
} from "../js/personas.js";

test("ships a seeded cast of distinct personas", () => {
  const cast = defaultPersonas();
  assert.ok(cast.length >= 4);
  const ids = new Set(cast.map((p) => p.id));
  assert.equal(ids.size, cast.length);
  for (const p of cast) {
    assert.ok(p.name && p.name.length <= 40);
    assert.ok(p.tagline);
    assert.ok(p.systemPrompt.length > 80);
    assert.ok(p.greeting.length > 20);
    assert.ok(PERSONA_COLORS.includes(p.color));
    assert.ok(p.genre);
  }
});

test("seeded cast is realistic slow-burn, not fantasy", () => {
  for (const p of defaultPersonas()) {
    assert.ok(/slow|realistic|psycholog/i.test(p.systemPrompt), `${p.name} prompt must anchor slow-burn realism`);
    assert.ok(!/\b(dragon|elf|android|vampire|starship|magic|wizard)\b/i.test(p.systemPrompt + p.tagline + p.genre), `${p.name} must be a realistic character`);
  }
});

test("createPersona builds a valid custom persona", () => {
  const p = createPersona({ name: "Test", systemPrompt: "You are a test persona." });
  assert.ok(p.id);
  assert.equal(p.name, "Test");
  assert.equal(p.custom, true);
  assert.ok(PERSONA_COLORS.includes(p.color));
});

test("sanitizePersona drops junk and clamps oversized fields", () => {
  assert.equal(sanitizePersona(null), null);
  assert.equal(sanitizePersona({ name: "x" }), null); // no systemPrompt
  const p = sanitizePersona({
    id: "abc",
    name: "  N  ",
    tagline: 42,
    systemPrompt: "y".repeat(MAX_PERSONA_PROMPT_CHARS + 500),
    greeting: null,
    color: "not-a-color",
    genre: "x".repeat(200),
  });
  assert.equal(p.name, "N");
  assert.equal(p.tagline, "");
  assert.equal(p.systemPrompt.length, MAX_PERSONA_PROMPT_CHARS);
  assert.equal(p.greeting, "");
  assert.ok(PERSONA_COLORS.includes(p.color));
  assert.ok(p.genre.length <= 40);
});

test("sanitizePersonas keeps valid entries up to the cap and dedupes ids", () => {
  const a = createPersona({ name: "A", systemPrompt: "prompt a" });
  const b = createPersona({ name: "B", systemPrompt: "prompt b" });
  const out = sanitizePersonas([a, a, b, null, { name: "bad" }, ...Array.from({ length: 80 }, () => createPersona({ name: "x", systemPrompt: "p" }))]);
  assert.equal(out.length, MAX_PERSONAS);
  assert.equal(new Set(out.map((p) => p.id)).size, out.length);
});

test("restoreDefaultPersonas re-adds only missing built-ins at their cast position", () => {
  const cast = defaultPersonas();
  const custom = createPersona({ name: "Claire", systemPrompt: "You are Claire." });
  const editedMara = { ...cast[0], name: "Mara (edited)" };
  const current = [editedMara, custom, cast[3]];
  const out = restoreDefaultPersonas(current);
  assert.equal(out.length, cast.length + 1);
  assert.equal(new Set(out.map((p) => p.id)).size, out.length);
  assert.ok(out.includes(editedMara), "edited built-in must be kept as-is");
  assert.ok(out.includes(custom), "custom persona must be kept");
  assert.ok(out.includes(cast[3]), "existing built-in must be kept as-is");
  const restoredTheo = out.find((p) => p.id === "theo");
  assert.deepEqual(restoredTheo, cast[1], "missing built-in returns with its original definition");
  assert.ok(out.indexOf(restoredTheo) < out.indexOf(cast[3]), "restored in cast order");
});

test("restoreDefaultPersonas is a no-op when the full cast is present", () => {
  const current = [...defaultPersonas(), createPersona({ name: "C", systemPrompt: "p" })];
  const out = restoreDefaultPersonas(current);
  assert.deepEqual(out, current);
});

test("restoreDefaultPersonas respects the persona cap", () => {
  const current = Array.from({ length: MAX_PERSONAS }, () => createPersona({ name: "x", systemPrompt: "p" }));
  const out = restoreDefaultPersonas(current);
  assert.equal(out.length, MAX_PERSONAS);
});