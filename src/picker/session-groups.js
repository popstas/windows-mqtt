/** Pure shaping of the claude-wt session list for the picker. No I/O. */

const SEP = '\u0000';

// Sorting keys for the two "unknown" cases: an unknown desktop sorts before
// every real one, an unknown monitor after.
const DESKTOP_UNKNOWN = -1;
const MONITOR_UNKNOWN = Number.MAX_SAFE_INTEGER;

/**
 * Disambiguate rows that would read identically.
 *
 * Two slots can share both name and project — the same session reopened, or one
 * live and one stale. Nothing else on the row differs, so choosing between them
 * becomes a guess; a short id prefix is the cheapest thing that does not.
 */
function labelSessions(sessions) {
  const counts = new Map();
  for (const s of sessions) {
    const key = `${s.title}${SEP}${s.cwd}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return sessions.map(s => {
    const key = `${s.title}${SEP}${s.cwd}`;
    const label = counts.get(key) > 1 ? `${s.title} (${String(s.id).slice(0, 4)})` : s.title;
    return { ...s, label };
  });
}

function groupLabel(desktop, monitor) {
  const d = desktop === null ? 'Desktop —' : `Desktop ${desktop}`;
  const m = monitor === null ? 'Unknown monitor' : `Monitor ${monitor}`;
  return `${d} · ${m}`;
}

function groupSessions(sessions) {
  const groups = new Map();
  for (const s of sessions) {
    const desktop = s.desktop ?? null;
    const monitor = s.monitor ?? null;
    const key = `${desktop}${SEP}${monitor}`;
    if (!groups.has(key)) groups.set(key, { desktop, monitor, label: groupLabel(desktop, monitor), sessions: [] });
    groups.get(key).sessions.push(s);
  }

  const list = [...groups.values()];
  for (const g of list) {
    g.sessions.sort((a, b) =>
      (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0) ||
      (a.bounds?.y ?? 0) - (b.bounds?.y ?? 0));
  }
  list.sort((a, b) =>
    (a.desktop ?? DESKTOP_UNKNOWN) - (b.desktop ?? DESKTOP_UNKNOWN) ||
    (a.monitor ?? MONITOR_UNKNOWN) - (b.monitor ?? MONITOR_UNKNOWN));
  return list;
}

/**
 * Shape the result of the native claudeWtSessions() call into the
 * claude-wt-sessions event payload the picker UI consumes.
 *
 * Pure: takes the already-fetched `res`, does no I/O of its own.
 */
function buildSessionsPayload(res) {
  return res.ok
    ? { ok: true, groups: groupSessions(labelSessions(res.sessions)) }
    : { ok: false, reason: res.reason };
}

/**
 * Which way to go for the session the user just picked.
 *
 * The window could have been closed while the list sat on screen, so the handle
 * is checked at the moment of the action rather than kept fresh by polling.
 */
function chooseAction(session, isAlive) {
  if (session.open && session.windowId && isAlive(session.windowId)) return 'focus';
  return 'restore';
}

/**
 * Which virtual desktop (if any) to switch to after picking a session.
 *
 * `winMan.virtualDesktop.GetWindowDesktopNumber` and `GoToDesktopNumber` both
 * use 0-based desktop numbers (see http-server.js/ws-client.js in
 * windows11-manager, which subtract 1 from their 1-based input before
 * calling GoToDesktopNumber). `session.desktop` is stored 1-based
 * (claude-wt/index.js stores `Number(num) + 1`). The window's *live* desktop
 * — read fresh, right before this call — is authoritative: the stored value
 * can be stale if the window moved desktops since the last snapshot. So the
 * target is always the live desktop, converted back to the 0-based number
 * GoToDesktopNumber expects; that is a harmless no-op when the app is
 * already showing that desktop, so no comparison against the stored value is
 * needed.
 *
 * Returns the 0-based desktop number to pass to GoToDesktopNumber, or `null`
 * when the live desktop could not be determined (nothing to switch to).
 */
function resolveDesktopSwitch(session, liveDesktop) {
  if (liveDesktop === undefined || liveDesktop === null) return null;
  return Number(liveDesktop);
}

module.exports = {
  labelSessions,
  groupSessions,
  buildSessionsPayload,
  chooseAction,
  resolveDesktopSwitch,
};
