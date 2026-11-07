import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../js/app.js", import.meta.url), "utf8");

function importedNames(source, modulePath) {
  const re = new RegExp(`import\\s*\\{([^}]+)\\}\\s*from\\s*"\\./${modulePath}"`);
  const m = source.match(re);
  if (!m) return null;
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

test("app.js imports only names the pure modules actually export", async () => {
  const modules = {
    "personas.js": await import("../js/personas.js"),
    "lore.js": await import("../js/lore.js"),
    "engine.js": await import("../js/engine.js"),
    "storage.js": await import("../js/storage.js"),
    "theme.js": await import("../js/theme.js"),
  };
  for (const [file, mod] of Object.entries(modules)) {
    const names = importedNames(appSource, file);
    assert.ok(names, `app.js must import from ./${file}`);
    for (const name of names) {
      assert.ok(name in mod, `js/${file} must export ${name} (imported by app.js)`);
    }
  }
});

test("app.js imports only names gradio.js exports", async () => {
  const source = await readFile(new URL("../js/gradio.js", import.meta.url), "utf8");
  const names = importedNames(appSource, "gradio.js");
  assert.ok(names);
  for (const name of names) {
    assert.ok(
      new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(source),
      `js/gradio.js must export function ${name}`
    );
  }
});

test("index.html references every app shell file that exists", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["persona-strip", "transcript", "composer", "input", "send-btn", "scrim", "toast", "sheet-sagas", "sheet-personas", "sheet-lore", "sheet-story", "sheet-settings", "sheet-timeskip"]) {
    assert.ok(html.includes(`id="${id}"`), `index.html missing #${id}`);
  }
});