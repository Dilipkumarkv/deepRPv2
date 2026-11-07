import {
  PERSONA_COLORS,
  MAX_PERSONAS,
  defaultPersonas,
  createPersona,
  restoreDefaultPersonas,
  sanitizePersonas,
} from "./personas.js";
import { defaultLore, createLoreEntry, sanitizeLore, matchLore } from "./lore.js";
import {
  closenessStage,
  clampCloseness,
  clampContextChars,
  CONTEXT_MIN_CHARS,
  CONTEXT_MAX_CHARS,
  buildSystemPrompt,
  buildTranscript,
  buildUserTurn,
  contextUsage,
} from "./engine.js";
import {
  STORAGE_KEYS,
  MAX_MESSAGES_PER_CHAT,
  createChat,
  sanitizeChats,
  sanitizeSettings,
  readJSON,
  writeJSON,
  exportBundle,
  importBundle,
} from "./storage.js";
import { ensureClient, predictReply, describeError, resetClient } from "./gradio.js";
import { applyTheme, toggleTheme, currentTheme } from "./theme.js";

/* ---------- state ---------- */

let settings = sanitizeSettings(readJSON(localStorage, STORAGE_KEYS.settings, {}));
let token = localStorage.getItem(STORAGE_KEYS.token) || "";
let personas = sanitizePersonas(readJSON(localStorage, STORAGE_KEYS.personas, []));
if (!personas.length) personas = defaultPersonas();
let lore = sanitizeLore(readJSON(localStorage, STORAGE_KEYS.lore, []));
if (!lore.length && !localStorage.getItem(STORAGE_KEYS.lore)) lore = defaultLore();
let chats = sanitizeChats(readJSON(localStorage, STORAGE_KEYS.chats, []));
let activeChatId = chats[0]?.id || null;
let generating = false;
let typingEl = null;
let toastTimer = null;
let pendingUndo = null;
let selectedColor = PERSONA_COLORS[0];

const $ = (id) => document.getElementById(id);
const els = {
  statusBadge: $("status-badge"),
  statusText: $("status-text"),
  personaStrip: $("persona-strip"),
  closenessLabel: $("closeness-label"),
  closenessFill: $("closeness-fill"),
  closenessValue: $("closeness-value"),
  closenessDot: $("closeness-dot"),
  transcript: $("transcript"),
  contextMeter: $("context-meter"),
  contextLabel: $("context-label"),
  contextFill: $("context-fill"),
  input: $("input"),
  sendBtn: $("send-btn"),
  scrim: $("scrim"),
  toast: $("toast"),
  toastText: $("toast-text"),
  toastAction: $("toast-action"),
};

function activeChat() {
  return chats.find((c) => c.id === activeChatId) || null;
}
function activePersona() {
  const chat = activeChat();
  return personas.find((p) => p.id === chat?.personaId) || personas[0];
}
function personaById(id) {
  return personas.find((p) => p.id === id) || null;
}

function persist() {
  writeJSON(localStorage, STORAGE_KEYS.chats, chats);
  writeJSON(localStorage, STORAGE_KEYS.personas, personas);
  writeJSON(localStorage, STORAGE_KEYS.lore, lore);
  writeJSON(localStorage, STORAGE_KEYS.settings, settings);
}

function setStatus(state, text) {
  els.statusBadge.dataset.state = state;
  els.statusText.textContent = text;
}

/* ---------- toast ---------- */

function showToast(text, { action = null, onAction = null, duration = 4000 } = {}) {
  clearTimeout(toastTimer);
  els.toastText.textContent = text;
  els.toastAction.hidden = !action;
  els.toastAction.textContent = action || "";
  pendingUndo = onAction;
  els.toast.hidden = false;
  toastTimer = setTimeout(hideToast, duration);
}
function hideToast() {
  clearTimeout(toastTimer);
  els.toast.hidden = true;
  pendingUndo = null;
}
els.toastAction.addEventListener("click", () => {
  const fn = pendingUndo;
  hideToast();
  if (fn) fn();
});

/* ---------- sheets ---------- */

