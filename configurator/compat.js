// Проверка совместимости — предварительная оценка на характеристиках из прайса и Onliner (см. content/components-facts.md).
// Ключевая идея: несовместимые варианты вообще не показываются в списке выбора (filterOptions),
// а не отображаются с предупреждением постфактум. Спорные случаи, которые решаются прошивкой BIOS или
// настройкой (например, Ryzen 5000 на плате B450), не скрываются, а дают предупреждение в checkCompat.
// Если какой-то характеристики у товара нет (не нашлась на Onliner) — эта проверка для него пропускается,
// а не прячет товар: финальную комплектацию всё равно подтверждает консультант.
import { CATALOG, STEPS, findPart, isRequired, FORM_RANK, FORM_LABEL } from "./data.js";

const SYSTEM_WATT = 100; // плата, память, диски, вентиляторы
const WATT_SAFETY = 50; // если БП мощнее нужного меньше чем на столько — предупреждение, а не «ок»

/** Сколько ватт потребляет процессор под нагрузкой: у Intel — максимальный TDP (PL2), у AMD — PPT ≈ 1.35 × TDP.
 *  Если у Intel максимальный TDP неизвестен (Pentium/Celeron) — с запасом 1.25 × TDP, а не просто TDP. */
export const cpuPower = (cpu) => (cpu ? cpu.tdpMax || Math.round((cpu.tdp || 65) * (cpu.brand === "AMD" ? 1.35 : 1.25)) : 0);

/** Сколько ватт нужно системе. Если у видеокарты есть рекомендация производителя по БП — берём большее.
 *  Считаем и когда выбрана только видеокарта: иначе к RTX 3070 можно взять БП на 450 Вт, а потом не подойдёт ни один процессор. */
export function computeNeededWatt(cpu, gpu) {
  if (!cpu && !gpu) return 0;
  const raw = cpuPower(cpu) + (gpu?.tdp || 0) + SYSTEM_WATT;
  const need = Math.max(raw, gpu?.psuRec || 0);
  return Math.ceil(need / 50) * 50;
}

/** "error" — не хватает, "warning" — впритык, "ok" — с запасом */
export const wattStatus = (psuWatt, neededWatt) => (psuWatt < neededWatt ? "error" : psuWatt < neededWatt + WATT_SAFETY ? "warning" : "ok");

// ——— поддержка процессора чипсетом платы ———
// "no" — не заработает (скрываем), "bios" — заработает с подходящей прошивкой платы (предупреждаем).
// Ключи поколений (cpu.gen) проставляет tools/build-catalog.mjs по кодовому имени кристалла.
const CHIPSET_RULES = [
  // AM4
  { re: /^(A520|B550)$/, no: ["bristol", "raven", "dali", "picasso"] },
  { re: /^(X570)$/, no: ["bristol", "raven"] },
  { re: /^(A320|B350|X370|B450|X470)$/, bios: ["matisse", "renoir", "cezanne", "vermeer", "bristol"] },
  // AM5: 600-й серии для Ryzen 8000G и 9000 нужна прошивка новее, чем на первых партиях плат
  { re: /^(A620|B650|B650E|X670|X670E)$/, bios: ["phoenix", "granite"] },
  // LGA1200: 11-е поколение не работает на H410/B460; на H470/Z490/Q470/W480 — работает с обновлённой прошивкой
  { re: /^(H410|B460)$/, no: ["rocket"] },
  { re: /^(H470|Z490|Q470|W480)$/, bios: ["rocket"] },
  // LGA1700: 600-й серии для 13–14-го поколения нужна свежая прошивка
  { re: /^(H610|B660|H670|Z690)$/, bios: ["raptor"] },
  // LGA1851: обновлённые «Plus»-процессоры на 800-й серии — с новой прошивкой
  { re: /^(H810|B860|Z890)$/, bios: ["arrow-r"] },
];
// Как поколение процессора называется в списке поддержки у платы (поле mb.cpus, из характеристик производителя).
const cpuFamily = (cpu) =>
  ({
    picasso: "AMD 3000G", dali: "AMD 3000G", matisse: "AMD 3000", renoir: cpu.igpu ? "AMD 4000G" : "AMD 4000",
    cezanne: cpu.igpu ? "AMD 5000G" : "AMD 5000", vermeer: "AMD 5000", raphael: "AMD 7000", phoenix: "AMD 8000", granite: "AMD 9000",
    comet: "Intel Gen10", rocket: "Intel Gen11", alder: "Intel Gen12", raptor: /-14\d{3}/.test(cpu.name) ? "Intel Gen14" : "Intel Gen13",
    arrow: "Intel Core Ultra", "arrow-r": "Intel Core Ultra",
  })[cpu.gen] || null;

