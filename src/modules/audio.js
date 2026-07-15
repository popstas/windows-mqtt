// `loudness` is used on the write path (volume/mute set via MQTT command) and
// as a fallback read path (polling) when the native audio-watcher sidecar is
// missing. When the watcher is available, reads are event-driven through it,
// because loudness has no Windows event API and shells out an .exe on every
// getVolume/getMuted call — a per-tick process spawn we avoid when we can.
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

// --- Pure, testable helpers (no spawning / no closures over module state) ---

// Whether the default-device topics should be silenced. This gates ONLY
// device-topic publishing — volume/mute reporting must keep flowing regardless.
function isDeviceDisabled(config) {
  if (!config) return false;
  const deviceCfg = (config.device && typeof config.device === 'object') ? config.device : {};
  return config.device === false || deviceCfg.enabled === false;
}

// Parse a single `kind\tvalue` line from the audio-watcher. Returns
// { kind, value } or null when the line is malformed / has an empty value.
function parseWatcherLine(line) {
  const idx = line.indexOf('\t');
  if (idx === -1) return null;
  const kind = line.slice(0, idx);
  const value = line.slice(idx + 1).trim();
  if (!value) return null;
  return { kind, value };
}

// Fallback loudness polling period in ms (config.interval seconds, default 5).
function fallbackIntervalMs(config) {
  const seconds = (config && config.interval) || 5;
  return seconds * 1000;
}

// Guard for the watcher restart timer: never schedule while stopping, and never
// double-schedule when a timer is already pending (both 'error' and 'exit' can
// fire for one failed spawn).
function shouldScheduleRestart({ stopping, timerActive }) {
  return !stopping && !timerActive;
}

async function onVolumeSet(topic, message) {
  console.log(`< volume/set: ${message}`);
  const volume = parseInt(message);
  if (Number.isNaN(volume)) return; // ignore non-numeric payloads (would set/publish NaN)
  const value = `${volume}`;
  lastVolume = value;
  await loudness.setVolume(volume);
  mqtt.publish(volumeStatTopic, value);
}

async function onMuteSet(topic, message) {
  const mute = `${message}` === '1';
  const value = mute ? '1' : '0';
  lastMute = value;
  await loudness.setMuted(mute);
  console.log(`< mute/set: ${message}`);
  mqtt.publish(muteStatTopic, value);
}

