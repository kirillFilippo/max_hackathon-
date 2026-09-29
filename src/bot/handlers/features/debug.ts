import { show, type BotContext } from '../../context.js';
import type { AppDeps } from '../../deps.js';
import type { DebugScenario } from '../../../services/debugService.js';
import { cb, withKeyboard } from '../../message.js';
import { cbEventCard, cbShopShow } from '../../callbacks.js';
import { menuRow, requireUser } from '../helpers.js';
import { openEventForParticipant, showEventCard } from './events.js';
import { isGoing } from '../../../domain/stats.js';

/**
 * Отладочные команды: быстро получить событие с людьми.
 *
 * `/debugcreateevent` — создаёт событие от имени вызывающего и наполняет его
 * синтетическими участниками, ответами и списком покупок.
 * `/debugreceiveevent` — создаёт событие «чужого» организатора и записывает
 * вызывающего участником: видно путь участника, а не организатора.
 *
 * Команды включаются переменной `DEBUG_COMMANDS=1`; синтетическим людям
 * сообщения не отправляются (у них отрицательные id).
 */
export const DEBUG_CREATE_COMMAND = 'debugcreateevent';
export const DEBUG_RECEIVE_COMMAND = 'debugreceiveevent';

const scenarioSummary = (scenario: DebugScenario): string => {
  const going = scenario.participants.filter(
    isGoing,
  ).length;
  const waiting = scenario.participants.filter((item) => item.waitlisted).length;
  const maybe = scenario.participants.filter((item) => item.status === 'maybe').length;
  const notGoing = scenario.participants.filter((item) => item.status === 'not_going').length;

  const parts = [`идут ${going}`];
  if (waiting > 0) parts.push(`в листе ожидания ${waiting}`);
  if (maybe > 0) parts.push(`под вопросом ${maybe}`);
  if (notGoing > 0) parts.push(`не идут ${notGoing}`);

  return [
    `Участников: ${scenario.participants.length} (${parts.join(', ')}).`,
    `Список покупок: ${scenario.items.length} позиции, забронировано ${scenario.reservedItems}.`,
    'Отладочные участники помечены отрицательными id: сообщения им не отправляются.',
  ].join('\n');
};

/** Наполняет событие данными и показывает его карточку организатору. */
export const debugCreateEvent = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  if (!deps.config.debugCommands) {
    await show(ctx, withKeyboard('Отладочные команды выключены (DEBUG_COMMANDS=1).', menuRow));
    return;
  }

  const user = requireUser(ctx);
  const scenario = await deps.debug.createFilledEvent({ userId: user.user_id, name: user.name });

  await show(
    ctx,
    withKeyboard(
      [
        'Отладочное событие создано.',
        scenarioSummary(scenario),
        `Код события: ${scenario.event.code}.`,
      ].filter(Boolean).join('\n'),
      [[cb('Открыть карточку', cbEventCard(scenario.event.code))], ...menuRow],
    ),
  );
  await showEventCard(ctx, deps, scenario.event.code);
};

/** Записывает вызывающего участником в отладочное событие «чужого» организатора. */
export const debugReceiveEvent = async (ctx: BotContext, deps: AppDeps): Promise<void> => {
  if (!deps.config.debugCommands) {
    await show(ctx, withKeyboard('Отладочные команды выключены (DEBUG_COMMANDS=1).', menuRow));
    return;
  }

  const user = requireUser(ctx);
  const scenario = await deps.debug.createEventForParticipant({
    userId: user.user_id,
    name: user.name,
  });

  await show(
    ctx,
    withKeyboard(
      [
        'Вы записаны в отладочное событие.',
        scenarioSummary(scenario),
        `Код события: ${scenario.event.code}.`,
        'Заявка в статусе «под вопросом» — подтвердите участие кнопками в карточке.',
      ].join('\n'),
      [
        [cb('Моя карточка', cbEventCard(scenario.event.code))],
        [cb('Список покупок', cbShopShow(scenario.event.code))],
        ...menuRow,
      ],
    ),
  );
  await openEventForParticipant(ctx, deps, scenario.event.code);
};
