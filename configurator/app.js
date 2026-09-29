// Сборка страницы «Конструктор ПК»: состояние выбора, рендер шагов/итога, совместимость, оплата частями, Telegram.
import { CATALOG, CATALOG_META, STEPS, FORM_LABEL, FORM_RANK, findPart, isRequired, loadCatalog, priceTier, TIER_LABEL } from "./data.js";
import { filterOptions, noPartAllowed, partFits, checkCompat, recommendedWatt } from "./compat.js";
import { splitPrice, INSTALLMENT_MONTHS, CREDIT_ANNUAL_RATE } from "./installment.js";
import { UPSELL } from "./upsell.js";
import { estimateFps, fpsLevel, RESOLUTIONS } from "./fps.js";
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
let catalogReady = false;
let installmentMonths = INSTALLMENT_MONTHS[0];
const extras = new Set(); // отмеченные допы (id из UPSELL) — уходят консультанту в сообщении
let extrasOffered = false; // окно «Добавим к сборке?» показываем один раз на сборку (до «Начать заново»)
let wasComplete = false;
let fpsRes = 0; // разрешение в блоке FPS: 0 — Full HD, 1 — 2K, 2 — 4K

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
// Каталог большой (сотни позиций в категории), поэтому варианты рисуются только у раскрытого шага,
// порциями по PAGE, с поиском и быстрыми фильтрами-чипами (FACETS).
const stepsEl = $("#steps");
const stepEls = {};
const PAGE = 12;
const view = Object.fromEntries(STEPS.map((s) => [s.key, { q: "", facets: {}, limit: PAGE }]));

const gb = (n) => (n >= 1000 ? `${+(n / 1000).toFixed(1)} ТБ` : `${n} ГБ`);
const wattBand = (w) => (w < 600 ? "до 550 Вт" : w < 750 ? "600–700 Вт" : w < 900 ? "750–850 Вт" : "от 900 Вт");
// Быстрые фильтры: у каждого шага 1–2 ряда чипов. Показываются, только если среди подходящих вариантов есть выбор.
const FACETS = {
  cpu: [{ key: "brand", get: (p) => p.brand }, { key: "socket", get: (p) => p.socket }],
  motherboard: [{ key: "form", get: (p) => FORM_LABEL[p.form] || p.form }, { key: "mem", get: (p) => p.mem }],
  ram: [{ key: "cap", get: (p) => gb(p.cap), sort: (p) => p.cap }, { key: "rgb", get: (p) => (p.rgb ? "С подсветкой" : null) }],
  gpu: [{ key: "vendor", get: (p) => (p.vendor === "amd" ? "AMD Radeon" : p.vendor === "nvidia" ? "NVIDIA GeForce" : null) }, { key: "vram", get: (p) => (p.vram ? `${p.vram} ГБ` : null), sort: (p) => p.vram }],
  storage: [{ key: "cap", get: (p) => gb(p.cap), sort: (p) => p.cap }, { key: "iface", get: (p) => (p.iface === "nvme" ? "NVMe M.2" : p.form === "2.5" ? 'SATA 2.5"' : "SATA M.2") }],
  hdd: [{ key: "cap", get: (p) => gb(p.cap), sort: (p) => p.cap }],
  psu: [{ key: "watt", get: (p) => wattBand(p.watt), sort: (p) => p.watt }, { key: "rating", get: (p) => p.rating }],
  case: [{ key: "color", get: (p) => ({ white: "Белые", black: "Чёрные" })[p.color] || "Другие цвета" }, { key: "form", get: (p) => (p.form ? `до ${FORM_LABEL[p.form]}` : null), sort: (p) => FORM_RANK[p.form] }],
  cooler: [{ key: "type", get: (p) => (p.type === "aio" ? "Водяное охлаждение" : "Воздушное охлаждение") }, { key: "color", get: (p) => (p.color === "white" ? "Белые" : null) }],
};