let openSheet = null;
function showSheet(id) {
  closeSheet();
  const sheet = $(id);
  sheet.hidden = false;
  els.scrim.hidden = false;
  openSheet = sheet;
  const focusable = sheet.querySelector("input, textarea, select, button:not(.sheet-close)");
  if (focusable) focusable.focus({ preventScroll: true });
}
function closeSheet() {
  if (openSheet) openSheet.hidden = true;
  openSheet = null;
  els.scrim.hidden = true;
}
els.scrim.addEventListener("click", closeSheet);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheet();
});
document.querySelectorAll("[data-close]").forEach((btn) => btn.addEventListener("click", closeSheet));

/* ---------- rendering ---------- */

function renderPersonaStrip() {
  els.personaStrip.replaceChildren();
  const active = activeChat()?.personaId;
  for (const p of personas) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "persona-chip";
    chip.setAttribute("role", "tab");
    chip.setAttribute("aria-selected", String(p.id === active));
    chip.style.setProperty("--chip-color", p.color);
    const dot = document.createElement("span");
    dot.className = "chip-dot";
    dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.textContent = p.name;
    chip.append(dot, name);
    chip.addEventListener("click", () => switchPersona(p.id));
    els.personaStrip.append(chip);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "persona-chip add-chip";
  add.setAttribute("aria-label", "Manage the people");
  add.textContent = "＋";
  add.addEventListener("click", () => {
    renderRoster();
    showSheet("sheet-personas");
  });
  els.personaStrip.append(add);
  const activeChip = els.personaStrip.querySelector('[aria-selected="true"]');
  if (activeChip) activeChip.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function renderCloseness() {
  const chat = activeChat();
  const v = chat ? chat.closeness : 8;
  const stage = closenessStage(v);
  const color = activePersona()?.color || "var(--wine)";
  els.closenessLabel.textContent = stage;
  els.closenessValue.textContent = String(v);
  els.closenessFill.style.width = `${v}%`;
  els.closenessFill.style.background = color;
  els.closenessDot.style.background = color;
}

function feedbackKey() {
  return STORAGE_KEYS.feedback + (activeChatId || "none");
}
function storedFeedback(text) {
  const data = readJSON(localStorage, feedbackKey(), {});
  return data[text] ?? null;
}
function markFeedback(upBtn, downBtn, direction) {
  upBtn.classList.toggle("is-up", direction === "up");
  downBtn.classList.toggle("is-down", direction === "down");
  upBtn.setAttribute("aria-pressed", String(direction === "up"));
  downBtn.setAttribute("aria-pressed", String(direction === "down"));
}
function toggleFeedback(button, direction, text) {
  const bubble = button.closest(".msg");
  const upBtn = bubble.querySelector(".thumb-btn.up");
  const downBtn = bubble.querySelector(".thumb-btn.down");
  const next = storedFeedback(text) === direction ? null : direction;
  markFeedback(upBtn, downBtn, next);
  const data = readJSON(localStorage, feedbackKey(), {});
  if (next) data[text] = next;
  else delete data[text];
  writeJSON(localStorage, feedbackKey(), data);
}

const ICONS = {
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
};

function renderMessage(msg) {
  const persona = activePersona();
  const el = document.createElement("div");
  if (msg.role === "system") {
    el.className = "msg msg-system" + (msg.error ? " error" : "");
    el.textContent = msg.text;
    return el;
  }
  el.className = `msg msg-${msg.role}` + (msg.error ? " error" : "");
  if (msg.role === "user" && msg.text.startsWith("(OOC:")) el.classList.add("ooc");
  if (msg.role === "bot") {
    const speaker = document.createElement("span");
    speaker.className = "msg-speaker";
    speaker.textContent = persona?.name || "Character";
    el.append(speaker);
  }
  const body = document.createElement("span");
  body.textContent = msg.text;
  el.append(body);
  if (msg.role === "bot" && !msg.error) {
    const actions = document.createElement("div");
    actions.className = "msg-actions";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "mini-btn";
    copy.setAttribute("aria-label", "Copy reply");
    copy.innerHTML = ICONS.copy;
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(msg.text);
        showToast("Copied to clipboard");
      } catch {
        showToast("Copy failed — long-press the text instead");
      }
    });
    const up = document.createElement("button");
    up.type = "button";
    up.className = "mini-btn thumb-btn up";
    up.setAttribute("aria-label", "Good reply");
    up.setAttribute("aria-pressed", "false");
    up.innerHTML = ICONS.up;
    up.addEventListener("click", () => toggleFeedback(up, "up", msg.text));
    const down = document.createElement("button");
    down.type = "button";
    down.className = "mini-btn thumb-btn down";
    down.setAttribute("aria-label", "Bad reply");
    down.setAttribute("aria-pressed", "false");
    down.innerHTML = ICONS.down;
    down.addEventListener("click", () => toggleFeedback(down, "down", msg.text));
    const saved = storedFeedback(msg.text);
    if (saved === "up" || saved === "down") markFeedback(up, down, saved);
    actions.append(copy, up, down);
    el.append(actions);
  }
  return el;
}

