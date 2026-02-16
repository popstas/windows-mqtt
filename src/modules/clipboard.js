module.exports = async (mqtt, config, log) => {

  const clipboard = await import('clipboardy');

  async function set(topic, message) {
    log(`< ${topic}: ${message}`);
    clipboard.default.writeSync(`${message}`);
  }

  return {
    subscriptions: [
      {
        topics: [ config.base + '/set' ],
        handler: set
      },
    ],
  }
}
