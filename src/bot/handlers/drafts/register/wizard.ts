import { STATUS_LABELS, type ParticipantStatus } from '../../../../domain/types.js';
import { validateAnswer } from '../../../../domain/validation.js';
import { show, userText, type BotContext } from '../../../context.js';
import type { AppDeps } from '../../../deps.js';
import { text, withKeyboard } from '../../../message.js';
import type { DraftState, RegisterStep } from '../../../session.js';
import { findEventOrNotify, menuRow, userIdOf } from '../../helpers.js';
import { callbackArgs } from '../fieldsScreen.js';
import {
  cancelNotice,
  contactPrompt,
  namePrompt,
  registerFieldPrompt,
  statusPrompt,
} from '../../../texts/registration.js';
import {
  goToFieldsOrConfirm,
  renderConfirm,
  renderField,
  type RegisterDraft,
} from './screens.js';
import { saveRegistration } from './submit.js';

export const registerDraftOwnsCallback = (
  step: RegisterStep,
  eventCode: string,
  args: string[],
): boolean => {
  const sub = args[0] ?? '';
  // Отмена и «Заполнить заново» относятся к мастеру на любом шаге.
  if (sub === 'cancel' || sub === 'start') return true;
  // Имя и контакт мастер принимает на любом шаге: кнопка из старого сообщения
  // не должна «проваливаться» в общий роутер и оставлять пользователя без ответа —
  // шаг в этом случае просто не откатывается (см. ветки name/contact ниже).
  if (sub === 'name' || sub === 'contact') return true;

  switch (step) {
    case 'name':
      return sub === 'name';
    case 'contact':
      return sub === 'contact';
    case 'status':
      // Статус принимаем только для своего события: чужое напоминание обработает роутер.
      return sub === 'status' && (args[1] ?? '') === eventCode;
    case 'fields':
      return sub === 'answer' || sub === 'toggle';
    case 'confirm':
      return sub === 'confirm';
    default:
      return false;
  }
};

