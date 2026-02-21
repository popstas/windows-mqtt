const readline = require('readline');
const { log } = require('./helpers');

const handlers = {};

function register(actionMap) {
  for (const [action, fn] of Object.entries(actionMap)) {
    handlers[action] = fn;
  }
}

function init() {
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
  });

  rl.on('close', () => {
    log('stdin closed');
  });
}

module.exports = { init, register };
