// module for receive tabs info from https://github.com/popstas/chrome-tabs-exporter
const WebSocket = require("ws");

module.exports = async (mqtt, config, log) => {
  let lastData = {};
  if (!config.port) {
    log('tabs: need to define port in config');
    return;
  }

  let wss;
  try {
    wss = new WebSocket.Server({ port: config.port });
  } catch(e) {
    console.log(`Failed to open WebSocket server for module 'tabs'`);
    console.log(e.message);
  }

  wss.on("connection", ws => {
    ws.on("message", message => {
      const data = JSON.parse(message);
      if (data.type === 'stat') {
        // console.log('tabs data: ', data);

        let total = 0;

        // for correct graphs need to send 0 at latest count
        if (lastData?.byDomain) {
          for (let domain in lastData.byDomain) {
            if (lastData.byDomain[domain] == 0) continue;
            if (!data.byDomain[domain]) data.byDomain[domain] = 0;
          }
        }
        lastData = data;

        // domains
        if (data.byDomain) {
          for (let domain in data.byDomain) {
            if (config.excludedDomains.includes(domain)) continue;
            const count = data.byDomain[domain];
            total += count;
            mqtt.publish(`${config.base}/domains/${domain}`, `${count}`);
          }
        }

        mqtt.publish(`${config.base}/total`, `${total}`);
      }
    });
  });

  return {
    subscriptions: [],
  };
}