/** Короткая строка характеристик под названием варианта */
function specLine(step, p) {
  const bits = {
    cpu: [p.socket, p.cores && `${p.cores} ядер`, p.tdp && `${p.tdp} Вт`, p.igpu === false ? "без графики" : "есть графика", p.boxCooler && "кулер в комплекте"],
    motherboard: [p.chipset, FORM_LABEL[p.form], p.mem && `${p.slots || ""}×${p.mem}`.replace(/^×/, ""), p.m2 ? `${p.m2}×M.2` : null],
    ram: [p.mem, p.cap && (p.sticks > 1 ? `${gb(p.cap)} (${p.sticks}×${gb(p.cap / p.sticks)})` : gb(p.cap)), p.mhz && `${p.mhz} МГц`, p.rgb && "подсветка"],
    gpu: [p.vram && `${p.vram} ГБ`, p.len && `длина ${p.len} мм`, p.psuRec && `БП от ${p.psuRec} Вт`],
    storage: [p.cap && gb(p.cap), p.iface === "nvme" ? "NVMe" : "SATA", p.form === "m2" ? "M.2" : '2.5"', p.read && `до ${p.read} МБ/с`],
    hdd: [p.cap && gb(p.cap), p.rpm && `${p.rpm} об/мин`],
    psu: [p.watt && `${p.watt} Вт`, p.rating, p.modular && "модульный"],
    case: [p.form && `до ${FORM_LABEL[p.form]}`, p.gpuMax && `видеокарта до ${p.gpuMax} мм`, p.coolerMax && `кулер до ${p.coolerMax} мм`],
    cooler: [p.type === "aio" ? (p.rad ? `водяное охлаждение ${p.rad} мм` : "водяное охлаждение") : p.towers > 1 ? "двухбашенный" : p.lowProfile ? "низкопрофильный" : "башенный", p.tdp && `до ${p.tdp} Вт`, p.type !== "aio" && p.height && `высота ${p.height} мм`],
  }[step];
  return (bits || []).filter(Boolean).join(" · ");
}

function partMeta(step, part) {
  const tags = [];
  if (step === "psu" && recommendedWatt(sel) && part.watt >= recommendedWatt(sel) + 150) tags.push('<span class="tag tag--ok">С запасом по мощности</span>');
  return tags.join("");
}

// Уровень цены точками — только когда у товара есть цена (пока прайс без цен — не показываем)
function tierDots(step, part) {
  const t = priceTier(step, part);
  if (!t) return "";
  const dots = [1, 2, 3].map((i) => `<i class="${i <= t ? "on" : ""}"></i>`).join("");
  return `<span class="pc-tier" aria-label="${TIER_LABEL[t]}" title="${TIER_LABEL[t]}">${dots}</span>`;
}

const norm = (t) => t.toLowerCase().replace(/ё/g, "е");
function visibleOptions(step, parts) {
  const v = view[step];
  const words = norm(v.q).split(/\s+/).filter(Boolean);
  return parts.filter((p) => {
    for (const f of FACETS[step] || []) if (v.facets[f.key] && f.get(p) !== v.facets[f.key]) return false;
    if (!words.length) return true;
    const hay = p._hay || (p._hay = norm(`${p.name} ${p.full} ${p.id}`));
    return words.every((w) => hay.includes(w));
  });
}

