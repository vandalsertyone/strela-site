// Сценарии диалога — только данные. Реплики и варианты можно править без изменения логики.
//
// CATEGORIES — карточки и ветки диалога.
//   tags         — подписи на карточке, если нет брендов
//   start        — id первого вопроса ветки (см. NODES)
//   request      — как начинается сообщение в Telegram: «Здравствуйте! <request>: …»
//   keywords     — основы слов для распознавания свободного ввода (регистр не важен)
// NODES — вопросы ассистента.
//   say          — реплика помощника
//   param        — название параметра в карточке «Ваш запрос»
//   options      — кнопки-ответы: label (на кнопке), phrase (в сообщение; '' = не включать), next (id или 'summary')
//   rich         — необязательное «богатое» сообщение перед вопросом (бренды из ассортимента)
import { CONFIG } from "./config.js";

const budget = (key, say = "Какой бюджет рассматриваете?") => ({
  say,
  param: "Бюджет",
  options: [...CONFIG.budgets[key], CONFIG.budgetUnknown].map((o) => ({ ...o, next: "summary" })),
});

export const CATEGORIES = [
  {
    id: "laptop",
    title: "Ноутбуки",
    desc: "Игровые, для учёбы и для работы",
    icon: "laptop",
    brands: [],
    tags: ["Игровые", "Для учёбы", "Для работы"],
    userSays: "Ноутбуки",
    intro: "Отлично, ноутбуки! Уточню пару деталей.",
    start: "laptop_use",
    request: "Хочу подобрать ноутбук",
    keywords: ["ноут", "ноуб", "laptop", "macbook", "ультрабук", "нетбук"],
  },
  {
    id: "pc",
    title: "Сборка ПК",
    desc: "3D-конструктор с проверкой совместимости",
    icon: "pc",
    brands: [],
    tags: ["3D-сборка", "Совместимость", "Рассрочка"],
    userSays: "Сборка ПК",
    intro: "Для сборки ПК у нас есть отдельный конструктор: соберите его в 3D сами — с проверкой совместимости и расчётом рассрочки. Или дождитесь подбора с ИИ, он уже на подходе.",
    link: "configurator.html",
    request: "Хочу собрать ПК",
    keywords: ["(?<![\\p{L}])пк(?![\\p{L}])", "комп(?![\\p{L}])", "компа", "компо", "компу", "компьют", "сборк", "собра", "собер", "rtx", "gtx", "видеокарт", "системник", "процессор", "ryzen", "моноблок"],
  },
  {
    id: "keyboard",
    title: "Клавиатуры",
    desc: "От компактных 60% до полноразмерных",
    icon: "keyboard",
    brands: ["Red Square", "Keychron"],
    badge: "Эксклюзив Red Square в Strela",
    userSays: "Клавиатуры",
    intro: "Клавиатуры — отличный выбор. Уточню пару деталей.",
    start: "kb_size",
    request: "Хочу подобрать клавиатуру",
    keywords: ["клав", "keyboard", "свитч", "switch", "свич", "механик", "кейкап"],
  },
  {
    id: "mouse",
    title: "Мыши",
    desc: "Лёгкие, беспроводные, игровые",
    icon: "mouse",
    brands: ["Red Square", "Lunacy", "Dark Project"],
    userSays: "Мыши",
    intro: "Мыши — отличный выбор. Уточню пару деталей.",
    start: "ms_weight",
    request: "Хочу подобрать мышь",
    keywords: ["мыш", "mouse", "манипулятор"],
  },
  {
    id: "headphones",
    title: "Наушники",
    desc: "Игровые гарнитуры и не только",
    icon: "headphones",
    brands: ["Red Square", "Dark Project", "Lunacy", "Logitech"],
    userSays: "Наушники",
    intro: "Наушники — хороший выбор. Уточню пару деталей.",
    start: "hp_type",
    request: "Хочу подобрать наушники",
    keywords: ["науш", "гарнитур", "headset", "headphone", "tws", "airpods", "вкладыш"],
  },
  {
    id: "other",
    title: "Другое",
    desc: "Смартфоны, ТВ и остальная техника",
    icon: "box",
    brands: [],
    tags: ["Смартфоны", "ТВ", "И не только"],
    userSays: "Другое",
    intro: "Напишите, что ищете, — передам консультанту.",
    start: "other_text",
    request: "Хочу подобрать",
    keywords: [],
  },
];

// Бренды для мини-карточек внутри чата (только подтверждённые каталогом strelashop.by)
const brandsRich = (id) => {
  const c = CATEGORIES.find((x) => x.id === id);
  return { type: "brands", title: "В ассортименте Strela:", items: c.brands.map((name) => ({ name, exclusive: id === "keyboard" && name === "Red Square" })) };
};

