const winMan = require('windows11-manager');
const globalConfig = require('../config.js');
const {exec, spawn} = require('child_process');
const {
  buildSessionsPayload, chooseAction, resolveDesktopSwitch, cycleSort,
} = require('../picker/session-groups');
const {labelSessions} = require('../picker/session-groups');
const {buildSlots, sessionIdForSlot} = require('../picker/session-slots');
const {
  readSessionsSortFromConfig, persistSessionsSort,
} = require('../picker/sessions-sort-config');
const {
  DEFAULTS: sessionOpenDefaults,
  toWindowsPath,
  isCursorProcessPath,
  availableActions,
  buildOpenCommands,
} = require('../picker/session-open-helpers');
const {resolveAppFile} = require('../paths');
const {
  discoveryMessages, namesFingerprint, stateMessages, topics: haTopics,
} = require('../homeassistant/discovery');
const {
  sessionEntity, buildSessionEntities, buildSummaryEntity,
} = require('../homeassistant/claude-sessions');
const {throttlePress} = require('./press-throttle');

module.exports = async (mqtt, config, log) => {
  let lastStats = {};
  let statsIntervalId = null;
  let restoreTimeoutId = null;

  if (config.restoreOnStart) {
    await restoreWindows();
    restoreTimeoutId = setTimeout(() => {
      if (config.placeWindowOnStart) winMan.placeWindows();
      restoreTimeoutId = null;
    }, 15000);
  }

  if (config.placeWindowOnOpen) {
    await winMan.placeWindowOnOpen();
  }

  if (config.claudeWt) {
    winMan.startClaudeWt();
  }

  if (config.placeWindowOnStart) {
    await winMan.placeWindows();
  }

  if (config.publishStats) {
    publishStats();
    statsIntervalId = setInterval(publishStats, 60000);
  }

  function onStop() {
    if (statsIntervalId !== null) {
      clearInterval(statsIntervalId);
      statsIntervalId = null;
    }
    if (restoreTimeoutId !== null) {
      clearTimeout(restoreTimeoutId);
      restoreTimeoutId = null;
    }
    if (config.placeWindowOnOpen) winMan.stopPlaceNewWindows();
    if (config.claudeWt) winMan.stopClaudeWt();
    stopSessionsFeed();
    stopHomeAssistantExport();
  }

  function onStart() {
    if (config.publishStats && statsIntervalId === null) {
      publishStats();
      statsIntervalId = setInterval(publishStats, 60000);
    }
  }

  async function restoreWindows() {
    await winMan.restoreWindows();

    const stored = config?.store?.custom;
    if (stored.apps) stored.windows = stored.apps.map(path => {
      return {path}
    });
    await winMan.openStore(stored);
  }

  function publishStats() {
    const topicBase = config.publishStatsTopic || `${config.base}/stats`;
    const stats = winMan.getStats();

    // for correct graphs need to send 0 at latest count
    if (lastStats?.byApp) {
      for (let app in lastStats.byApp) {
        if (lastStats.byApp[app].count === 0) continue;
        if (!stats.byApp[app]) stats.byApp[app] = {count: 0, wins: []}
      }
    }
    lastStats = stats;

    mqtt.publish(`${topicBase}/total`, `${stats.total}`);

    for (let name in stats.byApp) {
      const app = stats.byApp[name];
      const topic = `${topicBase}/apps/${name}`;
      const msg = `${app.count}`;
      mqtt.publish(topic, msg);
    }

    if (stats.active) {
      mqtt.publish(`${topicBase}/active/app`, stats.active.app);
      mqtt.publish(`${topicBase}/active/title`, stats.active.title);
    }
  }

  async function autoplace(topic, message) {
    log(`< ${topic}: ${message}`);
    const placed = await winMan.placeWindows();

    const apps = placed.map(item => {
      const parts = item.w.path.split('\\');
      return parts[parts.length - 1].replace(/\.exe$/, '');
    });
    const msg = `Placed windows: ${placed.length}`;
    log(msg);

    // notify
    if (config.notifyPlaced && placed.length > 0) {
      const topic = globalConfig.mqtt.base + '/notify/notify';
      mqtt.publish(topic, msg);
    }
  }

  // Opens a terminal window per stored claude session, ~2s apart, so it takes
  // tens of seconds and gives no feedback until done. Refuses to run when any
  // planned session is already on screen.
  async function claudeRestore() {
    const {restored, skipped} = await winMan.restoreClaudeSessions();
    log(`claude-wt restored ${restored.length}, skipped ${skipped.length}`);
  }

  // Focus fails silently unless Rust has granted this process the right to take
  // the foreground first — see allow_node_foreground and send_command_with in main.rs.
  async function claudeFocus(payload) {
    const id = payload?.id;
    if (!id) return;
    let res;
    try {
      res = winMan.claudeWtSessions();
    } catch (e) {
      log(`claude-wt sessions failed: ${e.message}`, 'error');
      notifyPicker(`claude-wt: ${e.message}`);
      return;
    }
    if (!res.ok) { log(`claude-wt: ${res.reason}`, 'warn'); notifyPicker(`claude-wt: ${res.reason}`); return; }
    const session = res.sessions.find(s => s.id === id);
    if (!session) {
      log(`claude-wt: unknown session ${id}`, 'warn');
      notifyPicker(`claude-wt: unknown session ${id}`);
      return;
    }

    const action = chooseAction(session, (windowId) => !!winMan.getWindowById(windowId));
    if (action === 'restore') {
      await claudeRestoreOne({id});
      scheduleHaRefresh();
      return;
    }

    const current = await winMan.virtualDesktop.GetWindowDesktopNumber(session.windowId);
    const target = resolveDesktopSwitch(current);
    if (target !== null) {
      await winMan.virtualDesktop.GoToDesktopNumber(target);
    }
    if (!winMan.focusWindowById(session.windowId)) {
      log(`claude-wt: ${id} is not on screen`, 'warn');
    }
    scheduleHaRefresh();
  }

  function sessionOpenOpts() {
    const so = config.sessionOpen || {};
    const execCfg = globalConfig.modules?.exec || {};
    return {
      linuxHome: so.linuxHome || sessionOpenDefaults.linuxHome,
      windowsRoot: so.windowsRoot || sessionOpenDefaults.windowsRoot,
      sshHost: so.sshHost || sessionOpenDefaults.sshHost,
      sshApp: so.sshApp || execCfg.ssh_app || sessionOpenDefaults.sshApp,
    };
  }

  function findCursorExe() {
    try {
      const hit = winMan.getWindows().find(w => isCursorProcessPath(w.path));
      return hit?.path || null;
    } catch (e) {
      log(`claude-wt cursor detect failed: ${e.message}`, 'warn');
      return null;
    }
  }

  function findSessionById(id) {
    let res;
    try {
      res = winMan.claudeWtSessions();
    } catch (e) {
      return { error: e.message };
    }
    if (!res.ok) return { error: res.reason };
    const session = res.sessions.find(s => s.id === id);
    if (!session) return { error: `unknown session ${id}` };
    return { session };
  }

  function runDetachedSpawn(file, args) {
    return new Promise((resolve, reject) => {
      const child = spawn(file, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      let done = false;
      const finish = (fn, arg) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        fn(arg);
      };
      child.once('error', (err) => finish(reject, err));
      child.unref();
      // ENOENT (and friends) arrive on the next ticks; if nothing failed soon,
      // treat the spawn as accepted — GUI apps stay running and never "exit".
      const timer = setTimeout(() => finish(resolve, child), 50);
    });
  }

  async function runOpenCommand(cmd, { cursorExe, winPath }) {
    if (!cmd) throw new Error('unsupported action');
    if (cmd.kind === 'shell') {
      return new Promise((resolve, reject) => {
        exec(cmd.command, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
    try {
      await runDetachedSpawn(cmd.file, cmd.args);
    } catch (e) {
      if (e.code === 'ENOENT' && cmd.file === 'cursor' && cursorExe) {
        await runDetachedSpawn(cursorExe, [winPath]);
        return;
      }
      throw e;
    }
  }

  // Ctrl+K menu: which open-targets apply for this session right now.
  async function claudeSessionActions(payload) {
    const id = payload?.id;
    if (!id || typeof mqtt.sendEvent !== 'function') return;
    const found = findSessionById(id);
    if (found.error) {
      log(`claude-wt session-actions: ${found.error}`, 'warn');
      mqtt.sendEvent('claude-wt-session-actions', {ok: false, reason: found.error});
      return;
    }
    const {session} = found;
    const labeled = labelSessions([session])[0];
    const opts = sessionOpenOpts();
    const cursorExe = findCursorExe();
    const actions = availableActions(
      {cwd: session.cwd, cursorRunning: !!cursorExe},
      opts,
    );
    mqtt.sendEvent('claude-wt-session-actions', {
      ok: true,
      id: session.id,
      label: labeled.label || '',
      cwd: session.cwd || '',
      actions,
    });
  }

  async function claudeSessionOpen(payload) {
    const id = payload?.id;
    const action = payload?.action;
    if (!id || !action) return;
    const found = findSessionById(id);
    if (found.error) {
      log(`claude-wt session-open: ${found.error}`, 'warn');
      notifyPicker(`claude-wt: ${found.error}`);
      return;
    }
    const {session} = found;
    const opts = sessionOpenOpts();
    const winPath = toWindowsPath(session.cwd, opts);
    if (!winPath) {
      notifyPicker('claude-wt: cannot map session path to Windows');
      return;
    }
    const cursorExe = findCursorExe();
    if (action === 'cursor' && !cursorExe) {
      notifyPicker('claude-wt: Cursor is not running');
      return;
    }
    const cmd = buildOpenCommands({
      action,
      cwd: session.cwd,
      winPath,
      sshApp: opts.sshApp,
      sshHost: opts.sshHost,
      cursorExe,
      useCursorCli: true,
    });
    try {
      await runOpenCommand(cmd, {cursorExe, winPath});
      log(`claude-wt open ${action}: ${session.cwd}`);
    } catch (e) {
      log(`claude-wt open ${action} failed: ${e.message}`, 'error');
      notifyPicker(`claude-wt: open ${action} failed — ${e.message}`);
    }
  }

  // Экспорт сессий в Home Assistant. Живёт своим таймером, а не фидом пикера:
  // панель показывает список постоянно, а фид крутится только пока открыто окно
  // выбора. Интервал редкий — claudeWtSessions() сканирует окна через
  // getWindows(), и раз в секунду в фоне ему тут делать нечего.
  // Транспорт — MQTT Discovery, а не REST: только так у сущностей появляется
  // устройство, unique_id и жизнь после перезапуска HA. /api/states пишет
  // состояние мимо реестра, поэтому там ни устройства, ни переименования.
  const haCfg = {
    slots: config?.homeassistant?.slots ?? 10,
    interval: (config?.homeassistant?.interval ?? 15) * 1000,
    enabled: config?.homeassistant?.enabled !== false,
    // Закрытые сессии на панели только мешают: строк там единицы, и каждая,
    // занятая давно закрытой сессией, вытесняет живую. В пикере они по-прежнему
    // видны — там места хватает, и восстановить закрытую можно только оттуда.
    openOnly: config?.homeassistant?.openOnly !== false,
  };
  let haTimerId = null;
  let haAnnounced = null;
  // Последняя разложенная по слотам картина: фокус с панели приходит номером
  // строки, а не id сессии — кнопка прибита к строке, и что в ней лежит, знает
  // только эта сторона.
  let lastSlots = [];

  function currentSessions() {
    const res = winMan.claudeWtSessions();
    if (!res.ok) throw new Error(res.reason);
    return labelSessions(res.sessions);
  }

  function publishAll(messages) {
    for (const m of messages) mqtt.publish(m.topic, m.payload, {retain: m.retain, qos: 0});
  }

  async function exportToHomeAssistant() {
    if (!haCfg.enabled) return;
    let sessions;
    try {
      sessions = currentSessions();
    } catch (e) {
      log(`claude-wt sessions failed: ${e.message}`, 'error');
      return;
    }
    // Сводка считается по всем сессиям, слоты — только по живым: total в
    // сводке должен оставаться total.
    const slotSessions = haCfg.openOnly ? sessions.filter(s => s.open) : sessions;
    lastSlots = buildSlots(slotSessions, haCfg.slots);
    // Конфиги переиздаются только когда меняются имена: HA держит их retained,
    // и гонять десяток сообщений каждые пятнадцать секунд ради тех же
    // заголовков незачем.
    const names = lastSlots.map(s => s.title);
    const fingerprint = namesFingerprint(names);
    if (fingerprint !== haAnnounced) {
      publishAll(discoveryMessages(config.base, haCfg.slots, names));
      haAnnounced = fingerprint;
    }
    publishAll(stateMessages(config.base, [
      buildSummaryEntity(sessions),
      ...buildSessionEntities(slotSessions, haCfg.slots),
    ]));
  }

  function startHomeAssistantExport() {
    if (!haCfg.enabled || haTimerId !== null) return;
    log(`home assistant: publishing ${haCfg.slots} session slots every ${haCfg.interval / 1000}s`);
    exportToHomeAssistant();
    haTimerId = setInterval(exportToHomeAssistant, haCfg.interval);
  }

  // Внеочередной экспорт после того, как мы сами перевели фокус.
  //
  // Отметку «просмотрено» ставит демон claude-wt на своём тике, а не мы в
  // момент вызова: переключиться на окно можно и руками, поэтому признак живёт
  // там, где видно любой переход фокуса. Значит сразу после focusWindowById()
  // состояние на диске ещё прежнее, и экспорт по горячим следам опубликовал бы
  // ровно тот статус, от которого человек только что ушёл. Ждём тик демона с
  // запасом и публикуем один раз; периодический таймер остаётся страховкой.
  //
  // Две секунды — это два тика демона (у него интервал 1000 мс). Одного хватило
  // бы в среднем, но тик, пришедшийся сразу после нашего таймера, оставил бы
  // панель с прежним статусом до следующего периодического экспорта.
  const HA_REFRESH_DELAY = 2000;
  let haRefreshId = null;

  function scheduleHaRefresh(delay = HA_REFRESH_DELAY) {
    // Один отложенный экспорт на серию нажатий: пока прошлый не отработал,
    // новый таймер не нужен — публиковать он будет то же самое.
    if (!haCfg.enabled || haRefreshId !== null) return;
    haRefreshId = setTimeout(() => {
      haRefreshId = null;
      exportToHomeAssistant();
    }, delay);
    haRefreshId.unref?.();
  }

  function stopHomeAssistantExport() {
    if (haRefreshId !== null) {
      clearTimeout(haRefreshId);
      haRefreshId = null;
    }
    if (haTimerId === null) return;
    clearInterval(haTimerId);
    haTimerId = null;
    // Сущности станут unavailable, а не застынут с последним состоянием: пока
    // windows-mqtt не работает, никакой номер слота ничего не значит.
    mqtt.publish(haTopics(config.base).availability, 'offline', {retain: true, qos: 0});
  }

  /**
   * Погасить переключатель слота, не дожидаясь очередного экспорта.
   *
   * Состояние слота отвечает на вопрос «нужен ли я тебе», и нажатие на него уже
   * ответило: человек идёт к этой сессии. Ждать до пятнадцати секунд, пока
   * периодический экспорт скажет то же самое, незачем — всё это время плитка
   * горит и зовёт туда, куда уже пошли.
   *
   * Публикуется слот целиком, а не одно поле: состояние и атрибуты живут в
   * одном топике (`json_attributes_topic` = `state_topic`), и нагрузка из
   * одного `state` стёрла бы текст, сводку и цифры — строка на панели опустела
   * бы до следующего тика.
   *
   * Раскладка берётся из последнего экспорта: она же отвечала на нажатие, и
   * гасить надо ровно ту строку, которую человек видел.
   */
  function publishSlotOff(slot) {
    if (!haCfg.enabled) return;
    const n = Number(slot);
    const known = lastSlots.find(s => s.slot === n);
    if (!known) return;
    publishAll(stateMessages(config.base, [{...sessionEntity(known), state: 'off'}]));
  }

  /**
   * Нажатие на переключатель сессии в интерфейсе Home Assistant.
   *
   * Топик несёт номер слота, полезная нагрузка (ON/OFF) не важна: у сессии нет
   * «выключить», есть только «перейти к ней».
   *
   * Гасим до перехода, а не после: focusWindowById() ходит в Windows и может
   * задуматься, а переключатель к этому моменту уже должен стоять правильно.
   */
  /**
   * Отброшенное нажатие с панели.
   *
   * Пишется в журнал, а не проглатывается молча: с той стороны человек видит
   * только то, что кнопка не сработала, и без строки в логе это неотличимо от
   * поломки — ни на плате, ни в Home Assistant следа не остаётся.
   */
  function pressDropped(topic, message) {
    log(`< ${topic}: ${String(message ?? '').trim()} — отброшено, не чаще раза в секунду`, 'warn');
  }

  async function claudeSlotCommand(topic) {
    const slot = topic.split('/').at(-2);
    log(`< ${topic}`);
    publishSlotOff(slot);
    await claudeFocusSlot(topic, slot);
  }

  /**
   * Фокус по номеру строки на панели.
   *
   * Панель шлёт номер, а не id: топик в openhasp_buttons.yaml — фиксированная
   * строка, он не может зависеть от того, какая сессия сейчас в этой строке.
   * Раскладка берётся из последнего экспорта, чтобы номер значил ровно то, что
   * человек видел на экране в момент нажатия.
   */
  async function claudeSnapshotRestore(topic, message) {
    // Пустое сообщение означает самый свежий снимок. Снимок, а не lastLayout:
    // последний обнуляется через секунду после закрытия окон, потому что демон
    // переписывает его тем, что видит на экране.
    const id = String(message ?? '').trim() || 'last';
    log(`< ${topic}: ${id}`);
    try {
      const {restored, skipped} = await winMan.restoreSnapshot({id});
      log(`claude-wt snapshot ${id}: restored ${restored.length}, skipped ${skipped.length}`);
      if (!restored.length && !skipped.length) notifyPicker('claude-wt: нечего восстанавливать');
    } catch (e) {
      log(`claude-wt snapshot restore failed: ${e.message}`, 'error');
      notifyPicker(`claude-wt: ошибка восстановления — ${e.message}`);
    }
  }

  async function claudeFocusSlot(topic, message) {
    // Обработчики подписок получают сырое сообщение: с панели прилетает просто
    // номер строки, но JSON-вида {slot: N} тоже принимаем — так удобнее звать
    // руками из автоматизаций.
    const raw = String(message ?? '').trim();
    let slot = raw;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.slot !== undefined) slot = parsed.slot;
    } catch { /* обычный номер, не JSON */ }
    log(`< ${topic}: ${raw}`);
    const id = sessionIdForSlot(lastSlots, slot);
    if (!id) {
      log(`claude-wt: slot ${slot} is empty`, 'warn');
      return;
    }
    await claudeFocus({id});
  }

  let sessionsTimerId = null;

  function sendSessions() {
    if (typeof mqtt.sendEvent !== 'function') return;
    let res;
    try {
      res = winMan.claudeWtSessions();
    } catch (e) {
      log(`claude-wt sessions failed: ${e.message}`, 'error');
      mqtt.sendEvent('claude-wt-sessions', {ok: false, reason: e.message});
      return;
    }
    const sort = readSessionsSortFromConfig(config);
    mqtt.sendEvent('claude-wt-sessions', buildSessionsPayload(res, sort));
  }

  function cycleSessionsSort() {
    const next = cycleSort(readSessionsSortFromConfig(config));
    try {
      persistSessionsSort({
        moduleConfig: config,
        globalConfig,
        sort: next,
        configPath: resolveAppFile('config.yml', 'CONFIG'),
      });
    } catch (e) {
      log(`claude-wt sessionsSort persist failed: ${e.message}`, 'error');
      // In-memory still updated so the UI reflects the click even if the file
      // write failed (read-only install, missing config.yml, …).
      config.sessionsSort = next;
    }
    sendSessions();
  }

  // Only runs while the picker window is open: it scans every terminal window
  // once a second, which is not something to do in the background forever.
  function startSessionsFeed() {
    sendSessions();
    if (sessionsTimerId === null) sessionsTimerId = setInterval(sendSessions, 1000);
  }

  function stopSessionsFeed() {
    if (sessionsTimerId !== null) {
      clearInterval(sessionsTimerId);
      sessionsTimerId = null;
    }
  }

  async function claudeRestoreOne(payload) {
    const id = payload?.id;
    if (!id) return;
    try {
      const {restored, skipped} = await winMan.restoreClaudeSessions({sessionIds: [id]});
      log(`claude-wt restored ${restored.length}, skipped ${skipped.length}`);
      if (!restored.length) notifyPicker(`claude-wt: не удалось поднять сессию ${id}`);
    } catch (e) {
      log(`claude-wt restore failed: ${e.message}`, 'error');
      notifyPicker(`claude-wt: ошибка восстановления — ${e.message}`);
    }
  }

  // A silent failure is worse than one extra toast: the picker is already gone
  // by the time restore finishes, so the log is the only other channel.
  function notifyPicker(message) {
    mqtt.publish(globalConfig.mqtt.base + '/notify/notify', message);
  }

  // win:active,x:0,y:0,width:mon1.thirdWidth,height:mon1.height
  async function place(topic, message) {
    log(`< ${topic}: ${message}`);
    try {
      const pos = JSON.parse(`${message}`);
      await winMan.placeWindowByConfig(pos);
    } catch (e) {
      log('Failed to parse place position json');
      log(e);
    }
  }

  async function store(topic, message) {
    // log(`< ${topic}: ${message}`);
    winMan.storeWindows();
  }

  async function restore(topic, message) {
    log(`< ${topic}: ${message}`);
    await restoreWindows();
  }

  async function clear(topic, message) {
    log(`< ${topic}: ${message}`);
    winMan.clearWindows();
  }

  async function open(topic, message) {
    log(`< ${topic}: ${message}`);
    const store = JSON.parse(`${message}`);
    winMan.openStore(store);
  }

  async function focus(topic, message) {
    log(`< ${topic}: ${message}`);
    const rules = JSON.parse(`${message}`);
    const focused = await winMan.focusWindow(rules);
    if (!focused) log(`focus: no window matched ${message}`, 'warn');
  }

  async function reload() {
    await winMan.reloadConfigs();
    await mqtt.publish(`${config.base}/reload`, '1');
  }

  async function restartHandler(topic, message) {
    log(`< ${topic}: ${message}`);
    const type = `${message}`;
    if (type === 'nostore') {
      restart();
    } else {
      winMan.storeWindows();
      restart();
    }
  }

  async function shutdownHandler(topic, message) {
    log(`< ${topic}: ${message}`);
    const type = `${message}`;
    if (type === 'store') {
      winMan.storeWindows();
    }
    shutdown();
  }

  function sleep() {
    setTimeout(() => {
      exec('D:/prog/SysinternalsSuite/psshutdown.exe -d -t 0');
    }, 1000);
  }

  function restart() {
    setTimeout(() => {
      exec('shutdown -t 0 -r -f');
    }, 1000);
  }

  function shutdown() {
    setTimeout(() => {
      exec('shutdown -t 0 -s -f');
    }, 1000);
  }

  const menuItems = [];
  menuItems.push(...[
    {
      label: 'Place windows',
      async click() {
        await autoplace('command/autoplace', '1');
      }
    },
    {
      label: 'Store windows',
      click() {
        winMan.storeWindows();
      }
    },
    {
      label: 'Restore windows',
      async click() {
        await winMan.restoreWindows();
      },
    },
    {
      label: 'Clear stored windows',
      click() {
        winMan.clearWindows();
      },
    },
  ]);

  // open default apps
  const stored = config?.store?.default;
  if (stored.apps) stored.windows = stored.apps.map(path => {
    return {path}
  });
  if (stored) {
    menuItems.push({
      label: 'Open default apps',
      click() {
        winMan.openStore(stored);
      }
    })
  }

  menuItems.push(...[
    {
      type: 'separator',
    },
    {
      label: 'Restart with windows restore',
      click() {
        winMan.storeWindows();
        restart();
      }
    },
    {
      label: 'Sleep',
      click: sleep
    },
    {
      label: 'Restart',
      click: restart
    },
    {
      label: 'Shutdown',
      click: shutdown
    },
    {
      type: 'separator',
    },
    {
      label: 'Reload configs',
      click: reload
    },
  ]);

  const stdinActions = {
    'windows/autoplace': () => autoplace('stdin/autoplace', '1'),
    'windows/store': () => winMan.storeWindows(),
    'windows/restore': () => restoreWindows(),
    'windows/clear': () => winMan.clearWindows(),
    'windows/open_default': () => {
      const s = config?.store?.default;
      if (s) {
        if (s.apps) s.windows = s.apps.map(path => ({ path }));
        winMan.openStore(s);
      }
    },
    'windows/claude-restore': () => claudeRestore(),
    'windows/claude-focus': (payload) => claudeFocus(payload),
    'windows/claude-session-actions': (payload) => claudeSessionActions(payload),
    'windows/claude-session-open': (payload) => claudeSessionOpen(payload),
    'windows/claude-sessions-start': () => startSessionsFeed(),
    'windows/claude-sessions-stop': () => stopSessionsFeed(),
    'windows/claude-sessions-sort-cycle': () => cycleSessionsSort(),
    'windows/claude-restore-one': (payload) => claudeRestoreOne(payload),
    'windows/restart_restore': () => { winMan.storeWindows(); restart(); },
    'windows/sleep': () => sleep(),
    'windows/restart': () => restart(),
    'windows/shutdown': () => shutdown(),
    'windows/reload': () => reload(),
  };

  // Экспорт стартует здесь, а не рядом со startClaudeWt() выше: он опирается
  // на const-объявления ниже по файлу, и вызов оттуда попал бы во временную
  // мёртвую зону.
  if (config.claudeWt) startHomeAssistantExport();

  return {
    subscriptions: [
      {
        // Панель openHASP шлёт сюда номер строки; см. claudeFocusSlot().
        //
        // Под ограничителем: строка на панели — физическая кнопка, и палец,
        // снятый неровно, даёт две-три посылки подряд. Каждая — переход фокуса
        // в Windows, то есть настоящая работа, а не запись в переменную.
        topics: [config.base + '/claude-focus-slot'],
        handler: throttlePress(claudeFocusSlot, {onDrop: pressDropped})
      },
      {
        // Своё окно, а не общее со строками: восстановление снимка — другое
        // действие, и нажатие на строку не должно съедать нажатие на кнопку.
        topics: [config.base + '/claude-snapshot-restore'],
        handler: throttlePress(claudeSnapshotRestore, {onDrop: pressDropped})
      },
      {
        // Переключатели сессий в Home Assistant. Топики перечислены поимённо:
        // диспетчер подписок ищет обработчик точным совпадением, шаблон с + он
        // не разрешит.
        topics: Array.from({length: config?.homeassistant?.slots ?? 9},
          (_, i) => haTopics(config.base).slotCommand(i + 1)),
        handler: claudeSlotCommand
      },
      {
        topics: [config.base + '/autoplace'],
        handler: autoplace
      },
      {
        topics: [config.base + '/place'],
        handler: place
      },
      {
        topics: [config.base + '/store'],
        handler: store
      },
      {
        topics: [config.base + '/restore'],
        handler: restore
      },
      {
        topics: [config.base + '/clear'],
        handler: clear
      },
      {
        topics: [config.base + '/open'],
        handler: open
      },
      {
        topics: [config.base + '/focus'],
        handler: focus
      },
      {
        topics: [config.base + '/sleep'],
        handler: sleep
      },
      {
        topics: [config.base + '/restart'],
        handler: restartHandler
      },
      {
        topics: [config.base + '/shutdown'],
        handler: shutdownHandler
      },
    ],
    stdinActions,
    menuItems,
    onStop,
    onStart,
  };
}
