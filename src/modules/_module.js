// module example

module.exports = async (mqtt, config, log) => {

  let modulePaused = false; // optional
  let intervalId = null;

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
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }
  function onStart() {
    modulePaused = false;
    if (intervalId === null) {
      intervalId = setInterval(publishMqtt, config.interval * 1000);
    }
  }

  await publishMqtt();
  intervalId = setInterval(publishMqtt, config.interval * 1000);

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
