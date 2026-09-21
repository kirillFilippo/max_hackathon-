import { CB } from '../callbacks.js';
import { cb, withKeyboard, type MessageContent } from '../message.js';

export const mainMenu = (options: { hasEvents: boolean; hasDuties: boolean }): MessageContent => {
  const lines = [
    'Ассистент организатора',
    '',
    options.hasEvents
      ? 'События, участники и списки покупок — в разделе «Мои события».'
      : 'Начните с создания события: бот соберёт заявки и напомнит участникам.',
  ];
  if (options.hasDuties) {
    lines.push('', 'У вас есть незакрытые расчёты — раздел «Мои расчёты».');
  }

  return withKeyboard(lines.join('\n'), [
    [cb('Создать событие', CB.eventNew)],
    [cb('Мои события', CB.menuEvents), cb('Мои расчёты', CB.menuDuties)],
    [cb('Профиль и реквизиты', CB.menuProfile), cb('Помощь', CB.menuHelp)],
  ]);
};

export const helpText = (): MessageContent =>
  withKeyboard(
    [
      'Как работает бот',
      '',
      'Организатору:',
      '/new — создать событие: название, дата, адрес, лимит, вопросы участникам',
      '/events — события, состав участников, список покупок и выгрузка',
      '/templates — наборы вопросов для новых событий',
      '/duties — расчёты: кому и сколько вы должны или должны вам',
      '/profile — имя, контакт и реквизиты для переводов',
      '/faq — частые вопросы',
      '/cancel — прервать текущий шаг',
      '',
      'Участнику:',
      'перейдите по ссылке-приглашению или отправьте /join КОД (например /join A7K2Q).',
      '',
      'Напоминания приходят автоматически: за 1–2 дня бот просит подтвердить участие,',
      'за час — присылает детали встречи и адрес.',
    ].join('\n'),
    [[cb('В меню', CB.menuMain)]],
  );

export const cancelled = (): MessageContent =>
  withKeyboard('Действие отменено.', [[cb('В меню', CB.menuMain)]]);

export const eventNotFound = (code: string): MessageContent =>
  withKeyboard(
    `Событие с кодом ${code} не найдено.\n\nПроверьте код или попросите у организатора ссылку-приглашение.`,
    [[cb('В меню', CB.menuMain)]],
  );

export const notOrganizer = (): MessageContent =>
  withKeyboard('Это событие создал другой организатор, управлять им нельзя.', [
    [cb('В меню', CB.menuMain)],
  ]);

export const unknownInput = (hint: string): MessageContent =>
  withKeyboard(hint, [[cb('В меню', CB.menuMain)]]);

export const fallback = (options: { eventsCount: number }): MessageContent => {
  const hint =
    options.eventsCount > 0
      ? 'Не понял сообщение.\n\nОткройте «Мои события» или напишите вопрос словами: «где встречаемся», «во сколько начало», «что взять».'
      : 'Не понял сообщение.\n\nСоздайте событие командой /new или посмотрите /help.';
  return withKeyboard(hint, [
    [cb('Создать событие', CB.eventNew), cb('Мои события', CB.menuEvents)],
    [cb('Помощь', CB.menuHelp)],
  ]);
};
