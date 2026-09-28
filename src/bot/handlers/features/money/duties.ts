import type { DosugEvent, TransferRequest } from '../../../../domain/types.js';
import { show, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import { dutiesPanel, transferDebtorCard } from '../../../texts/money.js';
import { userIdOf } from '../../helpers.js';


export const showDebtorCard = async (
  ctx: BotContext,
  deps: AppDeps,
  request: TransferRequest,
): Promise<void> => {
  const event = await deps.events.findById(request.eventId);
  if (!event) return;
  const view = await deps.settlements.view(event);
  const creditor = await deps.profiles.get(request.toUserId);
  const profile = await deps.profiles.get(request.fromUserId);
  const items = view.items
    .filter((item) => item.reservation?.userId === request.fromUserId)
    .map((item) => item.title);
  await show(
    ctx,
    transferDebtorCard({
      request,
      event,
      creditorName: creditor?.name ?? `id${request.toUserId}`,
      items,
      profile,
      tz: deps.config.appTz,
    }),
  );
};

/** Раздел «Мои расчёты»: долги пользователя и то, что должны ему. */
export const showDuties = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  const userId = userIdOf(ctx);
  const [debtsRaw, creditsRaw] = await Promise.all([
    deps.settlements.listForDebtor(userId),
    deps.settlements.listForCreditor(userId),
  ]);

  const eventCache = new Map<string, DosugEvent | null>();
  const loadEventCached = async (id: string): Promise<DosugEvent | null> => {
    if (!eventCache.has(id)) eventCache.set(id, await deps.events.findById(id));
    return eventCache.get(id) ?? null;
  };

  const debts = [];
  for (const request of debtsRaw) {
    const event = await loadEventCached(request.eventId);
    if (!event) continue;
    debts.push({
      request,
      event,
      creditorName: (await deps.profiles.get(request.toUserId))?.name ?? `id${request.toUserId}`,
    });
  }
  const credits = [];
  for (const request of creditsRaw) {
    const event = await loadEventCached(request.eventId);
    if (!event) continue;
    credits.push({
      request,
      event,
      debtorName: (await deps.profiles.get(request.fromUserId))?.name ?? `id${request.fromUserId}`,
    });
  }

  await show(ctx, dutiesPanel({ debts, credits }));
};
