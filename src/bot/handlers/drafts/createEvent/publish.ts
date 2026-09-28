import type { DraftState } from '../../../session.js';
import { cbEventLink } from '../../../callbacks.js';
import { replyTo, show, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import { cb, withKeyboard } from '../../../message.js';
import { organizerEventCard } from '../../../texts/event.js';
import { eventViewOptions } from '../../features/events.js';
import { botUsernameOf, menuRow } from '../../helpers.js';



import type { CreateEventDraft } from './types.js';

export const publish = async (ctx: BotContext, deps: AppDeps, draft: CreateEventDraft): Promise<void> => {
  const user = ctx.user;
  if (!user || !draft.data.title || !draft.data.startsAt || !draft.data.place) {
    await show(ctx, withKeyboard('Черновик потерялся, начните заново.', menuRow));
    return;
  }

  const event = await deps.events.create({
    title: draft.data.title,
    description: draft.data.description ?? '',
    startsAt: draft.data.startsAt,
    place: draft.data.place,
    placeCoords: draft.data.placeCoords ?? null,
    limit: draft.data.limit ?? null,
    fields: draft.fields,
    answerMode: draft.data.answerMode ?? 'auto',
    organizerId: user.user_id,
    organizerName: user.name,
  });

  if (ctx.session) {
    ctx.session.draft = null;
    ctx.session.lastEventCode = event.code;
  }

  const options = eventViewOptions(ctx, deps);
  await show(ctx, organizerEventCard(event, deps.events.stats(event, []), options, 0));

  const link = deps.events.inviteLink(event, botUsernameOf(ctx, deps));
  await replyTo(
    ctx,
    link
      ? withKeyboard(
          [
            'Отправьте участникам ссылку-приглашение:',
            link,
            '',
            `Код события: ${event.code}. Если ссылку неудобно пересылать, участник может отправить боту /join ${event.code}.`,
            'Адрес и карта — в разделе «Доп. информация» карточки события.',
          ].join('\n'),
          [[cb('Показать ссылку ещё раз', cbEventLink(event.code))]],
        )
      : withKeyboard(
          `Событие создано. Код для участников: ${event.code}. Пусть отправят боту /join ${event.code}.`,
          [[cb('К событию', `ev:card:${event.code}`)]],
        ),
  );
};