function renderTranscript() {
  els.transcript.replaceChildren();
  const chat = activeChat();
  if (!chat) return;
  if (!chat.messages.length) {
    if (!token || !settings.space) {
      const card = document.createElement("div");
      card.className = "welcome";
      const h = document.createElement("h2");
      h.textContent = "Start something slow";
      const p = document.createElement("p");
      p.textContent = "Connect your Hugging Face Space, choose someone above, and make the first move. Your stories stay on this device.";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-btn primary";
      btn.textContent = "Connect your Space";
      btn.addEventListener("click", () => {
        syncSettingsForm();
        showSheet("sheet-settings");
      });
      card.append(h, p, btn);
      els.transcript.append(card);
      return;
    }
    const note = document.createElement("div");
    note.className = "msg msg-system";
    note.textContent = "A new story begins. Say something below.";
    els.transcript.append(note);
    return;
  }
  for (const msg of chat.messages) els.transcript.append(renderMessage(msg));
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function updateContextMeter() {
  const chat = activeChat();
  if (!chat || !chat.messages.length) {
    els.contextMeter.hidden = true;
    return;
  }
  const transcript = buildTranscript(chat.messages, activePersona()?.name, { maxChars: settings.contextChars });
  const usage = contextUsage(transcript, settings.contextChars);
  els.contextMeter.hidden = false;
  els.contextLabel.textContent = `${usage.used} / ${usage.total} chars (${usage.percent}%)`;
  els.contextFill.style.width = `${usage.percent}%`;
  els.contextMeter.classList.toggle("warn", usage.percent >= 80 && usage.percent < 95);
  els.contextMeter.classList.toggle("danger", usage.percent >= 95);
}

function updateSendButton() {
  els.sendBtn.disabled = generating || !els.input.value.trim();
  document.querySelectorAll(".director-btn").forEach((b) => (b.disabled = generating));
}

function renderAll() {
  renderPersonaStrip();
  renderCloseness();
  renderTranscript();
  updateContextMeter();
  updateSendButton();
}

/* ---------- chat lifecycle ---------- */

function newStory(personaId) {
  const persona = personaById(personaId) || personas[0];
  const chat = createChat({ personaId: persona.id, title: `${persona.name} · new story` });
  if (persona.greeting) {
    chat.messages.push({ role: "bot", text: persona.greeting, ts: Date.now() });
  }
  chats.unshift(chat);
  activeChatId = chat.id;
  persist();
  renderAll();
  return chat;
}

function switchPersona(personaId) {
  if (generating) return;
  const existing = chats.find((c) => c.personaId === personaId);
  if (existing) {
    activeChatId = existing.id;
    persist();
    renderAll();
  } else {
    newStory(personaId);
  }
}

function deleteStory(id) {
  const idx = chats.findIndex((c) => c.id === id);
  if (idx < 0) return;
  const [removed] = chats.splice(idx, 1);
  if (activeChatId === id) activeChatId = chats[0]?.id || null;
  if (!chats.length) newStory(activePersona()?.id || personas[0].id);
  persist();
  renderAll();
  renderStoryList();
  showToast("Story deleted", {
    action: "Undo",
    duration: 6000,
    onAction: () => {
      chats.splice(Math.min(idx, chats.length), 0, removed);
      activeChatId = removed.id;
      persist();
      renderAll();
      renderStoryList();
    },
  });
}

function renderStoryList() {
  const list = $("saga-list");
  list.replaceChildren();
  $("new-saga-persona").textContent = activePersona()?.name || "this person";
  if (!chats.length) {
    const li = document.createElement("li");
    li.className = "empty-note";
    li.textContent = "No stories yet.";
    list.append(li);
    return;
  }
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const chat of sorted) {
    const persona = personaById(chat.personaId);
    const li = document.createElement("li");
    li.className = "saga-item" + (chat.id === activeChatId ? " active" : "");
    const dot = document.createElement("span");
    dot.className = "item-dot";
    dot.style.setProperty("--item-color", persona?.color || "var(--text-dim)");
    const main = document.createElement("button");
    main.type = "button";
    main.className = "item-main";
    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = chat.title;
    const sub = document.createElement("span");
    sub.className = "item-sub";
    const lastBot = [...chat.messages].reverse().find((m) => m.role === "bot");
    sub.textContent = `${persona?.name || "Unknown"} · ${chat.messages.length} message${chat.messages.length === 1 ? "" : "s"}${lastBot ? " · " + lastBot.text.slice(0, 40) : ""}`;
    main.append(title, sub);
    main.addEventListener("click", () => {
      activeChatId = chat.id;
      persist();
      renderAll();
      closeSheet();
    });
    const del = document.createElement("button");
    del.type = "button";
    del.className = "item-btn danger";
    del.setAttribute("aria-label", `Delete ${chat.title}`);
    del.innerHTML = ICONS.trash;
    del.addEventListener("click", () => deleteStory(chat.id));
    li.append(dot, main, del);
    list.append(li);
  }
}

