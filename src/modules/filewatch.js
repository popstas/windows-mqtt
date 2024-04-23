const chokidar = require('chokidar');

module.exports = async (mqtt, config, log) => {
  for (const file of config.files) {
    log('filewatch: watching ' + file.path);
    chokidar.watch(file.path).on('change', (event, path) => {
      // console.log('event: ', event);
      mqtt.publish(config.base + '/' + file.mqtt_topic, file.mqtt_payload);
    });
  }

  return {};
}
