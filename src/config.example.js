const os = require('os');

module.exports = {
  systray: true,
  mqtt: {
    host: 'host',
    port: 1883,
    user: 'user',
    password: 'password',
    base: 'home/room/pc',
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
    exec: {
      success_tts: 'Command success', // 'stdout' for answer with command output
      error_tts: 'Command error',
      long_time_sec: 5,
    },
    keys: {
      // base: 'home/room/pc/keys',
    },
    midi: {
      portName: 'WORLDE easy control',
      // portNum: 1,
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
      ]
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
    tts: {
      // enabled: false,
      ttsTopic: 'tts',
      playCommand: os.platform() == 'linux' ? 'mpg321 -q' : 'mpg123 -q',
      lang: 'ru',
      gapLinux: 200,
      gapNoLinux: 0,
    },
    windows: {
      enabled: false, // module windows-manager not published yet, sorry
      placeWindowOnOpen: true,
    },
  },
};
