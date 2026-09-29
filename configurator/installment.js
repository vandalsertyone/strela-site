// Калькулятор «Оплата частями» — по сути это потребительский кредит: ставка и сроки заданы
// владельцем магазина (переписка от 29.09.2026), но на странице это осознанно называется
// «Оплата частями», а не «кредит» или «рассрочка». Ставку в мелкий шрифт всё же выводим —
// иначе на сайте, который считает деньги за клиента, это выглядело бы как скрытые условия.
export const CREDIT_ANNUAL_RATE = 0.1765; // 17.65% годовых
export const INSTALLMENT_MONTHS = [12, 18, 24, 36, 48];

/**
 * Аннуитетный платёж: одинаковая сумма каждый месяц весь срок.
 * @returns {{months:number, perMonth:number, total:number, overpay:number}}
 */
export function splitPrice(total, months, annualRate = CREDIT_ANNUAL_RATE) {
  const r = annualRate / 12;
  const raw = total * r * Math.pow(1 + r, months) / (Math.pow(1 + r, months) - 1);
  const perMonth = Math.ceil(raw);
  return { months, perMonth, total: perMonth * months, overpay: perMonth * months - total };
}
