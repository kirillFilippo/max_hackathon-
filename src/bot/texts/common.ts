import { CB } from '../callbacks.js';
import { cb, withKeyboard, type MessageContent } from '../message.js';

export const mainMenu = (options: { hasEvents: boolean }): MessageContent => {
  const lines = [
    'Ассистент организатора',
    '',
    options.hasEvents
      ? 'События, участники и списки покупок — в разделе «Мои события».'
      : 'Начните с создания события: бот соберёт заявки и напомнит участникам.',
  ];

  return withKeyboard(lines.join('\n'), [
    [cb('Создать событие', CB.eventNew)],
    [cb('Профиль', CB.menuProfile), cb('Помощь', CB.menuHelp)],
  ]);
};

export const helpText = (): MessageContent =>
  withKeyboard(
    [
      'Как работает бот',
      '',
      'Организатору:',
      '/new — создать событие: название, дата, адрес, лимит, вопросы участникам',
      '/events — события, состав участников и список покупок',
      '/templates — наборы вопросов для новых событий',
      '/profile — имя и контакт для связи',
      '/faq — частые вопросы',
      '/cancel — прервать текущий шаг',
      '',
      'Участнику:',
      'перейдите по ссылке-приглашению или отправьте боту /join и код события.',
      '',
      'Напоминания приходят автоматически: за 1–2 дня бот просит подтвердить участие,',
      'за час — присылает детали встречи и адрес.',
    ].join('\n'),
    [[cb('В меню', CB.menuMain)]],
  );





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
