/** Питание машины. Осталось здесь после того, как окна уехали в windows11-manager. */
const {exec} = require('child_process');

/**
 * Попросить менеджер сохранить раскладку и дождаться ответа.
 *
 * Ждать подтверждения брокера бессмысленно: QoS говорит о доставке до брокера,
 * а не о том, что раскладка записана на диск. Признак — ответная публикация
 * `windows/store/done`, которую менеджер шлёт по завершении storeWindows().
 * Таймаут нужен на случай, когда менеджера нет вовсе: перезагрузка без
 * сохранения лучше, чем машина, которая не перезагружается.
 */
function storeThen({
  publish, base, ack, timeoutMs = 5000,
  setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout,
}) {
  publish(`${base}/store`, '1');
  return new Promise((resolve) => {
    const timer = setTimeoutFn(resolve, timeoutMs);
    if (ack && typeof ack.then === 'function') {
      ack.then(() => {
        clearTimeoutFn(timer);
        resolve();
      });
    }
  });
}

function sleep() {
  setTimeout(() => exec('D:/prog/SysinternalsSuite/psshutdown.exe -d -t 0'), 1000);
}

function restart() {
  setTimeout(() => exec('shutdown -t 0 -r -f'), 1000);
}

function shutdown() {
  setTimeout(() => exec('shutdown -t 0 -s -f'), 1000);
}

module.exports = async (mqtt, config, log) => {
  // Ответ менеджера ловится одной подпиской на всё время жизни модуля: своей
  // на каждую перезагрузку было бы столько же, сколько перезагрузок.
  let ackResolvers = [];
  function nextAck() {
    return new Promise((resolve) => ackResolvers.push(resolve));
  }
  function onStoreDone() {
    const pending = ackResolvers;
    ackResolvers = [];
    for (const r of pending) r();
  }

  const publish = (topic, payload) => mqtt.publish(topic, payload);

  async function storeAndThen(action) {
    await storeThen({publish, base: config.base, ack: nextAck()});
    action();
  }

  return {
    subscriptions: [
      {topics: [`${config.base}/store/done`], handler: onStoreDone},
      {topics: [`${config.base}/sleep`], handler: () => sleep()},
      {
        topics: [`${config.base}/restart`],
        handler: (topic, message) => {
          log(`< ${topic}: ${message}`);
          if (`${message}` === 'nostore') restart();
          else storeAndThen(restart);
        },
      },
      {
        topics: [`${config.base}/shutdown`],
        handler: (topic, message) => {
          log(`< ${topic}: ${message}`);
          if (`${message}` === 'store') storeAndThen(shutdown);
          else shutdown();
        },
      },
      {topics: [`${config.base}/restart_restore`], handler: () => storeAndThen(restart)},
    ],
    menuItems: [
      {label: 'Restart with windows restore', click: () => storeAndThen(restart)},
      {label: 'Sleep', click: sleep},
      {label: 'Restart', click: restart},
      {label: 'Shutdown', click: shutdown},
    ],
  };
};

module.exports.storeThen = storeThen;
