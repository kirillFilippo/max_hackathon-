import type { UserProfile } from '../../domain/types.js';
import { CB } from '../callbacks.js';
import { cb, valueOrDash, withKeyboard, type KeyboardRows, type MessageContent } from '../message.js';

export interface ParticipationLine {
  title: string;
  startsAt: string;
  status: string;
}

export const profileCard = (
  profile: UserProfile | null,
  participations: ParticipationLine[],
): MessageContent => {
  const lines = [
    'Профиль',
    '',
    `Имя: ${valueOrDash(profile?.name)}`,
    `Ник в MAX: ${profile?.username ? `@${profile.username}` : '—'}`,
    `Контакт: ${valueOrDash(profile?.contact)}`,
  ];

  if (participations.length > 0) {
    lines.push('', 'Ваши заявки:');
    participations.slice(0, 5).forEach((entry) => {
      lines.push(`  ${entry.title} — ${entry.status}`);
    });
  }

  lines.push(
    '',
    'Данные хранятся в базе бота и не теряются при перезапуске и обновлении.',
  );

  const rows: KeyboardRows = [
    [cb('Изменить контакт', CB.profileContact)],
    [cb('Мои события', CB.menuEvents), cb('В меню', CB.menuMain)],
  ];
  return withKeyboard(lines.join('\n'), rows);
};

export const contactPrompt = (profile: UserProfile | null): MessageContent =>
  withKeyboard(
    [
      'Контакт для связи',
      '',
      profile?.contact ? `Сейчас: ${profile.contact}` : 'Сейчас контакт не указан.',
      '',
      'Напишите телефон, почту или ник — организатор увидит это в списке участников.',
    ].join('\n'),
    [[cb('Отмена', CB.draftCancel)]],
  );

export const contactSaved = (profile: UserProfile): MessageContent =>
  withKeyboard(
    [`Контакт сохранён: ${profile.contact}`, '', 'Организаторы увидят его в списке участников.'].join('\n'),
    [[cb('Профиль', CB.menuProfile), cb('В меню', CB.menuMain)]],
  );
