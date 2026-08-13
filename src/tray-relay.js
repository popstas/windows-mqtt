/**
 * Пункты трея по управлению окнами — ретрансляция в MQTT.
 *
 * Трей Tauri шлёт нажатие пункта не в брокер, а по stdin своему же
 * node-процессу (`send_command` в `src-tauri/src/main.rs`), и раньше его ловил
 * `src/modules/windows.js` — единственный модуль со `stdinActions`. После его
 * отъезда в windows11-manager обработчика в этом процессе не осталось, и
 * пункты молча писали в лог `stdin: unknown action "windows/store"`.
 *
 * Выполнять их здесь больше нечем — код уехал. Зато уехавший код слушает те же
 * топики: MQTT-служба windows11-manager подписана на `<mqtt.base>/windows/#`
 * безусловно и раздаёт команды своим роутером. Поэтому пункт трея просто
 * публикуется, и работу делает тот, у кого она теперь живёт.
 *
 * Питание (`sleep`, `restart`, `shutdown`, `restart_restore`) сюда не входит
 * намеренно: его исполняет модуль `power` в этом же процессе, и обязан делать
 * это при лежащем брокере — машина должна выключаться и без сети. Те же четыре
 * команды windows11-manager у себя явно пропускает (`FOREIGN_COMMANDS`).
 */

// Ключ — действие, которое шлёт трей; значение — суффикс топика.
// Имена суффиксов проверены по роутеру windows11-manager (`buildCommandMap`):
// autoplace, store, restore, clear, reload. Пунктов, которым там нечего
// вызвать, в трее не заведено.
const RELAYED = {
  'windows/autoplace': 'autoplace',
  'windows/store': 'store',
  'windows/restore': 'restore',
  'windows/clear': 'clear',
  'windows/reload': 'reload',
};

/**
 * Построить карту stdin-действий, публикующих команды окон в MQTT.
 *
 * @param {{publish: (topic: string, payload: string) => any}} mqtt
 * @param {string} base — `config.mqtt.base`, без хвоста `/windows`
 * @param {(message: string, level?: string) => void} log
 */
function buildTrayRelayActions(mqtt, base, log = () => {}) {
  const actions = {};
  for (const [action, command] of Object.entries(RELAYED)) {
    actions[action] = () => {
      const topic = `${base}/windows/${command}`;
      log(`> ${topic} (трей)`);
      mqtt.publish(topic, '1');
    };
  }
  return actions;
}

module.exports = { buildTrayRelayActions, RELAYED };
