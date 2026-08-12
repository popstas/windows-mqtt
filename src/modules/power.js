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
 *
 * `windows/store/done` НЕ привязан к конкретному запросу — он летит на любой
 * `windows/store`, откуда бы тот ни пришёл: панель openHASP и Node-RED тоже
 * публикуют его для «сохранить раскладку», и это топик, существовавший
 * задолго до power. `ack` в storeAndThen() снизу — свидетельство «какое-то
 * store завершилось», а не «моё store завершилось». Если между запросом
 * power и его ответом откуда-то ещё прилетит свой windows/store, done от НЕГО
 * снимет ожидание раньше времени, и перезагрузка пойдёт по чуть устаревшей
 * раскладке. См. createAckQueue() — там та же оговорка для запросов внахлёст.
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
 * идут внахлёст, это точное соответствие.
 *
 * «Внахлёст» здесь шире, чем два своих storeAndThen подряд: windows/store —
 * топик, которым и до power пользовались панель openHASP и Node-RED для
 * «сохранить раскладку», и менеджер шлёт done на КАЖДЫЙ такой запрос, откуда
 * бы он ни пришёл. Если чужой store (с панели) уже в процессе, когда
 * стартует свой storeAndThen, done от чужого запроса может достаться
 * ожидающему power — резолвер получит подтверждение не своего, а чьего-то
 * ещё store. На практике это не рушит протокол (см. докстринг storeThen()
 * выше), но если когда-нибудь понадобится точность — настоящее решение
 * не в этой очереди, а в корреляционном id, который менеджер эхом
 * возвращал бы в store/done.
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
    // Пункты трея приходят не по MQTT, а по stdin от Tauri, и это намеренно:
    // выключение машины должно работать и при лежащем брокере. Раздавал их
    // раньше windows.js — единственный модуль со stdinActions; после его
    // отъезда в windows11-manager пункты питания молча перестали работать
    // (`stdin: unknown action "windows/sleep"`), пока их не забрал power.
    // Имена действий — те же, что шлёт трей (`src-tauri/src/main.rs`).
    //
    // «Restart» и «Restart with restore» — два разных пункта трея, поэтому
    // первый перезагружает сразу, а раскладку сохраняет только второй; так же
    // это было и в windows.js. У одноимённых MQTT-топиков умолчание обратное
    // (там сохранение просят чаще, а отказ от него — явным `nostore`).
    stdinActions: {
      'windows/sleep': () => sleep(),
      'windows/restart': () => restart(),
      'windows/shutdown': () => shutdown(),
      'windows/restart_restore': () => storeAndThen(restart),
    },
  };
};

module.exports.storeThen = storeThen;
module.exports.createAckQueue = createAckQueue;
