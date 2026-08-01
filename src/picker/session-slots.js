/** Раскладка сессий claude-wt по фиксированным слотам. Без I/O. */

const DEFAULT_SLOTS = 9;

/**
 * Порядок сессий на экране.
 *
 * Живые идут первыми и группируются по виртуальным столам — на панели важно
 * сначала увидеть то, что работает прямо сейчас. Внутри стола порядок по
 * координатам, чтобы слоты не прыгали от тика к тику: набор сессий приходит в
 * порядке hwnd'ов, а он меняется.
 *
 * Закрытые идут следом по свежести: чем позже сессия подавала признаки жизни,
 * тем выше она нужна. Их обычно десятки, и в девять слотов попадут единицы —
 * поэтому сортировка тут важнее, чем группировка.
 */
function orderSessions(sessions) {
  const open = [];
  const closed = [];
  for (const s of sessions ?? []) (s.open ? open : closed).push(s);
  open.sort((a, b) =>
    (a.desktop ?? Number.MAX_SAFE_INTEGER) - (b.desktop ?? Number.MAX_SAFE_INTEGER) ||
    (a.bounds?.x ?? 0) - (b.bounds?.x ?? 0) ||
    (a.bounds?.y ?? 0) - (b.bounds?.y ?? 0));
  closed.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
  return [...open, ...closed];
}

/**
 * Что показывать в слоте.
 *
 * `review` здесь — это «работа встала, посмотри»: и stop/fail, и уведомление
 * «waiting for your input», которое хук пишет как idle. Фокус на окно гасит
 * оба, поэтому agentSeen проверяется до всего остального.
 *
 * Вопрос гаснет так же. Агент при этом остаётся заблокированным, и это
 * осознанный размен: панель, которая продолжает звать после того, как на
 * сессию сходили, перестаёт что-либо значить — на неё просто не смотрят.
 */
function slotStatus(session) {
  if (!session) return 'empty';
  if (!session.open) return 'closed';
  const needsAttention = session.agentState === 'question'
    || session.agentState === 'review'
    || (session.agentState === 'idle' && session.agentEvent === 'attention');
  if (needsAttention) {
    if (session.agentSeen) return 'idle';
    return session.agentState === 'question' ? 'question' : 'review';
  }
  return session.agentState === 'active' ? 'active' : 'idle';
}

/** Пустой слот — это тоже состояние: панель показывает N строк всегда. */
function emptySlot(index) {
  return {
    slot: index + 1,
    id: '',
    title: '',
    cwd: '',
    status: 'empty',
    open: false,
    desktop: null,
    monitor: null,
    lastActivity: null,
    message: '',
    summary: '',
  };
}

function buildSlots(sessions, count = DEFAULT_SLOTS) {
  const ordered = orderSessions(sessions);
  return Array.from({ length: count }, (_, i) => {
    const s = ordered[i];
    if (!s) return emptySlot(i);
    return {
      slot: i + 1,
      id: s.id,
      title: s.label || s.title || '',
      cwd: s.cwd ?? '',
      status: slotStatus(s),
      open: Boolean(s.open),
      desktop: s.desktop ?? null,
      monitor: s.monitor ?? null,
      lastActivity: s.lastActivity ?? null,
      message: s.agentMessage ?? '',
      // Чем сессия закончила: первая строка последнего ответа агента. В строку
      // панели не влезает, но годится в подсказку и в нижнюю строку состояния.
      summary: s.agentSummary ?? '',
    };
  });
}

/** Сессия, сидящая в слоте с этим номером, или null. */
function sessionIdForSlot(slots, slot) {
  const n = Number(slot);
  if (!Number.isInteger(n)) return null;
  return slots?.find(s => s.slot === n)?.id || null;
}

module.exports = { DEFAULT_SLOTS, orderSessions, slotStatus, buildSlots, sessionIdForSlot };
