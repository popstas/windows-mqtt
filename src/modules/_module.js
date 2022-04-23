// module example

module.exports = async (mqtt, config) => {

  let modulePaused = false; // optional

  async function publishMqtt() {
    const topic = config.base + '/random';
    const value = `${Math.random() * 1000}`;
    mqtt.publish(topic, value);
  }

  async function onStatus(topic) {
    if (modulePaused) return;
    const status = 'ok';
    mqtt.publish(topic, status);
  }

  function onStop() {
    modulePaused = true;
  }
  function onStart() {
    modulePaused = false;
  }

  await publishMqtt();
  setInterval(publishMqtt, config.interval * 1000);

  return {
    subscriptions: [
      {
        topics: [
          config.base + '/status',
          config.base + '/status/get',
        ],
        handler: onStatus
      },
    ],
    onStop,
    onStart,
  }
}
