// База комплектующих для конструктора ПК.
// Источники и разбор «реальное / демо» — см. content/components-facts.md. Коротко:
//   name, price, stock, url  — с strelashop.by (проверяйте по url);
//   socket/ram/tdp/iGpu/form — открытые характеристики производителя (сайт их не публикует);
//   demo: true               — позиции, которых пока нет в каталоге Strela, добавлены для выбора и вида конструктора.
//   armor/rgb/color/front/argb/finish/heatpipes/towers — только визуальные подсказки для 3D-сцены (scene3d.js),
//                              стилизация «по мотивам» модели, а не характеристики; совместимость на них не опирается.
//
// Чтобы обновить цену/наличие реального товара — поменяйте только price/stock, ничего больше.
// Чтобы добавить новый реальный товар — скопируйте объект, укажите url, demo не указывайте (по умолчанию false).

export const STOCK = {
  IN: "in", LOW: "low", ONE: "one", OUT: "out",
};
const STOCK_LABEL = { in: "В наличии", low: "Осталась 1 шт", one: "Осталась 1 шт", out: "Нет в наличии" };
export const stockLabel = (s) => STOCK_LABEL[s] || "";

// Форм-фактор платы/корпуса: у корпуса должен быть ранг не меньше, чем у платы (в ATX-корпус встанет mATX-плата, наоборот — нет).
export const FORM_RANK = { mATX: 1, ATX: 2 };