/* ---------- the people ---------- */

function renderRoster() {
  const list = $("roster-list");
  list.replaceChildren();
  for (const p of personas) {
    const li = document.createElement("li");
    li.className = "roster-item";
    const dot = document.createElement("span");
    dot.className = "item-dot";
    dot.style.setProperty("--item-color", p.color);
    const main = document.createElement("button");
    main.type = "button";
    main.className = "item-main";
    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = p.name + (p.custom ? "" : " · built-in");
    const sub = document.createElement("span");
    sub.className = "item-sub";
    sub.textContent = p.tagline || p.genre || "Custom";
    main.append(title, sub);
    main.addEventListener("click", () => fillPersonaForm(p));
    li.append(dot, main);
    list.append(li);
  }
  $("restore-personas").hidden = !defaultPersonas().some((d) => !personas.some((p) => p.id === d.id));
  renderSwatches();
}

function renderSwatches() {
  const wrap = $("persona-colors");
  wrap.replaceChildren();
  for (const color of PERSONA_COLORS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.style.setProperty("--swatch", color);
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(color === selectedColor));
    b.setAttribute("aria-label", color);
    b.addEventListener("click", () => {
      selectedColor = color;
      renderSwatches();
    });
    wrap.append(b);
  }
}

function fillPersonaForm(p) {
  $("persona-form-title").textContent = p ? `Edit ${p.name}` : "Create someone";
  $("persona-id").value = p?.id || "";
  $("persona-name").value = p?.name || "";
  $("persona-tagline").value = p?.tagline || "";
  $("persona-genre").value = p?.genre || "";
  $("persona-prompt").value = p?.systemPrompt || "";
  $("persona-greeting").value = p?.greeting || "";
  selectedColor = p?.color || PERSONA_COLORS[0];
  renderSwatches();
  $("persona-delete").hidden = !p;
  $("persona-form").scrollIntoView({ block: "nearest" });
}

