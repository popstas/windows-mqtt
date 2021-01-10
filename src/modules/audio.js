const loudness = require('loudness');

let mqtt;
let volumeSetTopic, volumeStatTopic, muteSetTopic, muteStatTopic;
let lastVolume, lastMute;

async function publishMqtt() {
  const volume = await loudness.getVolume();
  const mute = await loudness.getMuted() ? '1' : '0';
  if (volume != lastVolume) {
    lastVolume = volume;
    console.log(`> ${volumeStatTopic}: ${volume}`);
    mqtt.publish(volumeStatTopic, `${volume}`);
  }

  if (mute !== lastMute) {
    lastMute = mute;
    console.log(`> ${muteStatTopic}: ${mute}`);
    mqtt.publish(muteStatTopic, mute);
  }
}

async function onVolumeSet(topic, message) {
  console.log(`< volume/set: ${message}`);
  const volume = parseInt(message);
  lastVolume = volume;
  await loudness.setVolume(volume);
  mqtt.publish(volumeStatTopic, `${volume}`);
}

async function onMuteSet(topic, message) {
  const mute = `${message}` == '1';
  await loudness.setMuted(mute);
  console.log(`< mute/set: ${message}`);
  mqtt.publish(muteStatTopic, `${mute}`);
}

module.exports = async (mqttClient, config) => {
  mqtt = mqttClient;

  // onStart
  volumeSetTopic = config.base + config.volume.set;
  volumeStatTopic = config.base + config.volume.stat;
  muteSetTopic = config.base + config.mute.set;
  muteStatTopic = config.base + config.mute.stat;

  await publishMqtt();
  setInterval(publishMqtt, config.interval * 1000);

  return {
    subscriptions: [
      {
        topics: [volumeSetTopic],
        handler: onVolumeSet
      },
      {
        topics: [muteSetTopic],
        handler: onMuteSet
      },
    ]
  }
}