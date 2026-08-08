const test = require('node:test');
const assert = require('node:assert');

const {parseRestorePayload} = require('../src/picker/restore-payload');

test('пустое сообщение значит самый свежий снимок', () => {
  // Кнопка Restore last на панели шлёт пустоту. Снимок, а не lastLayout:
  // последний обнуляется через секунду после закрытия окон.
  assert.deepEqual(parseRestorePayload(''), {id: 'last', sessionIds: []});
  assert.deepEqual(parseRestorePayload(null), {id: 'last', sessionIds: []});
});

test('сырая строка — это id снимка', () => {
  // С панели прилетает так же, как и прежде: ветка не меняется.
  assert.deepEqual(parseRestorePayload('snap-1'), {id: 'snap-1', sessionIds: []});
});

test('объект от пикера разбирается, а не уезжает литералом', () => {
  // Без этой ветки id снимка стал бы строкой `{"id":"snap-1"}`, и
  // восстановление молча не находило бы ничего: ошибки на такой вход нет,
  // есть пустой результат.
  assert.deepEqual(parseRestorePayload('{"id":"snap-1"}'), {id: 'snap-1', sessionIds: []});
});

test('sessionIds доезжает до restoreSnapshot', () => {
  assert.deepEqual(parseRestorePayload('{"id":"snap-1","sessionIds":["aaa"]}'),
    {id: 'snap-1', sessionIds: ['aaa']});
});

test('объект без id — тоже самый свежий снимок', () => {
  assert.deepEqual(parseRestorePayload('{"sessionIds":["aaa"]}'),
    {id: 'last', sessionIds: ['aaa']});
});

test('мусор в sessionIds отбрасывается, а снимок поднимается целиком', () => {
  // Полбеды лучше беды: раскладка поднимется вся, а не ни одна.
  assert.deepEqual(parseRestorePayload('{"id":"snap-1","sessionIds":"aaa"}'),
    {id: 'snap-1', sessionIds: []});
});
