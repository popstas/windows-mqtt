// Loaded twice: as a <script> in sessions.html and as a module in the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PickerSnapshots = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  function isSnapshotsCommand(query) {
    const q = String(query ?? '').trim().toLowerCase();
    return q === '/s' || q === '/snapshots';
  }

  function projectBasename(session) {
    const cwd = session?.cwd != null ? String(session.cwd).trim() : '';
    if (cwd) {
      const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
    return String(session?.title ?? '').trim() || '—';
  }

  function formatSnapshotTime(snapshot) {
    const sec = Number(snapshot?.created);
    if (Number.isFinite(sec) && sec > 0) {
      const d = new Date(sec * 1000);
      const p = n => String(n).padStart(2, '0');
      return `${p(d.getHours())}:${p(d.getMinutes())}`
        + ` · ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }
    return String(snapshot?.id ?? '');
  }

  function missingLabel(session) {
    return projectBasename(session);
  }

  /**
   * Строки режима /s: дата+count, basenames, restore n: missing.
   *
   * `openSessionIds` — Set id сессий, у которых сейчас есть окно.
   */
  function buildSnapshotRows(snapshots, openSessionIds) {
    const open = openSessionIds instanceof Set ? openSessionIds : new Set(openSessionIds ?? []);
    return (snapshots ?? []).map((snap, n) => {
      const sessions = snap.sessions ?? [];
      const names = sessions.map(projectBasename);
      const missing = sessions.filter(s => !open.has(s.id)).map(missingLabel);
      const count = sessions.length;
      const countLabel = count === 1 ? '1 session' : `${count} sessions`;
      return {
        id: snap.id,
        n,
        line1: `${formatSnapshotTime(snap)} · ${countLabel}`,
        line2: names.join(' · ') || '—',
        line3: `restore ${n}: ${missing.length ? missing.join(', ') : '—'}`,
      };
    });
  }

  return { isSnapshotsCommand, projectBasename, buildSnapshotRows, formatSnapshotTime };
});
