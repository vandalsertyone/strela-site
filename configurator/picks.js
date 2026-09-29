// «Актуально сейчас»: что показывать первым в списке вариантов (просьба заказчика 29.09.2026 — «в самом топе какое-то
// старое и непопулярное железо»). Цен в прайсе пока нет, поэтому уровень считаем не по цене, а по классу детали.
//
//  1. fresh(step, part) — насколько деталь современная (0 — устаревшая … 3 — текущее поколение). По ней сортируется
//     весь список: сначала свежие, внутри одной «свежести» — прежний порядок каталога (наличие у поставщика, название).
//  2. TIERS — три уровня подборки над списком: «Базовый», «Оптимальный», «Максимум». У каждого уровня — список правил
//     по убыванию предпочтения; берётся первая совместимая деталь (в порядке каталога), подошедшая под самое раннее
//     правило. Правила — классы и поколения железа на осень 2026 года, без выдуманных цифр продаж.
//
// Новое поколение в прайсе → добавить его в FRESH/TIERS, иначе оно просто встанет в общий список по свежести 0.

const has = (re) => (p) => re.test(p.name);
const chip = (re) => (p) => re.test(p.chip || "");

// ——— свежесть (0..3) ———
const CPU_GEN = { granite: 3, arrow: 3, "arrow-r": 3, raphael: 2, phoenix: 2, raptor: 2, alder: 1, vermeer: 1, cezanne: 1 };
const MB_CHIPSET = {
  B850: 3, X870: 3, X870E: 3, B840: 3, Z890: 3, B860: 3, H810: 3,
  B650: 2, B650E: 2, A620: 2, Z790: 2, B760: 2, H610: 2,
  B550: 1, A520: 1, Z690: 1, B660: 1,
};
const FRESH = {
  cpu: (p) => CPU_GEN[p.gen] ?? 0,
  motherboard: (p) => MB_CHIPSET[p.chipset] ?? 0,
  ram: (p) => {
    const f = p.mem === "DDR5" ? (p.mhz >= 5600 ? 3 : 2) : p.mhz >= 3200 ? 1 : 0;
    return p.cap < 16 ? Math.min(f, 1) : f;
  },
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

// ——— три уровня подборки ———
export const TIER_NAMES = ["Базовый", "Оптимальный", "Максимум"];
const ram = (cap, sticks, mem, mhz = 0) => (p) => p.cap === cap && (!sticks || p.sticks === sticks) && p.mem === mem && p.mhz >= mhz;
const nvme = (cap, read) => (p) => p.iface === "nvme" && p.cap === cap && p.read >= read;
const psu = (min, max, rating) => (p) => p.watt >= min && p.watt <= max && rating.test(p.rating || "");

const TIERS = {
  cpu: [
    // AM4/LGA1200 — в конце: подходят, только если плата уже выбрана под старый сокет
    [has(/Ryzen 5 9600/), has(/Ryzen 5 7500F/), has(/Core Ultra 5 225/), has(/Core i5-14400/), has(/Ryzen 5 (8400F|7400F|7600)/), has(/Core i5-1[23]400/), has(/Ryzen 5 5600\b/), has(/Ryzen 5 5500\b/), has(/Core i5-1[01]400/), has(/Core i3-1[234]100/)],
    [has(/Ryzen 7 9700X/), has(/Ryzen 7 7700\b/), has(/Core Ultra 7 265/), has(/Core Ultra 5 245/), has(/Core i7-14700/), has(/Ryzen 7 7700X/), has(/Core i5-14600/), has(/Ryzen 7 7800X3D/), has(/Ryzen 7 5700X/), has(/Core i5-1[01]600/)],
    [has(/Ryzen 7 98\d0X3D/), has(/Ryzen 9 99\d0X3D/), has(/Core Ultra 9 285/), has(/Ryzen 9 9950X\b/), has(/Ryzen 9 9900X\b/), has(/Core Ultra 7 270K/), has(/Ryzen 9 79\d0X/), has(/Core i9-1[34]900/), has(/Ryzen 9 5950X/)],
  ],
  motherboard: [
    [(p) => p.chipset === "B840", (p) => p.chipset === "A620", (p) => p.chipset === "H810", (p) => p.chipset === "H610", (p) => p.chipset === "A520"],
    [(p) => p.chipset === "B850" && p.wifi, (p) => p.chipset === "B860" && p.wifi, (p) => p.chipset === "B850", (p) => p.chipset === "B860", (p) => p.chipset === "B650", (p) => p.chipset === "B760", (p) => p.chipset === "B550"],
    [(p) => p.chipset === "X870E", (p) => p.chipset === "X870", (p) => p.chipset === "Z890", (p) => p.chipset === "B650E", (p) => p.chipset === "Z790"],
  ],
  ram: [
    [ram(16, 2, "DDR5", 5600), ram(16, 1, "DDR5", 5600), ram(16, 0, "DDR5"), ram(16, 2, "DDR4", 3200), ram(16, 1, "DDR4", 3200)],
    [ram(32, 2, "DDR5", 6000), ram(32, 2, "DDR5", 5600), ram(32, 0, "DDR5"), ram(32, 2, "DDR4", 3200), ram(32, 0, "DDR4")],
    [ram(64, 2, "DDR5", 6000), ram(64, 0, "DDR5"), ram(64, 0, "DDR4")],
  ],
  gpu: [
    [chip(/RTX 5060$/), chip(/RX 9060 XT/), chip(/RTX 5050/), chip(/RTX 3060$/), chip(/RTX 3050/)],
    [(p) => /RTX 5060 Ti/.test(p.chip) && p.vram >= 16, chip(/RTX 5070$/), chip(/RX 9070$/), chip(/RTX 5060 Ti/)],
    [chip(/RTX 5070 Ti/), chip(/RX 9070 XT/), chip(/RTX 5080/)],
  ],
  storage: [
    [nvme(1000, 3000), nvme(500, 3000), nvme(512, 3000)],
    [nvme(2000, 5000), nvme(1000, 6500), nvme(2000, 3000)],
    [nvme(2000, 10000), nvme(4000, 6000), nvme(1000, 10000)],
  ],
  hdd: [
    [(p) => p.cap === 2000 && p.rpm >= 7200, (p) => p.cap === 2000, (p) => p.cap === 1000],
    [(p) => p.cap === 4000 && p.rpm >= 7200, (p) => p.cap === 4000],
    [(p) => p.cap >= 8000, (p) => p.cap >= 6000],
  ],
  psu: [
    [psu(650, 750, /Bronze/), psu(600, 750, /Gold/), psu(550, 750, /Bronze|Silver/)],
    [psu(750, 850, /Gold/), psu(750, 850, /Platinum|Silver/)],
    [psu(1000, 1300, /Platinum|Titanium/), psu(1000, 1300, /Gold/)],
  ],
  case: [
    [(p) => p.form === "mATX" && p.fansIn >= 3 && p.front === "mesh", (p) => p.form === "mATX" && p.fansIn >= 3, (p) => p.form === "mATX" && p.window],
    [(p) => p.form === "ATX" && p.fansIn >= 3 && p.front === "mesh", (p) => p.form === "ATX" && p.fansIn >= 3, (p) => p.form === "ATX" && p.window],
    [(p) => p.aquarium && p.fansIn >= 4, (p) => p.aquarium && ["ATX", "EATX"].includes(p.form), (p) => p.form === "EATX" && p.fansIn >= 3],
  ],
  cooler: [
    [(p) => p.type === "air" && p.towers === 1 && p.tdp >= 180 && p.tdp <= 240, (p) => p.type === "air" && p.towers === 1 && p.tdp >= 150],
    [(p) => p.type === "air" && p.towers >= 2, (p) => p.type === "aio" && p.rad === 240, (p) => p.type === "air" && p.tdp >= 240],
    [(p) => p.type === "aio" && p.rad === 360, (p) => p.type === "aio" && p.rad >= 280],
  ],
};

/**
 * Подборка по уровням из уже совместимых деталей (parts — результат filterOptions, в порядке каталога).
 * Возвращает до трёх { tier, name, part }; уровень, под который ничего не подошло, пропускается.
 */
export function topPicks(step, parts) {
  const tiers = TIERS[step];
  if (!tiers || parts.length < 6) return []; // короткий список и так виден целиком
  const used = new Set();
  const out = [];
  tiers.forEach((rules, tier) => {
    for (const rule of rules) {
      // внутри правила — самая свежая, при равенстве — первая по каталогу (наличие у поставщика)
      let best = null;
      for (const p of parts) if (!used.has(p.id) && rule(p) && (!best || fresh(step, p) > fresh(step, best))) best = p;
      if (best) {
        used.add(best.id);
        out.push({ tier, name: TIER_NAMES[tier], part: best });
        return;
      }
    }
  });
  return out;
}

/** Список по актуальности: свежие выше, внутри одной свежести — прежний порядок каталога (сортировка стабильная). */
export const byFreshness = (step, parts) => [...parts].sort((a, b) => fresh(step, b) - fresh(step, a));
