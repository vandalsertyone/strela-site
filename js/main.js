// Сборка страницы: карточки категорий, поле ввода, диалог, отправка в Telegram.
import { CONFIG } from "../config.js";
import { CATEGORIES } from "../scenarios.js";
import { Dialog, defaultRequest } from "./engine.js";
import { ChatUI } from "./chat-ui.js";
import { initEffects } from "./effects.js";

const $ = (s) => document.querySelector(s);
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

const log = $("#log");
const input = $("#chat-input");
const composer = $("#composer");
const strip = $("#strip");
const cats = $("#cats");
const fab = $("#fab");
const toastEl = $("#toast");
const ph = $("#ph");

// ——— Карточки категорий: одна и та же разметка для ленты (телефон) и сетки (планшет/десктоп) ———
const SVGNS = "http://www.w3.org/2000/svg";
function cardEl(cat) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "card";
  b.dataset.cat = cat.id;
  const glow = Object.assign(document.createElement("span"), { className: "card__glow" });
  glow.setAttribute("aria-hidden", "true");
  const icon = document.createElement("span");
  icon.className = "card__icon";
  icon.setAttribute("aria-hidden", "true");
  const svg = document.createElementNS(SVGNS, "svg");
  const use = document.createElementNS(SVGNS, "use");
  use.setAttribute("href", `#i-${cat.icon}`);
  svg.appendChild(use);
  icon.appendChild(svg);
  b.append(glow, icon);
  if (cat.badge) {
    const badge = Object.assign(document.createElement("span"), { className: "badge", textContent: "Эксклюзив в Strela" });
    b.appendChild(badge);
  }
  b.appendChild(Object.assign(document.createElement("span"), { className: "card__title", textContent: cat.title }));
  b.appendChild(Object.assign(document.createElement("span"), { className: "card__desc", textContent: cat.desc }));
  const chips = cat.brands.length ? cat.brands : cat.tags || [];
  if (chips.length) {
    const wrap = document.createElement("span");
    wrap.className = "card__brands";
    chips.forEach((n) => wrap.appendChild(Object.assign(document.createElement("span"), { textContent: n })));
    b.appendChild(wrap);
  }
  return b;
}
CATEGORIES.forEach((c, i) => {
  // --i: карточки выходят лесенкой при загрузке (css: card-in)
  strip.appendChild(cardEl(c)).style.setProperty("--i", i);
  cats.appendChild(cardEl(c)).style.setProperty("--i", i);
});

// ——— Telegram: копируем текст (запасной вариант) и показываем тост ———
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
let toastTimer;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 5200);
}
async function onSend({ message }) {
  // Ссылка откроется сама (это <a target="_blank">) — здесь только копирование и тост
  if (await copyText(message)) toast("Текст запроса скопирован — если он не появился в чате, просто вставьте его");
}

// ——— Диалог ———
const ui = new ChatUI({ log, input, onSend });
let current = null; // готовый запрос {message, url} или null
const dialog = new Dialog(ui, {
  started() {
    document.body.classList.add("is-chatting");
    strip.classList.add("is-compact");
  },
  reset() {
    document.body.classList.remove("is-chatting");
    strip.classList.remove("is-compact");
    document.querySelectorAll(".card.is-active").forEach((c) => c.classList.remove("is-active"));
    input.value = "";
    syncInput();
  },
  category(id) {
    document.querySelectorAll(".card").forEach((c) => c.classList.toggle("is-active", c.dataset.cat === id));
  },
  done(req) {
    current = req;
    if (req) {
      fab.href = req.url;
      fab.target = "_blank";
      fab.rel = "noopener noreferrer";
    } else {
      fab.href = "#top";
      fab.removeAttribute("target");
      fab.removeAttribute("rel");
    }
  },
});

document.addEventListener("click", (e) => {
  const card = e.target.closest(".card[data-cat]");
  if (!card) return;
  dialog.pickCategory(card.dataset.cat);
  // Карточка могла быть под чатом (планшет/десктоп) — возвращаем чат в поле зрения
  const r = $("#chat").getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight) {
    $("#chat").scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: "center" });
  }
});
$("#restart").addEventListener("click", () => dialog.restart());

// ——— Закреплённая кнопка: итог → Telegram, иначе — назад к чату ———
function scrollToChat() {
  $("#chat").scrollIntoView({ behavior: reduced.matches ? "auto" : "smooth", block: matchMedia("(max-width:767px)").matches ? "start" : "center" });
  setTimeout(() => input.focus({ preventScroll: true }), reduced.matches ? 0 : 500);
}
fab.addEventListener("click", (e) => {
  if (current) onSend(current);
  else {
    e.preventDefault();
    scrollToChat();
  }
});
document.querySelector("[data-scroll-chat]")?.addEventListener("click", (e) => {
  e.preventDefault();
  scrollToChat();
});

// ——— Поле ввода ———
function syncInput() {
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 120) + "px";
  ph.classList.toggle("is-hidden", input.value.length > 0);
}
input.addEventListener("input", syncInput);
input.addEventListener("keydown", (e) => {
  // Enter — отправить, Shift+Enter — новая строка
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    composer.requestSubmit();
  }
});
composer.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  syncInput();
  dialog.handleText(text);
});

// Сменяющийся плейсхолдер
let phIndex = 0;
ph.textContent = CONFIG.placeholders[0];
setInterval(() => {
  if (input.value || document.hidden) return;
  ph.classList.add("is-out");
  setTimeout(() => {
    phIndex = (phIndex + 1) % CONFIG.placeholders.length;
    ph.textContent = CONFIG.placeholders[phIndex];
    ph.classList.remove("is-out");
  }, reduced.matches ? 0 : 350);
}, 3400);

initEffects({ stage: $("#top"), chat: $("#chat"), input, log, fab });
dialog.start();
