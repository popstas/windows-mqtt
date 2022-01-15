// module for receive tabs info from https://github.com/popstas/chrome-tabs-exporter
const WebSocket = require("ws");

module.exports = async (mqtt, config, log) => {
  if (!config.port) {
    log('tabs: need to define port in config');
    return;
  }

  const wss = new WebSocket.Server({ port: config.port });
  wss.on("connection", ws => {
    ws.on("message", message => {
      const data = JSON.parse(message);
      if (data.type === 'stat') {
        // console.log('tabs data: ', data);

        // tabs
        if (data.tabs) mqtt.publish(`${config.base}/total`, `${data.tabs}`);

        // domains
        if (data.byDomain) {
          for (let domain in data.byDomain) {
            const count = data.byDomain[domain];
            mqtt.publish(`${config.base}/domains/${domain}`, `${count}`);
          }
        }
      }
    });
  });

  return {
    subscriptions: [],
  };
}
