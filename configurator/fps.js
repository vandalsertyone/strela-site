// Примерный FPS готовой сборки в популярных играх (по просьбе заказчика, 29.09.2026). Это ОЦЕНКА, не замер —
// на сайте так и подписано. Как считается:
//  1. Опорные точки — средний FPS видеокарты в тяжёлых играх на очень высоких настройках (Full HD / 2K / 4K),
//     поле `fps` в каталоге (из выгрузки характеристик; есть у RTX 5060, 5060 Ti, 5070).
//  2. Для остальных карт — пересчёт по относительной производительности видеочипа (PERF: RTX 5060 = 120, RTX 4060 = 100;
//     приближённые значения по сводным обзорам видеокарт, растеризация в Full HD) и типовому падению FPS в 2K/4K.
//  3. Для каждой игры — коэффициент «насколько она легче/тяжелее средней тяжёлой игры» на указанных настройках и
//     потолок, выше которого упирается движок или процессор.
// Процессор в расчёте не участвует — в сноске сказано, что в киберспортивных играх итог сильнее зависит от него.

// [шаблон названия видеочипа, относительная производительность]. Более длинные названия — раньше.
const PERF = [
  [/RTX 5080/, 255], [/RTX 5070 Ti/, 225], [/RTX 5070/, 180], [/RTX 5060 Ti/, 137], [/RTX 5060/, 120], [/RTX 5050/, 95],
  [/RTX 3070/, 112], [/RTX 3060 Ti/, 98], [/RTX 3060/, 78], [/RTX 3050/, 55], [/RTX 2060 Super/, 76],
  [/GTX ?1660 (Super|Ti)/, 57], [/GTX ?1650/, 42], [/GTX ?1050 Ti/, 34], [/GTX ?1050/, 28], [/GTX ?750 Ti/, 22],
  [/GT 740/, 12], [/GT 730/, 8], [/GT 710/, 5], [/GT 610/, 4], [/GT 210/, 3],
  [/RX 9070 XT/, 225], [/RX 9070/, 205], [/RX 9060 XT/, 135], [/RX 7600/, 98], [/RX 5700 XT/, 88], [/RX 580/, 50], [/RX 550/, 18], [/R5 2[23]0/, 3],
  [/RTX A4500/, 115], [/RTX 2000/, 65], [/RTX A2000/, 55], [/RTX A400/, 20],
];
const ANCHOR = { perf: 120, fhd: 86 }; // RTX 5060: 86 FPS в Full HD на очень высоких

export const RESOLUTIONS = [
  { key: 0, label: "Full HD", hint: "1920×1080" },
  { key: 1, label: "2K", hint: "2560×1440" },
  { key: 2, label: "4K", hint: "3840×2160" },
];

// k — во сколько раз FPS выше, чем в средней тяжёлой игре на очень высоких; cap — потолок движка/процессора
export const GAMES = [
  { name: "Counter-Strike 2", preset: "высокие", k: 3.0, cap: 450 },
  { name: "Valorant", preset: "высокие", k: 4.2, cap: 500 },
  { name: "Dota 2", preset: "высокие", k: 2.3, cap: 280 },
  { name: "Fortnite", preset: "высокие, без трассировки", k: 1.5, cap: 330 },
  { name: "PUBG: Battlegrounds", preset: "ультра", k: 1.6, cap: 280 },
  { name: "GTA V", preset: "очень высокие", k: 2.0, cap: 185 },
  { name: "Call of Duty: Warzone", preset: "высокие", k: 1.2, cap: 260 },
  { name: "Red Dead Redemption 2", preset: "высокие", k: 1.0, cap: 200 },
  { name: "Cyberpunk 2077", preset: "высокие, без трассировки", k: 1.0, cap: 220 },
];

const perfOf = (gpu) => PERF.find(([re]) => re.test(gpu.chip || gpu.name || ""))?.[1] ?? null;

/** Средний FPS видеокарты в тяжёлых играх [Full HD, 2K, 4K] — замер, если есть, иначе оценка. null — не знаем карту. */
export function gpuBaseFps(gpu) {
  if (!gpu) return null;
  if (gpu.fps?.[0]) return gpu.fps;
  const perf = perfOf(gpu);
  if (!perf) return null;
  const fhd = (ANCHOR.fhd * perf) / ANCHOR.perf;
  // чем мощнее карта, тем меньше она теряет в высоком разрешении; 8 ГБ и меньше в 4K ещё проседают
  const r2k = Math.min(0.8, 0.62 + 0.0006 * perf);
  const r4k = Math.min(0.5, 0.2 + 0.0011 * perf) * (gpu.vram && gpu.vram <= 8 ? 0.9 : 1);
  return [fhd, fhd * r2k, fhd * r4k];
}

const round = (n) => (n < 30 ? Math.round(n) : Math.round(n / 5) * 5);

/** Оценка FPS по играм для разрешения res (0/1/2): [{ name, preset, fps }] или null. */
export function estimateFps(gpu, res = 0) {
  const base = gpuBaseFps(gpu);
  if (!base) return null;
  return GAMES.map((g) => ({ name: g.name, preset: g.preset, fps: round(Math.min(g.cap, base[res] * g.k)) }));
}

/** Как ощущается такой FPS: подпись и уровень для цвета полоски */
export function fpsLevel(fps) {
  if (fps >= 144) return { level: 4, label: "144+ Гц" };
  if (fps >= 60) return { level: 3, label: "плавно" };
  if (fps >= 30) return { level: 2, label: "играбельно" };
  return { level: 1, label: "слабо" };
}
