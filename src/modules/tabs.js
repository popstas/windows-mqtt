// module for receive tabs info from https://github.com/popstas/chrome-tabs-exporter
// Только именованным импортом. Под ESM `ws` резолвится в wrapper.mjs, где
// default — это КЛАСС WebSocket без статик: `WebSocket.Server` там undefined,
// и `new WebSocket.Server()` падал с TypeError с самого перехода на ESM
// (исключение глотал initModules(), модуль просто молча не работал).
// Оговорка про cjs-module-lexer из CLAUDE.md сюда не относится: wrapper.mjs —
// настоящий ESM с настоящими именованными экспортами.
import { WebSocketServer } from "ws";

export default async (mqtt, config, log) => {
  let lastData = {};
  if (!config.port) {
    log('tabs: need to define port in config');
    return {};
  }

  let wss = null;
  const clients = new Set(); // Track connected clients

  function createServer() {
    try {
      wss = new WebSocketServer({ port: config.port });

      wss.on("error", e => {
        log('Tabs error: ' + e);
        if (config.debug) log(e.stack);
      });

      wss.on("connection", ws => {
        clients.add(ws);
        
        ws.on("message", message => {
          // ws отдаёт RawData (Buffer | ArrayBuffer | Buffer[]), а не строку.
          const data = JSON.parse(String(message));
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

        ws.on("close", () => {
          clients.delete(ws);
        });

        ws.on("error", () => {
          clients.delete(ws);
        });
      });
    } catch(e) {
      console.log(`Failed to open WebSocket server for module 'tabs'`);
      console.log(e.message);
    }
  }

  createServer();

  function onStop() {
    // Close all client connections
    for (const ws of clients) {
      try {
        ws.close();
      } catch (e) {
        // Ignore errors
      }
    }
    clients.clear();
    
    // Close the server
    if (wss) {
      return new Promise((resolve) => {
        wss.close(() => {
          wss = null;
          resolve();
        });
      });
    }
  }

  function onStart() {
    if (!wss) {
      createServer();
    }
  }

  return {
    subscriptions: [],
    onStop,
    onStart,
  };
}
