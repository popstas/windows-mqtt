// Loaded twice: as a <script> in sessions.html and as a module in the tests.
// Здесь только решение «что менять в списке» — сами записи в DOM остаются в
// sessions.html, чтобы решение можно было проверить без браузера.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PickerListSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  /**
   * Сравнивает новый список строк с уже нарисованным.
   *
   * Подача пикера тикает раз в секунду, и почти всегда между тиками меняется
   * один-два возраста. Перерисовка всего списка ради этого сносит и собирает
   * заново три десятка элементов: скролл прыгает к началу, hover под курсором
   * гаснет — на глаз это и есть «мелькает».
   *
   * Строки узнаются по ключу (id сессии, заголовок группы). Совпали ключи и их
   * порядок — правим только те позиции, чья разметка отличается. Разошлись
   * (пришла новая сессия, сменилась сортировка или фильтр) — пересобираем
   * целиком: это и так видимая перестройка списка, чинить её нечем.
   *
   * @param {{keys: string[], html: string[]}} prev — итог прошлого вызова.
   * @param {{key: string, html: string}[]} items — что должно быть на экране.
   * @param {number} [nodeCount] — сколько элементов сейчас в контейнере.
   *   Не совпало с ожидаемым (DOM правили мимо этой функции) — пересобираем:
   *   точечная правка по индексам била бы не по тем элементам.
   * @returns {{mode: 'rebuild'|'patch', updates: {index: number, html: string}[],
   *   keys: string[], html: string[]}}
   */
  function planListSync(prev, items, nodeCount) {
    const list = Array.isArray(items) ? items : [];
    const keys = list.map(item => item.key);
    const html = list.map(item => item.html);
    const prevKeys = (prev && prev.keys) || [];
    const prevHtml = (prev && prev.html) || [];

    const sameShape = keys.length === prevKeys.length
      && keys.every((key, i) => key === prevKeys[i]);
    const domInSync = typeof nodeCount !== 'number' || nodeCount === list.length;
    if (!sameShape || !domInSync) return { mode: 'rebuild', updates: [], keys, html };

    const updates = [];
    for (let i = 0; i < list.length; i++) {
      if (html[i] !== prevHtml[i]) updates.push({ index: i, html: html[i] });
    }
    return { mode: 'patch', updates, keys, html };
  }

  return { planListSync };
});