// "ok" | "bios" — работает, но может понадобиться свежая прошивка (в т.ч. когда чипсет поколение поддерживает,
// а производитель платы в списке его не указывает: 14-е поколение на ранних B760, Ryzen 5000G на B550) | "no" — не заработает (скрываем).
// Если производитель конкретной платы явно заявляет поколение, которое общее правило чипсета запрещает
// (некоторые A520/B550 с Ryzen 3000G), — верим производителю, но с предупреждением про прошивку.
export function chipsetSupport(cpu, mb) {
  if (!cpu?.gen || !mb?.chipset) return "ok";
  let res = "ok";
  for (const r of CHIPSET_RULES) {
    if (!r.re.test(mb.chipset)) continue;
    if (r.no?.includes(cpu.gen)) res = "no";
    else if (r.bios?.includes(cpu.gen)) res = "bios";
    break;
  }
  const fam = cpuFamily(cpu);
  if (!mb.cpus?.length || !fam) return res;
  const listed = mb.cpus.includes(fam);
  if (res === "no" && listed) return "bios";
  if (res === "ok" && !listed) return "bios";
  return res;
}

// Крепёж плат стандартный: отверстия mATX — подмножество ATX, mini-ITX — подмножество mATX, поэтому в корпус
// под ATX встаёт и mATX, и mini-ITX, даже если в характеристиках корпуса меньшие форматы не перечислены.
// Плата с разъёмами на обороте (BTF) — только в корпус, где поддержка BTF не «нет».
const caseFitsBoard = (c, mb) =>
  (FORM_RANK[c.form] == null || FORM_RANK[mb.form] == null || FORM_RANK[c.form] >= FORM_RANK[mb.form]) && !(mb.btf && c.btf === false);
const coolerFitsCpu = (cl, cpu) => (!cl.sockets || cl.sockets.includes(cpu.socket)) && (!cl.tdp || !cpu.coolTdp || cl.tdp >= cpu.coolTdp);
const coolerFitsCase = (cl, c) =>
  cl.type === "aio" ? !c.rads?.length || !cl.rad || c.rads.includes(cl.rad) : !cl.height || !c.coolerMax || cl.height <= c.coolerMax;
// длина — не больше допустимой; толщина (в слотах) — не больше числа слотов расширения корпуса (важно для мини-корпусов)
const gpuFitsCase = (g, c) => (!g.len || !c.gpuMax || g.len <= c.gpuMax) && (!g.slots || !c.slots || g.slots <= c.slots);
const psuFitsCase = (p, c) => (!c.psuForms?.length || !p.form || c.psuForms.includes(p.form)) && (!p.len || !c.psuMaxLen || p.len <= c.psuMaxLen);

/**
 * Подходит ли конкретная деталь `part` категории `step` к уже выбранным деталям в `sel`.
 * `part === null` — вариант «без детали» для необязательного шага.
 * Сравнение только с ДРУГИМИ уже выбранными деталями — так можно фильтровать список любого шага
 * независимо от порядка выбора (фильтр двусторонний).
 */
