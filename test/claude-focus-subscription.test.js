/**
 * Просьба ccfzf-picker о подъёме окна приходит по MQTT, а не по stdin.
 *
 * Пикер живёт на другой машине и публикует `<base>/windows/claude-focus` с
 * телом `{"id": …}` — ответа у просьбы нет по замыслу (http-сервер, у которого
 * ответ был, вешал демона). Пока подписки на этот топик не было, публикация
 * уходила в пустоту: имя `windows/claude-focus` существовало только ключом
 * `stdinActions`, то есть дверью для своего же Tauri-процесса, и брокер ничего
 * демону не доставлял. Молчание с обеих сторон — ровно то, что человек видел
 * как «Enter не работает».
 *
 * Проверка текстовая, а не через загрузку модуля: `src/modules/windows.js`
 * тянет нативный windows11-manager, которого в тестах нет. Тот же приём, что и
 * в picker-action-consistency.test.js.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const windowsModulePath = path.join(__dirname, '..', 'src', 'modules', 'windows.js');

test('модуль windows подписан на claude-focus, а не только на claude-focus-slot', () => {
  const js = fs.readFileSync(windowsModulePath, 'utf8');

  // Закрывающая кавычка в шаблоне обязательна: без неё совпал бы соседний
  // claude-focus-slot, и тест прошёл бы на коде, где подписки по-прежнему нет.
  const subscribed = /topics:\s*\[[^\]]*config\.base\s*\+\s*['"]\/claude-focus['"][^\]]*\]/;
  assert.ok(
    subscribed.test(js),
    'нет подписки на config.base + \'/claude-focus\': пикер публикует туда просьбу '
    + 'о подъёме окна, и без подписки она пропадает молча',
  );
});

test('слот-топик панели остался на месте', () => {
  // Соседняя дверь: панель openHASP шлёт номер строки, а не id сессии. Правка
  // подписки на claude-focus не должна была её задеть.
  const js = fs.readFileSync(windowsModulePath, 'utf8');
  const slot = /topics:\s*\[[^\]]*config\.base\s*\+\s*['"]\/claude-focus-slot['"][^\]]*\]/;
  assert.ok(slot.test(js), 'подписка на claude-focus-slot пропала');
});
