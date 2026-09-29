// Сборка страницы «Конструктор ПК»: состояние выбора, рендер шагов/итога, совместимость, оплата частями, Telegram.
import { CATALOG, STEPS, findPart, stockLabel, STOCK, priceTier, TIER_LABEL } from "./data.js";
import { filterOptions, noPartAllowed, partFits, checkCompat } from "./compat.js";
import { splitPrice, INSTALLMENT_MONTHS, CREDIT_ANNUAL_RATE } from "./installment.js";
import { UPSELL } from "./upsell.js";
import { sourceLine, telegramUrl } from "../js/engine.js";
import { createScene } from "./scene.js";

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

// ——— состояние ———
const sel = Object.fromEntries(STEPS.map((s) => [s.key, null]));
const touched = {}; // отметить необязательные шаги, где явно выбрали «без детали» (сейчас — только gpu)
let openStep = STEPS[0].key;
let installmentMonths = INSTALLMENT_MONTHS[0];

// ——— появление блоков при прокрутке (.sr, стили — css/configurator.css) ———
// Каждый блок анимируется один раз. Шаги конструктора перерисовываются при каждом клике, поэтому
// уже показанные шаги запоминаем по ключу и новые их копии вставляем без анимации.
const motionOK = "IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealedSteps = new Set();
const srIO = motionOK
  ? new IntersectionObserver(
      (entries) => {
        // кто появился в одной «пачке» — выходит лесенкой
        entries
          .filter((e) => e.isIntersecting)
          .forEach((e, k) => {
            const t = e.target;
            t.style.setProperty("--sr-i", Math.min(k, 6));
            t.classList.add("in");
            if (t.dataset.step) revealedSteps.add(t.dataset.step);
            srIO.unobserve(t);
          });
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    )
  : null;
function sr(node, variant) {
  node.classList.add("sr");
  if (variant) node.classList.add(`sr--${variant}`);
  if (srIO) srIO.observe(node);
  else node.classList.add("in");
}
document.querySelectorAll(".sr").forEach((n) => (srIO ? srIO.observe(n) : n.classList.add("in")));

// 3D-сцена (three.js ~650 КБ + аддоны bloom/геометрии) грузится не сразу, а после загрузки страницы —
// иначе её загрузка и инициализация задерживают первую отрисовку текста (LCP).
// Прокси копит вызовы .set() до готовности; если WebGL недоступен, createScene сама
// подставит облегчённую CSS-версию (см. configurator/scene.js).
const idle = (cb) => ("requestIdleCallback" in window ? requestIdleCallback(cb, { timeout: 1200 }) : setTimeout(cb, 200));
// Ждём полной загрузки страницы и ещё ~1.2 с — пока проиграется появление заголовка (он и есть LCP), и только потом
// тянем three.js и аддоны: так тяжёлые модули не конкурируют с первой отрисовкой текста (LCP).
const afterLoad = (cb) => {
  const go = () => setTimeout(() => idle(cb), 1200);
  if (document.readyState === "complete") go();
  else addEventListener("load", go, { once: true });
};
class SceneProxy {
  constructor(rootEl) {
    this.queue = [];
    this.impl = null;
    afterLoad(() => {
      createScene(rootEl).then((impl) => {
        this.impl = impl;
        this.queue.forEach(([k, v]) => impl.set(k, v));
        this.queue = [];
      });
    });
  }
  set(key, filled) {
    if (this.impl) this.impl.set(key, filled);
    else this.queue.push([key, filled]);
  }
}
const scene = new SceneProxy($("#scene"));

// ——— вкладки «Собрать самому» / «Подбор с ИИ» ———
const tabs = { build: $("#tab-build"), ai: $("#tab-ai") };
const panels = { build: $("#build"), ai: $("#ai") };
function selectTab(name) {
  for (const k of Object.keys(tabs)) {
    tabs[k].classList.toggle("is-active", k === name);
    tabs[k].setAttribute("aria-selected", String(k === name));
    panels[k].hidden = k !== name;
  }
}
tabs.build.addEventListener("click", () => selectTab("build"));
tabs.ai.addEventListener("click", () => selectTab("ai"));

// ——— шаги и карточки выбора ———
const stepsEl = $("#steps");
const stepEls = {};

function partMeta(step, part) {
  const tags = [];
  if (part.demo) tags.push('<span class="tag tag--demo">Демо</span>');
  else if (part.stock === STOCK.OUT) tags.push('<span class="tag tag--out">Нет в наличии</span>');
  else if (part.stock === STOCK.LOW || part.stock === STOCK.ONE) tags.push(`<span class="tag tag--low">${stockLabel(part.stock)}</span>`);
  if (step === "psu") tags.push(`<span class="tag">${part.watt} Вт</span>`);
  if (step === "ram") tags.push(`<span class="tag">${part.ram}</span>`);
  if (step === "cooler" && part.type === "aio") tags.push('<span class="tag">СЖО</span>');
  return tags.join("");
}

// Точной цены в списке нет намеренно — только относительный уровень (см. data.js: priceTier)
function tierDots(step, part) {
  const t = priceTier(step, part);
  const dots = [1, 2, 3].map((i) => `<i class="${i <= t ? "on" : ""}"></i>`).join("");
  return `<span class="pc-tier" aria-label="${TIER_LABEL[t]}" title="${TIER_LABEL[t]}">${dots}</span>`;
}

let justOpened = null;
function renderSteps() {
  STEPS.forEach((s) => {
    const wrap = el("div", "pc-step" + (openStep === s.key ? " is-open" : "") + (justOpened === s.key && motionOK ? " is-opening" : ""));
    wrap.dataset.step = s.key;
    const head = el(
      "button",
      "pc-step__head",
      `<span class="pc-step__ico"><svg class="ico" aria-hidden="true"><use href="#i-${s.icon}"/></svg></span>
       <span class="pc-step__title"><b>${s.title}</b><span data-role="subtitle"></span></span>
       <span class="pc-step__badge" data-role="badge"></span>
       <svg class="ico pc-step__chev" aria-hidden="true"><use href="#i-down"/></svg>`,
    );
    head.type = "button";
    head.addEventListener("click", () => {
      openStep = openStep === s.key ? null : s.key;
      justOpened = openStep; // варианты только что раскрытого шага выйдут лесенкой (см. .is-opening в CSS)
      renderSteps();
    });
    wrap.appendChild(head);

    const body = el("div", "pc-step__body");
    const list = el("div", "pc-options");
    const parts = filterOptions(s.key, sel);
    const hiddenCount = CATALOG[s.key].length - parts.length;

    if (!s.required && noPartAllowed(s.key, sel)) {
      const none = el("button", "pc-option" + (sel[s.key] === null && touched[s.key] ? " is-selected" : ""));
      none.type = "button";
      none.innerHTML = `<span class="pc-option__ico"><svg class="ico" aria-hidden="true"><use href="#i-box"/></svg></span>
        <span class="pc-option__mid"><span class="pc-option__name">Без видеокарты</span><span class="pc-option__meta"><span class="tag">Хватит встроенной графики</span></span></span>
        <span class="pc-option__check"><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg></span>`;
      none.addEventListener("click", () => choose(s.key, null));
      list.appendChild(none);
    }
    parts.forEach((p) => {
      const opt = el("button", "pc-option" + (sel[s.key] === p.id ? " is-selected" : ""));
      opt.type = "button";
      opt.innerHTML = `<span class="pc-option__ico"><svg class="ico" aria-hidden="true"><use href="#i-${s.icon}"/></svg></span>
        <span class="pc-option__mid"><span class="pc-option__name">${p.name}</span><span class="pc-option__meta">${partMeta(s.key, p)}</span></span>
        ${tierDots(s.key, p)}
        <span class="pc-option__check"><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg></span>`;
      opt.addEventListener("click", () => choose(s.key, p.id));
      list.appendChild(opt);
    });
    if (parts.length === 0 && !(!s.required && noPartAllowed(s.key, sel))) {
      list.appendChild(el("p", "pc-empty", "Нет вариантов, подходящих к уже выбранным деталям — измените один из предыдущих шагов."));
    } else if (hiddenCount > 0) {
      list.appendChild(el("p", "pc-empty", `Ещё ${hiddenCount} ${plural(hiddenCount)} скрыто — они не подходят к уже выбранным деталям.`));
    }
    [...list.children].forEach((n, i) => n.style.setProperty("--oi", Math.min(i, 10)));
    body.appendChild(list);
    wrap.appendChild(body);
    if (!revealedSteps.has(s.key)) {
      if (stepEls[s.key]) srIO?.unobserve(stepEls[s.key]);
      sr(wrap);
    }
    stepEls[s.key] = wrap;
  });
  stepsEl.replaceChildren(...STEPS.map((s) => stepEls[s.key]));
  justOpened = null;
  syncStepTexts();
}

function plural(n) {
  const m = n % 10;
  const t = n % 100;
  if (t >= 11 && t <= 14) return "вариантов";
  if (m === 1) return "вариант";
  if (m >= 2 && m <= 4) return "варианта";
  return "вариантов";
}

function syncStepTexts() {
  STEPS.forEach((s) => {
    const wrap = stepEls[s.key];
    wrap.classList.toggle("is-open", openStep === s.key);
    wrap.classList.toggle("is-done", !!sel[s.key] || (!s.required && touched[s.key]));
    const part = findPart(s.key, sel[s.key]);
    $('[data-role="subtitle"]', wrap).textContent = part ? part.name : s.required ? "Не выбрано" : "Можно пропустить";
    $('[data-role="badge"]', wrap).textContent = part ? tierWord(s.key, part) : "";
  });
}
const tierWord = (step, part) => ({ 1: "Начальный", 2: "Средний", 3: "Топ" }[priceTier(step, part)]);

function choose(step, id) {
  sel[step] = id;
  touched[step] = true;
  scene.set(step, findPart(step, id));
  reconcile(step);
  const idx = STEPS.findIndex((s) => s.key === step);
  openStep = STEPS[idx + 1]?.key ?? null;
  justOpened = openStep;
  renderSteps();
  renderCompat();
  renderSummary();
}

// Выбор одной детали иногда делает несовместимой уже выбранную деталь ДРУГОЙ категории
// (например, поставили слабый блок питания — мощная видеокарта уже не подходит).
// Здесь такие детали автоматически сбрасываются, а не остаются висеть с ошибкой.
function reconcile(justChosen) {
  const cleared = [];
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const s of STEPS) {
      if (s.key === justChosen) continue;
      if (s.key === "gpu") {
        if (sel.gpu === null && touched.gpu && !noPartAllowed("gpu", sel)) {
          touched.gpu = false;
          changed = true;
          cleared.push(s.title);
        } else if (sel.gpu !== null && !partFits("gpu", findPart("gpu", sel.gpu), sel)) {
          sel.gpu = null;
          touched.gpu = false;
          scene.set("gpu", null);
          changed = true;
          cleared.push(s.title);
        }
        continue;
      }
      if (sel[s.key] !== null && !partFits(s.key, findPart(s.key, sel[s.key]), sel)) {
        sel[s.key] = null;
        delete touched[s.key];
        scene.set(s.key, null);
        changed = true;
        cleared.push(s.title);
      }
    }
    if (!changed) break;
  }
  if (cleared.length) toast(`Пришлось сбросить: ${[...new Set(cleared)].join(", ")} — прежний вариант больше не подходит.`);
}

