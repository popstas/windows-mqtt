const mqtt = require('./mqtt');
const config = require('./config');

let modules;

start();

async function start() {
  // get enabled modules from config
  let modulesEnabled =  [];
  for (let name in config.modules) {
    const mod = config.modules[name];
    const isEnabled = mod.enabled !== undefined ? !!mod.enabled : true;
    if (isEnabled) modulesEnabled.push(name);
  }

  // init modules
  modules = [];
  for (let name of modulesEnabled) {
    const opts = config.modules[name] || {};
    const mod = require('./modules/' + name);
    console.log('load module: ' + name);
    const modInited = await mod(mqtt, opts)
    modules.push(modInited);
  };

  // subscribe all topics
  let topics = [];
  for (let mod of modules) {
    const modTopics = mod.subscriptions.map(sub => Array.isArray(sub.topics) ? sub.topics : [sub.topics]).flat();
    topics = [...topics, ...modTopics];
  }
  mqtt.subscribe(topics.flat());

  // on receive message
  mqtt.on('message', async (topic, message) => {
    const handler = getHandler(topic);
    if (!handler) {
      console.log(`Cannot find handler for topic ${topic}`);
      return;
    }

    handler(topic, message);
  });
}

function getHandler(topic) {
  let handler;
  for (let mod of modules) {
    const sub = mod.subscriptions.find(sub => sub.topics.includes(topic))
    if (sub) handler = sub.handler;
  }
  return handler;
}
