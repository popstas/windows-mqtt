const chokidar = require('chokidar');
const { isNetworkPath } = require('./filewatch-helpers');

module.exports = async (mqtt, config, log) => {
  const watchers = [];

  function createWatcher(file) {
    log('filewatch: ' + file.path, 'debug');
    // Сетевые шары не отдают события файловой системы: ReadDirectoryChangesW по
    // SMB не работает, и chokidar падает с EISDIR вместо того, чтобы следить за
    // файлом. Для таких путей остаётся опрос.
    const usePolling = file.usePolling ?? isNetworkPath(file.path);
    const options = usePolling
      ? { usePolling: true, interval: (file.pollInterval ?? 3) * 1000 }
      : {};
    if (usePolling) log(`filewatch: polling ${file.path}`, 'debug');
    return chokidar.watch(file.path, options)
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
