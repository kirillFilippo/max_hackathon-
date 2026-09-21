/**
 * Мини-приложение «Вопросы участникам»: конструктор полей в стиле Google Forms.
 *
 * Страница отдаётся тем же процессом, что и бот (HTTP-сервер на MINIAPP_PORT),
 * поэтому дополнительных компонентов в compose не нужно.
 *
 * Что умеет:
 *  - вопросы списком: тип, варианты, ограничения ответа, обязательность;
 *  - ограничения как в формах: границы числа, максимальная длина текста,
 *    один или несколько вариантов с границами, дата, обязательность;
 *  - «спрятанная» настройка способа ответа: по весу вопросов бот сам решает,
 *    отвечать в чате или в мини-приложении, но организатор может переопределить.
 *
 * Конструктор доступен только организатору, который открыл его из мастера
 * создания события. Параметр `t` — одноразовый код из сессии бота.
 */
export const MINIAPP_MAX_FIELDS = 10;
export const MINIAPP_MAX_OPTIONS = 12;
export const MINIAPP_MAX_LABEL = 140;
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
         font:15px/1.45 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; padding:12px 12px 96px; }
  h1 { font-size:18px; margin:4px 0 2px; }
  .hint { color:var(--muted); font-size:13px; margin-bottom:12px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:10px; padding:12px; margin-bottom:10px; }
  label { display:block; font-size:13px; color:var(--muted); margin:8px 0 4px; }
  input, select, textarea { width:100%; border:1px solid var(--line); border-radius:8px;
      padding:10px; font:inherit; background:#fff; color:var(--ink); }
  textarea { min-height:64px; resize:vertical; }
  .row { display:flex; gap:8px; }
  .row > * { flex:1; }
  .check { display:flex; align-items:center; gap:8px; margin-top:10px; font-size:14px; color:var(--ink); }
  .check input { width:auto; }
  button { font:inherit; border-radius:8px; border:1px solid var(--line); background:#fff;
      padding:10px 12px; color:var(--ink); }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; font-weight:600; }
  button.danger { color:#b4232c; }
  .actions { position:fixed; left:0; right:0; bottom:0; display:flex; gap:8px; padding:12px;
      background:linear-gradient(180deg, rgba(244,246,250,0) 0%, var(--bg) 30%); }
  .actions button { flex:1; }
  .item-head { display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .item-head strong { font-size:14px; }
  .empty { color:var(--muted); text-align:center; padding:18px 0; }
  .status { position:fixed; left:12px; right:12px; bottom:78px; background:#14181f; color:#fff;
      border-radius:8px; padding:10px 12px; font-size:13px; opacity:0; transition:opacity .2s; }
  .status.show { opacity:.95; }
  .weight { background:#fff; border:1px solid var(--line); border-radius:10px; padding:10px 12px;
      font-size:13px; color:var(--muted); margin-bottom:10px; }
  .weight b { color:var(--ink); }
  details.mode { background:#fff; border:1px solid var(--line); border-radius:10px; padding:10px 12px;
      margin-bottom:10px; font-size:14px; }
  details.mode summary { cursor:pointer; color:var(--muted); font-size:13px; }
  details.mode .radio { display:flex; align-items:center; gap:8px; margin-top:8px; }
  details.mode .radio input { width:auto; }
  .muted { color:var(--muted); font-size:12px; margin-top:4px; }
</style>
</head>
<body>
<h1>Вопросы участникам</h1>
<div class="hint">Участник ответит на эти вопросы при регистрации. Максимум ${MINIAPP_MAX_FIELDS} вопросов.</div>
<div class="weight" id="weight"></div>
<div id="list"></div>
<button id="add" style="width:100%">Добавить вопрос</button>

<details class="mode">
  <summary>Способ ответа участников (настраивается автоматически)</summary>
  <div class="radio"><input type="radio" name="mode" id="mode-auto" value="auto"><label for="mode-auto" style="margin:0">Автоматически по весу вопросов</label></div>
  <div class="radio"><input type="radio" name="mode" id="mode-chat" value="chat"><label for="mode-chat" style="margin:0">Всегда в чате</label></div>
  <div class="radio"><input type="radio" name="mode" id="mode-miniapp" value="miniapp"><label for="mode-miniapp" style="margin:0">Всегда в мини-приложении</label></div>
  <div class="muted" id="mode-hint"></div>
</details>

<div class="actions">
  <button class="primary" id="save">Сохранить в бота</button>
  <button id="cancel">Отмена</button>
</div>
<div class="status" id="status"></div>

<script>
const MAX_FIELDS = ${MINIAPP_MAX_FIELDS};
const MAX_OPTIONS = ${MINIAPP_MAX_OPTIONS};
const CHAT_LIMIT = ${MINIAPP_CHAT_WEIGHT_LIMIT};
const TYPES = [['text','Текст'],['number','Число'],['choice','Выбор из вариантов'],['yesno','Да / Нет'],['date','Дата']];

const params = new URLSearchParams(location.search);
const ticket = params.get('t');
const initial = params.get('d');
const initialMode = params.get('m') || 'auto';
const statusEl = document.getElementById('status');
const listEl = document.getElementById('list');
const weightEl = document.getElementById('weight');
const modeHintEl = document.getElementById('mode-hint');

let fields = [];
try { fields = initial ? JSON.parse(decodeURIComponent(escape(atob(initial)))) : []; } catch (e) { fields = []; }
if (!Array.isArray(fields)) fields = [];
fields = fields.map((f) => ({
  label: f.label || '',
  type: f.type || 'text',
  options: Array.isArray(f.options) ? f.options : [],
  multiple: Boolean(f.multiple),
  minSelected: f.minSelected ?? null,
  maxSelected: f.maxSelected ?? null,
  min: f.min ?? null,
  max: f.max ?? null,
  maxLength: f.maxLength ?? null,
  required: f.required !== false,
}));

let answerMode = ['auto','chat','miniapp'].includes(initialMode) ? initialMode : 'auto';

// Вес вопроса считается так же, как на сервере бота (domain/questionnaire.ts).
const fieldWeight = (f) => {
  if (f.type === 'text') return 5;
  if (f.type === 'number' || f.type === 'date') return 2;
  if (f.type === 'choice') return Math.floor((f.options || []).length / 3) + 1;
  return 1;
};
const totalWeight = () => fields.reduce((sum, f) => sum + fieldWeight(f), 0);
const effectiveMode = () => {
  if (answerMode === 'chat' || answerMode === 'miniapp') return answerMode;
  return totalWeight() < CHAT_LIMIT ? 'chat' : 'miniapp';
};

const notify = (text) => {
  statusEl.textContent = text;
  statusEl.classList.add('show');
  setTimeout(() => statusEl.classList.remove('show'), 2400);
};

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
  const weight = totalWeight();
  const mode = effectiveMode();
  const where = mode === 'chat' ? 'участники отвечают в чате' : 'участники отвечают в мини-приложении';
  weightEl.innerHTML = 'Вес вопросов: <b>' + weight + '</b> (порог ' + CHAT_LIMIT + ') — ' + where + '.';
  modeHintEl.textContent = 'Сейчас по весу: ' + where + '. Можно переопределить вручную.';
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
    head.className = 'item-head';
    const title = document.createElement('strong');
    title.textContent = 'Вопрос ' + (index + 1);
    const remove = document.createElement('button');
    remove.className = 'danger';
    remove.textContent = 'Удалить';
    remove.onclick = () => { fields.splice(index, 1); render(); };
    head.append(title, remove);
    card.appendChild(head);

    card.appendChild(input('Вопрос', field.label, (value) => { field.label = value; }, { maxLength: ${MINIAPP_MAX_LABEL} }));

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
      if (field.type !== 'choice') { field.options = []; field.multiple = false; field.minSelected = null; field.maxSelected = null; }
      if (field.type !== 'number') { field.min = null; field.max = null; }
      if (field.type !== 'text') { field.maxLength = null; }
      render();
    };
    typeWrap.appendChild(typeSelect);
    card.appendChild(typeWrap);

    if (field.type === 'choice') {
      const optionsWrap = document.createElement('label');
      optionsWrap.textContent = 'Варианты (до ' + MAX_OPTIONS + ', через запятую)';
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
        if (!field.multiple) { field.minSelected = null; field.maxSelected = null; }
        render();
      };
      const multiText = document.createElement('span');
      multiText.textContent = 'Можно выбрать несколько вариантов';
      multi.append(multiInput, multiText);
      card.appendChild(multi);

      if (field.multiple) {
        const row = document.createElement('div');
        row.className = 'row';
        row.append(
          input('Минимум выбрать', field.minSelected, (value) => { field.minSelected = numberOrNull(value); }, { type: 'number', min: '0' }),
          input('Максимум выбрать', field.maxSelected, (value) => { field.maxSelected = numberOrNull(value); }, { type: 'number', min: '0' }),
        );
        card.appendChild(row);
      }
    }

    if (field.type === 'number') {
      const row = document.createElement('div');
      row.className = 'row';
      row.append(
        input('Минимум', field.min, (value) => { field.min = numberOrNull(value); }, { type: 'number' }),
        input('Максимум', field.max, (value) => { field.max = numberOrNull(value); }, { type: 'number' }),
      );
      card.appendChild(row);
    }

    if (field.type === 'text') {
      card.appendChild(input('Максимальная длина, символов', field.maxLength, (value) => {
        field.maxLength = numberOrNull(value);
      }, { type: 'number', min: '1', max: '500' }));
    }

    const check = document.createElement('label');
    check.className = 'check';
    const required = document.createElement('input');
    required.type = 'checkbox';
    required.checked = field.required !== false;
    required.onchange = () => { field.required = required.checked; };
    const requiredText = document.createElement('span');
    requiredText.textContent = 'Обязательный вопрос';
    check.append(required, requiredText);
    card.appendChild(check);

    listEl.appendChild(card);
  });

  renderWeight();
};