// ——— совместимость (страховка — при обычной работе интерфейса срабатывать не должна) ———
const compatHead = $("#compatHead");
const compatText = $("#compatText");
const compatList = $("#compatList");
function renderCompat() {
  const r = checkCompat(sel);
  const hasAny = Object.values(sel).some(Boolean);
  compatHead.className = "compat__head " + (!hasAny ? "is-ok" : r.issues.some((i) => i.level === "error") ? "is-error" : r.issues.length ? "is-warning" : "is-ok");
  const iconId = compatHead.classList.contains("is-ok") ? "check" : "warn";
  compatHead.querySelector("use").setAttribute("href", `#i-${iconId}`);
  compatText.textContent = !hasAny ? "Выбирайте детали — конструктор сам покажет только совместимые" : r.issues.length === 0 ? "Все выбранные детали совместимы" : "Обнаружены несостыковки — проверьте отмеченные шаги";
  compatList.replaceChildren();
  compatList.hidden = r.issues.length === 0;
  r.issues.forEach((iss) => {
    const li = el("li", "is-" + iss.level, `<svg class="ico" aria-hidden="true"><use href="#i-warn"/></svg><span></span>`);
    li.querySelector("span").textContent = iss.text;
    compatList.appendChild(li);
  });
  return r;
}

