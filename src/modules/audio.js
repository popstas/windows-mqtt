const loudness = require('loudness');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { appRoot } = require('../paths');

let mqtt;
let volumeSetTopic, volumeStatTopic, muteSetTopic, muteStatTopic;
let lastVolume, lastMute;

// Locate the native audio-watcher sidecar (built from ../audio-watcher). It
// reports the default playback/recording device on change via Core Audio, so we
// don't spawn PowerShell on an interval. Returns null when not built/bundled.
function resolveWatcherBin() {
  const candidates = [
    process.env.AUDIO_WATCHER_BIN,
    path.join(appRoot, 'bin', 'audio-watcher.exe'),
    path.join(appRoot, 'audio-watcher', 'target', 'release', 'audio-watcher.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function onVolumeSet(topic, message) {
  console.log(`< volume/set: ${message}`);
  const volume = parseInt(message);
  lastVolume = volume;
  await loudness.setVolume(volume);
  mqtt.publish(volumeStatTopic, `${volume}`);
}

async function onMuteSet(topic, message) {
  const mute = `${message}` === '1';
  await loudness.setMuted(mute);
  console.log(`< mute/set: ${message}`);
  mqtt.publish(muteStatTopic, `${mute}`);
}

module.exports = async (mqttClient, config, log) => {
  let intervalId = null;

  async function publishMqtt() {
    const volume = await loudness.getVolume();
    const mute = await loudness.getMuted() ? '1' : '0';

    if (!isNaN(volume) && volume !== lastVolume) {
      log(`> ${volumeStatTopic}: ${volume}`, lastVolume === undefined ? 'debug' : 'info');
      lastVolume = volume;
      mqtt.publish(volumeStatTopic, `${volume}`);
    }

    if (mute !== lastMute) {
      log(`> ${muteStatTopic}: ${mute}`, lastMute === undefined ? 'debug' : 'info');
      lastMute = mute;
      mqtt.publish(muteStatTopic, mute);
    }
  }

  mqtt = mqttClient;

  // onStart
  volumeSetTopic = config.base + config.volume.set;
  volumeStatTopic = config.base + config.volume.stat;
  muteSetTopic = config.base + config.mute.set;
  muteStatTopic = config.base + config.mute.stat;

  // --- Default audio device reporting (event-driven, via audio-watcher) ---
  const deviceCfg = (config.device && typeof config.device === 'object') ? config.device : {};
  const deviceDisabled = config.device === false || deviceCfg.enabled === false;
  const recordingStatTopic = config.base + (deviceCfg.stat || '/device');
  const playbackStatTopic = config.base + (deviceCfg.playbackStat || '/device/playback');
  const deviceAliases = deviceCfg.aliases || {};
  const watcherRestartMs = (deviceCfg.restartSec || 5) * 1000;

  let watcher = null;
  let watcherStopping = false;
  let watcherRestartTimer = null;
  let watcherStdoutBuf = '';
  let lastPlayback, lastRecording;

  function publishDevice(kind, rawName) {
    const name = deviceAliases[rawName] || rawName;
    if (kind === 'playback') {
      if (name === lastPlayback) return;
      log(`> ${playbackStatTopic}: ${name}`, lastPlayback === undefined ? 'debug' : 'info');
      lastPlayback = name;
      mqtt.publish(playbackStatTopic, name);
    } else {
      if (name === lastRecording) return;
      log(`> ${recordingStatTopic}: ${name}`, lastRecording === undefined ? 'debug' : 'info');
      lastRecording = name;
      mqtt.publish(recordingStatTopic, name);
    }
  }

  function onWatcherLine(line) {
    const idx = line.indexOf('\t');
    if (idx === -1) return;
    const kind = line.slice(0, idx);
    const name = line.slice(idx + 1).trim();
    if (name && (kind === 'playback' || kind === 'recording')) publishDevice(kind, name);
  }

  function startWatcher() {
    if (deviceDisabled || watcher) return;
    const bin = resolveWatcherBin();
    if (!bin) {
      log('audio-watcher binary not found, device reporting disabled (run `npm run build-audio-watcher`)', 'warn');
      return;
    }
    watcherStopping = false;
    watcherStdoutBuf = '';
    watcher = spawn(bin, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });

    watcher.stdout.setEncoding('utf8');
    watcher.stdout.on('data', (chunk) => {
      watcherStdoutBuf += chunk;
      let nl;
      while ((nl = watcherStdoutBuf.indexOf('\n')) !== -1) {
        const line = watcherStdoutBuf.slice(0, nl).replace(/\r$/, '');
        watcherStdoutBuf = watcherStdoutBuf.slice(nl + 1);
        if (line) onWatcherLine(line);
      }
    });

    watcher.stderr.setEncoding('utf8');
    watcher.stderr.on('data', (data) => {
      const text = `${data}`.trim();
      if (text) log(`audio-watcher: ${text}`, 'error');
    });

    watcher.on('error', (err) => {
      log(`audio-watcher spawn error: ${err.message}`, 'error');
    });

    watcher.on('exit', (code) => {
      watcher = null;
      // Force a re-publish of the current devices once a fresh watcher starts.
      lastPlayback = undefined;
      lastRecording = undefined;
      if (watcherStopping) return;
      log(`audio-watcher exited (code ${code}), restarting in ${watcherRestartMs}ms`, 'warn');
      watcherRestartTimer = setTimeout(startWatcher, watcherRestartMs);
    });
  }

  function stopWatcher() {
    watcherStopping = true;
    if (watcherRestartTimer) {
      clearTimeout(watcherRestartTimer);
      watcherRestartTimer = null;
    }
    if (!watcher) return;
    const child = watcher;
    watcher = null;
    // Closing stdin makes the sidecar exit cleanly; hard-kill as a fallback.
    try { child.stdin.end(); } catch (e) { /* ignore */ }
    setTimeout(() => { try { child.kill(); } catch (e) { /* ignore */ } }, 500);
  }

  function onStop() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    stopWatcher();
  }

  function onStart() {
    if (intervalId === null) {
      intervalId = setInterval(publishMqtt, config.interval * 1000);
    }
    startWatcher();
  }

  await publishMqtt();
  intervalId = setInterval(publishMqtt, config.interval * 1000);
  startWatcher();

  return {
    subscriptions: [
      {
        topics: [volumeSetTopic],
        handler: onVolumeSet
      },
      {
        topics: [muteSetTopic],
        handler: onMuteSet
      },
    ],
    onStop,
    onStart,
  }
}
