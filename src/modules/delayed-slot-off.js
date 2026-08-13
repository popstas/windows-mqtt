/** Отложенное гашение слота после нажатия на openHASP. Без I/O. */

/**
 * Панель с `toggle: true` успевает отрисовать локальное включение; мгновенный
 * MQTT off иногда проигрывает этой отрисовке. Полсекунды — после локального
 * toggle, до того как человек решит, что плитка залипла.
 *
 * Повторное нажатие на тот же слот перезапускает таймер: гасить надо финальное
 * нажатие, а не промежуточное.
 */
function createDelayedSlotOff({
  delayMs = 500,
  publish,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  const timers = new Map();
  return function scheduleSlotOff(slot) {
    const key = String(slot);
    const prev = timers.get(key);
    if (prev !== undefined) clearTimeoutFn(prev);
    const id = setTimeoutFn(() => {
      timers.delete(key);
      publish(slot);
    }, delayMs);
    timers.set(key, id);
  };
}

module.exports = { createDelayedSlotOff };