// ——— итог, оплата частями, отправка ———
const rowsEl = $("#summaryRows");
const totalEl = $("#summaryTotal");
const installmentBox = $("#installment");
const installmentTabs = $("#installmentTabs");
const installmentResult = $("#installmentResult");
const installmentNote = $("#installmentNote");
const sendBtn = $("#pcSend");
const upsellBox = $("#upsell");

INSTALLMENT_MONTHS.forEach((m) => {
  const b = el("button", "installment__tab" + (m === installmentMonths ? " is-active" : ""), `${m} мес.`);
  b.type = "button";
  b.addEventListener("click", () => {
    installmentMonths = m;
    renderSummary();
  });
  installmentTabs.appendChild(b);
});

function buildMessage(total, compat) {
  const lines = ["Здравствуйте! Собрал ПК в конструкторе на сайте:"];
  STEPS.forEach((s) => {
    const part = findPart(s.key, sel[s.key]);
    if (part) lines.push(`— ${s.title}: ${part.name}`);
  });
  if (!STEPS.some((s) => findPart(s.key, sel[s.key]))) lines.push("(детали пока не выбраны)");
  lines.push(`Итого: ${total} BYN (ориентировочно)`);
  if (!compat.ok) lines.push("Есть предупреждения о совместимости — прошу проверить.");
  const src = sourceLine();
  if (src) lines.push(src);
  return lines.join("\n");
}

