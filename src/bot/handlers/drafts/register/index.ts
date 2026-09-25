/**
 * Мастер регистрации участника разбит по шагам работы: экраны, сохранение заявки,
 * входы (ссылка, кнопка, карточка), смена статуса и сам мастер. Наружу всё отдаётся
 * через этот файл, поэтому импорты `drafts/register.js` не меняются.
 */
export * from './screens.js';
export * from './submit.js';
export * from './entry.js';
export * from './status.js';
export * from './wizard.js';
