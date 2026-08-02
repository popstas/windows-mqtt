/** Resolve a claudeProjects entry from an IPC/MQTT payload. No I/O. */

/**
 * @param {Array<{ name?: string, cwd?: string, hotkey?: string, profile?: string }>|null|undefined} projects
 * @param {{ name?: string, cwd?: string }|null|undefined} payload
 * @returns {{ name: string, cwd: string, hotkey?: string, profile?: string }|null}
 */
function resolveClaudeProject(projects, payload) {
  const list = Array.isArray(projects) ? projects : [];
  const name = typeof payload?.name === 'string' ? payload.name : '';
  const cwd = typeof payload?.cwd === 'string' ? payload.cwd : '';

  if (name) {
    const hit = list.find(p => p && p.name === name);
    if (hit && typeof hit.cwd === 'string' && hit.cwd) {
      return projectFields(hit);
    }
  }

  if (cwd) {
    const hit = list.find(p => p && p.cwd === cwd);
    if (hit && typeof hit.name === 'string' && hit.name) {
      return projectFields(hit);
    }
    if (name) return { name, cwd };
  }

  return null;
}

function projectFields(hit) {
  const out = { name: hit.name, cwd: hit.cwd, hotkey: hit.hotkey };
  if (typeof hit.profile === 'string' && hit.profile) out.profile = hit.profile;
  return out;
}

/**
 * Compact hotkey for the picker: `Ctrl+F12` → `^F12`.
 * Unknown shapes are returned trimmed unchanged.
 */
function formatHotkeyCaret(hotkey) {
  if (typeof hotkey !== 'string') return '';
  const s = hotkey.trim();
  if (!s) return '';
  return s.replace(/^(Ctrl|Control)\+/i, '^');
}

/**
 * Attach a caret-form `hotkey` field to sessions whose cwd matches a project.
 */
function attachProjectHotkeys(sessions, projects) {
  const list = Array.isArray(projects) ? projects : [];
  const byCwd = new Map();
  for (const p of list) {
    if (p && typeof p.cwd === 'string' && p.cwd && typeof p.hotkey === 'string' && p.hotkey.trim()) {
      byCwd.set(p.cwd, formatHotkeyCaret(p.hotkey));
    }
  }
  if (!byCwd.size) return sessions ?? [];
  return (sessions ?? []).map(s => {
    const hotkey = byCwd.get(s?.cwd);
    return hotkey ? { ...s, hotkey } : s;
  });
}

module.exports = { resolveClaudeProject, formatHotkeyCaret, attachProjectHotkeys };
