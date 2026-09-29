// Все настройки лендинга в одном месте. Правьте значения, логику трогать не нужно.

export const CONFIG = {
  // ВРЕМЕННАЯ заглушка — заменить на аккаунт консультанта (без @)
  telegramUsername: "YoungUSDT",

  catalogUrl: "https://strelashop.by",
  // Отдельная страница конструктора ПК (см. configurator.html и configurator/*)
  configuratorUrl: "configurator.html",
  telegramChannel: "https://t.me/strela_shop",
  instagram: "https://www.instagram.com/strelashop.by/",
  youtube: "https://www.youtube.com/channel/UCtuuD6V2ftt_w9wyCWxRnWg",

  // Текст, если человек нажал «Написать консультанту», не пройдя диалог
  defaultMessage: "Здравствуйте! Хочу проконсультироваться по технике",

  // Метки источника: ?src=<ключ> → «Источник: <название>».
  // Ключ пишите строчными латинскими буквами. Неизвестная метка выводится как есть.
  sources: {
    marit: "Минск, МАРИТ",
    aud: "Могилёв, АУД",
    gray: "Гомель, ГРАЙ",
    ittan: "Витебск, ИТТАН",
    oda: "Гродно, ОДА",
    saga: "Могилёв, САГА",
    sign: "Могилёв, СИГН",
    tryud: "Витебск, ТРЮД",
    frigg: "Могилёв, ФРИГГ",
    promo: "Акция",
  },

  // Диапазоны бюджета в BYN по категориям.
  // label — надпись на кнопке, phrase — фрагмент сообщения в Telegram.
  budgets: {
    laptop: [
      { label: "до 1500 BYN", phrase: "бюджет до 1500 BYN" },
      { label: "1500–2500 BYN", phrase: "бюджет 1500–2500 BYN" },
      { label: "2500–4000 BYN", phrase: "бюджет 2500–4000 BYN" },
      { label: "от 4000 BYN", phrase: "бюджет от 4000 BYN" },
    ],
    pc: [
      { label: "до 2000 BYN", phrase: "бюджет до 2000 BYN" },
      { label: "2000–3500 BYN", phrase: "бюджет 2000–3500 BYN" },
      { label: "3500–5500 BYN", phrase: "бюджет 3500–5500 BYN" },
      { label: "от 5500 BYN", phrase: "бюджет от 5500 BYN" },
    ],
    keyboard: [
      { label: "до 100 BYN", phrase: "бюджет до 100 BYN" },
      { label: "100–250 BYN", phrase: "бюджет 100–250 BYN" },
      { label: "250–500 BYN", phrase: "бюджет 250–500 BYN" },
      { label: "от 500 BYN", phrase: "бюджет от 500 BYN" },
    ],
    mouse: [
      { label: "до 60 BYN", phrase: "бюджет до 60 BYN" },
      { label: "60–150 BYN", phrase: "бюджет 60–150 BYN" },
      { label: "150–300 BYN", phrase: "бюджет 150–300 BYN" },
      { label: "от 300 BYN", phrase: "бюджет от 300 BYN" },
    ],
    headphones: [
      { label: "до 100 BYN", phrase: "бюджет до 100 BYN" },
      { label: "100–250 BYN", phrase: "бюджет 100–250 BYN" },
      { label: "250–500 BYN", phrase: "бюджет 250–500 BYN" },
      { label: "от 500 BYN", phrase: "бюджет от 500 BYN" },
    ],
  },
  // Вариант «не знаю» в любом бюджете
  budgetUnknown: { label: "Подскажите", phrase: "по бюджету нужна подсказка" },

  // Подсказки, которые сменяются в поле ввода
  placeholders: [
    "игровой ноутбук с RTX…",
    "сборка ПК под 1440p…",
    "клавиатура 75% на линейных свитчах…",
    "беспроводные игровые наушники…",
  ],

  // Задержки «печатает…» (мс)
  typing: { min: 400, max: 900 },
};
