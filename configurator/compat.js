// Проверка совместимости — предварительная оценка на открытых характеристиках (см. content/components-facts.md).
// Ключевая идея: несовместимые варианты вообще не показываются в списке выбора (filterOptions),
// а не отображаются с предупреждением постфактум. checkCompat остаётся как защитный резерв
// (например, пока не выбраны все детали) и для итоговой сводки.
import { CATALOG, findPart, FORM_RANK } from "./data.js";

const WATT_MARGIN_WITH_GPU = 120;
const WATT_MARGIN_NO_GPU = 80;
const WATT_SAFETY = 50; // если БП мощнее нужного меньше чем на столько — предупреждение, а не «ок»

/** Сколько ватт нужно системе: TDP процессора + TDP видеокарты (если есть) + запас */
export const computeNeededWatt = (cpuTdp, gpuTdp) => cpuTdp + (gpuTdp || 0) + (gpuTdp ? WATT_MARGIN_WITH_GPU : WATT_MARGIN_NO_GPU);

/** "error" — не хватает, "warning" — впритык, "ok" — с запасом */
export const wattStatus = (psuWatt, neededWatt) => (psuWatt < neededWatt ? "error" : psuWatt < neededWatt + WATT_SAFETY ? "warning" : "ok");

/**
 * Подходит ли конкретная деталь `part` категории `step` к уже выбранным деталям в `sel`.
 * Не учитывает саму категорию step (сравнение только с ДРУГИМИ уже выбранными деталями) —
 * так можно фильтровать список вариантов для любого шага независимо от порядка выбора.
 */
export function partFits(step, part, sel) {
  const cpu = step === "cpu" ? null : findPart("cpu", sel.cpu);
  const mb = step === "motherboard" ? null : findPart("motherboard", sel.motherboard);
  const gpu = step === "gpu" ? null : findPart("gpu", sel.gpu);

  if (step === "cpu" && mb && part.socket !== mb.socket) return false;
  if (step === "motherboard" && cpu && part.socket !== cpu.socket) return false;

  if (step === "ram" && mb && part.ram !== mb.ram) return false;

  if (step === "gpu" && part === null) {
    // «Без видеокарты» — только если у процессора есть встроенная графика
    return !cpu || cpu.iGpu !== false;
  }

  if (step === "case" && mb && FORM_RANK[part.form] < FORM_RANK[mb.form]) return false;
  if (step === "motherboard" && sel.case) {
    const c = findPart("case", sel.case);
    if (c && FORM_RANK[c.form] < FORM_RANK[part.form]) return false;
  }

  if (step === "cooler") {
    if (cpu && !part.sockets.includes(cpu.socket)) return false;
    if (cpu && cpu.tdp > part.tdpMax) return false;
  }
  if (step === "cpu" && sel.cooler) {
    const cl = findPart("cooler", sel.cooler);
    if (cl && (!cl.sockets.includes(part.socket) || part.tdp > cl.tdpMax)) return false;
  }

  if (step === "psu") {
    if (cpu) {
      const needed = computeNeededWatt(cpu.tdp, gpu?.tdp);
      if (part.watt < needed) return false;
    }
  }
  if ((step === "cpu" || step === "gpu") && sel.psu) {
    const psu = findPart("psu", sel.psu);
    if (psu) {
      const testCpu = step === "cpu" ? part : cpu;
      const testGpuTdp = step === "gpu" ? part?.tdp : gpu?.tdp;
      if (testCpu && psu.watt < computeNeededWatt(testCpu.tdp, testGpuTdp)) return false;
    }
  }

  return true;
}

/** Список вариантов шага `step`, совместимых с уже выбранными деталями. `null` в списке — вариант «без детали» (для gpu). */
export function filterOptions(step, sel) {
  return CATALOG[step].filter((p) => partFits(step, p, sel));
}

/** true, если вариант «без детали» (для необязательного шага) допустим при текущем выборе */
export const noPartAllowed = (step, sel) => partFits(step, null, sel);

/**
 * Полная проверка уже сделанного выбора — резерв на случай гонок при смене более раннего шага.
 * В обычной работе интерфейса (через filterOptions) несовместимых комбинаций возникать не должно.
 */
export function checkCompat(sel) {
  const cpu = findPart("cpu", sel.cpu);
  const mb = findPart("motherboard", sel.motherboard);
  const ram = findPart("ram", sel.ram);
  const gpu = findPart("gpu", sel.gpu);
  const psu = findPart("psu", sel.psu);
  const cooler = findPart("cooler", sel.cooler);
  const caseP = findPart("case", sel.case);
  const issues = []; // { level: "error"|"warning", text, steps: [] }

  if (cpu && mb && cpu.socket !== mb.socket) issues.push({ level: "error", text: `Процессор (${cpu.socket}) и плата (${mb.socket}) — разные сокеты.`, steps: ["cpu", "motherboard"] });
  if (mb && ram && mb.ram !== ram.ram) issues.push({ level: "error", text: `Плата работает с ${mb.ram}, а память — ${ram.ram}.`, steps: ["motherboard", "ram"] });
  if (cpu && !cpu.iGpu && !gpu) issues.push({ level: "error", text: "У этого процессора нет встроенной графики — нужна видеокарта.", steps: ["cpu", "gpu"] });
  if (cooler && cpu && !cooler.sockets.includes(cpu.socket)) issues.push({ level: "error", text: `Кулер не поддерживает сокет ${cpu.socket}.`, steps: ["cooler", "cpu"] });
  if (cooler && cpu && cpu.tdp > cooler.tdpMax) issues.push({ level: "warning", text: "Процессор горячее, чем рассчитан этот кулер.", steps: ["cooler", "cpu"] });
  if (mb && caseP && FORM_RANK[caseP.form] < FORM_RANK[mb.form]) issues.push({ level: "error", text: `Плата форм-фактора ${mb.form} не влезет в корпус ${caseP.form}.`, steps: ["motherboard", "case"] });

  const neededWatt = cpu ? computeNeededWatt(cpu.tdp, gpu?.tdp) : 0;
  if (psu && neededWatt) {
    const status = wattStatus(psu.watt, neededWatt);
    if (status === "error") issues.push({ level: "error", text: `Блоку питания не хватит мощности: нужно от ${neededWatt} Вт, а этот — ${psu.watt} Вт.`, steps: ["psu"] });
    else if (status === "warning") issues.push({ level: "warning", text: "Блок питания в притык по мощности — лучше взять с небольшим запасом.", steps: ["psu"] });
  }

  const errors = issues.filter((i) => i.level === "error");
  return { ok: errors.length === 0, issues, neededWatt };
}

/** Рекомендация блока питания под уже выбранные CPU/GPU (для подсказки в шаге PSU) */
export function recommendedWatt(sel) {
  const cpu = findPart("cpu", sel.cpu);
  const gpu = findPart("gpu", sel.gpu);
  if (!cpu) return null;
  return computeNeededWatt(cpu.tdp, gpu?.tdp);
}
