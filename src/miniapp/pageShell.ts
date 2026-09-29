/**
 * Общий каркас страниц мини-приложения.
 *
 * Конструктор вопросов и анкету участника обслуживает одно мини-приложение MAX,
 * и общего у них больше, чем кажется: `<head>` с подключением моста, чтение
 * `start_param` (два источника — мост и фрагмент ссылки), обязательный
 * `WebApp.ready()` (без него вебвью остаётся на экране загрузки), подпись запуска
 * для запросов, всплывающая подсказка и финальный экран с кнопкой «Вернуться
 * в чат». Пока это лежало в двух файлах, любую правку приходилось делать дважды,
 * а `finish()` и вовсе разошёлся бы при первой же забывчивости.
 *
 * CSS сюда намеренно не вынесен: у страниц разные экраны (у конструктора —
 * вопросы и вес анкеты, у анкеты — карточка события и статусы), и общий стиль
 * был бы переносом строк, а не устранением дублирования.
 */

/** Начало документа: мета, заголовок и мост MAX. Дальше страница открывает свой `<style>`. */
export const pageHead = (options: { title: string }): string => `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${options.title}</title>
<script src="https://st.max.ru/js/max-web-app.js"></script>`;

/**
 * Стартовый параметр мини-приложения: мост MAX или фрагмент ссылки.
 *
 * `fallback` — JS-выражение на случай пустого параметра (анкета умеет брать код
 * события из `?code=`, конструктор — нет).
 */
export const startParamJs = (fallback = "''"): string => `/** Стартовый параметр мини-приложения: мост MAX или фрагмент ссылки. */
const readStartParam = () => {
  try {
    const fromBridge = window.WebApp && window.WebApp.initDataUnsafe && window.WebApp.initDataUnsafe.start_param;
    if (fromBridge) return String(fromBridge);
  } catch (error) { /* мост мог не подняться */ }
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ''));
  return fragment.get('WebAppStartParam') || ${fallback};
};

const startParam = readStartParam();`;

/**
 * Мини-приложение открыто — сообщаем об этом MAX, иначе вебвью может остаться
 * на экране загрузки. Вне MAX моста нет: страница работает как обычный сайт.
 */
export const webAppReadyJs = (): string => `// Мини-приложение открыто — сообщаем об этом MAX, иначе вебвью может остаться
// на экране загрузки. Вне MAX моста нет: страница работает как обычный сайт.
try {
  if (window.WebApp) {
    window.WebApp.ready();
    if (window.WebApp.expand) window.WebApp.expand();
  }
} catch (error) { /* не критично */ }`;

/**
 * Развод страниц по стартовому параметру: обе страницы обслуживает одно
 * мини-приложение, поэтому `ev_…` уходит в анкету, `tpl_…` — в конструктор.
 */
export const redirectJs = (prefix: string, target: string): string => `if (startParam.startsWith('${prefix}')) {
  location.replace(${target} + location.hash);
}`;

/** Подпись запуска для запросов к серверу: без неё сервер не знает, кто отвечает. */
export const initDataJs = (): string => `const initData = () => {
  try {
    return (window.WebApp && window.WebApp.initData) || '';
  } catch (error) {
    return '';
  }
};`;

/** Всплывающая подсказка: сколько держать — у страниц разное. */
export const notifyJs = (ms: number): string => `const notify = (text) => {
  const box = document.getElementById('notice');
  box.textContent = text;
  box.classList.add('show');
  setTimeout(() => box.classList.remove('show'), ${ms});
};`;

/** Финальный экран: внутри MAX можно сразу закрыть приложение и вернуться в чат. */
export const finishJs = (): string => `const finish = (text) => {
  document.body.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'done';
  box.textContent = text;
  document.body.appendChild(box);
  try {
    if (window.WebApp && window.WebApp.close) {
      const back = document.createElement('button');
      back.className = 'primary';
      back.textContent = 'Вернуться в чат';
      back.onclick = () => window.WebApp.close();
      box.appendChild(back);
    }
  } catch (error) { /* вне MAX кнопка не нужна */ }
};`;
