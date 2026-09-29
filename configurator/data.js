// База комплектующих конструктора ПК.
// Сами товары лежат в configurator/catalog.json — он генерируется из прайса поставщика скриптом
//   node tools/build-catalog.mjs <прайс.xlsx>
// (названия, коды, цены — из прайса; технические характеристики — из прайса и выгрузки Onliner,
// см. content/components-facts.md). Руками catalog.json не правьте — перезапишется при следующей сборке.
//
// Здесь — шаги конструктора, загрузка каталога и мелкие помощники.

// Порядок шагов конструктора и подписи. required — обязателен ли шаг для «полной» сборки
// (для охлаждения это решается динамически: у BOX-процессора кулер уже в комплекте, см. isRequired).
export const STEPS = [
  { key: "cpu", title: "Процессор", icon: "cpu", required: true },
  { key: "motherboard", title: "Материнская плата", icon: "board", required: true },
  { key: "ram", title: "Оперативная память", icon: "ram", required: true },
  { key: "gpu", title: "Видеокарта", icon: "gpu", required: false, noneLabel: "Без видеокарты", noneHint: "Хватит встроенной графики" },
  { key: "storage", title: "Накопитель SSD", icon: "ssd", required: true },
  { key: "hdd", title: "Жёсткий диск", icon: "hdd", required: false, noneLabel: "Без жёсткого диска", noneHint: "Хватит SSD" },
  { key: "psu", title: "Блок питания", icon: "psu", required: true },
  { key: "case", title: "Корпус", icon: "case", required: true },
  { key: "cooler", title: "Охлаждение", icon: "cooler", required: true, noneLabel: "Кулер из комплекта", noneHint: "Процессор продаётся с кулером (BOX)" },
];

// Форм-фактор платы: чем больше, тем больше корпус нужен (если у корпуса нет точного списка поддерживаемых плат).
export const FORM_RANK = { ITX: 0, mATX: 1, ATX: 2, EATX: 3 };
export const FORM_LABEL = { ITX: "mini-ITX", mATX: "micro-ATX", ATX: "ATX", EATX: "E-ATX" };

export const CATALOG = Object.fromEntries(STEPS.map((s) => [s.key, []]));
export const CATALOG_META = { hasPrices: false, generated: null, source: null };
const index = {};
const tierCache = {};

export function setCatalog(json) {
  for (const s of STEPS) {
    CATALOG[s.key] = json.parts?.[s.key] || [];
    index[s.key] = new Map(CATALOG[s.key].map((p) => [p.id, p]));
    delete tierCache[s.key];
  }
  Object.assign(CATALOG_META, json.meta || {});
}

/** Каталог грузится отдельным JSON (~2000 позиций), чтобы не тормозить первую отрисовку страницы. */
export async function loadCatalog(url = new URL("./catalog.json", import.meta.url)) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`catalog.json: HTTP ${r.status}`);
  setCatalog(await r.json());
}

export const findPart = (step, id) => (id == null ? null : index[step]?.get(id) || null);

/** Обязателен ли шаг при текущем выборе: кулер не нужен, если процессор идёт в BOX-версии с кулером. */
export function isRequired(step, sel) {
  const s = STEPS.find((x) => x.key === step);
  if (step === "cooler") return !findPart("cpu", sel.cpu)?.boxCooler;
  return !!s?.required;
}

// Относительный уровень цены внутри категории (1..3) — вместо точной цены в списке выбора,
// чтобы не «продавать» ценником до итога. Пока в прайсе нет цен — возвращает null (точки не показываются).
export function priceTier(step, part) {
  if (part?.price == null) return null;
  if (!tierCache[step]) {
    const sorted = CATALOG[step].filter((p) => p.price != null).sort((a, b) => a.price - b.price);
    const n = sorted.length - 1 || 1;
    tierCache[step] = new Map(sorted.map((p, i) => [p.id, i / n]));
  }
  const t = tierCache[step].get(part.id) ?? 0;
  return t <= 0.34 ? 1 : t <= 0.67 ? 2 : 3;
}
export const TIER_LABEL = { 1: "Начальный уровень", 2: "Средний уровень", 3: "Топовый уровень" };