export function partFits(step, part, sel) {
  const pick = (k) => (k === step ? part : findPart(k, sel[k]));
  const cpu = pick("cpu");
  const mb = pick("motherboard");
  const ram = pick("ram");
  const gpu = pick("gpu");
  const ssd = pick("storage");
  const hdd = pick("hdd");
  const psu = pick("psu");
  const c = pick("case");
  const cl = pick("cooler");

  if (part === null) {
    if (step === "gpu") return !cpu || cpu.igpu !== false; // без видеокарты — только со встроенной графикой
    if (step === "cooler") return !cpu || !!cpu.boxCooler; // «кулер из комплекта» — только у BOX-процессоров
    return true;
  }

  // Каждая пара проверяется, только если в ней участвует текущий шаг — остальное уже проверено раньше.
  const involves = (...keys) => keys.includes(step);
  if (involves("cpu", "motherboard") && cpu && mb) {
    if (cpu.socket !== mb.socket) return false;
    if (chipsetSupport(cpu, mb) === "no") return false;
    if (cpu.mem?.length && mb.mem && !cpu.mem.includes(mb.mem)) return false;
  }
  // процессор и память сверяем напрямую, иначе после «AM4 + DDR5» не останется ни одной платы
  if (involves("cpu", "ram") && cpu && ram && cpu.mem?.length && !cpu.mem.includes(ram.mem)) return false;
  if (involves("ram", "motherboard") && ram && mb) {
    if (ram.mem !== mb.mem) return false;
    if (mb.slots && ram.sticks > mb.slots) return false;
  }
  if (involves("storage", "motherboard") && ssd && mb && ssd.form === "m2" && mb.m2 === 0) return false;
  if (involves("motherboard", "case") && mb && c && !caseFitsBoard(c, mb)) return false;
  if (involves("gpu", "case") && gpu && c && !gpuFitsCase(gpu, c)) return false;
  if (involves("hdd", "case") && hdd && c && c.bays35 === 0) return false;
  if (involves("psu", "case") && psu && c && !psuFitsCase(psu, c)) return false;
  if (involves("cooler", "cpu") && cl && cpu && !coolerFitsCpu(cl, cpu)) return false;
  if (involves("cooler", "case") && cl && c && !coolerFitsCase(cl, c)) return false;
  if (involves("psu", "cpu", "gpu") && psu && (cpu || gpu) && psu.watt < computeNeededWatt(cpu, gpu)) return false;
  return true;
}

/**
 * Список вариантов шага `step`, совместимых с уже выбранными деталями.
 * Плюс взгляд на шаг вперёд: вариант показываем, только если после него в каждом ещё не выбранном обязательном
 * шаге останется хоть одна подходящая деталь. Иначе попарно всё совместимо, а сборка заходит в тупик:
 * например, корпус mini-ITX + Ryzen AM4 — плат AM4 формата mini-ITX в прайсе нет.
 */
export function filterOptions(step, sel) {
  const open = STEPS.map((s) => s.key).filter((k) => k !== step && sel[k] == null);
  return CATALOG[step].filter((p) => {
    if (!partFits(step, p, sel)) return false;
    const next = { ...sel, [step]: p.id };
    return open.every((k) => (!isRequired(k, next) && partFits(k, null, next)) || CATALOG[k].some((q) => partFits(k, q, next)));
  });
}

/** true, если вариант «без детали» (для необязательного шага) допустим при текущем выборе */
export const noPartAllowed = (step, sel) => partFits(step, null, sel);

/**
 * Полная проверка выбора: ошибки (при обычной работе интерфейса возникать не должны — страховка)
 * и предупреждения о спорных, но рабочих сочетаниях.
 */