$("persona-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("persona-id").value;
  const fields = {
    name: $("persona-name").value,
    tagline: $("persona-tagline").value,
    genre: $("persona-genre").value,
    color: selectedColor,
    systemPrompt: $("persona-prompt").value,
    greeting: $("persona-greeting").value,
  };
  const existing = id ? personaById(id) : null;
  if (existing) {
    Object.assign(existing, {
      name: fields.name.trim().slice(0, 40) || existing.name,
      tagline: fields.tagline.trim().slice(0, 80),
      genre: fields.genre.trim().slice(0, 40),
      color: selectedColor,
      systemPrompt: fields.systemPrompt.trim().slice(0, 4000),
      greeting: fields.greeting.trim().slice(0, 1200),
    });
    showToast(`${existing.name} updated`);
  } else {
    if (personas.length >= MAX_PERSONAS) {
      showToast(`Your circle is full (${MAX_PERSONAS} people)`);
      return;
    }
    const p = createPersona(fields);
    personas.push(p);
    showToast(`${p.name} joined your circle`);
  }
  persist();
  renderPersonaStrip();
  renderRoster();
  renderCloseness();
  fillPersonaForm(null);
});

$("persona-reset").addEventListener("click", () => fillPersonaForm(null));
$("persona-delete").addEventListener("click", () => {
  const id = $("persona-id").value;
  const p = personaById(id);
  if (!p) return;
  if (personas.length <= 1) {
    showToast("Keep at least one person in your circle");
    return;
  }
  const index = personas.findIndex((x) => x.id === id);
  const reassigned = chats.filter((c) => c.personaId === id).map((c) => c.id);
  personas = personas.filter((x) => x.id !== id);
  for (const chat of chats) {
    if (chat.personaId === id) chat.personaId = personas[0].id;
  }
  persist();
  renderAll();
  renderRoster();
  fillPersonaForm(null);
  showToast(`${p.name} removed`, {
    action: "Undo",
    duration: 6000,
    onAction: () => {
      personas.splice(Math.min(index, personas.length), 0, p);
      for (const chat of chats) {
        if (reassigned.includes(chat.id)) chat.personaId = id;
      }
      persist();
      renderAll();
      renderRoster();
    },
  });
});

$("restore-personas").addEventListener("click", () => {
  const before = personas.length;
  personas = restoreDefaultPersonas(personas);
  const added = personas.length - before;
  if (!added) {
    showToast(`Your circle is full (${MAX_PERSONAS} people)`);
    return;
  }
  persist();
  renderAll();
  renderRoster();
  showToast(`${added} built-in${added === 1 ? "" : "s"} restored`);
});

/* ---------- threads ---------- */

function renderLoreList() {
  const list = $("lore-list");
  list.replaceChildren();
  if (!lore.length) {
    const li = document.createElement("li");
    li.className = "empty-note";
    li.textContent = "No threads yet — add the small details that mean everything.";
    list.append(li);
    return;
  }
  for (const entry of lore) {
    const li = document.createElement("li");
    li.className = "lore-item";
    const main = document.createElement("button");
    main.type = "button";
    main.className = "item-main";
    const title = document.createElement("span");
    title.className = "item-title";
    title.textContent = entry.title;
    const sub = document.createElement("span");
    sub.className = "item-sub";
    sub.textContent = entry.keys.join(", ");
    main.append(title, sub);
    main.addEventListener("click", () => fillLoreForm(entry));
    const del = document.createElement("button");
    del.type = "button";
    del.className = "item-btn danger";
    del.setAttribute("aria-label", `Delete ${entry.title}`);
    del.innerHTML = ICONS.trash;
    del.addEventListener("click", () => {
      lore = lore.filter((x) => x.id !== entry.id);
      persist();
      renderLoreList();
      showToast(`“${entry.title}” removed`);
    });
    li.append(main, del);
    list.append(li);
  }
}

function fillLoreForm(entry) {
  $("lore-form-title").textContent = entry ? `Edit ${entry.title}` : "Add a thread";
  $("lore-id").value = entry?.id || "";
  $("lore-title").value = entry?.title || "";
  $("lore-keys").value = entry?.keys.join(", ") || "";
  $("lore-content").value = entry?.content || "";
  $("lore-delete").hidden = !entry;
}

