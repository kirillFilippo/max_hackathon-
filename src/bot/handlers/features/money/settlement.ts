import { formatRub } from '../../../../domain/money.js';
import type { DosugEvent, TransferRequest } from '../../../../domain/types.js';
import { cbEventCard, cbMoneyShow } from '../../../callbacks.js';
import { show, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import { cb, withKeyboard } from '../../../message.js';
import { settlementPanel, transferDebtorCard } from '../../../texts/money.js';
import {
  findEventOrNotify,
  menuRow,
  sendToUser,
  userIdOf,
} from '../../helpers.js';

import { nameResolver } from './shared.js';

export const showSettlement = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await findEventOrNotify(ctx, deps, code);
  if (!event) return;
  const view = await deps.settlements.view(event);
  const requests = await deps.settlements.listByEvent(event.id);
  await show(
    ctx,
    settlementPanel(view, requests, {
      tz: deps.config.appTz,
      isOrganizer: event.organizerId === userIdOf(ctx),
      nameOf: nameResolver(view.participants),
    }),
  );
};

/** Создаёт запросы на перевод и рассылает должникам, кому и сколько они должны. */
export const requestTransfers = async (
  ctx: BotContext,
  deps: AppDeps,
  code: string,
): Promise<void> => {
  const event = await findEventOrNotify(ctx, deps, code);
  if (!event) return;
  if (event.organizerId !== userIdOf(ctx)) {
    await show(ctx, withKeyboard('Создавать запросы может только организатор.', menuRow));
    return;
  }

  const result = await deps.settlements.requestTransfers(event);
  const view = await deps.settlements.view(event);

  let sent = 0;
  for (const request of result.toNotify) {
    const creditor = await deps.profiles.get(request.toUserId);
    const debtor = await deps.profiles.get(request.fromUserId);
    const paidItems = view.items
      .filter((item) => item.reservation?.userId === request.fromUserId && item.reservation.paidKopecks != null)
      .map((item) => item.title);

    const delivered = await sendToUser(
      deps,
      request.fromUserId,
      transferDebtorCard({
        request,
        event,
        creditorName: creditor?.name ?? `id${request.toUserId}`,
        items: paidItems,
        profile: debtor,
        tz: deps.config.appTz,
      }),
    );
    if (delivered) sent += 1;
  }

  await show(
    ctx,
    withKeyboard(
      [
        `Запросы на перевод отправлены: ${sent}.`,
        result.alreadyNotified > 0
          ? `Уже получали карточку: ${result.alreadyNotified} — повторно не пишу, чтобы не дублировать.`
          : '',
        '',
        result.toNotify.length === 0
          ? 'Новых расчётов нет: переводы не требуются или все уже закрыты.'
          : `Всего в расчёте: ${formatRub(result.totalKopecks)}.`,
      ].join('\n'),
      [[cb('Обновить', cbMoneyShow(event.code)), cb('К событию', cbEventCard(event.code))]],
    ),
  );
};

/**
 * Должник нажал «Перевести и отправить реквизиты». Если реквизиты уже сохранены
 * в профиле — отправляем сразу, иначе запускаем короткий диалог.
 */