export function checkCompat(sel) {
  const g = (k) => findPart(k, sel[k]);
  const cpu = g("cpu");
  const mb = g("motherboard");
  const ram = g("ram");
  const gpu = g("gpu");
  const ssd = g("storage");
  const hdd = g("hdd");
  const psu = g("psu");
  const c = g("case");
  const cl = g("cooler");
  const issues = []; // { level: "error"|"warning", text, steps: [] }
  const err = (text, steps) => issues.push({ level: "error", text, steps });
  const warn = (text, steps) => issues.push({ level: "warning", text, steps });

  if (cpu && mb) {
    if (cpu.socket !== mb.socket) err(`Процессор (${cpu.socket}) и плата (${mb.socket}) — разные сокеты.`, ["cpu", "motherboard"]);
    const cs = chipsetSupport(cpu, mb);
    if (cs === "no") err(`Чипсет ${mb.chipset} не поддерживает этот процессор.`, ["cpu", "motherboard"]);
    if (cs === "bios") warn(`Для этого процессора на плате с чипсетом ${mb.chipset} может понадобиться обновление BIOS — консультант проверит версию прошивки.`, ["cpu", "motherboard"]);
    if (mb.chipset === "A620" && cpu.tdp >= 170) warn("На плате A620 процессор такого уровня может работать с ограничением мощности — лучше B650/B850 и выше.", ["cpu", "motherboard"]);
  }
  if (mb && ram) {
    if (ram.mem !== mb.mem) err(`Плата работает с ${mb.mem}, а память — ${ram.mem}.`, ["motherboard", "ram"]);
    else if (mb.slots && ram.sticks > mb.slots) err(`В комплекте памяти ${ram.sticks} модуля, а на плате всего ${mb.slots} слота.`, ["motherboard", "ram"]);
  }
  if (ssd && mb && ssd.form === "m2" && mb.m2 === 0) err("На плате нет слота M.2 для этого SSD.", ["storage", "motherboard"]);
  if (cpu && ram && cpu.mem?.length && !cpu.mem.includes(ram.mem)) err(`Процессор работает с ${cpu.mem.join("/")}, а память — ${ram.mem}.`, ["cpu", "ram"]);
  if (ssd?.short) warn("Это короткий SSD M.2 2230 — на плате крепление обычно под 2280, консультант добавит переходник.", ["storage"]);
  if (cpu && cpu.igpu === false && !gpu) err("У этого процессора нет встроенной графики — нужна видеокарта.", ["cpu", "gpu"]);
  if (cl && cpu && !coolerFitsCpu(cl, cpu)) err("Кулер не подходит к процессору (сокет или мощность).", ["cooler", "cpu"]);
  if (!cl && cpu && !cpu.boxCooler && sel.cooler === null && isFilledAll(sel)) warn("Не выбрано охлаждение процессора.", ["cooler"]);
  if (mb && c && !caseFitsBoard(c, mb))
    err(mb.btf && c.btf === false ? "У платы разъёмы на обратной стороне (BTF), а корпус такие платы не поддерживает." : `Плата ${FORM_LABEL[mb.form] || mb.form} не влезет в этот корпус.`, ["motherboard", "case"]);
  if (mb && c && mb.btf && c.btf == null) warn("У платы разъёмы на обратной стороне (BTF) — консультант проверит, что корпус их поддерживает.", ["motherboard", "case"]);
  if (mb && ram && ram.cudimm && mb.socket !== "LGA1851")
    warn("Память CUDIMM рассчитана на платы LGA1851 (Intel Core Ultra); на этой плате она заработает только в режиме совместимости, если его поддерживает прошивка, — консультант проверит.", ["motherboard", "ram"]);
  if (gpu && c && !gpuFitsCase(gpu, c))
    err(gpu.len && c.gpuMax && gpu.len > c.gpuMax ? `Видеокарта длиной ${gpu.len} мм не влезет: в корпус — до ${c.gpuMax} мм.` : `Видеокарта толщиной ${gpu.slots} слота не влезет: в корпусе ${c.slots} слота расширения.`, ["gpu", "case"]);
  if (cl && c && !coolerFitsCase(cl, c))
    err(cl.type === "aio" ? `Радиатор ${cl.rad} мм не встанет в этот корпус.` : `Кулер высотой ${cl.height} мм не влезет: в корпус — до ${c.coolerMax} мм.`, ["cooler", "case"]);
  if (hdd && c && c.bays35 === 0) err("В корпусе нет отсека для 3.5\" жёсткого диска.", ["hdd", "case"]);
  if (psu && c && !psuFitsCase(psu, c)) err("Блок питания не встанет в этот корпус (форм-фактор или длина).", ["psu", "case"]);
  if (gpu && c && gpu.len && !c.gpuMax) warn("Для этого корпуса нет данных о максимальной длине видеокарты — консультант проверит, что всё влезет.", ["gpu", "case"]);

  const neededWatt = computeNeededWatt(cpu, gpu);
  if (psu && neededWatt) {
    const status = wattStatus(psu.watt, neededWatt);
    if (status === "error") err(`Блоку питания не хватит мощности: нужно от ${neededWatt} Вт, а этот — ${psu.watt} Вт.`, ["psu"]);
    else if (status === "warning") warn("Блок питания впритык по мощности — лучше взять с небольшим запасом.", ["psu"]);
  }

  const errors = issues.filter((i) => i.level === "error");
  return { ok: errors.length === 0, issues, neededWatt };
}
const isFilledAll = (sel) => ["cpu", "motherboard", "ram", "storage", "psu", "case"].every((k) => sel[k]);

/** Рекомендация блока питания под уже выбранные CPU/GPU (для подсказки в шаге PSU) */
export function recommendedWatt(sel) {
  return computeNeededWatt(findPart("cpu", sel.cpu), findPart("gpu", sel.gpu)) || null;
}