function facetRows(step, parts) {
  const rows = [];
  for (const f of FACETS[step] || []) {
    const counts = new Map();
    for (const p of parts) {
      const val = f.get(p);
      if (val == null) continue;
      const cur = counts.get(val) || { n: 0, order: f.sort ? f.sort(p) : val };
      cur.n++;
      counts.set(val, cur);
    }
    if (counts.size < 2 && !view[step].facets[f.key]) continue;
    const vals = [...counts.entries()].sort((a, b) => (a[1].order > b[1].order ? 1 : a[1].order < b[1].order ? -1 : 0));
    const row = el("div", "pc-facets");
    for (const [val] of vals) {
      const on = view[step].facets[f.key] === val;
      const chip = el("button", "pc-chip" + (on ? " is-on" : ""));
      chip.type = "button";
      chip.textContent = val;
      chip.setAttribute("aria-pressed", String(on));
      chip.addEventListener("click", () => {
        view[step].facets[f.key] = on ? undefined : val;
        view[step].limit = PAGE;
        renderSteps({ keepFocus: false });
      });
      row.appendChild(chip);
    }
    rows.push(row);
  }
  return rows;
}

function optionButton(s, p) {
  const opt = el("button", "pc-option" + (sel[s.key] === p.id ? " is-selected" : ""));
  opt.type = "button";
  opt.innerHTML = `<span class="pc-option__ico"><svg class="ico" aria-hidden="true"><use href="#i-${s.icon}"/></svg></span>
    <span class="pc-option__mid"><span class="pc-option__name"></span><span class="pc-option__spec"></span><span class="pc-option__meta">${partMeta(s.key, p)}</span></span>
    ${tierDots(s.key, p)}
    <span class="pc-option__check"><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg></span>`;
  opt.querySelector(".pc-option__name").textContent = p.name;
  opt.querySelector(".pc-option__spec").textContent = specLine(s.key, p);
  opt.addEventListener("click", () => choose(s.key, p.id));
  return opt;
}

