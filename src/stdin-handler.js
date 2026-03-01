const readline = require('readline');
const { log } = require('./helpers');

const handlers = {};

function register(actionMap) {
  for (const [action, fn] of Object.entries(actionMap)) {
    handlers[action] = fn;
  }
}

async function handleAction(action) {
  const handler = handlers[action];
  if (!handler) {
    log(`stdin: unknown action "${action}"`, 'warn');
    return;
  }

  try {
    log(`stdin: ${action}`);
    await handler();
  } catch (e) {
    log(`stdin: error in "${action}": ${e.message}`, 'error');
  }
}

function init(mqttBridge) {
  if (mqttBridge) {
    // Bridge mode: actions arrive via mqttBridge 'action' events
    mqttBridge.on('action', handleAction);
  } else {
    // Standalone mode: read JSON lines from stdin
    const rl = readline.createInterface({ input: process.stdin });

    rl.on('line', async (line) => {
      let cmd;
      try {
        cmd = JSON.parse(line);
      } catch {
        return;
      }

      const { action } = cmd;
      if (!action) return;

      await handleAction(action);
    });

    rl.on('close', () => {
      log('stdin closed');
    });
  }
}

module.exports = { init, register };
