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
    '',
    'Реквизиты для переводов:',
    `  Банк: ${valueOrDash(profile?.bankName)}`,
    `  Номер или счёт: ${valueOrDash(profile?.paymentHandle)}`,
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
    [cb('Изменить контакт', CB.profileContact), cb('Изменить реквизиты', CB.profilePayment)],
    [cb('Мои расчёты', CB.menuDuties), cb('В меню', CB.menuMain)],
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

export const bankPrompt = (profile: UserProfile | null): MessageContent =>
  withKeyboard(
    [
      'Реквизиты для переводов',
      '',
      profile?.bankName
        ? `Сейчас: ${profile.bankName}, ${profile.paymentHandle}`
        : 'Сейчас реквизиты не указаны.',
      '',
      'Напишите название банка: например «Тинькофф» или «Сбер».',
    ].join('\n'),
    [[cb('Отмена', CB.draftCancel)]],
  );

export const handlePrompt = (bankName: string): MessageContent =>
  withKeyboard(
    ['Банк: ' + bankName, '', 'Теперь номер телефона, счёт или ник для перевода.'].join('\n'),
    [[cb('Отмена', CB.draftCancel)]],
  );

export const paymentSaved = (profile: UserProfile): MessageContent =>
  withKeyboard(
    [
      'Реквизиты сохранены',
      '',
      `Банк: ${profile.bankName}`,
      `Номер или счёт: ${profile.paymentHandle}`,
      '',
      'Их бот передаст тому, кому вы должны по расчётам.',
    ].join('\n'),
    [[cb('Профиль', CB.menuProfile), cb('В меню', CB.menuMain)]],
  );

export const contactSaved = (profile: UserProfile): MessageContent =>
  withKeyboard(
    [`Контакт сохранён: ${profile.contact}`, '', 'Организаторы увидят его в списке участников.'].join('\n'),
    [[cb('Профиль', CB.menuProfile), cb('В меню', CB.menuMain)]],
  );
