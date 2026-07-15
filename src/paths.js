const fs = require('fs');
const os = require('os');
const path = require('path');

// App root: the folder above src/. In a bundled Tauri install this is the
// flattened resource dir (`_up_`) — read-only app payload, NOT a place for
// user files. User config/commands live in the OS settings dir instead.
const appRoot = path.join(__dirname, '..');

// OS settings base dir: %APPDATA% on Windows, ~/Library/Application Support on
// macOS, $XDG_CONFIG_HOME (or ~/.config) on Linux.
function appDataDir() {
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
}

// Settings dir for user files: <appDataDir>/windows-mqtt[/<...segments>].
// Single source of truth for the per-user, writable app dir so the
// 'windows-mqtt' segment is never hand-built at call sites.
function settingsDir(...segments) {
  return path.join(appDataDir(), 'windows-mqtt', ...segments);
}

// Resolve a user file (config.yml, commands.yml, ...) by priority. Must stay in
// sync with resolve_config_path in src-tauri/src/main.rs. First existing wins;
// the legacy app-root path is returned as the fallback so error messages point
// somewhere sensible.
//   1. process.env[envVar] (if envVar given and the file exists) - override
//   2. <app_root>/data/<name>                        - local/dev
//   3. <settings-dir>/windows-mqtt/<name>            - per-user OS settings
//   4. <app_root>/<name>                             - legacy fallback
function resolveAppFile(name, envVar) {
  // Honor an explicit env override only when it points at a file that exists.
  // Rust passes CONFIG unconditionally, so a stale/missing path must not win
  // over the candidate list below (e.g. fresh install with no user config).
  if (envVar && process.env[envVar] && fs.existsSync(process.env[envVar])) {
    return process.env[envVar];
  }
  const candidates = [
    path.join(appRoot, 'data', name),
    settingsDir(name),
    path.join(appRoot, name),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1];
}

// Resolve a user-configured data file path (e.g. custom_commands_path) that is
// both read and written. Absolute paths are honored as-is. Relative paths are
// resolved by the same priority as resolveAppFile, but a NOT-yet-existing file
// defaults to the writable settings dir (never the read-only bundled app root).
function resolveUserDataFile(configPath) {
  if (!configPath) return configPath;
  if (path.isAbsolute(configPath)) return configPath;
  const name = path.basename(configPath);
  const candidates = [
    path.join(appRoot, 'data', name),
    settingsDir(name),
    path.join(appRoot, configPath),
    path.join(appRoot, name),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return settingsDir(name);
}

module.exports = { appRoot, appDataDir, settingsDir, resolveAppFile, resolveUserDataFile };