function renderStepBody(s) {
  const body = el("div", "pc-step__body");
  const inner = el("div", "pc-step__inner");
  body.appendChild(inner);
  if (openStep !== s.key) return body; // закрытые шаги — без вариантов (их сотни)
  if (!catalogReady) {
    inner.appendChild(el("p", "pc-empty", "Загружаем каталог комплектующих…"));
    return body;
  }
  const all = filterOptions(s.key, sel);
  const hiddenCount = CATALOG[s.key].length - all.length;
  const v = view[s.key];

  if (all.length > PAGE || v.q) {
    const search = el("label", "pc-search", `<svg class="ico" aria-hidden="true"><use href="#i-search"/></svg><input type="search" placeholder="Поиск: модель, бренд или код" autocomplete="off" enterkeyhint="search">`);
    const input = search.querySelector("input");
    input.value = v.q;
    input.setAttribute("aria-label", `Поиск: ${s.title.toLowerCase()}`);
    input.addEventListener("input", () => {
      v.q = input.value;
      v.limit = PAGE;
      renderList();
    });
    inner.appendChild(search);
  }
  const facetsWrap = el("div", "pc-facets-wrap");
  inner.appendChild(facetsWrap);
  const list = el("div", "pc-options");
  inner.appendChild(list);
  const foot = el("div", "pc-list-foot");
  inner.appendChild(foot);

  function renderList() {
    facetsWrap.replaceChildren(...facetRows(s.key, all));
    const shown = visibleOptions(s.key, all);
    const items = [];
    if (!isRequired(s.key, sel) && noPartAllowed(s.key, sel) && s.noneLabel && !v.q) {
      const none = el("button", "pc-option" + (sel[s.key] === null && touched[s.key] ? " is-selected" : ""));
      none.type = "button";
      none.innerHTML = `<span class="pc-option__ico"><svg class="ico" aria-hidden="true"><use href="#i-box"/></svg></span>
        <span class="pc-option__mid"><span class="pc-option__name">${s.noneLabel}</span><span class="pc-option__spec">${s.noneHint}</span></span>
        <span class="pc-option__check"><svg class="ico" aria-hidden="true"><use href="#i-check"/></svg></span>`;
      none.addEventListener("click", () => choose(s.key, null));
      items.push(none);
    }
    // выбранный вариант держим первым, даже если он дальше первой страницы
    const selected = shown.find((p) => p.id === sel[s.key]);
    const page = shown.filter((p) => p !== selected).slice(0, v.limit - (selected ? 1 : 0));
    if (selected) items.push(optionButton(s, selected));
    page.forEach((p) => items.push(optionButton(s, p)));
    items.forEach((n, i) => n.style.setProperty("--oi", Math.min(i, 10)));
    list.replaceChildren(...items);

    foot.replaceChildren();
    const rest = shown.length - Math.min(shown.length, v.limit);
    if (rest > 0) {
      const more = el("button", "ghost pc-more", `Показать ещё ${Math.min(rest, PAGE)} <small>· осталось ${rest}</small>`);
      more.type = "button";
      more.addEventListener("click", () => {
        v.limit += PAGE;
        renderList();
      });
      foot.appendChild(more);
    }
    if (all.length === 0 && !(!isRequired(s.key, sel) && noPartAllowed(s.key, sel))) {
      foot.appendChild(el("p", "pc-empty", "Нет вариантов, подходящих к уже выбранным деталям — измените один из предыдущих шагов."));
    } else if (shown.length === 0) {
      foot.appendChild(el("p", "pc-empty", "По этому запросу ничего не нашлось — попробуйте иначе или сбросьте фильтры."));
    } else if (hiddenCount > 0) {
      foot.appendChild(el("p", "pc-empty", `Ещё ${hiddenCount} ${plural(hiddenCount)} скрыто — они не подходят к уже выбранным деталям.`));
    }
  }
  renderList();
  return body;
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
    head.setAttribute("aria-expanded", String(openStep === s.key));
    head.addEventListener("click", () => {
      openStep = openStep === s.key ? null : s.key;
      justOpened = openStep; // варианты только что раскрытого шага выйдут лесенкой (см. .is-opening в CSS)
      renderSteps();
    });
    wrap.appendChild(head);
    wrap.appendChild(renderStepBody(s));
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
    const req = isRequired(s.key, sel);
    wrap.classList.toggle("is-open", openStep === s.key);
    wrap.classList.toggle("is-done", !!sel[s.key] || (!req && !!touched[s.key]));
    const part = findPart(s.key, sel[s.key]);
    $('[data-role="subtitle"]', wrap).textContent = part ? part.name : !req && touched[s.key] && s.noneLabel ? s.noneLabel : req ? "Не выбрано" : "Можно пропустить";
    $('[data-role="badge"]', wrap).textContent = part ? tierWord(s.key, part) : "";
  });
}
const tierWord = (step, part) => ({ 1: "Начальный", 2: "Средний", 3: "Топ" })[priceTier(step, part)] || "";

