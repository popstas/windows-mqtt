module.exports = async (mqtt, config, log) => {
  const host = config.host || 'localhost';
  const port = config.port || 8080;
  const origin = `http://${host}:${port}`

  const cmdMap = {
    rec: 1013,
    pause: 1008,
    play: 1007,
    stop: 40667,
    prev: 40172,
    next: 40173,
    loop: 1068,
  };

  async function command(cmd) {

    const cmdCode = cmdMap[cmd];
    if (!cmdCode) {
      log(`reaper: Unknown command: ${cmd}`);
      return;
    }
    try {
      await fetch(`${origin}/_/${cmdCode};TRANSPORT;`);
    } catch (error) {
      log(`reaper: Failed to send command: ${cmd} (${cmdCode})`, error);
    }
  }

  function commandHandler(cmd) {
    return async () => command(cmd);
  }

  const subscriptions = Object.entries(cmdMap).map(([command, cmdCode]) => ({
    topics: [config.base + '/' + command],
    handler: commandHandler(command),
  }));

  return {subscriptions};
}
