/**
 * Единая схема callback-данных кнопок: короткий payload из «действие + аргументы».
 * Идентификаторы (коды событий, item_id, request_id) не содержат двоеточий, поэтому
 * разбор через split(':') однозначен.
 */

export const CB = {
  menuMain: 'menu:main',
  menuEvents: 'menu:events',
  menuTemplates: 'menu:templates',
  menuFaq: 'menu:faq',
  menuHelp: 'menu:help',
  menuProfile: 'menu:profile',
  menuDuties: 'menu:duties',

  eventNew: 'ev:new',
  eventList: 'ev:list',

  shopShow: 'shop:show',
  questionsApp: 'app:questions',
  questionsMode: 'q:mode',
  shopAdd: 'shop:add',
  shopReserve: 'shop:reserve',
  shopMine: 'shop:mine',

  profileContact: 'profile:contact',
  profilePayment: 'profile:payment',

  draftCancel: 'draft:cancel',
  draftSkip: 'draft:skip',
  templateNew: 'tpl:new',
  draftSaveTemplate: 'draft:savetpl:yes',
  draftBack: 'draft:back',
  draftPublish: 'draft:publish',
  draftFieldAdd: 'draft:field:add',
  draftTemplateNone: 'draft:template:none',
  draftTemplateOwn: 'draft:template:own',
  draftPlaceOk: 'draft:place:ok',
  draftPlaceRetry: 'draft:place:retry',

  regConfirm: 'reg:confirm',
  regCancel: 'reg:cancel',
  regNameSelf: 'reg:name:self',
  regContactSkip: 'reg:contact:skip',
} as const;

export const cbEventCard = (code: string): string => `ev:card:${code}`;
export const cbEventInfo = (code: string): string => `ev:info:${code}`;
export const cbEventPeople = (code: string): string => `ev:people:${code}`;
export const cbEventLink = (code: string): string => `ev:link:${code}`;
export const cbEventEdit = (code: string): string => `ev:edit:${code}`;
export const cbEventEditField = (code: string, field: string): string => `ev:set:${code}:${field}`;
export const cbEventRemind = (code: string): string => `ev:remind:${code}`;
export const cbEventClose = (code: string): string => `ev:close:${code}`;

export const cbShopShow = (code: string): string => `shop:show:${code}`;
export const cbShopAdd = (code: string): string => `shop:add:${code}`;
export const cbShopReserve = (code: string): string => `shop:reserve:${code}`;
export const cbShopMine = (code: string): string => `shop:mine:${code}`;
export const cbShopNotify = (code: string): string => `shop:notify:${code}`;

export const cbItemTake = (code: string, itemId: string): string => `item:take:${code}:${itemId}`;
export const cbItemRelease = (code: string, itemId: string): string => `item:release:${code}:${itemId}`;
export const cbItemPrice = (code: string, itemId: string): string => `item:price:${code}:${itemId}`;

export const cbMoneyShow = (code: string): string => `money:show:${code}`;
export const cbMoneyRequest = (code: string): string => `money:request:${code}`;

export const cbTransferDetails = (requestId: string): string => `tr:details:${requestId}`;
export const cbTransferPerson = (requestId: string): string => `tr:person:${requestId}`;
export const cbTransferPaid = (requestId: string): string => `tr:paid:${requestId}`;
export const cbTransferReceived = (requestId: string): string => `tr:received:${requestId}`;

export const cbDraftTemplate = (templateId: string): string => `draft:template:${templateId}`;
export const cbDraftFieldType = (type: string): string => `draft:fieldtype:${type}`;
export const cbDraftFieldRequired = (required: boolean): string => `draft:fieldreq:${required ? 'yes' : 'no'}`;
export const cbDraftFieldRemove = (index: number): string => `draft:fieldremove:${index}`;
export const cbDraftEditorSkip = (): string => 'draft:editorskip';
export const cbDraftEditorCancel = (): string => 'draft:editorcancel';
export const cbDraftFieldMultiple = (multiple: boolean): string =>
  `draft:fieldmulti:${multiple ? 'yes' : 'no'}`;
export const cbDraftFieldPreset = (label: string): string => `draft:fieldpreset:${label}`;
export const cbQuestionsApp = (scope: 'draft' | string): string => `app:questions:${scope}`;
export const cbQuestionsModeShow = (scope: string): string => `q:mode:${scope}`;
export const cbQuestionsModeSet = (scope: string, mode: string): string => `q:set:${scope}:${mode}`;
/** Возврат из экрана способа ответа к списку вопросов черновика. */
export const cbQuestionsModeBack = (scope: string): string => `q:back:${scope}`;
export const cbRegToggle = (fieldIndex: number, optionIndex: number): string =>
  `reg:toggle:${fieldIndex}:${optionIndex}`;

export const cbRegStart = (code: string): string => `reg:start:${code}`;
/** Кнопка «Записаться» в приглашении: начинает мастер регистрации. */
export const cbRegBegin = (code: string): string => `reg:begin:${code}`;
export const cbRegChange = (code: string): string => `reg:change:${code}`;
export const cbRegStatus = (code: string, status: string): string => `reg:status:${code}:${status}`;
export const cbRegAnswer = (index: number, value: string): string => `reg:answer:${index}:${value}`;

export const cbTemplateUse = (templateId: string): string => `tpl:use:${templateId}`;
export const cbTemplateRename = (templateId: string): string => `tpl:rename:${templateId}`;
export const cbTemplateEdit = (templateId: string): string => `tpl:edit:${templateId}`;
export const cbTemplateDelete = (templateId: string): string => `tpl:delete:${templateId}`;
export const cbTemplateDeleteOk = (templateId: string): string => `tpl:delok:${templateId}`;

export const cbFaqQuestion = (key: string): string => `faq:q:${key}`;
export const cbFaqEvent = (code: string, key: string): string => `faq:ev:${code}:${key}`;

export interface ParsedCallback {
  action: string;
  args: string[];
}

export const parseCallback = (payload: string): ParsedCallback => {
  const [action = '', ...args] = payload.split(':');
  return { action, args };
};

/** Публичная ссылка на бота с payload диплинка. */
export const buildInviteUrl = (botUsername: string, eventCode: string): string =>
  `https://max.ru/${botUsername}?start=ev_${eventCode}`;

/** Диплинк мини-приложения с анкетой: MAX отдаёт это в start_param. */
export const buildAnswersUrl = (botUsername: string, eventCode: string): string =>
  `https://max.ru/${botUsername}?startapp=ev_${eventCode}`;

/**
 * Диплинк мини-приложения с конструктором вопросов. Открываем конструктор тем же
 * способом, что и анкету участника: MAX сам открывает зарегистрированное
 * мини-приложение, а подпись мастера едет в `start_param`.
 */
export const buildConstructorUrl = (botUsername: string, ticket: string): string =>
  `https://max.ru/${botUsername}?startapp=${CONSTRUCTOR_START_PREFIX}${ticket}`;

export const EVENT_START_PREFIX = 'ev_';
export const CONSTRUCTOR_START_PREFIX = 'tpl_';

/** Достаёт код события из payload диплинка `/start`. */
export const eventCodeFromStartPayload = (payload: string | null | undefined): string | null => {
  if (!payload || !payload.startsWith(EVENT_START_PREFIX)) return null;
  const code = payload.slice(EVENT_START_PREFIX.length).trim().toUpperCase();
  return code.length > 0 ? code : null;
};