let shownRows = new Set();
let shownTotal = 0;
function renderSummary() {
  const parts = STEPS.map((s) => ({ step: s, part: findPart(s.key, sel[s.key]) }));
  const rowKeys = new Set();
  rowsEl.replaceChildren(
    ...parts
      .filter((x) => x.part)
      .map((x) => {
        const key = `${x.step.key}:${x.part.id}`;
        rowKeys.add(key);
        const li = el("li", shownRows.has(key) ? "" : "is-new"); // новая/сменённая деталь «вписывается» в сводку
        li.innerHTML = `<span class="k">${x.step.title}</span><span class="v">${x.part.price} BYN${x.part.demo ? "<small>демо-цена</small>" : ""}</span>`;
        return li;
      }),
  );
  const total = parts.reduce((sum, x) => sum + (x.part ? x.part.price : 0), 0);
  totalEl.textContent = `${total} BYN`;
  shownRows = rowKeys;
  if (total !== shownTotal && motionOK) {
    // сумма изменилась — короткая вспышка (перезапуск CSS-анимации)
    totalEl.classList.remove("is-bump");
    void totalEl.offsetWidth;
    totalEl.classList.add("is-bump");
  }
  shownTotal = total;

  const compat = checkCompat(sel);
  installmentBox.hidden = total === 0;
  if (total > 0) {
    [...installmentTabs.children].forEach((b, i) => b.classList.toggle("is-active", INSTALLMENT_MONTHS[i] === installmentMonths));
    const { perMonth, overpay } = splitPrice(total, installmentMonths);
    installmentResult.textContent = `≈ ${perMonth} BYN / мес.`;
    installmentNote.textContent = `Переплата за весь срок — ≈ ${overpay} BYN. Это кредит, ставка ${(CREDIT_ANNUAL_RATE * 100).toFixed(2)}% годовых; точные условия — у банка-партнёра.`;
  }

  const message = buildMessage(total, compat);
  sendBtn.href = telegramUrl(message);
  sendBtn.querySelector("span").textContent = total === 0 ? "Написать консультанту" : !compat.ok ? "Отправить (есть предупреждения)" : "Отправить консультанту в Telegram";
  sendBtn.dataset.message = message;

  const requiredFilled = STEPS.filter((s) => s.required).every((s) => sel[s.key]);
  upsellBox.hidden = !requiredFilled;
}

