# Control PC with MQTT

Tested on Windows 10, Windows 11 and Ubuntu Desktop 20.04

## Features (modules)
### audio
- `home/room/pc/audio/volume/set` - set volume, `0-100`
- `home/room/pc/audio/mute/set` - set mute, `0 or 1`

Publish to:

- `home/room/pc/audio/volume`
- `home/room/pc/audio/mute`

### clipboard
- `home/room/pc/clipboard/set` - copy text to system clipboard

### commands
Read file commands.yml (see commands.example.yml), subscribe to topics, execute commands via exec module.

### dirwatch
Watch for changes in directories and send notifications.

### exec
- `home/room/pc/exec/cmd 'shell cmd'` - simple execute command with arguments in system shell
- `home/room/pc/exec/cmd/silent 'shell cmd'` - execute command without notifications
- `home/room/pc/exec/cmd '{"cmd" "shell cmd", "silent": true}'` - execute command without notifications
- `home/room/pc/exec/cmd '{"cmd": "shell cmd", "success_tts": "Success", "error_tts": "Error"}` - execute command with tts feedback. You can define default tts feedback in config. Set `success_tts: 'stdout'` for answer with command output
- `home/room/pc/exec/ssh user@host` - open ssh terminal

### filewatch
Watch for changes in files and send notifications.

### gpt
- `home/room/pc/gpt/ask` - send request to GPT

Publish to:

- `home/room/pc/gpt/answer` - get answer

### keys
- `home/room/pc/keys/press` - press a single key, you can pass several keys, space delimeted
- `home/room/pc/keys/type` - type a string

Keys:

- `f1-f12`
- `enter, escape, tab, space, backspace`
- `up, down, left, right`
- `home, end, insert, delete, pageup, pagedown`
- `control, shift, alt, command`
- `audio_prev, audio_next, audio_pause`

[Full keys list](https://robotjs.io/docs/syntax#keys)

Modifiers `control|ctrl|^, shift, alt, command|cmd|win` can be used: `(ctrl+alt+win)t`

Examples:

- `(win)x up up right down` - suspend for Windows 10

### midi
Binds midi signals to exec or mqtt actions.

### mouse
- `home/room/pc/mouse/click` - click button, `left|right|middle`
- `home/room/pc/mouse/point` - move button to `x`, `y`, optional click and mouse backs, example: `400,200,left,1`

### notify
- `home/room/pc/notify/notify 'message'` - simple notify
- `home/room/pc/notify/notify '{"title": "title", "msg": "msg", "app": "Planfix", "icon": "/path/to/planfix.png", "actions": ["OK"]}'` - full notify
- `home/room/pc/notify/clear 'msg text'` - clear notify on Android (for MacroDroid), you must define `config.modules.notify.clearNotificationWebhook` for this

### obs
Commands:
- `home/room/pc/obs/rec` - start recording
- `home/room/pc/obs/stop` - stop recording

Events:
- `home/room/pc/obs/state/rec` - change recording state

### reaper
- `home/room/pc/reaper/record` - start recording
- `home/room/pc/reaper/stop` - stop recording
- `home/room/pc/reaper/play` - start playing
- `home/room/pc/reaper/stop` - stop playing
- `home/room/pc/reaper/prev` - go to previous track
- `home/room/pc/reaper/next` - go to next track
- `home/room/pc/reaper/loop` - toggle loop

### tabs
Send browser tabs stats to MQTT. Requires browser extension [chrome-tabs-exporter](https://github.com/popstas/chrome-tabs-exporter).

### tts
- `tts` - TTS received message

### windows
- `home/room/pc/windows/autoplace` - autoplace windows with config
- `home/room/pc/windows/place '{"window":"current","fancyZones":{"monitor":1,"position":6}}'` - place window with rules
- `home/room/pc/windows/store` - store opened windows
- `home/room/pc/windows/restore` - restore windows
- `home/room/pc/windows/clear` - clear store
- `home/room/pc/windows/open '{ "apps": ["c:\\app1.exe"], "paths": ["d:\\prog"] }'` - open store
- `home/room/pc/windows/focus '{ "titleMatch": "blog.popstas.ru" }'` - focus window by title
- `home/room/pc/windows/restart` - restart PC, `nostore` for just restart, other payload for store opened windows

It's using module, https://github.com/popstas/windows11-manager, Vitrual desktop manager work only for Windows 11 now, as I am single user.

## Bugs
- Keyboard and mouse emulation not work while `windows-mqtt` running as Windows service.
- Process not kill when exit

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
