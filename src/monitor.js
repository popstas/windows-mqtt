// Periodic process health sampling: memory, CPU, event loop, handles.
// Appends JSONL to <settings-dir>/windows-mqtt/sysstats.jsonl and publishes
// to MQTT so leaks/busy-loops can be diagnosed from history.
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { settingsDir } = require('./paths');

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function startMonitor({ mqtt, log, config }) {
  const opts = config.monitor || {};
  if (opts.enabled === false) return { stop: () => {} };

  const intervalMs = (opts.interval || 60) * 1000;
  const filePath = opts.path || settingsDir('sysstats.jsonl');
  const topic = opts.topic || `${config.mqtt.base}/sysstats`;
  const mode = process.env.TAURI_BRIDGE === '1' ? 'bridge' : 'standalone';

  let lastCpu = process.cpuUsage();
  let lastElu = performance.eventLoopUtilization();
  let lastTime = Date.now();

  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch (e) {
    log(`monitor: cannot create stats dir: ${e.message}`, 'warn');
  }

  function sample() {
    const now = Date.now();
    const elapsedMs = now - lastTime;
    const cpu = process.cpuUsage();
    const elu = performance.eventLoopUtilization();
    const mem = process.memoryUsage();

    const cpuMs = (cpu.user - lastCpu.user + cpu.system - lastCpu.system) / 1000;
    const stats = {
      ts: new Date(now).toISOString(),
      pid: process.pid,
      mode,
      uptime_s: Math.round(process.uptime()),
      rss_mb: round1(mem.rss / 1048576),
      heap_used_mb: round1(mem.heapUsed / 1048576),
      heap_total_mb: round1(mem.heapTotal / 1048576),
      external_mb: round1(mem.external / 1048576),
      cpu_pct: elapsedMs > 500 ? round1((cpuMs / elapsedMs) * 100) : null,
      elu_pct: round1(performance.eventLoopUtilization(elu, lastElu).utilization * 100),
      handles: process._getActiveHandles().length,
      requests: process._getActiveRequests().length,
    };
    lastCpu = cpu;
    lastElu = elu;
    lastTime = now;

    writeStats(stats);
    if (mqtt) {
      try {
        mqtt.publish(topic, JSON.stringify(stats));
      } catch (e) {
        log(`monitor: publish failed: ${e.message}`, 'warn');
      }
    }
    log(`monitor: rss ${stats.rss_mb}mb, heap ${stats.heap_used_mb}mb, cpu ${stats.cpu_pct}%`, 'debug');
  }

  function writeStats(stats) {
    try {
      rotateIfNeeded();
      fs.appendFileSync(filePath, JSON.stringify(stats) + '\n');
    } catch (e) {
      log(`monitor: write failed: ${e.message}`, 'warn');
    }
  }

  function rotateIfNeeded() {
    try {
      const { size } = fs.statSync(filePath);
      if (size > MAX_FILE_BYTES) {
        fs.renameSync(filePath, filePath + '.1');
      }
    } catch {
      // File doesn't exist yet
    }
  }

  const intervalId = setInterval(sample, intervalMs);
  sample();
  log(`monitor: sampling every ${intervalMs / 1000}s to ${filePath}`);

  return {
    stop() {
      clearInterval(intervalId);
    },
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

module.exports = { startMonitor };
