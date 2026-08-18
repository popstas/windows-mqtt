import { test } from 'node:test';
import assert from 'node:assert';
import keys from '../src/modules/keys.js';

const TOPIC_BASE = 'home/room/pc/keys';

/**
 * Поднять модуль keys с подставным robotjs.
 *
 * Настоящий нажал бы клавиши по-настоящему — в том самом окне, где идут
 * тесты, и `(win)f10` открыл бы пикер. Заглушка приходит четвёртым
 * аргументом, поэтому нативный аддон не грузится вовсе и файл исполняется
 * на любой платформе, а не только на Windows.
 */
async function initKeys() {
  const taps = [];
  const fakeRobot = {
    keyTap: (key, mods) => taps.push([key, mods]),
    typeString: () => {},
  };
  const logged = [];
  const mod = await keys(
    {},
    { base: TOPIC_BASE },
    (message, level) => logged.push({ message, level }),
    { robot: fakeRobot },
  );
  const handlerFor = (suffix) => {
    const sub = mod.subscriptions.find((s) => s.topics.includes(`${TOPIC_BASE}/${suffix}`));
    assert.ok(sub, `нет подписки на ${TOPIC_BASE}/${suffix}`);
    return sub.handler;
  };
  return { handlerFor, taps, logged };
}

test('press-throttled drops a bounced press: one tap, not two', async () => {
  // Кнопка на плате openHASP физическая, и палец, снятый неровно, шлёт вторую
  // посылку следом. Для (win)f10 это открытие пикера и его же закрытие.
  const { handlerFor, taps, logged } = await initKeys();
  const press = handlerFor('press-throttled');
  press(`${TOPIC_BASE}/press-throttled`, '(win)f10');
  press(`${TOPIC_BASE}/press-throttled`, '(win)f10');
  assert.deepStrictEqual(taps, [['f10', ['command']]]);
  assert.ok(logged.some((l) => l.level === 'warn' && /отброшено/.test(l.message)),
    'отброшенное нажатие должно попадать в журнал, иначе неотличимо от поломки');
});

test('press-throttled keeps a separate window per key combination', async () => {
  // Топик один на все кнопки платы: нажатие на одну не должно съедать
  // нажатие на соседнюю, сделанное следом.
  const { handlerFor, taps } = await initKeys();
  const press = handlerFor('press-throttled');
  press(`${TOPIC_BASE}/press-throttled`, '(win)f10');
  press(`${TOPIC_BASE}/press-throttled`, 'escape');
  assert.deepStrictEqual(taps, [['f10', ['command']], ['escape', []]]);
});

test('the plain press topic still lets repeats through', async () => {
  // Через него ходят audio_next и прочее из Node-RED, где повтор подряд — это и
  // есть смысл («промотать три трека»).
  const { handlerFor, taps } = await initKeys();
  const press = handlerFor('press');
  press(`${TOPIC_BASE}/press`, 'audio_next');
  press(`${TOPIC_BASE}/press`, 'audio_next');
  press(`${TOPIC_BASE}/press`, 'audio_next');
  assert.strictEqual(taps.length, 3);
});