export const CATALOG = {
  cpu: [
    { id: "cpu-7600", name: "AMD Ryzen 5 7600", price: 549, demo: true, socket: "AM5", ram: "DDR5", tdp: 65, iGpu: true },
    { id: "cpu-7700", name: "AMD Ryzen 7 7700", price: 719, stock: STOCK.ONE, url: "https://strelashop.by/product/protsessor-amd-ryzen-7-7700-oem/", socket: "AM5", ram: "DDR5", tdp: 65, iGpu: true },
    { id: "cpu-7800x3d", name: "AMD Ryzen 7 7800X3D", price: 1090, demo: true, socket: "AM5", ram: "DDR5", tdp: 120, iGpu: true },
    { id: "cpu-7900x", name: "AMD Ryzen 9 7900X", price: 1180, demo: true, socket: "AM5", ram: "DDR5", tdp: 170, iGpu: true },
    { id: "cpu-9950x", name: "AMD Ryzen 9 9950X", price: 1590, demo: true, socket: "AM5", ram: "DDR5", tdp: 170, iGpu: true },
    { id: "cpu-5600", name: "AMD Ryzen 5 5600", price: 439, stock: STOCK.IN, url: "https://strelashop.by/product/protsessor-amd-ryzen-5-5600-oem/", socket: "AM4", ram: "DDR4", tdp: 65, iGpu: false },
    { id: "cpu-5600g", name: "AMD Ryzen 5 5600G", price: 419, demo: true, socket: "AM4", ram: "DDR4", tdp: 65, iGpu: true },
    { id: "cpu-5800x3d", name: "AMD Ryzen 7 5800X3D", price: 780, demo: true, socket: "AM4", ram: "DDR4", tdp: 105, iGpu: false },
  ],
  motherboard: [
    { id: "mb-b650m", name: "Gigabyte B650M D3HP rev 1.0", price: 359, stock: STOCK.ONE, url: "https://strelashop.by/product/materinskaya-plata-gigabyte-b650m-d3hp-rev-1-0/", socket: "AM5", ram: "DDR5", form: "mATX", armor: "basic" },
    { id: "mb-b650-elite", name: "Gigabyte B650 AORUS Elite AX", price: 649, demo: true, socket: "AM5", ram: "DDR5", form: "ATX", armor: "gaming" },
    { id: "mb-x670e", name: "ASUS ROG STRIX X670E-E", price: 1290, demo: true, socket: "AM5", ram: "DDR5", form: "ATX", armor: "flagship" },
    { id: "mb-b550m", name: "Gigabyte B550M K", price: 265, stock: STOCK.IN, url: "https://strelashop.by/product/materinskaya-plata-gigabyte-b550m-k/", socket: "AM4", ram: "DDR4", form: "mATX", armor: "basic" },
    { id: "mb-b450m", name: "Gigabyte B450M DS3H", price: 189, demo: true, socket: "AM4", ram: "DDR4", form: "mATX", armor: "basic" },
    { id: "mb-x570", name: "ASUS ROG STRIX X570-E", price: 890, demo: true, socket: "AM4", ram: "DDR4", form: "ATX", armor: "flagship" },
  ],
  ram: [
    { id: "ram-ddr4-16-3200", name: "DDR4 2×8 ГБ 3200 МГц", price: 130, demo: true, ram: "DDR4", capacity: 16 },
    { id: "ram-ddr4-32-3200", name: "DDR4 2×16 ГБ 3200 МГц", price: 220, demo: true, ram: "DDR4", capacity: 32 },
    { id: "ram-ddr4-32-3600", name: "DDR4 2×16 ГБ 3600 МГц", price: 250, demo: true, ram: "DDR4", capacity: 32, rgb: true },
    { id: "ram-ddr5-16-5200", name: "DDR5 2×8 ГБ 5200 МГц", price: 180, demo: true, ram: "DDR5", capacity: 16 },
    { id: "ram-ddr5-32-6000", name: "DDR5 2×16 ГБ 6000 МГц", price: 320, demo: true, ram: "DDR5", capacity: 32, rgb: true },
    { id: "ram-ddr5-64-6000", name: "DDR5 2×32 ГБ 6000 МГц", price: 560, demo: true, ram: "DDR5", capacity: 64, rgb: true },
  ],
  gpu: [
    { id: "gpu-4060", name: "GeForce RTX 4060 8GB", price: 1150, demo: true, tdp: 115, lengthClass: "standard", fans: 2 },
    { id: "gpu-asus-5060ti", name: "ASUS DUAL RTX 5060 Ti OC 8GB GDDR7", price: 1639, stock: STOCK.OUT, url: "https://strelashop.by/product/videokarta-asus-dual-rtx-5060-ti-oc-8gb-gddr7-dual-rtx5060ti-o8g/", tdp: 180, lengthClass: "standard", fans: 2 },
    { id: "gpu-gigabyte-5060ti", name: "Gigabyte RTX 5060 Ti Windforce OC 8G GDDR7", price: 1589, stock: STOCK.OUT, url: "https://strelashop.by/product/videokarta-gigabyte-rtx-5060-ti-windforce-oc-8g-gddr7-gv-n506twf2oc-8gd/", tdp: 180, lengthClass: "standard", fans: 2 },
    { id: "gpu-palit-5060", name: "Palit GeForce RTX 5060 Infinity 2 OC 8GB GDDR7", price: 1399, stock: STOCK.OUT, url: "https://strelashop.by/product/videokarta-palit-geforce-rtx-5060-infinity-2-oc-8gb-gddr7-ne75060v19p1-gb2063l/", tdp: 170, lengthClass: "standard", fans: 2 },
    { id: "gpu-4070super", name: "GeForce RTX 4070 SUPER 12GB", price: 2400, demo: true, tdp: 220, lengthClass: "standard", fans: 2 },
    { id: "gpu-4080super", name: "GeForce RTX 4080 SUPER 16GB", price: 3600, demo: true, tdp: 320, lengthClass: "large", fans: 3 },
    { id: "gpu-4090", name: "GeForce RTX 4090 24GB", price: 5800, demo: true, tdp: 450, lengthClass: "large", fans: 3 },
  ],
  storage: [
    { id: "ssd-500", name: "SSD NVMe 500 ГБ", price: 220, demo: true, capacity: 500 },
    { id: "ssd-kc3000-1tb", name: "SSD Kingston KC3000 1TB", price: 859, stock: STOCK.ONE, url: "https://strelashop.by/product/ssd-kingston-kc3000-1tb-skc3000s-1024g/", capacity: 1000 },
    { id: "ssd-nv3-2tb", name: "SSD Kingston NV3 2TB", price: 999, stock: STOCK.ONE, url: "https://strelashop.by/product/ssd-kingston-nv3-2tb-snv3s-2000g/", capacity: 2000 },
    { id: "ssd-4tb", name: "SSD NVMe 4 ТБ", price: 1450, demo: true, capacity: 4000 },
  ],
  psu: [
    { id: "psu-450", name: "Блок питания 450 Вт 80+", price: 90, demo: true, watt: 450 },
    { id: "psu-550", name: "Блок питания 550 Вт 80+ Bronze", price: 120, demo: true, watt: 550 },
    { id: "psu-650", name: "Блок питания 650 Вт 80+ Bronze", price: 150, demo: true, watt: 650 },
    { id: "psu-deepcool-800", name: "Deepcool PL800D 800 Вт 80+ Bronze", price: 110, stock: STOCK.OUT, url: "https://strelashop.by/product/blok-pitaniya-deepcool-pl800d-atx-3-1-800w-pwm-120mm-fan-active-pfc-dc-to-dc-80-bronze-ret-kitay-/", watt: 800 },
    { id: "psu-750", name: "Блок питания 750 Вт 80+ Gold", price: 190, demo: true, watt: 750 },
    { id: "psu-850", name: "Блок питания 850 Вт 80+ Gold", price: 240, demo: true, watt: 850 },
    { id: "psu-1000", name: "Блок питания 1000 Вт 80+ Gold", price: 320, demo: true, watt: 1000 },
  ],
  case: [
    { id: "case-haff-flash", name: "HAFF Flash mATX (белый)", price: 159, stock: STOCK.ONE, url: "https://strelashop.by/product/korpus-haff-flash-matx-bez-bp-belyy/", form: "mATX", color: "white", front: "glass", argb: true },
    { id: "case-haff-glory", name: "HAFF Glory Mini Air mATX (белый)", price: 159, stock: STOCK.ONE, url: "https://strelashop.by/product/korpus-haff-glory-mini-air-matx-bez-bp-belyy/", form: "mATX", color: "white", front: "mesh", argb: true },
    { id: "case-zalman-p30", name: "Zalman P30 Black V2 mATX", price: 249, stock: STOCK.IN, url: "https://strelashop.by/product/korpus-zalman-p30-black-v2-matx-bez-bp/", form: "mATX", color: "black", front: "glass", argb: false },
    { id: "case-vision-atx", name: "Strela Vision ATX Glass", price: 219, demo: true, form: "ATX", color: "black", front: "glass", argb: true },
    { id: "case-prime-atx", name: "Strela Prime ATX Glass", price: 289, demo: true, form: "ATX", color: "black", front: "mesh", argb: true },
  ],
  cooler: [
    { id: "cooler-budget", name: "Башенный кулер 130 Вт", price: 35, demo: true, sockets: ["AM4", "AM5"], tdpMax: 130, finish: "silver", heatpipes: 3 },
    { id: "cooler-idc-se214", name: "ID-Cooling SE-214-XT V2 ARGB", price: 59, stock: STOCK.ONE, url: "https://strelashop.by/product/kuler-id-cooling-se-214-xt-v2-argb-200w/", sockets: ["AM4", "AM5"], tdpMax: 200, finish: "silver", heatpipes: 4, argb: true },
    { id: "cooler-zalman-cnps9x", name: "Zalman CNPS9X Performa Plus ARGB", price: 79, stock: STOCK.LOW, url: "https://strelashop.by/product/kuler-zalman-cnps9x-performa-plus-argb-chernyy/", sockets: ["AM4", "AM5"], tdpMax: 220, finish: "black", heatpipes: 4, argb: true },
    { id: "cooler-air-250", name: "Башенный кулер 250 Вт ARGB", price: 99, demo: true, sockets: ["AM4", "AM5"], tdpMax: 250, finish: "black", heatpipes: 6, towers: 2, argb: true },
    { id: "cooler-aio-240", name: "СЖО 240 мм ARGB", price: 179, demo: true, sockets: ["AM4", "AM5"], tdpMax: 250, type: "aio", radiatorMm: 240 },
    { id: "cooler-aio-360", name: "СЖО 360 мм ARGB", price: 229, demo: true, sockets: ["AM4", "AM5"], tdpMax: 300, type: "aio", radiatorMm: 360 },
  ],
};

