const os = require('os');

module.exports = {
  systray: true,
  dirwatch: {
    dirs: [
      {
        path: 'D:/video/*.mp4',
        name: 'OBS',
      },
      {
        path: 'D:/rec/*.mp3',
        name: 'Songs',
      },
      {
        path: 'D:/audiobooks',
        name: 'Books',
      },
    ],
  },
  log: {
    path: 'data/windows-mqtt.log',
  },
  mqtt: {
    host: 'host',
    port: 1883,
    user: 'user',
    password: 'password',
    base: 'home/room/pc',
    //self_kill_cmd: 'D:/prog/SysinternalsSuite/pskill.exe node-windows-mqtt.exe',
  },
  modules: {
    audio: {
      interval: 5,
      // base: 'home/room/pc/audio',
      volume: {
        set: '/volume/set',
        stat: '/volume',
      },
      mute: {
        set: '/mute/set',
        stat: '/mute',
      },
    },
    clipboard: {},
    commands: {
      shells: {
        bash: '"c:/Program Files/Git/bin/bash.exe"',
      },
      custom_commands_path: 'data/commands_custom.yml',
      cache_path: 'h:/projects/js/yandex-dialogs-private/data/windows-mqtt-commands-pc.yml',
    },
    exec: {
      success_tts: 'Command success', // 'stdout' for answer with command output
      error_tts: 'Command error',
      long_time_sec: 5,
    },
    filewatch: {
      files: [
        {
          path: 'H:/projects/smarthome/home-assistant/config/conf/openhasp.yaml',
          mqtt_topic: 'openhasp',
          mqtt_payload: 'openhasp.yaml',
        }
      ],
    },
    gpt: {
      openai_api_key: '',
      completion_params: {
        temperature: 1,
      },
      timeoutMs: 30000,
      systemMessage: 'You are helpful bot. Think step by step',
      debug: false,
    },
    keys: {
      // base: 'home/room/pc/keys',
    },
    midi: {
      devices: [
        {
          portName: 'WORLDE easy control',
          // portNum: 1,
          hotReload: true,
          // ignoreLines: [248, 254],
          hotkeys: [
            // send keys
            {
              midi: [176, 2, 127],
              keys: 'alt+control+shift j',
            },
            // send mqtt
            {
              midi: [176, 67, 127],
              mqtt: ['home/room/pc/windows/autoplace', '1'],
            },
            // range controller
            {
              midi: [176,9],
              type: 'range',
              mqtt: ['home/hall/station/volume', '{{payload}}'],
              // min: 0,
              // max: 127,
              // to_min: 0,
              // to_max: 10,
            },
          ]
        },
      ],
    },
    mouse: {
      // base: 'home/room/pc/mouse',
    },
    notify: {
      title: 'MQTT',
      appIcons: {
        'Messages': 'sms.png', // place to assets/icons/sms.png
      },
      appSounds: {
        'Messages': false, // https://docs.microsoft.com/en-us/uwp/schemas/tiles/toastschema/element-audio?redirectedfrom=MSDN
      },
      clearNotificationWebhook: 'https://trigger.macrodroid.com/123123123/notification-clear',
      markAsReadText: 'Mark as readed',
    },
    // https://github.com/popstas/chrome-tabs-exporter
    tabs: {
      port: 5555,
      excludedDomains: [
        'web.whatsapp.com',
      ],
    },
    tts: {
      // enabled: false,
      ttsTopic: 'tts',
      playCommand: os.platform() === 'linux' ? 'mpg321 -q' : 'mpg123 -q',
      lang: 'ru',
      gapLinux: 200,
      gapNoLinux: 0,
    },
    windows: {
      enabled: false,
      placeWindowOnOpen: true, // on each window open
      placeWindowOnStart: true, // when windows-mqtt starts
      notifyPlaced: true,
      restoreOnStart: true,
      publishStats: true,
      store: {
        default: {
          apps: [
            "C:\\Program Files\\Microsoft VS Code\\Code.exe",
            "C:\\Program Files\\Mozilla Thunderbird\\thunderbird.exe",
          ],
          paths: [ "C:\\" ],
        },
        custom: { // restore always
          apps: [
            "C:\\Users\\popstas\\AppData\\Local\\Yandex\\YandexBrowser\\Application\\browser_proxy.exe --profile-directory=Default --app-id=hnpfjngllnobngcgfapefoaidbinmjnm"
          ],
          paths: [],
        }
      },
    },
  },
};
