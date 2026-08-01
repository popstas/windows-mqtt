const winMan = require('windows11-manager');
const globalConfig = require('../config.js');
const {exec} = require('child_process');
const {buildSessionsPayload, chooseAction, resolveDesktopSwitch} = require('../picker/session-groups');
const {labelSessions} = require('../picker/session-groups');
const {buildSlots, sessionIdForSlot} = require('../picker/session-slots');
const {HomeAssistantApi} = require('../homeassistant/api');
const {buildSessionEntities, buildSummaryEntity} = require('../homeassistant/claude-sessions');

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
  }

  // Экспорт сессий в Home Assistant. Живёт своим таймером, а не фидом пикера:
  // панель показывает список постоянно, а фид крутится только пока открыто окно
  // выбора. Интервал редкий — claudeWtSessions() сканирует окна через
  // getWindows(), и раз в секунду в фоне ему тут делать нечего.
  // Ленивая инициализация, а не const: startHomeAssistantExport() вызывается
  // выше по файлу, при запуске модуля, и const в этом месте попал бы в
  // временную мёртвую зону.
  let ha = null;
  const homeAssistant = () => (ha ??= new HomeAssistantApi(globalConfig.homeassistant, log));
  const haCfg = {
    slots: config?.homeassistant?.slots ?? 9,
    interval: (config?.homeassistant?.interval ?? 15) * 1000,
  };
  let haTimerId = null;
  // Последняя разложенная по слотам картина: фокус с панели приходит номером
  // строки, а не id сессии — кнопка прибита к строке, и что в ней лежит, знает
  // только эта сторона.
  let lastSlots = [];

  function currentSessions() {
    const res = winMan.claudeWtSessions();
    if (!res.ok) throw new Error(res.reason);
    return labelSessions(res.sessions);
  }

  async function exportToHomeAssistant() {
    if (!homeAssistant().enabled) return;
    let sessions;
    try {
      sessions = currentSessions();
    } catch (e) {
      log(`claude-wt sessions failed: ${e.message}`, 'error');
      return;
    }
    lastSlots = buildSlots(sessions, haCfg.slots);
    await homeAssistant().setStates([
      buildSummaryEntity(sessions),
      ...buildSessionEntities(sessions, haCfg.slots),
    ]);
  }

  function startHomeAssistantExport() {
    if (!homeAssistant().enabled || haTimerId !== null) return;
    log(`home assistant: exporting ${haCfg.slots} session slots every ${haCfg.interval / 1000}s`);
    exportToHomeAssistant();
    haTimerId = setInterval(exportToHomeAssistant, haCfg.interval);
  }

  function stopHomeAssistantExport() {
    if (haTimerId === null) return;
    clearInterval(haTimerId);
    haTimerId = null;
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
    mqtt.sendEvent('claude-wt-sessions', buildSessionsPayload(res));
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
    'windows/claude-sessions-start': () => startSessionsFeed(),
    'windows/claude-sessions-stop': () => stopSessionsFeed(),
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
        topics: [config.base + '/claude-focus-slot'],
        handler: claudeFocusSlot
      },
      {
        topics: [config.base + '/claude-snapshot-restore'],
        handler: claudeSnapshotRestore
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
