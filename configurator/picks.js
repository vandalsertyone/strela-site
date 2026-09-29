// «Популярное»: что показывать первым в списке вариантов. История: 29.09.2026 заказчик — «в самом топе какое-то старое
// и непопулярное железо»; затем — «изучи топы по продажам в разных ценовых… самый топовый, который у нас просят, —
// Ryzen 7 7800X3D, выше него реально не запрашивали, пониже — 7700, i5 14-го поколения и т.д.».
//
// Данные о спросе: сортировка «Популярные» каталога Onliner (Беларусь; продажи он не публикует — это ближайший открытый
// показатель), снимок — tools/fetch-onliner-popularity.mjs → поле pop в catalog.json (место в рейтинге раздела, 1 — самый
// популярный). У корпусов ещё band — ценовой сегмент 1..3 по рыночной цене (границы — BANDS в build-catalog.mjs).
//
//  1. Весь список шага: сначала популярные (по pop), без рейтинга — после них по «свежести»; явно устаревшее (fresh = 0:
//     GT 210, SATA на 240 ГБ, БП без сертификата…) — в самом конце. Внутри равных — прежний порядок каталога.
//  2. TIERS — уровни подборки над списком. У уровня — правила по убыванию предпочтения; из совместимых деталей под
//     самое раннее правило берётся самая популярная. Процессоры — лестница по спросу заказчика (потолок — 7800X3D),
//     остальное — самые популярные модели своего ценового сегмента.
//
// Обновить популярность: node tools/fetch-onliner-popularity.mjs && node tools/build-catalog.mjs <прайс.xlsx>.
// Новое поколение в прайсе → дописать в FRESH и при необходимости в TIERS.

const has = (re) => (p) => re.test(p.name);
const chip = (re) => (p) => re.test(p.chip || "");
const chipset = (...list) => (p) => list.includes(p.chipset);

// ——— свежесть (0..3): 0 — явно устаревшее, уходит в конец списка ———
const CPU_GEN = { granite: 3, arrow: 3, "arrow-r": 3, raphael: 2, phoenix: 2, raptor: 2, alder: 1, vermeer: 1, cezanne: 1 };
const MB_CHIPSET = {
  B850: 3, X870: 3, X870E: 3, B840: 3, Z890: 3, B860: 3, H810: 3,
  B650: 2, B650E: 2, A620: 2, Z790: 2, B760: 2, H610: 2,
  B550: 1, A520: 1, Z690: 1, B660: 1,
};
const FRESH = {
  cpu: (p) => CPU_GEN[p.gen] ?? 0,
  motherboard: (p) => MB_CHIPSET[p.chipset] ?? 0,
  ram: (p) => (p.cap < 16 ? 0 : p.mem === "DDR5" ? (p.mhz >= 5600 ? 3 : 2) : p.mhz >= 3200 ? 1 : 0),
  gpu: (p) => {
    const c = p.chip || "";
    if (p.pro) return 1;
    if (/RTX 50|RX 90/.test(c)) return 3;
    if (/RTX 40|RX 7\d{3}/.test(c)) return 2;
    if (/RTX 30|RX 6\d{3}/.test(c)) return 1;
    return 0;
  },
  storage: (p) => (p.cap < 480 ? 0 : p.iface !== "nvme" ? 0 : p.read >= 5000 ? 3 : p.read >= 3000 ? 2 : 1),
  hdd: (p) => (p.cap >= 2000 ? 1 : 0) + (p.rpm >= 7200 ? 1 : 0),
  psu: (p) => (/Gold|Platinum|Titanium/.test(p.rating || "") ? 3 : /Silver|Bronze/.test(p.rating || "") ? 2 : p.rating ? 1 : 0),
  case: (p) => (p.window || p.aquarium ? 1 : 0) + (p.fansIn >= 3 ? 1 : 0) + (p.front === "mesh" || p.aquarium ? 1 : 0),
  cooler: (p) => (p.type === "aio" ? (p.rad >= 240 ? 3 : 1) : p.tdp >= 200 ? 3 : p.tdp >= 150 ? 2 : p.tdp >= 100 ? 1 : 0),
};
export const fresh = (step, p) => FRESH[step]?.(p) ?? 0;

