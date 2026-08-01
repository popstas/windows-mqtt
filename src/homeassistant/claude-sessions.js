/** Сущности Home Assistant для сессий claude-wt. Чистая сборка, без I/O. */

const { buildSlots } = require('../picker/session-slots');

const SLOT_PREFIX = 'sensor.claude_session_';

// Значок состояния прямо в тексте: openHASP рисует строку как есть, а
// раскрашивать её по атрибуту — это шаблон в каждой кнопке. Один символ в
// начале читается с двух метров и не требует ничего от панели.
const STATUS_GLYPH = {
  active: '▶',
  question: '?',
  review: '!',
  idle: '·',
  closed: '×',
  empty: '',
};

/**
 * Текст, который увидит панель.
 *
 * Пустой слот — пустая строка, а не «—»: девять слотов на экране, из них
 * занята бывает половина, и ряд прочерков выглядит как поломка.
 */
function slotText(slot) {
  if (!slot || slot.status === 'empty') return '';
  const glyph = STATUS_GLYPH[slot.status] ?? '';
  return `${glyph} ${slot.title}`.trim();
}

/**
 * Слоты сессий как сущности HA.
 *
 * Номер слота — часть entity_id, и это принципиально: кнопка на панели
 * прибита к строке, а не к сессии, поэтому и сущность должна быть привязана к
 * строке. Иначе при каждом изменении состава пришлось бы переписывать
 * конфигурацию панели.
 */
function buildSessionEntities(sessions, count) {
  const slots = buildSlots(sessions, count);
  return slots.map(slot => ({
    entityId: `${SLOT_PREFIX}${slot.slot}`,
    state: slotText(slot),
    attributes: {
      friendly_name: `Claude session ${slot.slot}`,
      icon: 'mdi:console',
      slot: slot.slot,
      session_id: slot.id,
      title: slot.title,
      cwd: slot.cwd,
      status: slot.status,
      open: slot.open,
      desktop: slot.desktop,
      monitor: slot.monitor,
      last_activity: slot.lastActivity,
      message: slot.message,
    },
  }));
}

/** Сводная сущность: сколько сессий живо и сколько из них ждут внимания. */
function buildSummaryEntity(sessions) {
  const list = sessions ?? [];
  const open = list.filter(s => s.open);
  const waiting = open.filter(s => s.agentState === 'question'
    || (!s.agentSeen && (s.agentState === 'review'
      || (s.agentState === 'idle' && s.agentEvent === 'attention'))));
  return {
    entityId: 'sensor.claude_sessions',
    state: open.length,
    attributes: {
      friendly_name: 'Claude sessions',
      icon: 'mdi:console-network',
      unit_of_measurement: 'sessions',
      total: list.length,
      open: open.length,
      waiting: waiting.length,
      working: open.filter(s => s.agentState === 'active').length,
    },
  };
}

module.exports = { SLOT_PREFIX, STATUS_GLYPH, slotText, buildSessionEntities, buildSummaryEntity };
