/**
 * Мини-приложение «Анкета участника»: вопросы списком, как в Google Forms.
 *
 * Открывается по диплинку `https://max.ru/<бот>?startapp=ev_КОД`, когда анкета
 * тяжёлая (вес вопросов ≥ порога) — тогда отвечать в чате неудобно.
 * Страница показывает все вопросы сразу, проверяет ввод по ограничениям и
 * отправляет ответы на сервер бота вместе с подписью запуска (initData).
 */
import { finishJs, initDataJs, notifyJs, pageHead, redirectJs, startParamJs, webAppReadyJs } from './pageShell.js';

export const renderAnswerPageHtml = (options: { title: string }): string => `${pageHead({ title: options.title })}
<style>
  :root { --ink:#14181f; --muted:#5b6673; --line:#d7dde5; --accent:#1f6feb; --bg:#f4f6fa; --danger:#b4232c; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:15px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; padding:12px 12px 110px; }
  h1 { font-size:18px; margin:4px 0 2px; }
  .hint { color:var(--muted); font-size:13px; margin-bottom:12px; }
  .event { background:#fff; border:1px solid var(--line); border-radius:10px; padding:12px; margin-bottom:10px; font-size:14px; }
  .event b { display:block; margin-bottom:4px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:12px; margin-bottom:10px; }
  .card .q { font-size:14px; font-weight:600; margin-bottom:2px; }
  .card .c { color:var(--muted); font-size:12px; margin-bottom:8px; }
  label.choice { display:flex; align-items:center; gap:8px; padding:6px 0; font-size:14px; }
  label.choice input { width:auto; }
  label.field { display:block; font-size:13px; color:var(--muted); margin:6px 0 4px; }
  input[type=text], input[type=number], input[type=date], select, textarea { width:100%; border:1px solid var(--line);
      border-radius:8px; padding:10px; font:inherit; background:#fff; color:var(--ink); }
  .statuses { display:flex; gap:8px; margin-bottom:12px; }
  .statuses button { flex:1; }
  button { font:inherit; border-radius:8px; border:1px solid var(--line); background:#fff; padding:10px 12px; color:var(--ink); }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; }
  button.active { border-color:var(--accent); color:var(--accent); font-weight:600; }
  .actions { position:fixed; left:0; right:0; bottom:0; padding:12px;
      background:linear-gradient(180deg, rgba(244,246,250,0) 0%, var(--bg) 30%); }
  .actions button { width:100%; }
  .error { color:var(--danger); font-size:13px; margin-top:6px; }
  .status { position:fixed; left:12px; right:12px; bottom:82px; background:#14181f; color:#fff;
      border-radius:8px; padding:10px 12px; font-size:13px; opacity:0; transition:opacity .2s; }
  .status.show { opacity:.95; }
  .empty { color:var(--muted); text-align:center; padding:14px 0; font-size:14px; }
  .done { padding:40px 16px; text-align:center; font-size:16px; }
  .done button { margin-top:14px; }
</style>
</head>
<body>
<h1 id="title">Анкета</h1>
<div class="hint">Заполните вопросы и нажмите «Отправить». Данные увидит организатор.</div>
<div class="event" id="event"></div>
<div id="statuses" class="statuses"></div>
<div id="fields"><div class="empty">Загрузка…</div></div>
<div class="actions"><button class="primary" id="submit">Отправить</button></div>
<div class="status" id="notice"></div>

<script>
const params = new URLSearchParams(location.search);
const codeFromUrl = params.get('code') || params.get('event') || '';
const devUserId = params.get('devUserId');
const fieldsEl = document.getElementById('fields');
const eventEl = document.getElementById('event');
const statusesEl = document.getElementById('statuses');

let event = null;
let fields = [];
let me = { name: '', contact: '', status: 'going', answers: {} };

${notifyJs(2600)}

// Финальный экран: если открыто внутри MAX — можно сразу вернуться в чат.
${finishJs()}

${initDataJs()}

${webAppReadyJs()}

${startParamJs('codeFromUrl')}

// Конструктор вопросов живёт на этой же странице мини-приложения: разводим их
// по стартовому параметру, чтобы организатор попадал в конструктор, а не в анкету.
${redirectJs('tpl_', "'/app/questions?t=' + encodeURIComponent(startParam.slice(4))")}

const code = (() => {
  const value = startParam || '';
  return value.startsWith('ev_') ? value.slice(3).toUpperCase() : value.toUpperCase();
})();

const STATUSES = [['going','Иду'],['maybe','Под вопросом'],['not_going','Не смогу']];

const renderStatuses = () => {
  statusesEl.innerHTML = '';
  STATUSES.forEach(([value, caption]) => {
    const button = document.createElement('button');
    button.textContent = caption;
    if (me.status === value) button.className = 'active';
    button.onclick = () => { me.status = value; renderStatuses(); };
    statusesEl.appendChild(button);
  });
};

const describe = (field) => {
  const parts = [];
  if (field.type === 'number') {
    if (field.min !== null && field.max !== null) parts.push('от ' + field.min + ' до ' + field.max);
    else if (field.min !== null) parts.push('не меньше ' + field.min);
    else if (field.max !== null) parts.push('не больше ' + field.max);
  }
  if (field.type === 'text') parts.push('до ' + (field.maxLength || 500) + ' символов');
  if (field.type === 'date') parts.push('формат ДД.ММ.ГГГГ');
  if (field.type === 'choice' && field.multiple) {
    const min = field.minSelected === null ? 1 : field.minSelected;
    const max = field.maxSelected === null ? field.options.length : field.maxSelected;
    parts.push('выберите от ' + min + ' до ' + max);
  }
  parts.push(field.required ? 'обязательный' : 'необязательный');
  return parts.join(', ');
};

const setAnswer = (field, value) => { me.answers[field.id] = value; };

// Текущий выбор берём из ответов в момент нажатия, а не из разметки: иначе второй
// отмеченный вариант затирал бы первый (обработчики не перерисовываются).
const currentSelection = (field) => {
  const saved = me.answers[field.id];
  return saved ? String(saved).split(',').map((value) => value.trim()).filter(Boolean) : [];
};

const renderField = (field, index) => {
  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'field-' + field.id;

  const question = document.createElement('div');
  question.className = 'q';
  question.textContent = (index + 1) + '. ' + field.label;
  const constraint = document.createElement('div');
  constraint.className = 'c';
  constraint.textContent = describe(field);
  card.append(question, constraint);

  const current = me.answers[field.id] || '';

  if (field.type === 'choice') {
    const selected = currentSelection(field);
    field.options.forEach((option) => {
      const wrap = document.createElement('label');
      wrap.className = 'choice';
      const input = document.createElement('input');
      input.type = field.multiple ? 'checkbox' : 'radio';
      input.name = 'field-' + field.id;
      input.checked = selected.includes(option);
      input.onchange = () => {
        if (!field.multiple) { setAnswer(field, option); return; }
        const set = new Set(currentSelection(field));
        if (input.checked) set.add(option); else set.delete(option);
        // Порядок — как в списке вариантов, чтобы ответ читался одинаково везде.
        setAnswer(field, field.options.filter((value) => set.has(value)).join(', '));
      };
      const caption = document.createElement('span');
      caption.textContent = option;
      wrap.append(input, caption);
      card.appendChild(wrap);
    });
  } else if (field.type === 'yesno') {
    (['Да', 'Нет']).forEach((option) => {
      const wrap = document.createElement('label');
      wrap.className = 'choice';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'field-' + field.id;
      input.checked = current === option;
      input.onchange = () => setAnswer(field, option);
      const caption = document.createElement('span');
      caption.textContent = option;
      wrap.append(input, caption);
      card.appendChild(wrap);
    });
  } else {
    const wrap = document.createElement('label');
    wrap.className = 'field';
    wrap.textContent = field.type === 'number' ? 'Число' : field.type === 'date' ? 'Дата' : 'Ответ';
    const input = document.createElement('input');
    input.type = field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text';
    if (field.type === 'number') {
      if (field.min !== null) input.min = String(field.min);
      if (field.max !== null) input.max = String(field.max);
    }
    if (field.type === 'text' && field.maxLength) input.maxLength = field.maxLength;
    input.value = current;
    input.oninput = () => setAnswer(field, input.value);
    wrap.appendChild(input);
    card.appendChild(wrap);
  }

  fieldsEl.appendChild(card);
};

const render = () => {
  document.getElementById('title').textContent = event ? 'Анкета: ' + event.title : 'Анкета';
  eventEl.innerHTML = '';
  if (event) {
    const title = document.createElement('b');
    title.textContent = event.title;
    const when = document.createElement('div');
    when.textContent = 'Когда: ' + event.startsAt + (event.place ? ' · Место: ' + event.place : '');
    eventEl.append(title, when);
  }
  renderStatuses();
  fieldsEl.innerHTML = '';
  fields.forEach((field, index) => renderField(field, index));
};

const load = async () => {
  if (!code) {
    fieldsEl.innerHTML = '<div class="empty">Не понял, к какому событию анкета. Откройте приложение из бота.</div>';
    return;
  }
  try {
    const response = await fetch('/app/api/questionnaire?code=' + encodeURIComponent(code) +
      '&initData=' + encodeURIComponent(initData()) +
      (devUserId ? '&devUserId=' + encodeURIComponent(devUserId) : ''));
    const data = await response.json();
    if (!response.ok) {
      // 403 — почти всегда открытие вне MAX: подписи запуска нет.
      fieldsEl.innerHTML = '<div class="empty">' + (
        response.status === 403
          ? 'Откройте анкету по ссылке из чата с ботом в MAX.'
          : (data.error || 'Не удалось загрузить анкету')
      ) + '</div>';
      return;
    }
    event = data.event;
    fields = data.fields || [];
    me = Object.assign(me, data.me || {});
    render();
  } catch (error) {
    fieldsEl.innerHTML = '<div class="empty">Нет связи с ботом. Попробуйте открыть анкету ещё раз.</div>';
  }
};

const submitButton = document.getElementById('submit');

submitButton.onclick = async () => {
  if (submitButton.disabled) return;
  const payload = {
    code,
    initData: initData(),
    devUserId: devUserId || undefined,
    name: me.name,
    contact: me.contact,
    status: me.status,
    answers: me.answers,
  };
  submitButton.disabled = true;
  submitButton.textContent = 'Отправляем…';
  try {
    const response = await fetch('/app/answers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      notify(data.error || 'Не удалось отправить ответы');
      return;
    }
    finish('Ответы отправлены. Вернитесь в чат с ботом.');
  } catch (error) {
    notify('Нет связи с ботом');
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Отправить';
  }
};

load();
</script>
</body>
</html>
`;