sendBtn.addEventListener("click", async () => {
  const text = sendBtn.dataset.message || "";
  try {
    await navigator.clipboard.writeText(text);
    toast("Текст запроса скопирован — если он не появился в чате, просто вставьте его");
  } catch {
    /* буфер недоступен — ничего страшного, ссылка всё равно откроется */
  }
});

$("#pcReset").addEventListener("click", () => {
  STEPS.forEach((s) => {
    sel[s.key] = null;
    delete touched[s.key];
    scene.set(s.key, null);
  });
  openStep = STEPS[0].key;
  renderSteps();
  renderCompat();
  renderSummary();
});

// ——— апсейл ———
$("#upsellGrid").replaceChildren(
  ...UPSELL.map((u) => {
    const c = el("div", "pc-upsell__card", `<span class="pc-upsell__icowrap"><svg class="ico" aria-hidden="true"><use href="#i-${u.icon}"/></svg></span><h3>${u.title}</h3><p>${u.desc}</p>`);
    sr(c, "card");
    return c;
  }),
);

// ——— тост (свой, независимый от главной страницы) ———
const toastEl = $("#toast");
let toastTimer;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("is-on"), 5200);
}

// ——— вкладка «Подбор с ИИ» (заглушка Soon, пересылка живому консультанту) ———
const aiForm = $("#aiForm");
const aiInput = $("#aiInput");
const aiLog = $("#aiLog");
aiForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = aiInput.value.trim();
  if (!text) return;
  aiInput.value = "";
  aiLog.appendChild(el("div", "msg msg--user", `<span class="bubble"></span>`)).querySelector(".bubble").textContent = text;
  aiLog.scrollTo({ top: aiLog.scrollHeight, behavior: "smooth" });
  await new Promise((r) => setTimeout(r, 500));
  const msg = `Здравствуйте! Описание ПК из подбора с ИИ (пока в разработке): ${text}`;
  const src = sourceLine();
  const full = src ? `${msg}\n${src}` : msg;
  const bot = el("div", "msg msg--bot", `<span class="avatar" aria-hidden="true"></span><span class="bubble"></span>`);
  aiLog.appendChild(bot);
  const link = el("a", "key key--tg", `<svg class="ico" aria-hidden="true"><use href="#i-tg"/></svg><span>Отправить консультанту в Telegram</span>`);
  link.href = telegramUrl(full);
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.style.marginTop = "10px";
  bot.querySelector(".bubble").textContent = "Записал! Пока ИИ-подбор в разработке — передайте это сообщение консультанту вручную, он поможет с выбором.";
  bot.appendChild(link);
  aiLog.scrollTo({ top: aiLog.scrollHeight, behavior: "smooth" });
});

// ——— плавное появление блоков ———
if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && (e.target.classList.add("in"), io.unobserve(e.target))), { threshold: 0.15 });
  document.querySelectorAll(".reveal").forEach((n) => io.observe(n));
} else {
  document.querySelectorAll(".reveal").forEach((n) => n.classList.add("in"));
}

renderSteps();
renderCompat();
renderSummary();
