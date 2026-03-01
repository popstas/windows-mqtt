const { EventEmitter } = require('events');
const readline = require('readline');

class MqttBridge extends EventEmitter {
  constructor() {
    super();
    this._setupStdin();
  }

  _setupStdin() {
    const rl = readline.createInterface({ input: process.stdin });

    rl.on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'message':
          this.emit('message', msg.topic, Buffer.from(msg.payload || ''));
          break;
        case 'connected':
          this.emit('connect');
          break;
        case 'disconnected':
          this.emit('offline');
          break;
        case 'action':
          this.emit('action', msg.action);
          break;
      }
    });

    rl.on('close', () => {
      this.emit('close');
    });
  }

  subscribe(topics) {
    const arr = Array.isArray(topics) ? topics : [topics];
    this._send({ type: 'subscribe', topics: arr });
  }

  unsubscribe(topics) {
    const arr = Array.isArray(topics) ? topics : [topics];
    this._send({ type: 'unsubscribe', topics: arr });
  }

  publish(topic, payload, options) {
    const msg = {
      type: 'publish',
      topic,
      payload: payload instanceof Buffer ? payload.toString() : String(payload),
    };
    if (options) {
      msg.options = {
        retain: !!options.retain,
        qos: options.qos || 0,
      };
    }
    this._send(msg);
  }

  end() {
    // No-op: Rust owns the MQTT connection
  }

  removeListener(event, fn) {
    return super.removeListener(event, fn);
  }

  _send(obj) {
    process.stdout.write(JSON.stringify(obj) + '\n');
  }
}

function mqttInit() {
  return new MqttBridge();
}

module.exports = { mqttInit };
