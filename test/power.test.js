import test from 'node:test';
import assert from 'node:assert/strict';
import { storeThen, createAckQueue } from '../src/modules/power.js';

test('storeThen публикует просьбу сохранить раскладку', async () => {
  const published = [];
  const done = storeThen({
    publish: (topic, payload) => published.push([topic, payload]),
    base: 'home/room/pc/windows',
    timeoutMs: 50,
    setTimeoutFn: (fn) => { fn(); return 0; },
    clearTimeoutFn: () => {},
  });
  await done;
  assert.deepEqual(published, [['home/room/pc/windows/store', '1']]);
});

test('storeThen идёт дальше по ответу и снимает таймер', async () => {
  const cleared = [];
  /** @type {(value?: any) => void} */
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
  /** @type {() => void} */
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

// createAckQueue: два одновременных storeAndThen не должны отвечать друг
// другу. Баг был в том, что один store/done снимал разом всех ожидающих —
// второй перезагружался по чужому подтверждению сохранения.
test('createAckQueue отдаёт ответ только самому старому ожидающему', async () => {
  const q = createAckQueue();
  const first = q.wait();
  const second = q.wait();
  let firstResolved = false;
  let secondResolved = false;
  first.promise.then(() => { firstResolved = true; });
  second.promise.then(() => { secondResolved = true; });

  q.resolveNext();
  await first.promise;

  assert.equal(firstResolved, true, 'первый (самый старый) получает ответ');
  assert.equal(secondResolved, false, 'второй ещё ждёт — ему чужой ответ не достался');
});

test('createAckQueue: второй store/done обслуживает второго ожидающего', async () => {
  const q = createAckQueue();
  const first = q.wait();
  const second = q.wait();

  q.resolveNext();
  await first.promise;
  q.resolveNext();
  await second.promise;
});

test('createAckQueue: cancel убирает ожидающего, и следующий ответ ему не достаётся', async () => {
  const q = createAckQueue();
  const first = q.wait(); // симулирует того, кто уже ушёл по таймауту storeThen
  first.cancel();
  let firstResolved = false;
  first.promise.then(() => { firstResolved = true; });

  const second = q.wait();
  let secondResolved = false;
  second.promise.then(() => { secondResolved = true; });

  q.resolveNext();
  await second.promise;

  assert.equal(secondResolved, true, 'ответ достался второму, а не отменённому первому');
  assert.equal(firstResolved, false, 'отменённый резолвер не наступает никогда');
});

test('createAckQueue: лишний resolveNext без ожидающих ничего не ломает', () => {
  const q = createAckQueue();
  assert.doesNotThrow(() => q.resolveNext());
});