// Порядок шагов конструктора и подписи
export const STEPS = [
  { key: "cpu", title: "Процессор", icon: "cpu", required: true },
  { key: "motherboard", title: "Материнская плата", icon: "board", required: true },
  { key: "ram", title: "Оперативная память", icon: "ram", required: true },
  { key: "gpu", title: "Видеокарта", icon: "gpu", required: false },
  { key: "storage", title: "Накопитель", icon: "ssd", required: true },
  { key: "psu", title: "Блок питания", icon: "psu", required: true },
  { key: "case", title: "Корпус", icon: "case", required: true },
  { key: "cooler", title: "Охлаждение", icon: "cooler", required: true },
];

export const findPart = (step, id) => CATALOG[step]?.find((p) => p.id === id) || null;

// Относительный уровень цены внутри категории (1..3) — используется вместо точной цены в списке выбора,
// чтобы не «продавать» ценником до итога. Считается один раз и кэшируется.
const tierCache = {};
export function priceTier(step, part) {
  if (!tierCache[step]) {
    const sorted = [...CATALOG[step]].sort((a, b) => a.price - b.price);
    const n = sorted.length - 1 || 1;
    tierCache[step] = new Map(sorted.map((p, i) => [p.id, i / n]));
  }
  const t = tierCache[step].get(part.id) ?? 0;
  return t <= 0.34 ? 1 : t <= 0.67 ? 2 : 3;
}
export const TIER_LABEL = { 1: "Начальный уровень", 2: "Средний уровень", 3: "Топовый уровень" };

