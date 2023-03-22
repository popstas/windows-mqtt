module.exports = async (mqtt, config, log) => {


  async function set(topic, message) {
    log(`< ${topic}: ${message}`);
    const clipboard = await import('clipboardy');
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
