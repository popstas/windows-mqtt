const chokidar = require('chokidar');

module.exports = async (mqtt, config, log) => {
  log(`filewatch: ${config.files.length}`);
  for (const file of config.files) {
    log('filewatch: ' + file.path, 'debug');
    chokidar.watch(file.path)
      .on('change', (event, path) => {
        // console.log('event: ', event);
        mqtt.publish(config.base + '/' + file.mqtt_topic, file.mqtt_payload);
      })
      .on('error', (error) => {
        log(`filewatch error: ${error.message}`, 'error');
      });
  }

  return {};
}
