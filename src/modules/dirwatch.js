const chokidar = require('chokidar');
const path = require('node:path');

const addChangeGap = 1000; // avoid publish change file just after add

module.exports = async (mqtt, config, log) => {
  log(`dirwatch: ${config.dirs.length}`);
  for (const dir of config.dirs) {
    log('dirwatch: ' + dir.path, 'debug');
    const watchOpts = {
      ignoreInitial: true,
      depth: dir.depth || 1,
      ignored: '*.part',
      // ignored: /[\\\/]/,
    }
    let lastFilePath = '';
    let lastEvent = '';
    let lastTime = 0;
    chokidar.watch(dir.path, watchOpts).on('all', (event, filePath) => {
      console.log(`${event}: ${filePath}`);
      const fileDir = path.dirname(filePath);
      const mqtt_base = `${config.base}/last`;
      // if (event === 'addDir') return; // ignore new directories
      if (event === 'unlinkDir') return; // ignore deletes
      if (event === 'unlink') {
        mqtt.publish(`${mqtt_base}/event`, event);
        mqtt.publish(`${mqtt_base}/file/path`, fileDir);
        mqtt.publish(`${mqtt_base}/file/name`, '-');
        mqtt.publish(`${mqtt_base}/dir/path`, fileDir);
        mqtt.publish(`${mqtt_base}/dir/name`, dir.name);
        return; // ignore deletes
      }
      const isJustCreated = lastEvent === 'add' && lastFilePath === filePath;

      const isLastEventSoon = Date.now() - lastTime < addChangeGap;
      lastTime = Date.now(); // update lastTime even when no event change

      if (isLastEventSoon) return; // avoid publish frequently events

      // const isUpdateLastEvent = isJustCreated && isLastEventSoon ? false : true;
      // if (isUpdateLastEvent) {

      lastFilePath = filePath;
      lastEvent = event;

      // if (isJustCreated) return; // ignore change just after add

      mqtt.publish(`${mqtt_base}/event`, event);
      mqtt.publish(`${mqtt_base}/file/path`, filePath);
      mqtt.publish(`${mqtt_base}/file/name`, path.basename(filePath));
      mqtt.publish(`${mqtt_base}/dir/path`, fileDir);
      mqtt.publish(`${mqtt_base}/dir/name`, dir.name);
      // mqtt.publish(config.base + '/' + dir.mqtt_topic, dir.mqtt_payload);
    })
    .on('error', (error) => {
      log(`dirwatch error: ${error.message}`, 'error');
    });
  }

  return {};
}
