// Отображение чата: пузыри, «печатает…», чипсы, карточки брендов и итога.
// Не знает про сценарии — только рисует то, что попросил движок (engine.js).
import { CONFIG } from "../config.js";

const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
const reduced = () => reducedQuery.matches;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const TG_ICON =
  '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9.78 15.6l-.4 4.2c.57 0 .82-.25 1.12-.54l2.7-2.58 5.6 4.1c1.03.57 1.76.27 2.04-.95l3.7-17.3c.34-1.53-.55-2.13-1.55-1.76L1.2 9.1C-.28 9.68-.26 10.5.94 10.87l5.56 1.73 12.9-8.13c.6-.4 1.16-.18.7.22"/></svg>';

export class ChatUI {
  constructor({ log, input, onSend }) {
    this.log = log;
    this.input = input;
    this.onSend = onSend;
    this.epoch = 0; // растёт при отмене — устаревшие асинхронные шаги ничего не рисуют
    this.chipsEl = null;
    this.summaryEl = null;
  }

  // ——— служебное ———
  scroll() {
    this.log.scrollTo({ top: this.log.scrollHeight, behavior: reduced() ? "auto" : "smooth" });
  }

  append(node) {
    this.log.appendChild(node);
    this.scroll();
    return node;
  }

  cancel() {
    this.epoch += 1;
    this.clearChips();
    this.log.querySelectorAll(".msg--typing").forEach((n) => n.remove());
  }

  clear() {
    this.cancel();
    this.log.innerHTML = "";
    this.summaryEl = null;
  }

  focusInput() {
    this.input.focus({ preventScroll: true });
  }

  // ——— сообщения ———
  typingDelay(len) {
    if (reduced()) return 40;
    const { min, max } = CONFIG.typing;
    return Math.round(min + (max - min) * Math.min(1, len / 120));
  }

  /** Сообщение помощника с индикатором и эффектом набора. false — если диалог сбросили. */
  async bot(text) {
    const ep = this.epoch;
    const typing = el("div", "msg msg--bot msg--typing");
    typing.innerHTML = '<span class="avatar" aria-hidden="true"></span><span class="bubble"><i class="dots" aria-hidden="true"><b></b><b></b><b></b></i></span>';
    this.append(typing);
    await wait(this.typingDelay(text.length));
    typing.remove();
    if (ep !== this.epoch) return false;

    const msg = el("div", "msg msg--bot");
    msg.innerHTML = '<span class="avatar" aria-hidden="true"></span>';
    const bubble = el("span", "bubble");
    // Для скринридера — обычный текст; визуальный «набор» скрыт от него, чтобы не читалось по буквам
    const sr = el("span", "sr-only", text);
    const vis = el("span", "tw");
    vis.setAttribute("aria-hidden", "true");
    const shown = el("span");
    const rest = el("span", "tw__rest", text);
    vis.append(shown, rest);
    bubble.append(sr, vis);
    msg.appendChild(bubble);
    this.append(msg);

    if (reduced()) {
      shown.textContent = text;
      rest.textContent = "";
    } else {
      const chars = [...text];
      const step = Math.max(1, Math.ceil(chars.length / 28));
      for (let i = step; ; i += step) {
        if (ep !== this.epoch) return false;
        const n = Math.min(i, chars.length);
        shown.textContent = chars.slice(0, n).join("");
        rest.textContent = chars.slice(n).join("");
        if (n >= chars.length) break;
        await wait(22);
      }
    }
    this.scroll();
    return ep === this.epoch;
  }

  user(text) {
    this.clearChips();
    const msg = el("div", "msg msg--user");
    msg.appendChild(el("span", "bubble", text));
    this.append(msg);
  }

  // ——— варианты ответа ———
  chips(labels, onPick) {
    this.clearChips();
    const wrap = el("div", "chips");
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Варианты ответа");
    labels.forEach((label, i) => {
      const b = el("button", "chip", label);
      b.type = "button";
      b.style.setProperty("--i", i);
      b.addEventListener("click", () => onPick(i), { once: true });
      wrap.appendChild(b);
    });
    this.chipsEl = this.append(wrap);
  }

  clearChips() {
    if (this.chipsEl) this.chipsEl.remove();
    this.chipsEl = null;
  }

  // ——— «богатое» сообщение: бренды из ассортимента ———
  async rich(data) {
    const ep = this.epoch;
    await wait(reduced() ? 0 : 250);
    if (ep !== this.epoch) return false;
    const box = el("div", "rich");
    box.appendChild(el("p", "rich__title", data.title));
    const row = el("div", "rich__row");
    data.items.forEach((b, i) => {
      const card = el("div", "brand" + (b.exclusive ? " brand--ex" : ""));
      card.style.setProperty("--i", i);
      card.appendChild(el("span", "brand__name", b.name));
      if (b.exclusive) card.appendChild(el("span", "brand__badge", "Эксклюзив в Strela"));
      row.appendChild(card);
    });
    box.appendChild(row);
    this.append(box);
    await wait(reduced() ? 0 : 200);
    return ep === this.epoch;
  }

  // ——— карточка «Ваш запрос» ———
  summary({ rows, message, url }, handlers) {
    const card = el("section", "summary");
    card.setAttribute("aria-label", "Ваш запрос");
    card.appendChild(el("h3", "summary__title", "Ваш запрос"));

    const list = el("ul", "summary__rows");
    rows.forEach((r) => {
      const li = el("li");
      li.appendChild(el("span", "k", r.param));
      li.appendChild(el("span", "v", r.label));
      if (r.nodeId) {
        const b = el("button", "row-edit", "Изменить");
        b.type = "button";
        b.setAttribute("aria-label", `Изменить: ${r.param}`);
        b.addEventListener("click", () => handlers.edit(r.nodeId));
        li.appendChild(b);
      }
      list.appendChild(li);
    });
    card.appendChild(list);

    const preview = el("p", "summary__preview", message);
    card.appendChild(preview);

    const actions = el("div", "summary__actions");
    const send = el("a", "key key--tg");
    send.href = url;
    send.target = "_blank";
    send.rel = "noopener noreferrer";
    send.innerHTML = `${TG_ICON}<span>Отправить консультанту в Telegram</span>`;
    send.addEventListener("click", () => this.onSend({ message, url }));
    actions.appendChild(send);

    const secondary = el("div", "summary__secondary");
    const edit = el("button", "ghost", "Изменить");
    edit.type = "button";
    edit.setAttribute("aria-pressed", "false");
    edit.addEventListener("click", () => {
      const on = card.classList.toggle("is-editing");
      edit.setAttribute("aria-pressed", String(on));
    });
    if (!rows.some((r) => r.nodeId)) edit.hidden = true;
    const restart = el("button", "ghost", "Начать заново");
    restart.type = "button";
    restart.addEventListener("click", () => handlers.restart());
    secondary.append(edit, restart);
    actions.appendChild(secondary);
    card.appendChild(actions);

    this.summaryEl = this.append(card);
  }

  /** Прошлый итог гасим, чтобы не путать с новым */
  staleSummary() {
    if (!this.summaryEl) return;
    this.summaryEl.classList.add("is-stale");
    this.summaryEl.setAttribute("inert", "");
    this.summaryEl = null;
  }
}