// ——— уровни подборки ———
const NAMES4 = ["Бюджет", "Оптимум", "Мощный", "Топ"];
const NAMES3 = ["Бюджет", "Оптимум", "Топ"];
const ram = (cap, sticks, mem, mhz = 0) => (p) => p.cap === cap && (!sticks || p.sticks === sticks) && (!mem || p.mem === mem) && p.mhz >= mhz;
const psu = (min, max, rating) => (p) => p.watt >= min && p.watt <= max && rating.test(p.rating || "");
const DESKTOP_HDD = /Barracuda|WD Blue|WD Black|Toshiba (P300|DT0)/;
// (?![0-9A-Z]) — чтобы «Ryzen 5 5600» не цеплял 5600X/5600G/5600GT
const cpu = (m) => has(new RegExp(`${m}(?![0-9A-Z])`));

const TIERS = {
  // лестница по спросу заказчика; запасные правила — под уже выбранную плату другого сокета (AM4 / LGA1700 / LGA1851)
  cpu: {
    names: NAMES4,
    rules: [
      [cpu("Ryzen 5 5600"), cpu("Core i5-12400F"), cpu("Ryzen 5 8400F"), cpu("Ryzen 5 5500"), has(/Core i3-1[234]100F?/), has(/Core i5-1[01]400F?/)],
      [cpu("Core i5-14400F"), cpu("Ryzen 5 7500F"), has(/Core i5-1[34]400/), cpu("Ryzen 7 5700X"), has(/Core Ultra 5 225/), cpu("Ryzen 5 9600X"), has(/Core i5-1[01]600/)],
      [cpu("Ryzen 7 7700"), cpu("Ryzen 7 7700X"), has(/Core i5-14600K/), has(/Core Ultra 5 245/), cpu("Ryzen 7 9700X"), cpu("Ryzen 7 5800X"), has(/Core i5-1[23]600K/)],
      [cpu("Ryzen 7 7800X3D"), cpu("Ryzen 5 5500X3D"), has(/Core i7-14700/), has(/Core Ultra 7 265/), has(/Core i7-1[23]700/)],
    ],
  },
  gpu: {
    names: NAMES4,
    rules: [
      [chip(/RTX 5060$/), chip(/RTX 3060$/), chip(/RTX 5050/), chip(/RTX 3050/)],
      [(p) => /RTX 5060 Ti/.test(p.chip) && p.vram >= 16, chip(/RX 9060 XT/), chip(/RTX 5060 Ti/)],
      [chip(/RTX 5070$/), chip(/RX 9070$/)],
      [chip(/RTX 5070 Ti/), chip(/RX 9070 XT/)],
    ],
  },
  motherboard: {
    names: NAMES3,
    rules: [
      [chipset("A520", "H610", "A620", "H810", "B840")],
      [chipset("B650", "B760", "B550", "B860")],
      [chipset("B850", "X870", "Z790", "Z890", "B650E", "X870E")],
    ],
  },
  ram: {
    names: NAMES3,
    rules: [
      [ram(16, 2, "DDR5", 5600), ram(16, 2, "DDR4", 3200), ram(16, 0)],
      [ram(32, 2, "DDR5", 6000), ram(32, 2, "DDR5"), ram(32, 2, "DDR4", 3200), ram(32, 0)],
      [ram(64, 2, "DDR5"), ram(64, 0)],
    ],
  },
  storage: {
    names: NAMES3,
    rules: [
      [(p) => p.iface === "nvme" && p.cap === 1000 && p.read >= 3000 && p.read < 6500, (p) => p.iface === "nvme" && p.cap >= 500 && p.cap <= 512 && p.read >= 2000],
      [(p) => p.iface === "nvme" && p.cap === 1000 && p.read >= 6500],
      [(p) => p.iface === "nvme" && p.cap === 2000 && p.read >= 6500, (p) => p.iface === "nvme" && p.cap >= 2000],
    ],
  },
  hdd: {
    names: NAMES3,
    rules: [
      [(p) => p.cap === 1000 && DESKTOP_HDD.test(p.name), (p) => p.cap === 1000],
      [(p) => p.cap === 2000 && DESKTOP_HDD.test(p.name), (p) => p.cap === 2000],
      [(p) => p.cap === 4000 && DESKTOP_HDD.test(p.name), (p) => p.cap >= 4000],
    ],
  },
  psu: {
    names: NAMES3,
    rules: [
      [psu(600, 700, /Bronze|Gold/), psu(550, 700, /80\+/)],
      [psu(750, 750, /Gold/), psu(750, 800, /Gold|Silver|Bronze/)],
      [psu(850, 850, /Gold|Platinum/), psu(1000, 1000, /Gold|Platinum/), psu(850, 1300, /80\+/)],
    ],
  },
  case: {
    names: NAMES3,
    rules: [
      [(p) => p.band === 1 && p.fansIn >= 3, (p) => p.band === 1 && p.front === "mesh", (p) => p.band === 1],
      [(p) => p.band === 2 && p.fansIn >= 3, (p) => p.band === 2],
      [(p) => p.band === 3],
    ],
  },
  cooler: {
    names: NAMES3,
    rules: [
      [(p) => p.type === "air" && p.towers === 1 && p.tdp >= 180 && p.tdp <= 240, (p) => p.type === "air" && p.tdp >= 150],
      [(p) => p.type === "air" && p.towers >= 2, (p) => p.type === "aio" && p.rad === 240],
      [(p) => p.type === "aio" && p.rad === 360, (p) => p.type === "aio" && p.rad >= 280],
    ],
  },
};

