const {throttlePress} = require('./press-throttle');

module.exports = async (mqtt, config, log, deps = {}) => {
  // robotjs — нативный аддон: грузим внутри функции, а не на уровне модуля,
  // чтобы реестр модулей мог отдать keys на машине без собранного аддона, а
  // тест — подставить заглушку вместо настоящих нажатий (иначе прогон жал бы
  // клавиши в том самом окне, где идут тесты).
  const robot = deps.robot || require('@hurdlegroup/robotjs');
  function onPress(topic, message) {
    message = `${message}`;
    const keys = `${message}`.split(' ');

    log(`< ${topic}: ${message}`);

    for (let key of keys) {
      pressKey(key);
    }
  }

  function pressKey(key) {
    let mods = [];
    const res = key.match(/^\((.*?)\) ?/);
    if (res) {
      key = key.replace(/^\((.*?)\) ?/, '');
      mods = res[1].split(/[,|+-]/);

      // modifiers aliases
      mods = mods.map(mod => {
        if (['cmd', 'win', 'windows'].includes(mod)) return 'command';
        if (['ctrl', '^'].includes(mod)) return 'control';
        return mod;
      });
    }

    const modsStr = mods.length > 0 ? `${mods.join('+')}+` : '';
    log(`press ${modsStr}${key}`);
    robot.keyTap(key, mods);
  }

  function onType(topic, message) {
    message = `${message}`;
    log(`< ${topic}: ${message}`);
    robot.typeString(message);
  }

  /**
   * То же нажатие, но не чаще раза в секунду — для кнопок на плате openHASP.
   *
   * Кнопка на плате физическая: палец, снятый неровно, даёт две-три посылки
   * подряд. Для клавиши это хуже, чем для команды: `(win)f10` открывает пикер,
   * а второе такое же нажатие тут же его закрывает (см. toggle_picker в
   * src-tauri/src/main.rs), и снаружи это выглядит как «кнопка не работает».
   *
   * Отдельный топик, а не ограничитель на самом `press`: туда же летят
   * audio_next и прочее из Node-RED, где повтор подряд — это и есть смысл
   * («промотать три трека»), и глушить его нельзя.
   *
   * Окно на каждую комбинацию своё: топик один на все кнопки платы, и общий
   * счётчик означал бы, что нажатие на одну кнопку съедает нажатие на соседнюю.
   */
  const onPressThrottled = throttlePress(onPress, {
    keyOf: (topic, message) => `${message}`,
    // Отброшенное нажатие пишется в журнал, а не проглатывается молча: с той
    // стороны видно только то, что кнопка не сработала, и без строки в логе это
    // неотличимо от поломки.
    onDrop: (topic, message) =>
      log(`< ${topic}: ${message} — отброшено, не чаще раза в секунду`, 'warn'),
  });

  return {
    subscriptions: [
      {
        topics: [ config.base + '/press' ],
        handler: onPress
      },
      {
        topics: [ config.base + '/press-throttled' ],
        handler: onPressThrottled
      },
      {
        topics: [ config.base + '/type' ],
        handler: onType
      },
    ]
  }
}