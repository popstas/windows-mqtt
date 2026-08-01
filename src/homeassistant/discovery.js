/** MQTT Discovery для Home Assistant. Чистая сборка полезной нагрузки, без I/O. */

const DISCOVERY_PREFIX = 'homeassistant';

// Один идентификатор устройства на всё: HA собирает по нему сущности в
// карточку «claude-wt». Через REST такое недостижимо — устройства живут в
// реестре, а /api/states пишет только состояние.
const DEVICE = {
  identifiers: ['claude_wt'],
  name: 'claude-wt',
  manufacturer: 'windows-mqtt',
  model: 'Claude Code sessions',
};

/** Базовые топики. Всё под одной веткой, чтобы чистилось одной подпиской. */
function topics(base) {
  const root = `${base}/claude`;
  return {
    root,
    availability: `${root}/availability`,
    slot: n => `${root}/slot/${n}`,
    slotCommand: n => `${root}/slot/${n}/set`,
    summary: `${root}/summary`,
    slotConfig: n => `${DISCOVERY_PREFIX}/switch/claude_wt/slot_${n}/config`,
    summaryConfig: `${DISCOVERY_PREFIX}/sensor/claude_wt/summary/config`,
  };
}

/**
 * Конфиг слота.
 *
 * Тип switch, а не binary_sensor: у switch есть `command_topic`, и нажатие в
 * интерфейсе Home Assistant превращается в переход на эту сессию. Состояние
 * при этом остаётся тем же признаком «нужен ли я тебе», поэтому переключатель
 * сразу вернётся в положение, которое пришлёт windows-mqtt, — это ожидаемо.
 *
 * `optimistic: false` и `assumed_state: true`: состоянием управляет не HA, а
 * то, что происходит в окне, поэтому HA не должен считать, будто знает
 * результат нажатия заранее.
 *
 * Состояние и атрибуты берутся из одного топика: `value_template` вынимает
 * флаг, `json_attributes_topic` отдаёт всё остальное. Два топика на слот
 * означали бы две публикации и момент рассинхрона между ними.
 *
 * `object_id` фиксирует entity_id как switch.claude_session_N.
 */
function slotConfig(base, n) {
  const t = topics(base);
  return {
    name: `Session ${n}`,
    unique_id: `claude_wt_slot_${n}`,
    object_id: `claude_session_${n}`,
    state_topic: t.slot(n),
    value_template: '{{ value_json.state }}',
    json_attributes_topic: t.slot(n),
    command_topic: t.slotCommand(n),
    payload_on: 'ON',
    payload_off: 'OFF',
    state_on: 'on',
    state_off: 'off',
    optimistic: false,
    assumed_state: true,
    icon: 'mdi:console',
    availability_topic: t.availability,
    device: DEVICE,
  };
}

function summaryConfig(base) {
  const t = topics(base);
  return {
    name: 'Sessions',
    unique_id: 'claude_wt_summary',
    object_id: 'claude_sessions',
    state_topic: t.summary,
    value_template: '{{ value_json.state }}',
    json_attributes_topic: t.summary,
    unit_of_measurement: 'sessions',
    icon: 'mdi:console-network',
    availability_topic: t.availability,
    device: DEVICE,
  };
}

/**
 * Все сообщения одного экспорта: сначала конфиги (только когда просят), затем
 * состояния.
 *
 * Конфиги публикуются retained и только при старте: HA держит их у себя, и
 * повторять их каждые пятнадцать секунд значит гонять по брокеру килобайты
 * ради ничего.
 *
 * Состояния тоже retained — иначе после перезапуска HA сущности повисли бы
 * недоступными до следующего тика экспорта.
 */
function discoveryMessages(base, count) {
  const t = topics(base);
  const out = [{ topic: t.availability, payload: 'online', retain: true }];
  out.push({ topic: t.summaryConfig, payload: JSON.stringify(summaryConfig(base)), retain: true });
  for (let n = 1; n <= count; n += 1) {
    out.push({ topic: t.slotConfig(n), payload: JSON.stringify(slotConfig(base, n)), retain: true });
  }
  return out;
}

/** Полезная нагрузка слота: флаг внимания плюс все подробности сессии. */
function stateMessages(base, entities) {
  const t = topics(base);
  return (entities ?? []).map(e => {
    const slot = e.attributes?.slot;
    const topic = slot === undefined ? t.summary : t.slot(slot);
    return {
      topic,
      payload: JSON.stringify({ state: String(e.state), ...e.attributes }),
      retain: true,
    };
  });
}

/**
 * Снять устройство целиком: пустая нагрузка в топик конфига удаляет сущность
 * из HA. Нужно, когда меняется число слотов, иначе лишние повисают навсегда.
 */
function removalMessages(base, from, to) {
  const t = topics(base);
  const out = [];
  for (let n = from; n <= to; n += 1) {
    out.push({ topic: t.slotConfig(n), payload: '', retain: true });
    out.push({ topic: t.slot(n), payload: '', retain: true });
  }
  return out;
}

module.exports = {
  DISCOVERY_PREFIX,
  DEVICE,
  topics,
  slotConfig,
  summaryConfig,
  discoveryMessages,
  stateMessages,
  removalMessages,
};
