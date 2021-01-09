# Windows MQTT - control Windows PC with MQTT

## Install
1. Copy [src/config.example.js](src/config.example.js) to `src/config.js`

2. This script will install Windows service "windows-mqtt":
``` sh
git clone https://github.com/popstas/windows-mqtt
cd windows-mqtt
npm install
npm run install-windows
```

3. For TTS setup you should install `gTTS` (Python) and `mpg123`, see [popstas/mqtt2tts](https://github.com/popstas/mqtt2tts#requirements).

## Extend
1. Copy [src/modules/_module.js](src/modules/_module.js) to `src/modules/yourModuleName.js`
2. Add module options to `modules.yourModuleName` object in `src/config.js`

Module will receive  as `config` variable.

Module should return list of subscriptions on MQTT topics:
``` js
return {
  subscriptions: [
    {
      topics: [
        config.base + '/status',
        config.base + '/status/get',
      ],
      handler: onStatus
    },
  ]
}
```
