import { show, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import { CB } from '../../../callbacks.js';
import { cb, withKeyboard } from '../../../message.js';
import { answerModeScreen } from '../../questions.js';
import { showEventCard } from '../../features/events.js';
import { findEventOrNotify, isOrganizerOf, refuseNotOrganizer } from '../../helpers.js';


export const handleQuestions = async (
  ctx: BotContext,
  deps: AppDeps,
  args: string[],
): Promise<void> => {
// «Способ ответа на анкету» для опубликованного события: скрытая настройка,
// которую организатор может переопределить.
const [sub, scope = '', mode = ''] = args;
// Кнопки с scope «draft» обрабатывает мастер: у него есть сам черновик.
if (scope === 'draft') {
  await show(
    ctx,
    withKeyboard('Этот экран устарел: откройте событие заново, черновик мастера не активен.', [
      [cb('К событиям', CB.menuEvents)],
    ]),
  );
  return;
}
const event = await findEventOrNotify(ctx, deps, scope);
if (!event) return;
if (!isOrganizerOf(ctx, event)) {
  await refuseNotOrganizer(ctx, 'Менять способ ответа может только организатор.');
  return;
}
if (sub === 'mode') {
  await show(ctx, answerModeScreen(event.code, event.fields, event.answerMode));
  return;
}
if (sub === 'set' && (mode === 'auto' || mode === 'chat' || mode === 'miniapp')) {
  await deps.events.update(event.id, { answerMode: mode });
  await showEventCard(ctx, deps, event.code);
  return;
}
return;
};

export const handleApp = async (
  ctx: BotContext,
  deps: AppDeps,
  args: string[],
): Promise<void> => {
await show(
  ctx,
  withKeyboard(
    'Конструктор вопросов открывается из мастера создания события или из шаблона.',
    [[cb('Создать событие', CB.eventNew)]],
  ),
);
return;
};
