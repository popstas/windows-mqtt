const fs = require('fs');
const os = require('os');
const path = require('path');
const globalConfig = require('../config.js');
const yaml = require('js-yaml');
const { resolveUserDataFile, resolveAppFile } = require('../paths');

// Write a script-type command body to a temp file in the OS temp dir (always
// writable, unlike a bundled app's read-only cwd) and schedule cleanup. Returns
// the temp file path. The cleanup timer is unref'd so it never keeps the
// process (or a test run) alive.
function writeScriptFile(script) {
  const filePath = path.join(
    os.tmpdir(),
    `windows-mqtt-script-${Date.now()}-${Math.round(Math.random() * 1000)}`
  );
  fs.writeFileSync(filePath, script);
  const timer = setTimeout(() => removeScriptFile(filePath), 5000);
  if (timer.unref) timer.unref();
  return filePath;
}

// Delete a script temp file, tolerating an already-removed file so the delayed
// timer never throws.
function removeScriptFile(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (e) {
    // File may already be gone; nothing to clean up.
  }
}

// Read and parse a commands.yml-style file, returning [] on any read/parse
// error (or an empty document) so callers can always spread the result.
function parseCommandsFile(filePath) {
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8')) || [];
  } catch (e) {
    console.log('commands.yml not found', e.message);
    return [];
  }
}

module.exports = async (mqtt, config, log) => {
  const subscriptions = [];

  // Route the configured (possibly relative) custom-commands path through the
  // settings-folder resolver so it is found/written under %APPDATA%/windows-mqtt.
  const customCommandsPath = resolveUserDataFile(config.custom_commands_path);

  function cmdsHandler(cmds) {
    return function (topic, message) {
      log(`< ${topic}: ${message} (commands.yml)`);
      runCmds(cmds, message);
    }
  }

  function getCustomCommands() {
    try {
      // console.log('custom_commands_path: ', customCommandsPath);
      return yaml.load(fs.readFileSync(customCommandsPath, 'utf8'));
    } catch(e) {
      console.log('e.message: ', e.message);
      return [];
    }
  }

  function addCustomCommand(topic, message) {
    log(`< ${topic}: ${message} (commands.yml)`);
    const msg = `${message}`;

    // load commands
    const commands = [];
    commands.push(...getCustomCommands());

    // add new command
    const cmd = {
      name: msg,
      dialogs: true,
      type: 'mqtt',
      mqtt_topic: 'actions/custom/' + Math.round(Math.random() * 10000),
      cmds: [
        {
          mqtt: 'tts',
          payload: 'Осталось немного дописать действия на эту фразу'
        }
      ]
    }
    if (res = msg.match(/сайт (.*)/g)) {
      cmd.cmds = [ { mqtt: 'home/room/pc/site', payload: `https://www.google.com/search?btnI=1&q=${res[1]}`} ];
    }
    commands.push(cmd);

    // save new list
    fs.mkdirSync(path.dirname(customCommandsPath), { recursive: true });
    fs.writeFileSync(customCommandsPath, yaml.dump(commands));

    // refresh runtime cache
    loadYamlCommands();
  }

  function cmdToMqttMessage(cmd, in_message) {
    let out_message = cmd.payload || JSON.stringify(in_message);
    if (typeof cmd.payload == 'object') out_message = JSON.stringify(cmd.payload);
    return out_message;
  }

  function runCmds(cmds, in_message) {
    function runCmd(cmd) {
      if (typeof cmd !== 'object') return;

      if (cmd.mqtt) {
        const topic = cmd.mqtt;
        const message = cmdToMqttMessage(cmd, in_message);
        log(`> ${topic}: ${message}`);
        mqtt.publish(topic, message);
      }

      if (cmd.exec !== undefined) {
        const topic = `${globalConfig.mqtt.base}/exec/cmd`;
        const args = [];

        if (cmd.exec) args.push(cmd.exec);

        if (cmd.shell) {
          const shellPath = config.shells[cmd.shell];
          if (shellPath) args.push(shellPath);
        }

        if (cmd.script) {
          args.push(writeScriptFile(cmd.script));
        }

        const message = JSON.stringify({
          cmd: args.join(' '),
          success_tts: cmd.success_tts,
          error_tts: cmd.error_tts,
        });
        mqtt.publish(topic, message);
      }
    }

    for(let cmd of cmds) {
      runCmd(cmd);
    }
  }

  function addSubscription({topic, handler}) {
    const sub = {
      topics: [ topic ],
      handler: handler,
    }
    subscriptions.push(sub);
  }

  function addCommand(cmd) {
    if (cmd.mqtt_topic) {
      addSubscription({
        topic: cmd.mqtt_topic,
        handler: cmdsHandler(cmd.cmds),
      })
    }
    
    // cmd.dialogs yandex dialogs private handler
    if (cmd.dialogs) {
      function addDialogCommand (cmds) {
        // TODO: impl
      }
      addDialogCommand(cmd.cmds);
    }
  }

  function loadYamlCommands() {
    const commands = parseCommandsFile(resolveAppFile('commands.yml'));

    commands.push(...getCustomCommands());

    // save runtime cache compiled yml
    if (config.cache_path) {
      fs.writeFileSync(config.cache_path, yaml.dump(commands));
    }

    return commands;
  }

  const commands = loadYamlCommands();
  for (let cmd of commands) {
    addCommand(cmd); // fill subscripttions array
  }

  // запомни команду
  if (config.custom_commands_path) {
    addSubscription({
      topic: config.base + '/add',
      handler: addCustomCommand,
    });
  }

  return { subscriptions };
}

module.exports.writeScriptFile = writeScriptFile;
module.exports.removeScriptFile = removeScriptFile;
module.exports.parseCommandsFile = parseCommandsFile;