// Движок диалога: чистая логика без DOM. Всё отображение — через объект ui (см. chat-ui.js).
// Сценарии лежат в scenarios.js, настройки — в config.js.
import { CONFIG } from "../config.js";
import { CATEGORIES, NODES, PHRASES } from "../scenarios.js";

const catById = (id) => CATEGORIES.find((c) => c.id === id) || null;
const norm = (s) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const stripEnd = (s) => s.replace(/[\s.!,;]+$/u, "");

// Регулярки из основ слов собираем один раз
const MATCHERS = CATEGORIES.filter((c) => c.keywords.length).map((c) => ({
  id: c.id,
  re: new RegExp(c.keywords.map((k) => `(?:${k})`).join("|"), "iu"),
}));

/** Распознаёт категорию по свободному тексту. Побеждает слово, стоящее раньше в тексте. */
export function recognizeCategory(text) {
  const t = norm(text);
  let best = null;
  for (const m of MATCHERS) {
    const hit = m.re.exec(t);
    if (hit && (best === null || hit.index < best.index)) best = { id: m.id, index: hit.index };
  }
  return best ? best.id : null;
}

/** Метка источника из ?src=… (или пустая строка) */
export function sourceLine(search = location.search) {
  const raw = (new URLSearchParams(search).get("src") || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 60);
  if (!raw) return "";
  const label = CONFIG.sources[raw.toLowerCase()] || raw;
  return `Источник: ${label}`;
}

/** Собирает текст сообщения и строки для карточки «Ваш запрос» */
export function buildRequest(state, search) {
  const cat = catById(state.category);
  let text;
  const rows = [];
  if (cat && cat.id !== "other") {
    const phrases = state.answers.map((a) => a.phrase).filter(Boolean);
    text = `Здравствуйте! ${cat.request}${phrases.length ? ": " + phrases.join(", ") : ""}.`;
    rows.push({ param: "Категория", label: cat.title });
    state.answers.forEach((a) => rows.push({ param: a.param, label: a.label, nodeId: a.nodeId }));
    if (state.notes.length) {
      const notes = state.notes.join("; ");
      text += `\nПожелания: ${notes}`;
      rows.push({ param: "Пожелания", label: notes });
    }
  } else {
    const free = stripEnd(state.freeText || "");
    text = free ? `Здравствуйте! Хочу подобрать: ${free}.` : CONFIG.defaultMessage + ".";
    rows.push({ param: "Запрос", label: state.freeText || "—", nodeId: "other_text" });
  }
  const src = sourceLine(search);
  if (src) text += `\n${src}`;
  return { message: text, rows };
}

export const telegramUrl = (message) =>
  `https://t.me/${CONFIG.telegramUsername}?text=${encodeURIComponent(message)}`;

/** Запрос для кнопки «Написать консультанту», если диалог не пройден */
export function defaultRequest() {
  let message = CONFIG.defaultMessage;
  const src = sourceLine();
  if (src) message += `\n${src}`;
  return { message, url: telegramUrl(message) };
}

const fresh = () => ({ category: null, answers: [], notes: [], freeText: null, node: null, stage: "idle", pending: null, editing: false });

export class Dialog {
  /** hooks: { started(), reset(), category(id|null), done(request|null) } */
  constructor(ui, hooks = {}) {
    this.ui = ui;
    this.hooks = hooks;
    this.state = fresh();
    this.run = 0;
  }

  // Начало новой «ветки» логики: отменяет всё, что ещё печатается или ждёт ответа
  begin() {
    this.run += 1;
    this.ui.cancel();
    return this.run;
  }

  async bot(t, text) {
    const ok = await this.ui.bot(text);
    return ok && t === this.run;
  }

  async start() {
    const t = this.begin();
    await this.bot(t, PHRASES.greeting);
  }

  async restart() {
    this.run += 1;
    this.state = fresh();
    this.ui.clear();
    this.hooks.reset?.();
    this.hooks.category?.(null);
    this.hooks.done?.(null);
    await this.start();
  }

  request() {
    if (this.state.stage !== "summary") return null;
    const { message } = buildRequest(this.state);
    return { message, url: telegramUrl(message) };
  }

  // ——— Выбор категории (карточка или подтверждение распознанной) ———
  async pickCategory(id, { echo = true, notes = [] } = {}) {
    const cat = catById(id);
    if (!cat) return;
    const t = this.begin();
    this.state = { ...fresh(), category: id, notes };
    this.hooks.started?.();
    this.hooks.category?.(id);
    this.hooks.done?.(null);
    if (echo) this.ui.user(cat.userSays);
    if (!(await this.bot(t, cat.intro))) return;
    if (cat.link) return this.linkOut(t, cat);
    await this.ask(t, cat.start);
  }

  // Категория ведёт на отдельную страницу (сейчас — «Сборка ПК» → конструктор). Вместо вопросов — выбор:
  // открыть страницу или сразу написать консультанту с одной строкой запроса.
  async linkOut(t, cat) {
    this.state.stage = "flow";
    this.ui.chips(["Открыть конструктор", "Написать консультанту"], async (i) => {
      if (t !== this.run) return;
      if (i === 0) {
        this.ui.user("Открыть конструктор");
        location.href = CONFIG.configuratorUrl;
      } else {
        this.ui.user("Написать консультанту");
        await this.summary(this.begin());
      }
    });
  }