// кто «лучше» при прочих равных: популярнее → свежее → (сортировка стабильная) раньше в каталоге, т.е. больше у поставщика
const rank = (p) => p.pop ?? Infinity;
const better = (step, a, b) => (rank(a) === rank(b) ? 0 : rank(a) < rank(b) ? -1 : 1) || fresh(step, b) - fresh(step, a);

/**
 * Подборка по уровням из уже совместимых деталей (parts — в порядке каталога).
 * Возвращает до 3–4 { tier, name, top, part }; уровень, под который ничего не подошло, пропускается.
 */
export function topPicks(step, parts) {
  const t = TIERS[step];
  if (!t || parts.length < 6) return []; // короткий список и так виден целиком
  const used = new Set();
  const out = [];
  t.rules.forEach((rules, tier) => {
    for (const rule of rules) {
      let best = null;
      for (const p of parts) if (!used.has(p.id) && rule(p) && (!best || better(step, p, best) < 0)) best = p;
      if (best) {
        used.add(best.id);
        out.push({ tier, name: t.names[tier], top: tier === t.rules.length - 1, part: best });
        return;
      }
    }
  });
  return out;
}

// Выше потолка спроса магазина (заказчик: «самый топовый, который просят, — 7800X3D, выше не запрашивали»): такие
// модели в списке идут после популярных, но раньше устаревших — даже если на Onliner они в топе (9800X3D там №1).
const ABOVE_DEMAND = { cpu: has(/Ryzen 7 98\d0X3D|Ryzen 9|Core i9|Core Ultra 9|Core Ultra 7 270K/) };
const group = (step, p) => (fresh(step, p) === 0 ? 2 : ABOVE_DEMAND[step]?.(p) ? 1 : 0);

/** Порядок списка: популярные выше; выше потолка спроса — после них; устаревшее (fresh 0) — в конце.
 *  Сортировка стабильная — равные остаются в порядке каталога. */
export const byPopularity = (step, parts) => [...parts].sort((a, b) => group(step, a) - group(step, b) || better(step, a, b));
