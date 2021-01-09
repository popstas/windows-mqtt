module.exports = async (mqtt, config) => {

  async function publishMqtt() {
    const topic = config.base + '/random';
    const value = `${Math.random() * 1000}`;
    mqtt.publish(topic, value);
  }

  async function onStatus(topic, message) {
    const status = 'ok';
    mqtt.publish(topic, status);
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
    ]
  }
}