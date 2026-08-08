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

/**
 * Очередь ожидающих store/done в порядке FIFO.
 *
 * У store/done нет ничего, что связывало бы ответ с конкретным запросом — ни
 * payload, ни topic это не несут, а трогать протокол на стороне менеджера в
 * этой задаче нельзя. FIFO — лучшее доступное приближение: пока запросы не
 * идут внахлёст, это точное соответствие. Если же второй storeAndThen
 * стартовал раньше, чем пришёл ответ на первый, и менеджер ответит не в том
 * порядке, в котором запросы ушли, резолвер достанется не своему
 * ожидающему — этого FIFO принципиально не умеет.
 */
function createAckQueue() {
  let waiters = [];
  function wait() {
    let waiter;
    const promise = new Promise((resolve) => { waiter = resolve; });
    waiters.push(waiter);
    return {
      promise,
      // Снять себя из очереди даже без ответа (по таймауту storeThen) — иначе
      // резолвер висел бы вечно и его увёл бы следующий, никак не связанный
      // store/done.
      cancel: () => { waiters = waiters.filter((w) => w !== waiter); },
    };
  }
  function resolveNext() {
    const resolve = waiters.shift();
    if (resolve) resolve();
  }
  return { wait, resolveNext };
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
  // Одна подписка на всё время жизни модуля: своей на каждую перезагрузку
  // было бы столько же, сколько перезагрузок. Очередь FIFO раздаёт ответы по
  // порядку — см. createAckQueue().
  const ackQueue = createAckQueue();

  const publish = (topic, payload) => mqtt.publish(topic, payload);

  async function storeAndThen(action) {
    const {promise: ack, cancel} = ackQueue.wait();
    await storeThen({publish, base: config.base, ack});
    // Снимает себя из очереди в обоих случаях: и когда ответ пришёл (тогда
    // resolveNext() уже убрал его сам, и cancel() ничего не находит), и когда
    // сработал таймаут — иначе резолвер остался бы висеть и его забрал бы
    // следующий, никак не связанный store/done.
    cancel();
    action();
  }

  return {
    subscriptions: [
      {topics: [`${config.base}/store/done`], handler: () => ackQueue.resolveNext()},
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
module.exports.createAckQueue = createAckQueue;
