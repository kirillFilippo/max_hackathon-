/**
 * Мини-приложение «Вопросы участникам»: конструктор анкеты в стиле Google Forms.
 *
 * Отдаётся тем же процессом, что и бот (HTTP-сервер на MINIAPP_PORT). Черновик
 * вопросов не тащим в URL: страница запрашивает его по одноразовой подписи
 * (`GET /app/draft?t=...`), поэтому ссылка короткая, а длинные анкеты
 * не упираются в ограничение длины URL.
 *
 * Что можно задать: название набора (сохраняется как шаблон), вопросы с типом,
 * вариантами, ограничениями ответа и обязательностью, а также способ ответа
 * участников.
 */
export const MINIAPP_MAX_FIELDS = 10;
export const MINIAPP_MAX_OPTIONS = 12;
export const MINIAPP_MAX_LABEL = 140;
export const MINIAPP_MAX_NAME = 60;
export const MINIAPP_CHAT_WEIGHT_LIMIT = 10;

/** Код подписи мастера: кладём в сессию, чтобы конструктор мог записать результат. */
export interface MiniappTicket {
  userId: number;
  at: number;
}

export const renderMiniappHtml = (options: { title: string }): string => `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${options.title}</title>
<script src="https://st.max.ru/js/max-web-app.js"></script>
<style>
  :root { --ink:#14181f; --muted:#5b6673; --line:#d7dde5; --accent:#1f6feb; --bg:#f4f6fa; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:15px/1.4 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; padding:12px 12px 92px; }
  h1 { font-size:17px; margin:0 0 2px; }
  .hint { color:var(--muted); font-size:12px; margin-bottom:10px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:10px 12px; margin-bottom:8px; }
  .card .head { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:4px; }
  .card .head b { font-size:13px; color:var(--muted); font-weight:600; }
  label { display:block; font-size:12px; color:var(--muted); margin:6px 0 3px; }
  input, select, textarea { width:100%; border:1px solid var(--line); border-radius:8px;
      padding:9px 10px; font:inherit; background:#fff; color:var(--ink); }
  textarea { min-height:52px; resize:vertical; }
  .row { display:flex; gap:8px; }
  .row > * { flex:1; min-width:0; }
  .check { display:flex; align-items:center; gap:8px; margin-top:8px; font-size:13px; }
  .check input { width:auto; }
  button { font:inherit; border-radius:8px; border:1px solid var(--line); background:#fff;
      padding:9px 11px; color:var(--ink); }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; }
  button.small { padding:4px 8px; font-size:13px; color:var(--muted); }
  button.small.danger { color:#b4232c; }
  .actions { position:fixed; left:0; right:0; bottom:0; display:flex; gap:8px; padding:10px 12px;
      background:linear-gradient(180deg, rgba(244,246,250,0) 0%, var(--bg) 40%); }
  .actions button { flex:1; }
  .empty { color:var(--muted); text-align:center; padding:14px 0; font-size:14px; }
  .weight { font-size:12px; color:var(--muted); margin:0 0 10px; }
  .weight b { color:var(--ink); }
  details.mode { background:#fff; border:1px solid var(--line); border-radius:10px; padding:10px 12px;
      margin-top:8px; font-size:13px; }
  details.mode summary { cursor:pointer; color:var(--muted); font-size:12px; }
  details.mode .radio { display:flex; align-items:center; gap:8px; margin-top:6px; }
  details.mode .radio input { width:auto; }
  .notice { position:fixed; left:12px; right:12px; bottom:72px; background:#14181f; color:#fff;
      border-radius:8px; padding:9px 12px; font-size:13px; opacity:0; transition:opacity .2s; }
  .notice.show { opacity:.95; }
  .done { padding:40px 16px; text-align:center; font-size:16px; }
</style>
</head>
<body>
<h1>Вопросы участникам</h1>
<div class="hint">Отвечают участники при регистрации. Максимум ${MINIAPP_MAX_FIELDS} вопросов.</div>

<div class="card">
  <label for="name">Название набора</label>
  <input id="name" maxlength="${MINIAPP_MAX_NAME}" placeholder="Необязательно">
  <div class="hint" style="margin:6px 0 0">Если заполнить, бот сохранит набор как шаблон для будущих событий.</div>
</div>

<div class="weight" id="weight"></div>
<div id="list"></div>
<button id="add" style="width:100%">Добавить вопрос</button>

<details class="mode">
  <summary>Способ ответа участников</summary>
  <div class="radio"><input type="radio" name="mode" id="mode-auto" value="auto"><label for="mode-auto" style="margin:0">Автоматически по весу вопросов</label></div>
  <div class="radio"><input type="radio" name="mode" id="mode-chat" value="chat"><label for="mode-chat" style="margin:0">Всегда в чате</label></div>
  <div class="radio"><input type="radio" name="mode" id="mode-miniapp" value="miniapp"><label for="mode-miniapp" style="margin:0">Всегда в мини-приложении</label></div>
</details>

<div class="actions">
  <button class="primary" id="save">Сохранить в бота</button>
  <button id="cancel">Отмена</button>
</div>
<div class="notice" id="notice"></div>

<script>
const MAX_FIELDS = ${MINIAPP_MAX_FIELDS};
const MAX_OPTIONS = ${MINIAPP_MAX_OPTIONS};
const CHAT_LIMIT = ${MINIAPP_CHAT_WEIGHT_LIMIT};
const TYPES = [['text','Текст'],['number','Число'],['choice','Выбор из вариантов'],['yesno','Да / Нет'],['date','Дата']];

const ticket = new URLSearchParams(location.search).get('t') || '';
const noticeEl = document.getElementById('notice');
const listEl = document.getElementById('list');
const nameEl = document.getElementById('name');
const weightEl = document.getElementById('weight');

let fields = [];
let answerMode = 'auto';

const notify = (text) => {
  noticeEl.textContent = text;
  noticeEl.classList.add('show');
  setTimeout(() => noticeEl.classList.remove('show'), 2400);
};

const blankField = () => ({
  label: '', type: 'text', options: [], multiple: false,
  minSelected: null, maxSelected: null, min: null, max: null, maxLength: null, required: true,
});

const normalize = (raw) => Object.assign(blankField(), raw || {}, {
  options: Array.isArray(raw && raw.options) ? raw.options : [],
  required: raw && raw.required === false ? false : true,
});

// Вес считается так же, как на сервере бота (domain/questionnaire.ts).
const fieldWeight = (f) => {
  if (f.type === 'text') return 5;
  if (f.type === 'number' || f.type === 'date') return 2;
  if (f.type === 'choice') return Math.floor((f.options || []).length / 3) + 1;
  return 1;
};
const totalWeight = () => fields.reduce((sum, f) => sum + fieldWeight(f), 0);
const effectiveMode = () => (answerMode === 'auto'
  ? (totalWeight() < CHAT_LIMIT ? 'chat' : 'miniapp')
  : answerMode);

const input = (caption, value, onInput, extra = {}) => {
  const wrap = document.createElement('label');
  wrap.textContent = caption;
  const el = document.createElement('input');
  el.value = value === null || value === undefined ? '' : String(value);
  Object.assign(el, extra);
  el.oninput = () => onInput(el.value);
  wrap.appendChild(el);
  return wrap;
};

const numberOrNull = (value) => {
  const raw = String(value).trim().replace(',', '.');
  if (raw === '') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const renderWeight = () => {
  const mode = effectiveMode();
  weightEl.innerHTML = 'Вес вопросов: <b>' + totalWeight() + '</b> (порог ' + CHAT_LIMIT + ') — ' +
    (mode === 'chat' ? 'участники отвечают в чате' : 'участники отвечают в мини-приложении');
  document.getElementById('mode-' + answerMode).checked = true;
};

const render = () => {
  listEl.innerHTML = '';
  if (fields.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Пока нет вопросов. Добавьте первый.';
    listEl.appendChild(empty);
  }

  fields.forEach((field, index) => {
    const card = document.createElement('div');
    card.className = 'card';

    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('b');
    title.textContent = 'Вопрос ' + (index + 1);
    const remove = document.createElement('button');
    remove.className = 'small danger';
    remove.textContent = 'Удалить';
    remove.onclick = () => { fields.splice(index, 1); render(); };
    head.append(title, remove);
    card.appendChild(head);

    card.appendChild(input('Текст вопроса', field.label, (value) => { field.label = value; },
      { maxLength: ${MINIAPP_MAX_LABEL} }));

    const typeWrap = document.createElement('label');
    typeWrap.textContent = 'Тип ответа';
    const typeSelect = document.createElement('select');
    TYPES.forEach(([value, caption]) => {
      const option = document.createElement('option');
      option.value = value; option.textContent = caption;
      if (field.type === value) option.selected = true;
      typeSelect.appendChild(option);
    });
    typeSelect.onchange = () => {
      field.type = typeSelect.value;
      if (field.type !== 'choice') Object.assign(field, { options: [], multiple: false, minSelected: null, maxSelected: null });
      if (field.type !== 'number') Object.assign(field, { min: null, max: null });
      if (field.type !== 'text') field.maxLength = null;
      render();
    };
    typeWrap.appendChild(typeSelect);
    card.appendChild(typeWrap);

    if (field.type === 'choice') {
      const optionsWrap = document.createElement('label');
      optionsWrap.textContent = 'Варианты через запятую, до ' + MAX_OPTIONS;
      const optionsInput = document.createElement('textarea');
      optionsInput.value = field.options.join(', ');
      optionsInput.oninput = () => {
        field.options = optionsInput.value.split(',').map((v) => v.trim()).filter(Boolean).slice(0, MAX_OPTIONS);
        renderWeight();
      };
      optionsWrap.appendChild(optionsInput);
      card.appendChild(optionsWrap);

      const multi = document.createElement('label');
      multi.className = 'check';
      const multiInput = document.createElement('input');
      multiInput.type = 'checkbox';
      multiInput.checked = Boolean(field.multiple);
      multiInput.onchange = () => {
        field.multiple = multiInput.checked;
        if (!field.multiple) Object.assign(field, { minSelected: null, maxSelected: null });
        render();
      };
      const multiText = document.createElement('span');
      multiText.textContent = 'Можно выбрать несколько';
      multi.append(multiInput, multiText);
      card.appendChild(multi);

      if (field.multiple) {
        const row = document.createElement('div');
        row.className = 'row';
        row.append(
          input('Минимум выбрать', field.minSelected, (v) => { field.minSelected = numberOrNull(v); }, { type: 'number', min: '0' }),
          input('Максимум выбрать', field.maxSelected, (v) => { field.maxSelected = numberOrNull(v); }, { type: 'number', min: '0' }),
        );
        card.appendChild(row);
      }
    }

    if (field.type === 'number') {
      const row = document.createElement('div');
      row.className = 'row';
      row.append(
        input('Минимум', field.min, (v) => { field.min = numberOrNull(v); }, { type: 'number' }),
        input('Максимум', field.max, (v) => { field.max = numberOrNull(v); }, { type: 'number' }),
      );
      card.appendChild(row);
    }

    if (field.type === 'text') {
      card.appendChild(input('Максимальная длина, символов', field.maxLength, (v) => {
        field.maxLength = numberOrNull(v);
      }, { type: 'number', min: '1', max: '500' }));
    }

    const required = document.createElement('label');
    required.className = 'check';
    const requiredInput = document.createElement('input');
    requiredInput.type = 'checkbox';
    requiredInput.checked = field.required !== false;
    requiredInput.onchange = () => { field.required = requiredInput.checked; };
    const requiredText = document.createElement('span');
    requiredText.textContent = 'Обязательный вопрос';
    required.append(requiredInput, requiredText);
    card.appendChild(required);

    listEl.appendChild(card);
  });

  renderWeight();
};

document.querySelectorAll('input[name=mode]').forEach((radio) => {
  radio.onchange = () => { answerMode = radio.value; renderWeight(); };
});

document.getElementById('add').onclick = () => {
  if (fields.length >= MAX_FIELDS) { notify('Больше ' + MAX_FIELDS + ' вопросов не добавляем'); return; }
  fields.push(blankField());
  render();
};

const finish = (text) => {
  document.body.innerHTML = '<div class="done">' + text + '</div>';
};

const cleanFields = () => fields
  .map((f) => ({
    label: (f.label || '').trim(),
    type: f.type || 'text',
    options: (f.options || []).filter(Boolean),
    multiple: Boolean(f.multiple),
    minSelected: f.multiple ? f.minSelected : null,
    maxSelected: f.multiple ? f.maxSelected : null,
    min: f.type === 'number' ? f.min : null,
    max: f.type === 'number' ? f.max : null,
    maxLength: f.type === 'text' ? f.maxLength : null,
    required: f.required !== false,
  }))
  .filter((f) => f.label.length > 0);

const validate = (clean) => {
  for (const field of clean) {
    if (field.type === 'choice' && field.options.length < 2) {
      return 'Для вопроса «' + field.label + '» нужно минимум два варианта';
    }
    if (field.minSelected !== null && field.maxSelected !== null && field.minSelected > field.maxSelected) {
      return 'У вопроса «' + field.label + '» минимум больше максимума';
    }
    if (field.min !== null && field.max !== null && field.min > field.max) {
      return 'У вопроса «' + field.label + '» минимум больше максимума';
    }
  }
  return null;
};

document.getElementById('save').onclick = async () => {
  if (!ticket) { notify('Откройте конструктор заново из чата с ботом'); return; }
  const clean = cleanFields();
  if (clean.length === 0) { notify('Добавьте хотя бы один вопрос'); return; }
  const problem = validate(clean);
  if (problem) { notify(problem); return; }

  try {
    const response = await fetch('/app/fields', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket, fields: clean, answerMode, name: nameEl.value.trim() }),
    });
    const data = await response.json();
    if (!response.ok) { notify(data.error || 'Не удалось сохранить'); return; }
    finish('Сохранено. Вернитесь в чат с ботом.');
  } catch (error) {
    notify('Нет связи с ботом');
  }
};

document.getElementById('cancel').onclick = () => finish('Изменения не сохранены. Вернитесь в чат с ботом.');

// Черновик забираем с сервера по подписи: URL остаётся коротким, а повторное
// открытие конструктора не теряет уже собранные вопросы.
const load = async () => {
  if (!ticket) { notify('Откройте конструктор заново из чата с ботом'); return; }
  try {
    const response = await fetch('/app/draft?t=' + encodeURIComponent(ticket));
    const data = await response.json();
    if (!response.ok) { notify(data.error || 'Ссылка конструктора устарела'); return; }
    fields = (data.fields || []).map(normalize);
    answerMode = ['auto', 'chat', 'miniapp'].includes(data.answerMode) ? data.answerMode : 'auto';
    nameEl.value = data.name || '';
    render();
  } catch (error) {
    notify('Нет связи с ботом');
  }
};

load();
</script>
</body>
</html>
`;
