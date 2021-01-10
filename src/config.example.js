const os = require('os');

module.exports = {
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
    mouse: {
      // base: 'home/room/pc/mouse',
    },
    tts: {
      // enabled: false,
      ttsTopic: 'tts',
      playCommand: os.platform() == 'linux' ? 'mpg321 -q' : 'mpg123 -q',
      lang: 'ru',
      gapLinux: 200,
      gapNoLinux: 0,
    },
  },
};