$("lore-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const id = $("lore-id").value;
  const fields = {
    title: $("lore-title").value,
    keys: $("lore-keys").value,
    content: $("lore-content").value,
  };
  const existing = id ? lore.find((x) => x.id === id) : null;
  if (existing) {
    const rebuilt = createLoreEntry(fields);
    Object.assign(existing, { title: rebuilt.title, keys: rebuilt.keys, content: rebuilt.content });
    showToast("Thread updated");
  } else {
    const entry = createLoreEntry(fields);
    if (!entry.keys.length) {
      showToast("Add at least one trigger keyword");
      return;
    }
    lore.push(entry);
    showToast(`“${entry.title}” added to your threads`);
  }
  persist();
  renderLoreList();
  fillLoreForm(null);
});
$("lore-reset").addEventListener("click", () => fillLoreForm(null));
$("lore-delete").addEventListener("click", () => {
  const id = $("lore-id").value;
  lore = lore.filter((x) => x.id !== id);
  persist();
  renderLoreList();
  fillLoreForm(null);
  showToast("Thread removed");
});

/* ---------- story sheet ---------- */

function fillStoryForm() {
  const chat = activeChat();
  if (!chat) return;
  $("saga-title-input").value = chat.title;
  $("memory-input").value = chat.memory;
  $("closeness-slider").value = String(chat.closeness);
  $("closeness-stage-label").textContent = `${closenessStage(chat.closeness)} (${chat.closeness}/100)`;
  $("pacing-select").value = chat.pacing;
  $("tone-select").value = chat.tone;
  $("story-note").textContent = "";
}
$("closeness-slider").addEventListener("input", () => {
  const v = clampCloseness($("closeness-slider").value);
  $("closeness-stage-label").textContent = `${closenessStage(v)} (${v}/100)`;
});
$("story-save").addEventListener("click", () => {
  const chat = activeChat();
  if (!chat) return;
  chat.title = $("saga-title-input").value.trim().slice(0, 80) || chat.title;
  chat.memory = $("memory-input").value.trim().slice(0, 4000);
  chat.closeness = clampCloseness($("closeness-slider").value);
  chat.pacing = $("pacing-select").value;
  chat.tone = $("tone-select").value;
  chat.updatedAt = Date.now();
  persist();
  renderCloseness();
  renderStoryList();
  closeSheet();
  showToast("Story saved");
});

$("summarize-btn").addEventListener("click", async () => {
  const chat = activeChat();
  if (!chat || generating) return;
  if (!token || !settings.space) {
    $("story-note").textContent = "Connect your Space in Settings first.";
    return;
  }
  if (chat.messages.length < 4) {
    $("story-note").textContent = "Play a few turns first — there's nothing to summarize yet.";
    return;
  }
  const btn = $("summarize-btn");
  btn.disabled = true;
  $("story-note").textContent = "Distilling the story so far…";
  try {
    const transcript = buildTranscript(chat.messages, activePersona()?.name, { maxChars: settings.contextChars });
    const summary = await predictReply({
      space: settings.space,
      token,
      endpoint: settings.endpoint,
      message: `${transcript}\n\n[Director: Summarize the story so far as concise bullet-point facts: who, where, what happened, what was said and almost said, promises made, open threads. Max 150 words. No dialogue.]`,
      systemPrompt: "You are a story archivist. Output only the summary bullets, nothing else.",
    });
    chat.memory = summary.slice(0, 4000);
    chat.updatedAt = Date.now();
    persist();
    $("memory-input").value = chat.memory;
    $("story-note").textContent = "Memory updated — it now rides along in every prompt.";
    showToast("Story memory updated");
  } catch (err) {
    $("story-note").textContent = describeError(err, settings.space);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- settings ---------- */

function syncSettingsForm() {
  $("space-input").value = settings.space;
  $("endpoint-input").value = settings.endpoint;
  $("username-input").value = settings.userName;
  $("token-input").value = token;
  syncContextSlider();
}

function syncContextSlider() {
  $("context-slider").min = String(CONTEXT_MIN_CHARS);
  $("context-slider").max = String(CONTEXT_MAX_CHARS);
  $("context-slider").step = "1000";
  $("context-slider").value = String(settings.contextChars);
  syncContextLabel();
}

function syncContextLabel() {
  const v = clampContextChars($("context-slider").value);
  const tokens = Math.round(v / 4).toLocaleString("en-US");
  $("context-value").textContent = `${v.toLocaleString("en-US")} chars (~${tokens} tokens)`;
}

$("context-slider").addEventListener("input", syncContextLabel);

$("settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  settings = sanitizeSettings({
    space: $("space-input").value,
    endpoint: $("endpoint-input").value,
    userName: $("username-input").value,
    contextChars: clampContextChars($("context-slider").value),
  });
  token = $("token-input").value.trim();
  if (token) localStorage.setItem(STORAGE_KEYS.token, token);
  else localStorage.removeItem(STORAGE_KEYS.token);
  persist();
  resetClient();
  closeSheet();
  renderAll();
  if (token && settings.space) {
    setStatus("connecting", "Connecting…");
    try {
      await ensureClient(settings.space, token);
      setStatus("ready", "Ready");
      showToast("Connected — the evening is yours");
    } catch (err) {
      setStatus("error", "Error");
      showToast(describeError(err, settings.space));
    }
  } else {
    setStatus("disconnected", token ? "Set a Space" : "Offline");
  }
});

