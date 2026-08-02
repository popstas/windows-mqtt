/** Раскладка сессий claude-wt по фиксированным слотам. Без I/O. */

const { compareSessions, DEFAULT_SORT } = require('./session-groups');

const DEFAULT_SLOTS = 9;

/**
 * Порядок сессий на панели / в Home Assistant.
 *
 * Живые идут первыми — на панели важно сначала увидеть то, что работает
 * прямо сейчас. Внутри каждой группы — тот же режим, что у пикера
 * (`sessionsSort`: cost | oldest | newest | recent | name). Закрытые следом
 * тем же компаратором: в девять слотов попадут единицы, и сортировка тут
 * важнее группировки по столу.
 */
function orderSessions(sessions, sort = DEFAULT_SORT) {
  const open = [];
  const closed = [];
  for (const s of sessions ?? []) (s.open ? open : closed).push(s);
  open.sort((a, b) => compareSessions(a, b, sort));
  closed.sort((a, b) => compareSessions(a, b, sort));
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
    lastSummary: '',
    costUsd: 0,
    contextPct: 0,
  };
}

function buildSlots(sessions, count = DEFAULT_SLOTS, sort = DEFAULT_SORT) {
  const ordered = orderSessions(sessions, sort);
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
      // Не стирается у работающей сессии, в отличие от summary: «на чём
      // остановилась в прошлый раз» — вопрос отдельный от «что говорит сейчас».
      lastSummary: s.agentLastSummary ?? '',
      // Во что обошлась сессия и сколько от контекста съедено. Ноль — данных
      // нет: перехват статуслайна стоит не у всех.
      costUsd: s.agentCostUsd ?? 0,
      contextPct: s.agentContextPct ?? 0,
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
