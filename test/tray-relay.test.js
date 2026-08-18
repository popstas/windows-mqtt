import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

import { buildTrayRelayActions, RELAYED } from '../src/tray-relay.js';
import power from '../src/modules/power.js';

const BASE = 'home/room/pc';

function relay() {
  const published = [];
  const actions = buildTrayRelayActions(
    { publish: (topic, payload) => published.push([topic, payload]) },
    BASE,
  );
  return { actions, published };
}

test('пункт трея публикуется в топик windows11-manager, а не теряется', () => {
  // Раньше это действие ловил windows.js в этом же процессе; после его отъезда
  // исполнителя здесь нет, и единственный способ довести нажатие до него —
  // тот же топик, на который тот подписан.
  const { actions, published } = relay();
  actions['windows/store']();
  assert.deepStrictEqual(published, [[`${BASE}/windows/store`, '1']]);
});

test('ретранслируются ровно те команды, что есть в роутере windows11-manager', () => {
  // Лишний пункт молча ушёл бы в MQTT и вернулся бы предупреждением
  // «unknown command» в чужой лог, где его никто не читает.
  assert.deepStrictEqual(
    Object.keys(RELAYED).sort(),
    ['windows/autoplace', 'windows/clear', 'windows/reload', 'windows/restore', 'windows/store'],
  );
});

test('питание не ретранслируется: его исполняет power и при лежащем брокере', () => {
  // Выключение машины не должно зависеть от сети — эти четыре живут в
  // stdinActions модуля power, и windows11-manager их у себя пропускает
  // (FOREIGN_COMMANDS).
  const { actions } = relay();
  for (const power of ['windows/sleep', 'windows/restart', 'windows/shutdown', 'windows/restart_restore']) {
    assert.strictEqual(actions[power], undefined, `${power} не должен уходить в MQTT`);
  }
});

test('каждое действие трея по управлению окнами имеет обработчик', () => {
  // Симметрия с `src-tauri/src/main.rs`: там на пункт заведено действие, здесь
  // на действие — публикация. Разъехались — пункт снова пишет в лог
  // `stdin: unknown action` и не делает ничего.
  const { actions } = relay();
  for (const action of Object.keys(RELAYED)) {
    assert.strictEqual(typeof actions[action], 'function', action);
  }
});

test('у каждого пункта трея в main.rs есть обработчик на стороне node', async () => {
  // Тот самый разъезд, ради которого тест и заведён: windows.js уехал вместе
  // со своими stdinActions, а пункты меню в Rust остались — и вся секция
  // управления окнами месяц писала в лог `stdin: unknown action`, ничего не
  // делая. Ошибка молчаливая с обеих сторон, так что ловится только сверкой.
  const main = fs.readFileSync(path.join(import.meta.dirname, '..', 'src-tauri', 'src', 'main.rs'), 'utf8');
  const trayActions = [...main.matchAll(/"win_\w+"\s*=>\s*Some\("([^"]+)"\)/g)].map((m) => m[1]);
  assert.ok(trayActions.length >= 8, `подозрительно мало пунктов трея: ${trayActions.length}`);

  const powerMod = await power({ publish: () => {} }, { base: 'home/room/pc/windows' }, () => {});
  const handled = new Set([
    ...Object.keys(RELAYED),
    ...Object.keys(powerMod.stdinActions || {}),
  ]);

  const orphans = trayActions.filter((a) => !handled.has(a));
  assert.deepStrictEqual(orphans, [], `пункты трея без обработчика: ${orphans.join(', ')}`);
});