module.exports = async (mqttClient, config, log) => {
  mqtt = mqttClient;

  // onStart
  volumeSetTopic = config.base + config.volume.set;
  volumeStatTopic = config.base + config.volume.stat;
  muteSetTopic = config.base + config.mute.set;
  muteStatTopic = config.base + config.mute.stat;

  // --- Default audio device reporting (event-driven, via audio-watcher) ---
  const deviceCfg = (config.device && typeof config.device === 'object') ? config.device : {};
  // Gates ONLY device-topic publishing; the watcher still runs so volume/mute
  // keep flowing even when device reporting is turned off.
  const deviceDisabled = isDeviceDisabled(config);
  const recordingStatTopic = config.base + (deviceCfg.stat || '/device');
  const playbackStatTopic = config.base + (deviceCfg.playbackStat || '/device/playback');
  const deviceAliases = deviceCfg.aliases || {};
  const watcherRestartMs = (deviceCfg.restartSec || 5) * 1000;

  let watcher = null;
  let watcherStopping = false;
  let watcherRestartTimer = null;
  let watcherStdoutBuf = '';
  let lastPlayback, lastRecording;
  let fallbackTimer = null;

  function publishDevice(kind, rawName) {
    if (deviceDisabled) return;
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

  function publishVolumeMute(kind, value) {
    if (kind === 'volume') {
      if (value === lastVolume) return;
      log(`> ${volumeStatTopic}: ${value}`, lastVolume === undefined ? 'debug' : 'info');
      lastVolume = value;
      mqtt.publish(volumeStatTopic, value);
    } else {
      if (value === lastMute) return;
      log(`> ${muteStatTopic}: ${value}`, lastMute === undefined ? 'debug' : 'info');
      lastMute = value;
      mqtt.publish(muteStatTopic, value);
    }
  }

  function onWatcherLine(line) {
    const parsed = parseWatcherLine(line);
    if (!parsed) return;
    const { kind, value } = parsed;
    if (kind === 'playback' || kind === 'recording') publishDevice(kind, value);
    else if (kind === 'volume' || kind === 'mute') publishVolumeMute(kind, value);
  }

  // --- loudness fallback polling (used only when the watcher binary is absent) ---
  function startFallbackPolling() {
    if (fallbackTimer) return;
    const intervalMs = fallbackIntervalMs(config);
    const poll = async () => {
      try {
        const vol = await loudness.getVolume();
        publishVolumeMute('volume', `${Math.round(vol)}`);
      } catch (e) {
        log(`audio fallback volume poll error: ${e.message}`, 'error');
      }
      try {
        const muted = await loudness.getMuted();
        publishVolumeMute('mute', muted ? '1' : '0');
      } catch (e) {
        log(`audio fallback mute poll error: ${e.message}`, 'error');
      }
    };
    poll();
    fallbackTimer = setInterval(poll, intervalMs);
    if (fallbackTimer.unref) fallbackTimer.unref();
  }

  function stopFallbackPolling() {
    if (!fallbackTimer) return;
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }

  function scheduleRestart(reason) {
    watcher = null;
    // Force a re-publish of the current state once a fresh watcher starts.
    lastPlayback = undefined;
    lastRecording = undefined;
    lastVolume = undefined;
    lastMute = undefined;
    if (!shouldScheduleRestart({ stopping: watcherStopping, timerActive: watcherRestartTimer !== null })) return;
    // A present-but-failing binary would otherwise loop forever with no
    // volume/mute reporting. Poll via loudness during the retry window; a fresh
    // watcher that spawns successfully stops this again (startWatcher).
    startFallbackPolling();
    log(`audio-watcher ${reason}, restarting in ${watcherRestartMs}ms`, 'warn');
    watcherRestartTimer = setTimeout(() => {
      watcherRestartTimer = null;
      startWatcher();
    }, watcherRestartMs);
    if (watcherRestartTimer.unref) watcherRestartTimer.unref();
  }

  function startWatcher() {
    if (watcher) return;
    const bin = resolveWatcherBin();
    if (!bin) {
      log('audio-watcher binary not found — volume/mute reporting falls back to loudness polling and device reporting is unavailable (run `npm run build-audio-watcher` for event-driven reporting)', 'warn');
      startFallbackPolling();
      return;
    }
    // A real watcher supersedes the polling fallback.
    stopFallbackPolling();
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
      scheduleRestart('spawn error');
    });

    watcher.on('exit', (code) => {
      scheduleRestart(`exited (code ${code})`);
    });
  }

  function stopWatcher() {
    watcherStopping = true;
    if (watcherRestartTimer) {
      clearTimeout(watcherRestartTimer);
      watcherRestartTimer = null;
    }
    stopFallbackPolling();
    if (!watcher) return;
    const child = watcher;
    watcher = null;
    // Closing stdin makes the sidecar exit cleanly; hard-kill as a fallback.
    try { child.stdin.end(); } catch (e) { /* ignore */ }
    setTimeout(() => { try { child.kill(); } catch (e) { /* ignore */ } }, 500);
  }

  function onStop() {
    stopWatcher();
  }

  function onStart() {
    startWatcher();
  }

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

module.exports.isDeviceDisabled = isDeviceDisabled;
module.exports.parseWatcherLine = parseWatcherLine;
module.exports.fallbackIntervalMs = fallbackIntervalMs;
module.exports.shouldScheduleRestart = shouldScheduleRestart;
module.exports.resolveWatcherBin = resolveWatcherBin;
