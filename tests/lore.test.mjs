import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_LORE_ENTRIES,
  MAX_LORE_ENTRY_CHARS,
  defaultLore,
  createLoreEntry,
  sanitizeLore,
  matchLore,
} from "../js/lore.js";

test("default lore covers the seeded world with multi-keyword entries", () => {
  const lore = defaultLore();
  assert.ok(lore.length >= 4);
  for (const e of lore) {
    assert.ok(e.id && e.title);
    assert.ok(Array.isArray(e.keys) && e.keys.length >= 1);
    assert.ok(e.content.length > 30);
  }
});

test("matchLore fires on case-insensitive keyword hits only", () => {
  const lore = [
    createLoreEntry({ title: "City", keys: ["Veyra", "capital"], content: "The capital city." }),
    createLoreEntry({ title: "Blade", keys: ["sunblade"], content: "A legendary sword." }),
  ];
  const hits = matchLore(lore, "We ride to VEYRA at dawn. Maybe the capital holds answers.");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].title, "City");
  assert.deepEqual(matchLore(lore, "nothing relevant here"), []);
  assert.deepEqual(matchLore([], "Veyra"), []);
  assert.deepEqual(matchLore(lore, ""), []);
});

test("matchLore respects the injection budget and entry order", () => {
  const big = "x".repeat(MAX_LORE_ENTRY_CHARS);
  const lore = Array.from({ length: 20 }, (_, i) =>
    createLoreEntry({ title: `E${i}`, keys: ["token"], content: big })
  );
  const hits = matchLore(lore, "token token token", { maxChars: MAX_LORE_ENTRY_CHARS * 2 });
  assert.ok(hits.length <= 2);
  assert.equal(hits[0].title, "E0");
});

test("sanitizeLore clamps, dedupes and caps entries", () => {
  const e = createLoreEntry({ title: "T", keys: ["k"], content: "content" });
  const out = sanitizeLore([
    e,
    e,
    null,
    { title: "no keys", content: "x" },
    createLoreEntry({ title: "long", keys: ["a".repeat(300)], content: "y".repeat(MAX_LORE_ENTRY_CHARS + 99) }),
    ...Array.from({ length: MAX_LORE_ENTRIES + 10 }, () => createLoreEntry({ title: "t", keys: ["k"], content: "c" })),
  ]);
  assert.equal(out.length, MAX_LORE_ENTRIES);
  assert.equal(new Set(out.map((x) => x.id)).size, out.length);
  const long = out.find((x) => x.title === "long");
  assert.equal(long.content.length, MAX_LORE_ENTRY_CHARS);
  assert.ok(long.keys[0].length <= 40);
});