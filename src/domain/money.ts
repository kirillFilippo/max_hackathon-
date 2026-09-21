/**
 * Расчёты по общим тратам.
 *
 * Модель: есть список покупок, каждую позицию резервирует ровно один человек,
 * после покупки он вводит фактически потраченную сумму. Общая сумма делится
 * поровну между участниками, которые идут на событие; дальше считаем, кто
 * сколько внёс, и собираем минимальный список переводов.
 *
 * Считаем в копейках целыми числами, чтобы округление не «теряло» рубли.
 * Бот только считает и показывает раскладку — платежи участники проводят сами.
 */

import type { SettlementItem } from './types.js';

export interface MoneyParticipant {
  userId: number;
  name: string;
}

export interface PaidByEntry {
  userId: number;
  name: string;
  amountKopecks: number;
}

export interface BalanceEntry {
  userId: number;
  name: string;
  /** Внёс минус доля: > 0 — должны ему, < 0 — должен он. */
  balanceKopecks: number;
}

export interface TransferEntry {
  fromUserId: number;
  fromName: string;
  toUserId: number;
  toName: string;
  amountKopecks: number;
}

export interface Settlement {
  totalKopecks: number;
  participantsCount: number;
  /** Доля каждого участника. */
  perPersonKopecks: number;
  /** Нераспределённый остаток округления — показываем честно. */
  roundingRemainderKopecks: number;
  paid: PaidByEntry[];
  balances: BalanceEntry[];
  transfers: TransferEntry[];
  /** Позиции, забронированные, но без указанной суммы: в расчёт не входят. */
  itemsWithoutAmount: SettlementItem[];
  /** Свободные позиции: их ещё никто не взял. */
  unreservedItems: SettlementItem[];
}

export const toKopecks = (rubles: number): number => Math.round(rubles * 100);

export const fromKopecks = (kopecks: number): number => kopecks / 100;

/**
 * @param items позиции списка покупок (с бронью и фактической суммой)
 * @param participants участники, между которыми делим траты (обычно «иду»)
 */
export const computeSettlement = (
  items: SettlementItem[],
  participants: MoneyParticipant[],
): Settlement => {
  const paidItems = items.filter(
    (item) => item.reservedByUserId !== null && item.paidKopecks !== null,
  );
  const itemsWithoutAmount = items.filter(
    (item) => item.reservedByUserId !== null && item.paidKopecks === null,
  );
  const unreservedItems = items.filter((item) => item.reservedByUserId === null);

  const totalKopecks = paidItems.reduce((sum, item) => sum + (item.paidKopecks ?? 0), 0);
  const participantsCount = participants.length;
  const perPersonKopecks = participantsCount > 0 ? Math.round(totalKopecks / participantsCount) : 0;

  const paidMap = new Map<number, PaidByEntry>();
  for (const participant of participants) {
    paidMap.set(participant.userId, {
      userId: participant.userId,
      name: participant.name,
      amountKopecks: 0,
    });
  }
  for (const item of paidItems) {
    const userId = item.reservedByUserId!;
    const existing = paidMap.get(userId);
    if (existing) {
      existing.amountKopecks += item.paidKopecks ?? 0;
    } else {
      // Позицию взял человек, который не отмечен идущим — расход всё равно учитываем.
      paidMap.set(userId, {
        userId,
        name: item.reservedByName ?? `id${userId}`,
        amountKopecks: item.paidKopecks ?? 0,
      });
    }
  }

  const paid = [...paidMap.values()];
  const balances: BalanceEntry[] = paid.map((entry) => ({
    userId: entry.userId,
    name: entry.name,
    balanceKopecks: entry.amountKopecks - perPersonKopecks,
  }));

  const creditors = balances
    .filter((entry) => entry.balanceKopecks > 0)
    .map((entry) => ({ ...entry }))
    .sort((a, b) => b.balanceKopecks - a.balanceKopecks);
  const debtors = balances
    .filter((entry) => entry.balanceKopecks < 0)
    .map((entry) => ({ ...entry }))
    .sort((a, b) => a.balanceKopecks - b.balanceKopecks);

  const transfers: TransferEntry[] = [];
  let creditorIndex = 0;
  let debtorIndex = 0;
  while (creditorIndex < creditors.length && debtorIndex < debtors.length) {
    const creditor = creditors[creditorIndex]!;
    const debtor = debtors[debtorIndex]!;
    const amount = Math.min(creditor.balanceKopecks, -debtor.balanceKopecks);
    if (amount > 0) {
      transfers.push({
        fromUserId: debtor.userId,
        fromName: debtor.name,
        toUserId: creditor.userId,
        toName: creditor.name,
        amountKopecks: amount,
      });
      creditor.balanceKopecks -= amount;
      debtor.balanceKopecks += amount;
    }
    if (creditor.balanceKopecks <= 0) creditorIndex += 1;
    if (debtor.balanceKopecks >= 0) debtorIndex += 1;
  }

  return {
    totalKopecks,
    participantsCount,
    perPersonKopecks,
    roundingRemainderKopecks: totalKopecks - perPersonKopecks * participantsCount,
    paid: paid.sort((a, b) => b.amountKopecks - a.amountKopecks),
    balances,
    transfers,
    itemsWithoutAmount,
    unreservedItems,
  };
};

const formatNumber = (value: number): string =>
  value
    .toLocaleString('ru-RU', {
      minimumFractionDigits: value % 1 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    })
    // Intl вставляет узкий неразрывный пробел — приводим к обычному.
    .replace(/[\u202f\u00a0]/g, ' ');

/** «1 250 ₽» или «350,50 ₽». */
export const formatRub = (kopecks: number): string => `${formatNumber(fromKopecks(kopecks))} ₽`;

/** Разбирает сумму из сообщения: «350», «350,50», «1 200 ₽», «бесплатно» → null, мусор → undefined. */
export const parsePriceKopecks = (input: string): number | null | undefined => {
  const raw = input.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s|\u00a0/g, '');
  if (['бесплатно', 'нет', '-', '0', '0р', '0руб', 'безцены'].includes(raw)) return null;
  const match = /^(\d{1,7})(?:[.,](\d{1,2}))?(?:₽|р|руб|рублей|рубля)?$/.exec(raw);
  if (!match) return undefined;
  const rubles = Number(match[1]);
  const cents = match[2] ? Number(match[2].padEnd(2, '0')) : 0;
  return rubles * 100 + cents;
};
