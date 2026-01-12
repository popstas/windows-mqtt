const chokidar = require('chokidar');

module.exports = async (mqtt, config, log) => {
  const watchers = [];

  function createWatcher(file) {
    log('filewatch: ' + file.path, 'debug');
    return chokidar.watch(file.path)
      .on('change', (event, path) => {
        // console.log('event: ', event);
        mqtt.publish(config.base + '/' + file.mqtt_topic, file.mqtt_payload);
      })
      .on('error', (error) => {
        log(`filewatch error: ${error.message}`, 'error');
      });
  }

  log(`filewatch: ${config.files.length}`);
  for (const file of config.files) {
    const watcher = createWatcher(file);
    watchers.push(watcher);
  }

  function onStop() {
    for (const watcher of watchers) {
      watcher.close().catch(err => {
        log(`filewatch close error: ${err.message}`, 'error');
      });
    }
    watchers.length = 0;
  }

  function onStart() {
    if (watchers.length === 0) {
      for (const file of config.files) {
        const watcher = createWatcher(file);
        watchers.push(watcher);
      }
    }
  }

  return {
    onStop,
    onStart,
  };
}