document.querySelectorAll('input[name=mode]').forEach((radio) => {
  radio.onchange = () => { answerMode = radio.value; renderWeight(); };
});

document.getElementById('add').onclick = () => {
  if (fields.length >= MAX_FIELDS) { notify('Больше ' + MAX_FIELDS + ' вопросов не добавляем'); return; }
  fields.push({ label: '', type: 'text', options: [], multiple: false, minSelected: null, maxSelected: null, min: null, max: null, maxLength: null, required: true });
  render();
};

const finish = (text) => {
  document.body.innerHTML = '<div style="padding:40px 16px;text-align:center;font:16px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif">' + text + '</div>';
};

const validate = (clean) => {
  for (const field of clean) {
    if (field.type === 'choice' && field.options.length < 2) return 'Для вопроса «' + field.label + '» нужно минимум два варианта';
    if (field.type === 'choice' && field.multiple && field.minSelected !== null && field.maxSelected !== null
        && field.minSelected > field.maxSelected) return 'У вопроса «' + field.label + '» минимум больше максимума';
  }
  return null;
};

document.getElementById('save').onclick = async () => {
  const clean = fields
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

  if (clean.length === 0) { notify('Добавьте хотя бы один вопрос'); return; }
  const problem = validate(clean);
  if (problem) { notify(problem); return; }

  try {
    const response = await fetch('/app/fields', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ticket, fields: clean, answerMode }),
    });
    const data = await response.json();
    if (!response.ok) { notify(data.error || 'Не удалось сохранить'); return; }
    finish('Сохранено. Вернитесь в чат с ботом — вопросы уже в мастере.');
  } catch (error) {
    notify('Нет связи с ботом');
  }
};

document.getElementById('cancel').onclick = () => finish('Изменения не сохранены. Вернитесь в чат с ботом.');
render();
</script>
</body>
</html>
`;