export const NODES = {
  // ——— Ноутбук ———
  laptop_use: {
    say: "Для чего нужен ноутбук?",
    param: "Для чего",
    options: [
      { label: "Игры", phrase: "для игр", next: "laptop_size" },
      { label: "Учёба", phrase: "для учёбы", next: "laptop_size" },
      { label: "Работа", phrase: "для работы", next: "laptop_size" },
      { label: "Всё сразу", phrase: "для игр, учёбы и работы", next: "laptop_size" },
    ],
  },
  laptop_size: {
    say: "Какая диагональ удобнее?",
    param: "Диагональ",
    options: [
      { label: "14–15\"", phrase: "диагональ 14–15\"", next: "laptop_budget" },
      { label: "16\" и больше", phrase: "диагональ 16\" и больше", next: "laptop_budget" },
      { label: "Не важно", phrase: "", next: "laptop_budget" },
    ],
  },
  laptop_budget: budget("laptop"),

  // Сборка ПК теперь ведёт в отдельный конструктор (configurator.html) — см. CATEGORIES.pc.link в этом файле
  // и Dialog.linkOut в js/engine.js. Отдельных узлов диалога для неё больше нет.

  // ——— Клавиатура ———
  kb_size: {
    rich: brandsRich("keyboard"),
    say: "Какой размер клавиатуры нужен?",
    param: "Размер",
    options: [
      { label: "Полноразмерная", phrase: "полноразмерная", next: "kb_switch" },
      { label: "TKL", phrase: "TKL", next: "kb_switch" },
      { label: "75%", phrase: "75%", next: "kb_switch" },
      { label: "60%", phrase: "60%", next: "kb_switch" },
    ],
  },
  kb_switch: {
    say: "Какие свитчи предпочитаете?",
    param: "Свитчи",
    options: [
      { label: "Линейные", phrase: "линейные свитчи", next: "kb_conn" },
      { label: "Тактильные", phrase: "тактильные свитчи", next: "kb_conn" },
      { label: "Не знаю", phrase: "по свитчам нужна подсказка", next: "kb_conn" },
    ],
  },
  kb_conn: {
    say: "Как подключать?",
    param: "Подключение",
    options: [
      { label: "Провод", phrase: "проводная", next: "kb_budget" },
      { label: "Беспроводная", phrase: "беспроводная", next: "kb_budget" },
    ],
  },
  kb_budget: budget("keyboard"),

  // ——— Мышь ———
  ms_weight: {
    rich: brandsRich("mouse"),
    say: "Какая мышь по весу вам ближе?",
    param: "Вес",
    options: [
      { label: "Лёгкая", phrase: "лёгкая", next: "ms_conn" },
      { label: "Обычная", phrase: "обычного веса", next: "ms_conn" },
      { label: "Не важно", phrase: "", next: "ms_conn" },
    ],
  },
  ms_conn: {
    say: "Как подключать?",
    param: "Подключение",
    options: [
      { label: "Провод", phrase: "проводная", next: "ms_budget" },
      { label: "Беспроводная", phrase: "беспроводная", next: "ms_budget" },
    ],
  },
  ms_budget: budget("mouse"),

  // ——— Наушники ———
  hp_type: {
    rich: brandsRich("headphones"),
    say: "Какой тип наушников нужен?",
    param: "Тип",
    options: [
      { label: "Накладные", phrase: "накладные", next: "hp_conn" },
      { label: "Внутриканальные", phrase: "внутриканальные", next: "hp_conn" },
    ],
  },
  hp_conn: {
    say: "Как подключать?",
    param: "Подключение",
    options: [
      { label: "Провод", phrase: "проводные", next: "hp_mic" },
      { label: "Беспроводные", phrase: "беспроводные", next: "hp_mic" },
    ],
  },
  hp_mic: {
    say: "Нужен микрофон?",
    param: "Микрофон",
    options: [
      { label: "Нужен", phrase: "с микрофоном", next: "hp_budget" },
      { label: "Не нужен", phrase: "без микрофона", next: "hp_budget" },
    ],
  },
  hp_budget: budget("headphones"),

  // ——— Другое: ждём свободный ввод ———
  other_text: {
    say: "Напишите, что ищете, — передам консультанту.",
    param: "Запрос",
    freeText: true,
    options: [],
  },
};

// Реплики вне сценариев
export const PHRASES = {
  greeting: "Привет! Я помощник Strela. Выберите категорию или напишите своими словами, что ищете.",
  recognized: (title) => `Похоже, вас интересует: ${title.toLowerCase()}. Уточним пару деталей?`,
  recognizedYes: "Да, давайте",
  recognizedSkip: "Сразу консультанту",
  unrecognized: "Понял! Передам ваш запрос консультанту — он подберёт варианты.",
  noted: "Записал, добавлю это в запрос.",
  summary: "Готово! Проверьте запрос и отправьте его консультанту.",
  edit: "Что поменяем?",
};
