const test = require('node:test');
const assert = require('node:assert/strict');
const { storeThen } = require('../src/modules/power');

test('storeThen публикует просьбу сохранить раскладку', async () => {
  const published = [];
  const done = storeThen({
    publish: (topic, payload) => published.push([topic, payload]),
    base: 'home/room/pc/windows',
    onDone: () => {},
    timeoutMs: 50,
    setTimeoutFn: (fn) => { fn(); return 0; },
    clearTimeoutFn: () => {},
  });
  await done;
  assert.deepEqual(published, [['home/room/pc/windows/store', '1']]);
});

test('storeThen идёт дальше по ответу и снимает таймер', async () => {
  const cleared = [];
  let resolveAck;
  const ack = new Promise((r) => { resolveAck = r; });
  const p = storeThen({
    publish: () => {},
    base: 'b',
    ack,
    timeoutMs: 10000,
    // Таймер не срабатывает никогда: если бы промис ждал только его, тест
    // повис бы на 10 секунд и упал по таймауту раннера.
    setTimeoutFn: () => 77,
    clearTimeoutFn: (id) => cleared.push(id),
  });
  resolveAck();
  await p;
  assert.deepEqual(cleared, [77], 'таймер снят, потому что ответ пришёл раньше');
});

test('storeThen не ждёт вечно, если ответа нет', async () => {
  let timeoutFn;
  const p = storeThen({
    publish: () => {},
    base: 'b',
    ack: new Promise(() => {}),
    timeoutMs: 5000,
    setTimeoutFn: (fn) => { timeoutFn = fn; return 1; },
    clearTimeoutFn: () => {},
  });
  timeoutFn();
  await p;
});
