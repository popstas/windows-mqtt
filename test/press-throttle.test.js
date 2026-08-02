const { test } = require('node:test');
const assert = require('node:assert');
const { DEFAULT_INTERVAL_MS, throttlePress } = require('../src/modules/press-throttle');

// Подставные часы: настоящие сделали бы проверку окна гонкой с планировщиком.
function clock(start = 10_000) {
  let at = start;
  return { now: () => at, tick: (ms) => { at += ms; } };
}

test('the first press goes through immediately', () => {
  const seen = [];
  const c = clock();
  const press = throttlePress((...a) => seen.push(a), { now: c.now });
  press('topic', '3');
  assert.deepStrictEqual(seen, [['topic', '3']]);
});

test('a repeat inside the window is dropped, not deferred', () => {
  // Отложенное нажатие сделало бы то же самое секундой позже — фокус уехал бы
  // уже после того, как человек смотрит в окно.
  const seen = [];
  const c = clock();
  const press = throttlePress((...a) => seen.push(a), { now: c.now });
  press('topic', '3');
  c.tick(200);
  press('topic', '3');
  c.tick(700);
  press('topic', '4');
  assert.deepStrictEqual(seen, [['topic', '3']]);
});

test('the next press goes through once the window has passed', () => {
  const seen = [];
  const c = clock();
  const press = throttlePress((...a) => seen.push(a), { now: c.now });
  press('topic', '3');
  c.tick(DEFAULT_INTERVAL_MS);
  press('topic', '4');
  assert.deepStrictEqual(seen, [['topic', '3'], ['topic', '4']]);
});

test('a dropped press is reported, so it is not silently swallowed', () => {
  const dropped = [];
  const c = clock();
  const press = throttlePress(() => {}, { now: c.now, onDrop: (...a) => dropped.push(a) });
  press('topic', '3');
  c.tick(100);
  press('topic', '4');
  assert.deepStrictEqual(dropped, [['topic', '4']]);
});

test('each wrapper keeps its own window', () => {
  // Строки сессий и кнопка снимка — разные действия: общий счётчик означал бы,
  // что нажатие на строку съедает нажатие на кнопку.
  const seen = [];
  const c = clock();
  const rows = throttlePress(() => seen.push('rows'), { now: c.now });
  const snapshot = throttlePress(() => seen.push('snapshot'), { now: c.now });
  rows();
  snapshot();
  assert.deepStrictEqual(seen, ['rows', 'snapshot']);
});

test('the handler result reaches the caller, and a dropped press yields nothing', () => {
  // Обработчики подписок асинхронные: диспетчер ждёт возвращённый промис.
  const c = clock();
  const press = throttlePress(() => 'done', { now: c.now });
  assert.strictEqual(press(), 'done');
  assert.strictEqual(press(), undefined);
});
