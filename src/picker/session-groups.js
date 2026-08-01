/** Pure shaping of the claude-wt session list for the picker. No I/O. */

const SEP = '\u0000';

// Сессия с неизвестным столом сортируется перед всеми настоящими.
const DESKTOP_UNKNOWN = -1;

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

function desktopLabel(desktop) {
  return desktop === null ? 'Desktop —' : `Desktop ${desktop}`;
}

function byPosition(a, b) {
  return (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0) ||
    (a.bounds?.y ?? 0) - (b.bounds?.y ?? 0);
}

/**
 * Живые сессии — одной группой сверху, закрытые — по виртуальным столам.
 *
 * Раньше и те и другие лежали вперемешку в группах «стол · монитор», и три
 * работающие сессии терялись среди двух десятков вчерашних слотов.
 *
 * Живые не делятся по столам намеренно: их несколько, ищут их глазами, и
 * «где оно открыто» тут менее важно, чем «что из этого работает прямо сейчас».
 * Закрытые же режутся только по столу — монитор для закрытой сессии не значит
 * почти ничего, потому что мониторы переключаются чаще, чем живут слоты.
 */
function groupSessions(sessions) {
  const open = [];
  const groups = new Map();
  for (const s of sessions) {
    if (s.open) { open.push(s); continue; }
    const desktop = s.desktop ?? null;
    const key = `${desktop}`;
    if (!groups.has(key)) {
      groups.set(key, { desktop, monitor: null, label: desktopLabel(desktop), sessions: [] });
    }
    groups.get(key).sessions.push(s);
  }

  const past = [...groups.values()];
  for (const g of past) g.sessions.sort(byPosition);
  past.sort((a, b) => (a.desktop ?? DESKTOP_UNKNOWN) - (b.desktop ?? DESKTOP_UNKNOWN));

  if (!open.length) return past;
  open.sort(byPosition);
  return [{ desktop: null, monitor: null, label: 'Active sessions', sessions: open }, ...past];
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
 * calling GoToDesktopNumber). The stored session desktop is 1-based
 * (claude-wt/index.js stores `Number(num) + 1`), but it is never consulted
 * here: the window's *live* desktop — read fresh, right before this call —
 * is authoritative, since the stored value can be stale if the window moved
 * desktops since the last snapshot. So the target is always the live
 * desktop, converted back to the 0-based number GoToDesktopNumber expects;
 * that is a harmless no-op when the app is already showing that desktop, so
 * no comparison against the stored value is needed.
 *
 * `liveDesktop` commonly arrives as a *string*: the native call it comes
 * from, `windows11-manager`'s `GetWindowDesktopNumber`, regex-matches
 * `"desktop number (\d+)"` out of a CLI tool's text output and returns the
 * capture group as-is, never converting it to a number. `Number()` on that
 * string is this function's only real work.
 *
 * Returns the 0-based desktop number to pass to GoToDesktopNumber, or `null`
 * when the live desktop could not be determined (nothing to switch to).
 */
function resolveDesktopSwitch(liveDesktop) {
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
