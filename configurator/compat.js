// Проверка совместимости — предварительная оценка на характеристиках из прайса и Onliner (см. content/components-facts.md).
// Ключевая идея: несовместимые варианты вообще не показываются в списке выбора (filterOptions),
// а не отображаются с предупреждением постфактум. Спорные случаи, которые решаются прошивкой BIOS или
// настройкой (например, Ryzen 5000 на плате B450), не скрываются, а дают предупреждение в checkCompat.
// Если какой-то характеристики у товара нет (не нашлась на Onliner) — эта проверка для него пропускается,
// а не прячет товар: финальную комплектацию всё равно подтверждает консультант.
import { CATALOG, findPart, FORM_RANK, FORM_LABEL } from "./data.js";

const SYSTEM_WATT = 100; // плата, память, диски, вентиляторы
const WATT_SAFETY = 50; // если БП мощнее нужного меньше чем на столько — предупреждение, а не «ок»

/** Сколько ватт потребляет процессор под нагрузкой: у Intel — максимальный TDP (PL2), у AMD — PPT ≈ 1.35 × TDP. */
export const cpuPower = (cpu) => (cpu ? (cpu.tdpMax || Math.round((cpu.tdp || 65) * (cpu.brand === "AMD" ? 1.35 : 1))) : 0);

/** Сколько ватт нужно системе. Если у видеокарты есть рекомендация производителя по БП — берём большее. */
export function computeNeededWatt(cpu, gpu) {
  if (!cpu) return 0;
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
  // LGA1200: 400-я серия не знает 11-е поколение
  { re: /^(H410|B460|H470|Z490|Q470|W480)$/, no: ["rocket"] },
  // LGA1700: 600-й серии для 13–14-го поколения нужна свежая прошивка
  { re: /^(H610|B660|H670|Z690)$/, bios: ["raptor"] },
  // LGA1851: обновлённые «Plus»-процессоры на 800-й серии — с новой прошивкой
  { re: /^(H810|B860|Z890)$/, bios: ["arrow-r"] },
];
export function chipsetSupport(cpu, mb) {
  if (!cpu?.gen || !mb?.chipset) return "ok";
  for (const r of CHIPSET_RULES) {
    if (!r.re.test(mb.chipset)) continue;
    if (r.no?.includes(cpu.gen)) return "no";
    if (r.bios?.includes(cpu.gen)) return "bios";
  }
  return "ok";
}

const caseFitsBoard = (c, mb) => (c.forms?.length ? c.forms.includes(mb.form) : FORM_RANK[c.form] == null || FORM_RANK[mb.form] == null || FORM_RANK[c.form] >= FORM_RANK[mb.form]);
const coolerFitsCpu = (cl, cpu) => (!cl.sockets || cl.sockets.includes(cpu.socket)) && (!cl.tdp || !cpu.coolTdp || cl.tdp >= cpu.coolTdp);
const coolerFitsCase = (cl, c) =>
  cl.type === "aio" ? !c.rads?.length || !cl.rad || c.rads.includes(cl.rad) : !cl.height || !c.coolerMax || cl.height <= c.coolerMax;
const gpuFitsCase = (g, c) => !g.len || !c.gpuMax || g.len <= c.gpuMax;
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
  if (involves("psu", "cpu", "gpu") && psu && cpu && psu.watt < computeNeededWatt(cpu, gpu)) return false;
  return true;
}

/** Список вариантов шага `step`, совместимых с уже выбранными деталями. */
export function filterOptions(step, sel) {
  return CATALOG[step].filter((p) => partFits(step, p, sel));
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
  if (cpu && cpu.igpu === false && !gpu) err("У этого процессора нет встроенной графики — нужна видеокарта.", ["cpu", "gpu"]);
  if (cl && cpu && !coolerFitsCpu(cl, cpu)) err("Кулер не подходит к процессору (сокет или мощность).", ["cooler", "cpu"]);
  if (!cl && cpu && !cpu.boxCooler && sel.cooler === null && isFilledAll(sel)) warn("Не выбрано охлаждение процессора.", ["cooler"]);
  if (mb && c && !caseFitsBoard(c, mb)) err(`Плата ${FORM_LABEL[mb.form] || mb.form} не влезет в этот корпус.`, ["motherboard", "case"]);
  if (gpu && c && !gpuFitsCase(gpu, c)) err(`Видеокарта длиной ${gpu.len} мм не влезет: в корпус — до ${c.gpuMax} мм.`, ["gpu", "case"]);
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
