const { test } = require('node:test');
const assert = require('node:assert');
const { planListSync } = require('../frontend-src/picker-list-sync');

const empty = () => ({ keys: [], html: [] });
const items = (...pairs) => pairs.map(([key, html]) => ({ key, html }));

test('первая отрисовка собирает список целиком', () => {
  const plan = planListSync(empty(), items(['s:a', '<div>a</div>']), 0);
  assert.strictEqual(plan.mode, 'rebuild');
  assert.deepStrictEqual(plan.keys, ['s:a']);
  assert.deepStrictEqual(plan.html, ['<div>a</div>']);
});

test('тик без изменений не трогает ни одного элемента', () => {
  const first = items(['g:d1', '<div>D1</div>'], ['s:a', '<div>a</div>']);
  const prev = planListSync(empty(), first, 0);
  const plan = planListSync(prev, first, 2);
  assert.strictEqual(plan.mode, 'patch');
  assert.deepStrictEqual(plan.updates, []);
});

// Ради этого случая всё и затевалось: раз в секунду тикает возраст одной
// строки, а перерисовывался весь список.
test('изменилась одна строка — правится только она', () => {
  const prev = planListSync(empty(), items(
    ['s:a', '<div>a 5s</div>'],
    ['s:b', '<div>b 3h</div>'],
  ), 0);
  const plan = planListSync(prev, items(
    ['s:a', '<div>a 6s</div>'],
    ['s:b', '<div>b 3h</div>'],
  ), 2);
  assert.strictEqual(plan.mode, 'patch');
  assert.deepStrictEqual(plan.updates, [{ index: 0, html: '<div>a 6s</div>' }]);
});

test('новая сессия в списке — пересборка', () => {
  const prev = planListSync(empty(), items(['s:a', '<div>a</div>']), 0);
  const plan = planListSync(prev, items(
    ['s:a', '<div>a</div>'],
    ['s:b', '<div>b</div>'],
  ), 1);
  assert.strictEqual(plan.mode, 'rebuild');
});

test('перестановка строк при той же длине — пересборка, а не правка на месте', () => {
  const prev = planListSync(empty(), items(
    ['s:a', '<div>a</div>'],
    ['s:b', '<div>b</div>'],
  ), 0);
  const plan = planListSync(prev, items(
    ['s:b', '<div>b</div>'],
    ['s:a', '<div>a</div>'],
  ), 2);
  assert.strictEqual(plan.mode, 'rebuild');
});

test('пустой список после непустого — пересборка', () => {
  const prev = planListSync(empty(), items(['s:a', '<div>a</div>']), 0);
  const plan = planListSync(prev, [], 1);
  assert.strictEqual(plan.mode, 'rebuild');
  assert.deepStrictEqual(plan.html, []);
});

test('DOM разъехался с ожидаемым — пересборка, а не правка по чужим индексам', () => {
  const rows = items(['s:a', '<div>a</div>'], ['s:b', '<div>b</div>']);
  const prev = planListSync(empty(), rows, 0);
  const plan = planListSync(prev, rows, 5);
  assert.strictEqual(plan.mode, 'rebuild');
});

test('без счётчика элементов решение принимается по одним ключам', () => {
  const rows = items(['s:a', '<div>a</div>']);
  const prev = planListSync(empty(), rows, 0);
  assert.strictEqual(planListSync(prev, rows).mode, 'patch');
});

test('итог вызова годится как prev для следующего', () => {
  const prev = planListSync(empty(), items(['s:a', '<div>a 1s</div>']), 0);
  const next = planListSync(prev, items(['s:a', '<div>a 2s</div>']), 1);
  const third = planListSync(next, items(['s:a', '<div>a 2s</div>']), 1);
  assert.deepStrictEqual(third.updates, []);
});