$("forget-token-btn").addEventListener("click", () => {
  token = "";
  localStorage.removeItem(STORAGE_KEYS.token);
  $("token-input").value = "";
  resetClient();
  setStatus("disconnected", "Offline");
  showToast("Token forgotten on this device");
});

$("export-btn").addEventListener("click", () => {
  const bundle = exportBundle({ chats, personas, lore, settings });
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `after-hours-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Backup downloaded — no token inside");
});

$("import-btn").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async () => {
  const file = $("import-file").files[0];
  $("import-file").value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const data = importBundle(text);
    if (!window.confirm("Importing replaces your stories, people and threads on this device. Your token is untouched. Continue?")) return;
    chats = data.chats;
    if (data.personas.length) personas = data.personas;
    if (data.lore.length) lore = data.lore;
    settings = data.settings;
    activeChatId = chats[0]?.id || null;
    if (!chats.length) newStory(personas[0].id);
    persist();
    syncSettingsForm();
    renderAll();
    showToast("Backup imported");
  } catch (err) {
    showToast(err.message || "Import failed");
  }
});

/* ---------- sending ---------- */

function pushMessage(chat, role, text, extra = {}) {
  chat.messages.push({ role, text, ts: Date.now(), ...extra });
  if (chat.messages.length > MAX_MESSAGES_PER_CHAT) {
    chat.messages = chat.messages.slice(-MAX_MESSAGES_PER_CHAT);
  }
  chat.updatedAt = Date.now();
}

function addSystemNote(text, error = false) {
  const chat = activeChat();
  if (!chat) return;
  pushMessage(chat, "system", text, { error });
  persist();
  renderTranscript();
}

function showTyping() {
  hideTyping();
  typingEl = document.createElement("div");
  typingEl.className = "typing";
  typingEl.setAttribute("aria-label", "They are writing");
  typingEl.append(document.createElement("span"), document.createElement("span"), document.createElement("span"));
  els.transcript.append(typingEl);
  els.transcript.scrollTop = els.transcript.scrollHeight;
}
function hideTyping() {
  if (typingEl) typingEl.remove();
  typingEl = null;
}

function recentUserText(chat, newText) {
  const recent = chat.messages.filter((m) => m.role === "user").slice(-6).map((m) => m.text);
  recent.push(newText);
  return recent.join("\n");
}

async function sendMessage(text) {
  if (generating) return;
  const trimmed = (text ?? els.input.value).trim();
  if (!trimmed) return;
  if (!token || !settings.space) {
    addSystemNote("Connect your Hugging Face Space in Settings (⚙) first.", true);
    syncSettingsForm();
    showSheet("sheet-settings");
    return;
  }
  const chat = activeChat() || newStory(activePersona()?.id);
  const persona = personaById(chat.personaId) || personas[0];

  pushMessage(chat, "user", trimmed);
  persist();
  renderTranscript();
  updateContextMeter();
  els.input.value = "";
  autosize();
  generating = true;
  updateSendButton();
  showTyping();
  setStatus("connecting", "Writing…");

  try {
    const hits = matchLore(lore, recentUserText(chat, trimmed));
    const systemPrompt = buildSystemPrompt({
      persona,
      userName: settings.userName,
      loreEntries: hits,
      memory: chat.memory,
      closeness: chat.closeness,
      pacing: chat.pacing,
      tone: chat.tone,
    });
    const prior = buildTranscript(chat.messages.slice(0, -1), persona.name, { maxChars: settings.contextChars });
    const turn = buildUserTurn(prior, trimmed);
    const reply = await predictReply({
      space: settings.space,
      token,
      endpoint: settings.endpoint,
      message: turn,
      systemPrompt,
    });
    hideTyping();
    pushMessage(chat, "bot", reply);
    chat.closeness = clampCloseness(chat.closeness + 1);
    persist();
    renderTranscript();
    renderCloseness();
    updateContextMeter();
    setStatus("ready", "Ready");
    if (hits.length) showToast(`Thread woven in: ${hits.map((h) => h.title).join(", ")}`);
  } catch (err) {
    hideTyping();
    pushMessage(chat, "bot", describeError(err, settings.space), { error: true });
    persist();
    renderTranscript();
    setStatus("error", "Error");
  } finally {
    generating = false;
    updateSendButton();
    els.input.focus({ preventScroll: true });
  }
}

$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage();
});
els.input.addEventListener("input", () => {
  autosize();
  updateSendButton();
});
els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !matchMedia("(pointer: coarse)").matches) {
    e.preventDefault();
    sendMessage();
  }
});

function autosize() {
  els.input.style.height = "auto";
  els.input.style.height = Math.min(els.input.scrollHeight, 132) + "px";
}

/* ---------- scene tools ---------- */

$("continue-btn").addEventListener("click", () => sendMessage("(OOC: Continue the scene naturally from your last reply.)"));
$("timeskip-btn").addEventListener("click", () => showSheet("sheet-timeskip"));
$("thoughts-btn").addEventListener("click", () =>
  sendMessage("(OOC: Show me what you're thinking but not saying right now — the unfiltered inner monologue, then return to the scene.)")
);

document.querySelectorAll(".skip-preset").forEach((b) =>
  b.addEventListener("click", () => {
    closeSheet();
    sendMessage(`(OOC: Time skip — ${b.dataset.skip}. Resume the scene naturally; let the distance itself show.)`);
  })
);

/* ---------- header ---------- */

$("sagas-btn").addEventListener("click", () => {
  renderStoryList();
  showSheet("sheet-sagas");
});
$("new-saga-btn").addEventListener("click", () => {
  newStory(activeChat()?.personaId || personas[0].id);
  closeSheet();
  showToast("A new story begins");
});
$("lore-btn").addEventListener("click", () => {
  renderLoreList();
  showSheet("sheet-lore");
});
$("story-btn").addEventListener("click", () => {
  fillStoryForm();
  showSheet("sheet-story");
});
$("settings-btn").addEventListener("click", () => {
  syncSettingsForm();
  showSheet("sheet-settings");
});
$("theme-btn").addEventListener("click", () => {
  toggleTheme();
});

/* ---------- init ---------- */

function init() {
  applyTheme(currentTheme());
  if (!chats.length) newStory(personas[0].id);
  renderAll();
  syncSettingsForm();
  if (token && settings.space) {
    setStatus("connecting", "Connecting…");
    ensureClient(settings.space, token)
      .then(() => setStatus("ready", "Ready"))
      .catch(() => setStatus("error", "Offline"));
  } else {
    setStatus("disconnected", token ? "Set a Space" : "Offline");
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

init();