/** Шаги мастера регистрации. */
export const handleRegisterDraft = async (
  ctx: BotContext,
  deps: AppDeps,
  draft: RegisterDraft,
): Promise<boolean> => {
  const isCallback = ctx.updateType === 'message_callback';
  const { action, args } = callbackArgs(ctx);
  const input = userText(ctx);

  // Отмена относится к мастеру целиком, а не к отдельному шагу: раньше она была
  // только на шаге подтверждения, и на остальных кнопка молча ничего не делала.
  if (isCallback && action === 'reg' && args[0] === 'cancel') {
    if (ctx.session) ctx.session.draft = null;
    await show(ctx, withKeyboard(cancelNotice(), menuRow));
    return true;
  }

  const event = await findEventOrNotify(ctx, deps, draft.data.eventCode);
  if (!event) {
    if (ctx.session) ctx.session.draft = null;
    return true;
  }

  if (isCallback && action === 'reg' && args[0] === 'start') {
    draft.step = 'name';
    draft.data.answers = {};
    draft.data.fieldIndex = 0;
    draft.data.status = undefined;
    const profile = await deps.profiles.get(userIdOf(ctx));
    await show(ctx, namePrompt(event, profile?.name ?? ''));
    return true;
  }

  switch (draft.step) {
    case 'name': {
      if (isCallback && action === 'reg' && args[0] === 'name' && args[1] === 'self') {
        // Повтор кнопки из старого сообщения: имя уже принято — шаг не откатываем.
        if (!draft.data.participantName) {
          const profile = await deps.profiles.get(userIdOf(ctx));
          draft.data.participantName = profile?.name ?? ctx.user?.name ?? '';
        }
      } else if (input) {
        draft.data.participantName = input.slice(0, 80);
      } else {
        const profile = await deps.profiles.get(userIdOf(ctx));
        await show(ctx, namePrompt(event, profile?.name ?? ''));
        return true;
      }
      draft.step = 'contact';
      await show(ctx, contactPrompt(event));
      return true;
    }

    case 'contact': {
      // «Пропустить» из старого сообщения: контакт уже принят — оставляем как есть.
      if (isCallback && action === 'reg' && args[0] === 'contact' && args[1] === 'skip'
        && draft.data.contact === undefined) {
        draft.data.contact = '';
      } else if (isCallback && action === 'reg' && args[0] === 'contact') {
        // ничего не меняем, идём дальше
      } else {
        const fromContact = ctx.contactInfo?.tel;
        const value = fromContact ?? input;
        if (!value) {
          await show(ctx, contactPrompt(event));
          return true;
        }
        draft.data.contact = value.slice(0, 120);
      }

      // Повтор старой кнопки «Пропустить»/контакта: шаг уже пройден — не откатываем.
      if (isCallback && draft.data.status) {
        await goToFieldsOrConfirm(ctx, deps, event, draft);
        return true;
      }

      if (draft.data.status) {
        await goToFieldsOrConfirm(ctx, deps, event, draft);
        return true;
      }
      draft.step = 'status';
      await show(ctx, statusPrompt(event));
      return true;
    }

    case 'status': {
      if (isCallback && action === 'reg' && args[0] === 'status') {
        const status = (args[2] ?? '') as ParticipantStatus | '';
        // Статус уже выбран: повторное нажатие той же кнопки не должно
        // переспрашивать — иначе на медленном клиенте вопрос возвращается.
        if (status && status in STATUS_LABELS) {
          if (draft.data.status === status) {
            await show(ctx, statusPrompt(event));
            return true;
          }
          draft.data.status = status;
          await goToFieldsOrConfirm(ctx, deps, event, draft);
          return true;
        }
      }

      // Кнопка пришла от старого сообщения (шаг уже сменился) — показываем, что
      // происходит сейчас, а не задаём вопрос заново.
      if (isCallback && draft.data.status) {
        await show(
          ctx,
          withKeyboard(
            `Статус уже выбран: ${STATUS_LABELS[draft.data.status]}. Продолжаем заполнение заявки.`,
            menuRow,
          ),
        );
        await goToFieldsOrConfirm(ctx, deps, event, draft);
        return true;
      }

      await show(ctx, statusPrompt(event));
      return true;
    }

    case 'fields': {
      const field = event.fields[draft.data.fieldIndex];
      if (!field) {
        draft.step = 'confirm';
        await renderConfirm(ctx, deps, event, draft.data);
        return true;
      }

      const store = async (value: string): Promise<void> => {
        const validation = validateAnswer(field, value);
        if (!validation.ok) {
          const prompt = registerFieldPrompt(field, draft.data.fieldIndex, event.fields.length);
          await show(ctx, { ...prompt, text: `${validation.error}\n\n${prompt.text}` });
          return;
        }
        draft.data.answers[field.id] = validation.value;
        draft.data.fieldIndex += 1;
        if (draft.data.fieldIndex >= event.fields.length) {
          draft.step = 'confirm';
          await renderConfirm(ctx, deps, event, draft.data);
        } else {
          await renderField(ctx, deps, event, draft);
        }
      };

      if (isCallback && action === 'reg' && args[0] === 'answer') {
        const targetIndex = Number(args[1]);
        const value = args[2] ?? '';
        if (targetIndex !== draft.data.fieldIndex) {
          await renderField(ctx, deps, event, draft);
          return true;
        }
        if (value === 'skip') {
          await store('');
          return true;
        }
        if (value === 'done') {
          // Подтверждение мультивыбора: проверить ограничения и перейти дальше.
          await store(draft.data.answers[field.id] ?? '');
          return true;
        }
        if (value === 'yes') {
          await store('Да');
          return true;
        }
        if (value === 'no') {
          await store('Нет');
          return true;
        }
        const option = field.options[Number(value)];
        if (option === undefined) {
          await renderField(ctx, deps, event, draft);
          return true;
        }
        await store(option);
        return true;
      }

      // Мультивыбор: кнопки накапливают выбор, «Готово» подтверждает.
      if (isCallback && action === 'reg' && args[0] === 'toggle') {
        const targetIndex = Number(args[1]);
        const optionIndex = Number(args[2]);
        if (targetIndex !== draft.data.fieldIndex || !field.multiple) {
          await renderField(ctx, deps, event, draft);
          return true;
        }
        const option = field.options[optionIndex];
        if (option === undefined) {
          await renderField(ctx, deps, event, draft);
          return true;
        }
        const current = (draft.data.answers[field.id] ?? '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        const next = current.includes(option)
          ? current.filter((item) => item !== option)
          : [...current, option];
        draft.data.answers[field.id] = next.join(', ');
        await renderField(ctx, deps, event, draft);
        return true;
      }

      if (field.type === 'choice' && !field.multiple) {
        await renderField(ctx, deps, event, draft);
        return true;
      }
      if (!input) {
        await renderField(ctx, deps, event, draft);
        return true;
      }
      await store(input);
      return true;
    }

    case 'confirm':
    default: {
      if (isCallback && action === 'reg' && args[0] === 'confirm') {
        await saveRegistration(ctx, deps, event, draft);
        return true;
      }
      await renderConfirm(ctx, deps, event, draft.data);
      return true;
    }
  }
};