function choose(step, id) {
  sel[step] = id;
  touched[step] = true;
  scene.set(step, findPart(step, id));
  reconcile(step);
  // следующий ещё не заполненный шаг
  const idx = STEPS.findIndex((s) => s.key === step);
  const next = STEPS.slice(idx + 1).find((s) => !sel[s.key] && !touched[s.key]) || null;
  openStep = next?.key ?? null;
  justOpened = openStep;
  renderSteps();
  renderCompat();
  renderSummary();
  // сборка только что стала полной — предлагаем допы («картошечку к заказу?»), один раз на сборку
  const complete = isComplete();
  if (complete && !wasComplete && !extrasOffered) setTimeout(openExtras, motionOK ? 900 : 200);
  wasComplete = complete;
  // на телефоне — подвести к следующему шагу, чтобы не листать вручную
  if (openStep && motionOK) requestAnimationFrame(() => stepEls[openStep]?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
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
      if (sel[s.key] === null) {
        // явно выбранное «без детали» перестало быть допустимым (например, взяли процессор без графики)
        if (touched[s.key] && s.noneLabel && !noPartAllowed(s.key, sel)) {
          touched[s.key] = false;
          changed = true;
          cleared.push(s.title);
        }
        continue;
      }
      if (!partFits(s.key, findPart(s.key, sel[s.key]), sel)) {
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
const totalNote = $("#summaryNote");

INSTALLMENT_MONTHS.forEach((m) => {
  const b = el("button", "installment__tab" + (m === installmentMonths ? " is-active" : ""), `${m} мес.`);
  b.type = "button";
  b.addEventListener("click", () => {
    installmentMonths = m;
    renderSummary();
  });
  installmentTabs.appendChild(b);
});

// Итог считаем только если у всех выбранных деталей есть цена; пока прайс без цен — «по запросу».
function totals() {
  const parts = STEPS.map((s) => findPart(s.key, sel[s.key])).filter(Boolean);
  const priced = parts.length > 0 && parts.every((p) => p.price != null);
  return { parts, priced, total: priced ? Math.round(parts.reduce((a, p) => a + p.price, 0) * 100) / 100 : null };
}

function buildMessage(t, compat) {
  const lines = ["Здравствуйте! Собрал ПК в конструкторе на сайте:"];
  STEPS.forEach((s) => {
    const part = findPart(s.key, sel[s.key]);
    if (part) lines.push(`— ${s.title}: ${part.full || part.name} (код ${part.id})`);
    else if (touched[s.key] && s.noneLabel && !isRequired(s.key, sel)) lines.push(`— ${s.title}: ${s.noneLabel.toLowerCase()}`);
  });
  if (extras.size) lines.push(`— Ещё подобрать: ${extraList("word")}`);
  if (!t.parts.length) lines.push("(детали пока не выбраны)");
  else if (t.priced) lines.push(`Итого: ${t.total} BYN (ориентировочно)`);
  else lines.push("Подскажите, пожалуйста, итоговую цену и наличие.");
  if (!compat.ok) lines.push("Есть предупреждения о совместимости — прошу проверить.");
  const src = sourceLine();
  if (src) lines.push(src);
  return lines.join("\n");
}

let shownRows = new Set();
let shownTotal = null;
function renderSummary() {
  const t = totals();
  const rowKeys = new Set();
  rowsEl.replaceChildren(
    ...STEPS.map((s) => ({ step: s, part: findPart(s.key, sel[s.key]) }))
      .filter((x) => x.part)
      .map((x) => {
        const key = `${x.step.key}:${x.part.id}`;
        rowKeys.add(key);
        const li = el("li", shownRows.has(key) ? "" : "is-new"); // новая/сменённая деталь «вписывается» в сводку
        li.innerHTML = `<span class="k"></span><span class="v"></span>`;
        li.querySelector(".k").textContent = x.step.title;
        const v = li.querySelector(".v");
        if (x.part.price != null) v.textContent = `${x.part.price} BYN`;
        else {
          // без цены справа показываем название целиком: подпись шага сверху, название под ней на всю ширину
          li.classList.add("is-name");
          v.classList.add("v--name");
          v.textContent = x.part.name;
        }
        return li;
      }),
    ...(extras.size ? [extrasRow()] : []),
  );
  totalEl.textContent = !t.parts.length ? "0 BYN" : t.priced ? `${t.total} BYN` : "По запросу";
  totalEl.classList.toggle("is-ask", t.parts.length > 0 && !t.priced);
  totalNote.hidden = !(t.parts.length > 0 && !t.priced);
  shownRows = rowKeys;
  const key = t.priced ? t.total : t.parts.length;
  if (key !== shownTotal && motionOK && t.parts.length) {
    // итог изменился — короткая вспышка (перезапуск CSS-анимации)
    totalEl.classList.remove("is-bump");
    void totalEl.offsetWidth;
    totalEl.classList.add("is-bump");
  }
  shownTotal = key;

  const compat = checkCompat(sel);
  installmentBox.hidden = !t.priced;
  if (t.priced) {
    [...installmentTabs.children].forEach((b, i) => b.classList.toggle("is-active", INSTALLMENT_MONTHS[i] === installmentMonths));
    const { perMonth, overpay } = splitPrice(t.total, installmentMonths);
    installmentResult.textContent = `≈ ${perMonth} BYN / мес.`;
    installmentNote.textContent = `Переплата за весь срок — ≈ ${overpay} BYN. Это кредит, ставка ${(CREDIT_ANNUAL_RATE * 100).toFixed(2)}% годовых; точные условия — у банка-партнёра.`;
  }

  const message = buildMessage(t, compat);
  sendBtn.href = telegramUrl(message);
  sendBtn.querySelector("span").textContent = !t.parts.length ? "Написать консультанту" : !compat.ok ? "Отправить (есть предупреждения)" : t.priced ? "Отправить консультанту в Telegram" : "Узнать цену у консультанта";
  sendBtn.dataset.message = message;

  const requiredFilled = isComplete();
  upsellBox.hidden = !requiredFilled;
  syncUpsell();
  renderFps(requiredFilled);
}
const isComplete = () => STEPS.filter((s) => isRequired(s.key, sel)).every((s) => sel[s.key]);
const extraList = (field) => UPSELL.filter((u) => extras.has(u.id)).map((u) => u[field]).join(", ");
function extrasRow() {
  const li = el("li", "is-name is-extra", `<span class="k">Дополнительно подобрать</span><span class="v v--name"></span>`);
  li.querySelector(".v").textContent = extraList("title");
  return li;
}

// ——— примерный FPS в популярных играх (готовая сборка) ———
const fpsBox = $("#fps");
const fpsList = $("#fpsList");
const fpsSub = $("#fpsSub");
const fpsResEl = $("#fpsRes");
const fpsNote = $("#fpsNote");
const fpsNoteText = fpsNote.textContent;
RESOLUTIONS.forEach((r) => {
  const b = el("button", "pc-chip", `${r.label}`);
  b.type = "button";
  b.title = r.hint;
  b.addEventListener("click", () => {
    fpsRes = r.key;
    renderFps(true);
  });
  fpsResEl.appendChild(b);
});
let fpsShown = false;
function renderFps(complete) {
  fpsBox.hidden = !complete;
  if (!complete) {
    fpsShown = false;
    return;
  }
  if (!fpsShown) {
    fpsShown = true;
    sr(fpsBox, "card");
  }
  const gpu = findPart("gpu", sel.gpu);
  const rows = gpu ? estimateFps(gpu, fpsRes) : null;
  [...fpsResEl.children].forEach((b, i) => {
    b.classList.toggle("is-on", i === fpsRes);
    b.setAttribute("aria-pressed", String(i === fpsRes));
  });
  fpsResEl.hidden = !rows;
  fpsSub.textContent = gpu ? `С видеокартой ${gpu.name} · под названием игры — настройки графики` : "Сборка без видеокарты";
  fpsNote.textContent = !gpu
    ? "Без видеокарты FPS в играх не оцениваем: встроенной графики хватит для учёбы, работы и нетребовательных игр. Для современных игр добавьте видеокарту."
    : !rows
      ? "Для этой видеокарты оценки пока нет — консультант подскажет, как она покажет себя в играх."
      : gpu.pro
        ? `Это профессиональная видеокарта — она рассчитана на работу, а не на игры. ${fpsNoteText}`
        : fpsNoteText;
  fpsList.replaceChildren(
    ...(rows || []).map((g) => {
      const { level, label } = fpsLevel(g.fps);
      const li = el("li", `lvl-${level}`);
      li.innerHTML = `<span class="pc-fps__game"><b></b><small></small></span><span class="pc-fps__bar" aria-hidden="true"><i></i></span><span class="pc-fps__num"><b></b><small>FPS</small></span>`;
      li.querySelector(".pc-fps__game b").textContent = g.name;
      li.querySelector(".pc-fps__game small").textContent = `${g.preset[0].toUpperCase()}${g.preset.slice(1)} · ${label}`;
      li.querySelector(".pc-fps__num b").textContent = `~${g.fps}`;
      li.querySelector(".pc-fps__bar i").style.setProperty("--w", `${Math.max(4, Math.min(100, (g.fps / 240) * 100))}%`);
      return li;
    }),
  );
}

// ——— допы: окно «Сборка готова! Добавим к ней?» и карточки под конструктором ———
const extrasDlg = $("#extras");
const extrasGrid = $("#extrasGrid");
const extrasAdd = $("#extrasAdd");
let pending = new Set();
function extraToggle(u, on, onClick, cls) {
  const b = el("button", `${cls}${on ? " is-on" : ""}`, `<span class="pc-upsell__icowrap"><svg class="ico" aria-hidden="true"><use href="#i-${u.icon}"/></svg></span><span class="pc-extra__txt"><b></b><small></small></span><span class="pc-extra__check" aria-hidden="true"><svg class="ico"><use href="#i-check"/></svg></span>`);
  b.type = "button";
  b.dataset.extra = u.id;
  b.setAttribute("aria-pressed", String(on));
  b.querySelector("b").textContent = u.title;
  b.querySelector("small").textContent = u.desc;
  b.addEventListener("click", onClick);
  return b;
}
function renderExtrasGrid() {
  extrasGrid.replaceChildren(
    ...UPSELL.map((u) =>
      extraToggle(u, pending.has(u.id), () => {
        pending.has(u.id) ? pending.delete(u.id) : pending.add(u.id);
        renderExtrasGrid();
      }, "pc-extra"),
    ),
  );
  extrasAdd.disabled = pending.size === 0;
  extrasAdd.textContent = pending.size ? `Добавить к сборке (${pending.size})` : "Отметьте, что добавить";
}
function openExtras() {
  if (extrasOffered || !isComplete() || extrasDlg.open || typeof extrasDlg.showModal !== "function") return;
  extrasOffered = true;
  pending = new Set(extras);
  renderExtrasGrid();
  extrasDlg.showModal();
  document.documentElement.classList.add("has-dialog");
}
extrasDlg.addEventListener("click", (e) => {
  if (e.target === extrasDlg) extrasDlg.close("skip"); // клик по затемнению вокруг окна
});
// применяем сразу по нажатию (событие close приходит позже — ссылка на Telegram должна обновиться до этого)
extrasAdd.addEventListener("click", () => {
  if (!pending.size) return;
  pending.forEach((id) => extras.add(id));
  renderSummary();
  toast(`Добавили в заявку: ${extraList("word")} — консультант подберёт варианты.`);
});
extrasDlg.addEventListener("close", () => document.documentElement.classList.remove("has-dialog"));
function syncUpsell() {
  document.querySelectorAll("#upsellGrid [data-extra]").forEach((b) => {
    const on = extras.has(b.dataset.extra);
    b.classList.toggle("is-on", on);
    b.setAttribute("aria-pressed", String(on));
  });
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
    view[s.key] = { q: "", facets: {}, limit: PAGE };
    scene.set(s.key, null);
  });
  extras.clear();
  extrasOffered = false;
  wasComplete = false;
  openStep = STEPS[0].key;
  renderSteps();
  renderCompat();
  renderSummary();
});

// ——— апсейл ———
// карточки-переключатели: отмеченное добавляется в сводку и в сообщение консультанту
$("#upsellGrid").replaceChildren(
  ...UPSELL.map((u) => {
    const c = extraToggle(u, false, () => {
      extras.has(u.id) ? extras.delete(u.id) : extras.add(u.id);
      renderSummary();
    }, "pc-upsell__card");
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
loadCatalog()
  .then(() => {
    catalogReady = true;
    renderSteps();
  })
  .catch((e) => {
    console.warn("Каталог не загрузился:", e);
    stepsEl.prepend(el("p", "pc-empty", "Не удалось загрузить каталог — обновите страницу или напишите консультанту."));
  });