  async ask(t, nodeId, { edit = false } = {}) {
    const node = NODES[nodeId];
    this.state.node = nodeId;
    if (node.rich && !edit && !(await this.ui.rich(node.rich))) return;
    if (t !== this.run) return;
    if (!(await this.bot(t, node.say))) return;
    if (node.freeText) {
      this.state.stage = "await-text";
      this.ui.focusInput();
      return;
    }
    this.state.stage = "flow";
    this.showChips(t, node);
  }

  showChips(t, node) {
    this.ui.chips(node.options.map((o) => o.label), (i) => {
      if (t === this.run) this.choose(node, i);
    });
  }

  async choose(node, i, { echo = true } = {}) {
    const opt = node.options[i];
    const t = this.begin();
    if (echo) this.ui.user(opt.label);
    const nodeId = Object.keys(NODES).find((k) => NODES[k] === node);
    const answer = { nodeId, param: node.param, label: opt.label, phrase: opt.phrase };
    const at = this.state.answers.findIndex((a) => a.nodeId === nodeId);
    if (at >= 0) this.state.answers[at] = answer;
    else this.state.answers.push(answer);

    if (this.state.editing || opt.next === "summary") {
      this.state.editing = false;
      await this.summary(t);
    } else {
      await this.ask(t, opt.next);
    }
  }

  // ——— Итог ———
  async summary(t = this.begin()) {
    this.state.stage = "summary";
    this.state.editing = false;
    if (!(await this.bot(t, PHRASES.summary))) return;
    const { message, rows } = buildRequest(this.state);
    const url = telegramUrl(message);
    this.ui.summary(
      { rows, message, url },
      {
        edit: (nodeId) => this.editNode(nodeId),
        restart: () => this.restart(),
      },
    );
    this.hooks.done?.({ message, url });
  }

  async editNode(nodeId) {
    const t = this.begin();
    this.ui.staleSummary();
    this.hooks.done?.(null);
    this.state.editing = true;
    const node = NODES[nodeId];
    if (!node) return;
    if (node.freeText) this.state.freeText = null;
    await this.ask(t, nodeId, { edit: true });
  }

  // ——— Свободный ввод ———
  async handleText(raw) {
    const text = raw.trim();
    if (!text) return;
    const s = this.state;
    this.hooks.started?.();
    const rec = recognizeCategory(text);

    // Ждём текст для «Другое» (или правки этого поля)
    if (s.stage === "await-text") {
      const t = this.begin();
      this.ui.user(text);
      s.category = "other";
      s.freeText = text;
      s.editing = false;
      return this.summary(t);
    }

    // Идёт опрос: пробуем принять текст как ответ, иначе — как пожелание
    if (s.stage === "flow") {
      const node = NODES[s.node];
      const idx = node.options.findIndex((o) => norm(o.label) === norm(text));
      if (idx >= 0) return this.choose(node, idx);
      if (rec && rec !== s.category) return this.offerCategory(text, rec);
      const t = this.begin();
      this.ui.user(text);
      s.notes.push(text);
      if (!(await this.bot(t, PHRASES.noted))) return;
      this.showChips(t, node);
      return;
    }

    // Итог уже показан: дополняем запрос или предлагаем другую ветку
    if (s.stage === "summary") {
      if (rec && rec !== s.category && rec !== "other") return this.offerCategory(text, rec);
      const t = this.begin();
      this.ui.user(text);
      this.ui.staleSummary();
      if (s.category && s.category !== "other") s.notes.push(text);
      else s.freeText = s.freeText ? `${stripEnd(s.freeText)}; ${text}` : text;
      return this.summary(t);
    }

    // Начало разговора (или ожидаем подтверждение)
    if (rec && rec !== "other") return this.offerCategory(text, rec);
    const t = this.begin();
    this.ui.user(text);
    this.state = { ...fresh(), category: "other", freeText: text };
    this.hooks.category?.("other");
    if (!(await this.bot(t, PHRASES.unrecognized))) return;
    await this.summary(t);
  }

  async offerCategory(text, recId) {
    const cat = catById(recId);
    const t = this.begin();
    this.ui.user(text);
    this.state.stage = "confirm";
    this.state.pending = { id: recId, text };
    if (!(await this.bot(t, PHRASES.recognized(cat.title)))) return;
    this.ui.chips([PHRASES.recognizedYes, PHRASES.recognizedSkip], async (i) => {
      if (t !== this.run) return;
      const label = i === 0 ? PHRASES.recognizedYes : PHRASES.recognizedSkip;
      if (i === 0) {
        this.ui.user(label);
        await this.pickCategory(recId, { echo: false, notes: [text] });
      } else {
        const t2 = this.begin();
        this.ui.user(label);
        this.state = { ...fresh(), category: "other", freeText: text };
        this.hooks.category?.("other");
        await this.summary(t2);
      }
    });
  }
}
